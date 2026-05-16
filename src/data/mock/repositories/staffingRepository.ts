import type { AppDb } from "../../../domain/models";
import type { StaffingRepository } from "../../../domain/repository";
import {
  buildNotificationCenterItemFromLeaveRequest,
  upsertNotificationCenterItem
} from "./notificationCenter";

const weekdayToIndex: Record<string, number> = {
  星期日: 0,
  星期一: 1,
  星期二: 2,
  星期三: 3,
  星期四: 4,
  星期五: 5,
  星期六: 6
};

export function createStaffingRepository(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): StaffingRepository {
  const formatDateInputValue = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const normalizeReferenceDate = (value?: string) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : formatDateInputValue();

  const buildMonthRange = (referenceDate: string, monthOffset: number) => {
    const date = new Date(`${referenceDate}T00:00:00`);
    const year = date.getFullYear();
    const month = date.getMonth() + monthOffset;
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    return {
      start,
      end,
      label: `${start.getFullYear()}年${start.getMonth() + 1}月`
    };
  };

  const parseServiceSlotWeekday = (serviceSlot: string) => {
    const normalizedSlot = serviceSlot.replace(/\s/g, "").replace("星期天", "星期日");
    const matchedWeekday = Object.keys(weekdayToIndex).find((weekday) =>
      normalizedSlot.startsWith(weekday)
    );
    return matchedWeekday ? weekdayToIndex[matchedWeekday] : null;
  };

  const listServiceSlotOccurrenceDates = (serviceSlot: string, start: Date, end: Date) => {
    const targetWeekday = parseServiceSlotWeekday(serviceSlot);
    if (targetWeekday === null) {
      return [];
    }

    const dates: string[] = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor < end) {
      if (cursor.getDay() === targetWeekday) {
        dates.push(formatDateInputValue(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  };

  const isDoctorSideUnavailableSchedule = (schedule: AppDb["visit_schedules"][number]) => {
    const note = schedule.note.replace(/\s/g, "");
    return note.includes("醫師請假") || note.includes("醫師服務時段異動");
  };

  const isExplicitPatientSideUnavailableSchedule = (schedule: AppDb["visit_schedules"][number]) => {
    if (isDoctorSideUnavailableSchedule(schedule)) {
      return false;
    }
    if (schedule.status === "paused" || schedule.last_feedback_code === "absent") {
      return true;
    }
    if (!["cancelled", "rescheduled"].includes(schedule.status)) {
      return false;
    }

    const note = schedule.note.replace(/\s/g, "");
    return (
      /(個案|患者|病家|家屬).*(請假|外出|不在家|改期|取消|暫停)/.test(note) ||
      /(請假|外出|不在家|改期|取消|暫停).*(個案|患者|病家|家屬)/.test(note)
    );
  };

  const isUnservedAfterDueSchedule = (
    db: AppDb,
    schedule: AppDb["visit_schedules"][number],
    cutoff: Date
  ) => {
    const scheduledEnd = new Date(schedule.scheduled_end_at);
    if (scheduledEnd > cutoff || isDoctorSideUnavailableSchedule(schedule)) {
      return false;
    }
    const statisticalRouteItems = db.saved_route_plans.flatMap((routePlan) =>
      ["executing", "archived", "completed"].includes(routePlan.execution_status)
        ? routePlan.route_items.filter((item) => item.schedule_id === schedule.id)
        : []
    );
    if (statisticalRouteItems.length === 0) {
      return false;
    }
    if (
      schedule.status === "completed" ||
      db.visit_records.some((record) => record.visit_schedule_id === schedule.id) ||
      statisticalRouteItems.some((item) => item.checked && item.status !== "paused")
    ) {
      return false;
    }

    return true;
  };

  const buildPausedPatientStats = (db: AppDb, start: Date, end: Date) =>
    db.patients
      .filter((patient) => patient.status === "paused")
      .map((patient) => {
        const doctor = db.doctors.find((item) => item.id === patient.preferred_doctor_id);
        const occurrenceDates = listServiceSlotOccurrenceDates(patient.preferred_service_slot, start, end);
        return {
          source: "patient_status" as const,
          patientId: patient.id,
          patientName: patient.name,
          doctorId: patient.preferred_doctor_id,
          doctorName: doctor?.name ?? patient.preferred_doctor_id,
          serviceSlot: patient.preferred_service_slot,
          expectedVisitCount: occurrenceDates.length,
          reminderTags: patient.reminder_tags,
          occurrenceDates
        };
      })
      .sort(
        (left, right) =>
          right.expectedVisitCount - left.expectedVisitCount ||
          left.serviceSlot.localeCompare(right.serviceSlot, "zh-Hant") ||
          left.patientName.localeCompare(right.patientName, "zh-Hant")
      );

  const buildTemporaryPausedScheduleStats = (
    db: AppDb,
    start: Date,
    end: Date,
    cutoff: Date,
    excludedScheduleIds: Set<string>
  ) =>
    db.visit_schedules
      .filter((schedule) => {
        const scheduleStart = new Date(schedule.scheduled_start_at);
        const isUnservedAfterDue = isUnservedAfterDueSchedule(db, schedule, cutoff);
        return (
          (isExplicitPatientSideUnavailableSchedule(schedule) || isUnservedAfterDue) &&
          scheduleStart >= start &&
          scheduleStart < end &&
          (!excludedScheduleIds.has(schedule.id) || isUnservedAfterDue)
        );
      })
      .map((schedule) => {
        const patient = db.patients.find((item) => item.id === schedule.patient_id);
        const doctor = db.doctors.find((item) => item.id === schedule.assigned_doctor_id);
        return {
          source: "temporary_schedule" as const,
          patientId: schedule.patient_id,
          patientName: patient?.name ?? schedule.patient_id,
          doctorId: schedule.assigned_doctor_id,
          doctorName: doctor?.name ?? schedule.assigned_doctor_id,
          serviceSlot: schedule.service_time_slot,
          expectedVisitCount: 1,
          reminderTags: schedule.reminder_tags,
          scheduleId: schedule.id,
          scheduledStartAt: schedule.scheduled_start_at,
          note: schedule.note
        };
      })
      .sort(
        (left, right) =>
          (left.scheduledStartAt ?? "").localeCompare(right.scheduledStartAt ?? "") ||
          left.patientName.localeCompare(right.patientName, "zh-Hant")
      );

  const getImpactedSchedules = (doctorId: string, startDate: string, endDate: string) => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    return getDb().visit_schedules.filter((schedule) => {
      const scheduleStart = new Date(schedule.scheduled_start_at);
      return (
        schedule.assigned_doctor_id === doctorId &&
        scheduleStart >= start &&
        scheduleStart <= end &&
        !["completed", "cancelled"].includes(schedule.status)
      );
    });
  };

  const cancelSchedulesForLeave = (db: AppDb, leaveRequestId: string, now: string) => {
    const leaveRequest = db.leave_requests.find((item) => item.id === leaveRequestId);
    if (!leaveRequest) {
      return db;
    }

    const impactedSchedules = getImpactedSchedules(
      leaveRequest.doctor_id,
      leaveRequest.start_date,
      leaveRequest.end_date
    );
    const impactedScheduleIds = new Set(impactedSchedules.map((schedule) => schedule.id));
    if (impactedScheduleIds.size === 0) {
      return db;
    }

    const cancelReason = `醫師請假：${leaveRequest.reason}`;
    return {
      ...db,
      visit_schedules: db.visit_schedules.map((schedule) =>
        impactedScheduleIds.has(schedule.id)
          ? {
              ...schedule,
              status: "cancelled" as const,
              route_order: 0,
              note: schedule.note.includes(cancelReason)
                ? schedule.note
                : `${schedule.note}｜取消：${cancelReason}`,
              updated_at: now
            }
          : schedule
      ),
      saved_route_plans: db.saved_route_plans.map((routePlan) => {
        let didChange = false;
        const nextRouteItems = routePlan.route_items.map((item) => {
          if (!item.schedule_id || !impactedScheduleIds.has(item.schedule_id)) {
            return item;
          }
          didChange = true;
          return {
            ...item,
            checked: false,
            route_order: null,
            status: "paused" as const
          };
        });
        return didChange
          ? {
              ...routePlan,
              route_items: nextRouteItems,
              schedule_ids: routePlan.schedule_ids.filter((scheduleId) => !impactedScheduleIds.has(scheduleId)),
              updated_at: now
            }
          : routePlan;
      }),
      reminders: db.reminders.map((reminder) =>
        reminder.related_visit_schedule_id && impactedScheduleIds.has(reminder.related_visit_schedule_id)
          ? {
              ...reminder,
              status: "dismissed" as const,
              updated_at: now
            }
          : reminder
      ),
      notification_center_items: db.notification_center_items.map((item) =>
        item.linked_visit_schedule_id && impactedScheduleIds.has(item.linked_visit_schedule_id)
          ? {
              ...item,
              status: "closed",
              is_unread: false,
              updated_at: now
            }
          : item
      )
    };
  };

  const getSchedulesFromCompletionRecords = (db: AppDb, records: AppDb["route_completion_records"]) => {
    const scheduleIds = new Set(
      records.flatMap((record) => record.schedule_ids)
    );

    return db.visit_schedules.filter((schedule) => scheduleIds.has(schedule.id));
  };

  const getUnservedRouteSchedulesFromCompletionRecord = (
    db: AppDb,
    record: AppDb["route_completion_records"][number]
  ) => {
    const routePlan = db.saved_route_plans.find((item) => item.id === record.route_plan_id);
    if (!routePlan) {
      return [];
    }

    const pausedScheduleIds = new Set(
      routePlan.route_items
        .filter((item) => !item.checked || item.status === "paused")
        .map((item) => item.schedule_id)
        .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
    );
    return db.visit_schedules.filter(
      (schedule) => pausedScheduleIds.has(schedule.id) && !isDoctorSideUnavailableSchedule(schedule)
    );
  };

  const buildCompletionRecordStats = (input: {
    db: AppDb;
    records: AppDb["route_completion_records"];
    label: string;
    pausedPatients: ReturnType<typeof buildPausedPatientStats>;
    temporaryPausedSchedules: ReturnType<typeof buildTemporaryPausedScheduleStats>;
  }) => {
    const pausedRecordKeys = new Set<string>();
    input.records.forEach((record) => {
      const pausedRecordSchedules = [
        ...getSchedulesFromCompletionRecords(input.db, [record])
          .filter((schedule) => isExplicitPatientSideUnavailableSchedule(schedule)),
        ...getUnservedRouteSchedulesFromCompletionRecord(input.db, record)
      ].filter(
        (schedule, index, schedules) => schedules.findIndex((item) => item.id === schedule.id) === index
      );
      pausedRecordSchedules.forEach((schedule) => {
        pausedRecordKeys.add(`${schedule.patient_id}:${schedule.scheduled_start_at.slice(0, 10)}`);
      });

      const missingPausedIdentities = Math.max(0, record.paused_count - pausedRecordSchedules.length);
      for (let index = 0; index < missingPausedIdentities; index += 1) {
        pausedRecordKeys.add(`route-record:${record.id}:${index + 1}:${record.route_date}`);
      }
    });
    const temporaryPausedKeys = new Set(
      input.temporaryPausedSchedules.map((schedule) =>
        `${schedule.patientId}:${schedule.scheduledStartAt?.slice(0, 10) ?? schedule.scheduleId ?? "unknown"}`
      )
    );
    const pausedScheduledKeys = new Set([
      ...pausedRecordKeys,
      ...temporaryPausedKeys
    ]);
    const unrepresentedPausedPatientKeys = new Set<string>();
    input.pausedPatients.forEach((patient) => {
      patient.occurrenceDates.forEach((date) => {
        const key = `${patient.patientId}:${date}`;
        if (!pausedScheduledKeys.has(key)) {
          unrepresentedPausedPatientKeys.add(key);
        }
      });
    });
    const pausedKeys = new Set([
      ...pausedScheduledKeys,
      ...unrepresentedPausedPatientKeys
    ]);

    return {
      label: input.label,
      executedVisitCount: input.records.reduce((count, record) => count + record.executed_visit_count, 0),
      pausedCount: pausedKeys.size,
      urgentCount: input.records.reduce((count, record) => count + record.urgent_count, 0),
      routePlanCount: input.records.length,
      pausedScheduledCount: pausedScheduledKeys.size,
      pausedPatientExpectedCount: unrepresentedPausedPatientKeys.size,
      pausedTemporaryScheduleCount: temporaryPausedKeys.size
    };
  };

  const buildDoctorPerformance = (input: {
    db: AppDb;
    records: AppDb["route_completion_records"];
    pausedPatients: ReturnType<typeof buildPausedPatientStats>;
    temporaryPausedSchedules: ReturnType<typeof buildTemporaryPausedScheduleStats>;
  }) => {
    const performanceByDoctorId = new Map<
      string,
      {
        doctorId: string;
        doctorName: string;
        routePlanCount: number;
        completedRouteCount: number;
        executedVisitCount: number;
        pausedCount: number;
        pausedKeys: Set<string>;
        urgentCount: number;
      }
    >();

    const ensurePerformance = (doctorId: string, doctorName?: string) => {
      const doctor = input.db.doctors.find((item) => item.id === doctorId);
      const existing = performanceByDoctorId.get(doctorId);
      if (existing) {
        return existing;
      }
      const nextPerformance = {
        doctorId,
        doctorName: doctorName ?? doctor?.name ?? doctorId,
        routePlanCount: 0,
        completedRouteCount: 0,
        executedVisitCount: 0,
        pausedCount: 0,
        pausedKeys: new Set<string>(),
        urgentCount: 0
      };
      performanceByDoctorId.set(doctorId, nextPerformance);
      return nextPerformance;
    };

    input.db.doctors.forEach((doctor) => {
      ensurePerformance(doctor.id, doctor.name);
    });

    input.records.forEach((record) => {
      const performance = ensurePerformance(record.doctor_id);
      performance.routePlanCount += 1;
      performance.completedRouteCount += record.completed_at ? 1 : 0;
      performance.executedVisitCount += record.executed_visit_count;
      performance.urgentCount += record.urgent_count;
    });

    input.records.forEach((record) => {
      const pausedRecordSchedules = [
        ...getSchedulesFromCompletionRecords(input.db, [record])
          .filter((schedule) => isExplicitPatientSideUnavailableSchedule(schedule)),
        ...getUnservedRouteSchedulesFromCompletionRecord(input.db, record)
      ].filter(
        (schedule, index, schedules) => schedules.findIndex((item) => item.id === schedule.id) === index
      );
      pausedRecordSchedules.forEach((schedule) => {
        const performance = ensurePerformance(schedule.assigned_doctor_id);
        performance.pausedKeys.add(`${schedule.patient_id}:${schedule.scheduled_start_at.slice(0, 10)}`);
      });

      const missingPausedIdentities = Math.max(0, record.paused_count - pausedRecordSchedules.length);
      if (missingPausedIdentities > 0) {
        const performance = ensurePerformance(record.doctor_id);
        for (let index = 0; index < missingPausedIdentities; index += 1) {
          performance.pausedKeys.add(`route-record:${record.id}:${index + 1}:${record.route_date}`);
        }
      }
    });

    input.pausedPatients.forEach((patient) => {
      const performance = ensurePerformance(patient.doctorId, patient.doctorName);
      patient.occurrenceDates.forEach((date) => performance.pausedKeys.add(`${patient.patientId}:${date}`));
    });

    input.temporaryPausedSchedules.forEach((patient) => {
      const performance = ensurePerformance(patient.doctorId, patient.doctorName);
      performance.pausedKeys.add(
        `${patient.patientId}:${patient.scheduledStartAt?.slice(0, 10) ?? patient.scheduleId ?? "unknown"}`
      );
    });

    return Array.from(performanceByDoctorId.values())
      .map((performance) => {
        const pausedCount = performance.pausedKeys.size;
        const completionRate =
          performance.routePlanCount > 0
            ? Math.round((performance.completedRouteCount / performance.routePlanCount) * 100)
            : 0;
        const score =
          performance.executedVisitCount * 10 +
          performance.completedRouteCount * 5 -
          pausedCount * 4 -
          performance.urgentCount * 8;
        return {
          doctorId: performance.doctorId,
          doctorName: performance.doctorName,
          routePlanCount: performance.routePlanCount,
          completedRouteCount: performance.completedRouteCount,
          executedVisitCount: performance.executedVisitCount,
          pausedCount,
          urgentCount: performance.urgentCount,
          completionRate,
          score
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.executedVisitCount - left.executedVisitCount ||
          left.urgentCount - right.urgentCount ||
          left.pausedCount - right.pausedCount ||
          left.doctorName.localeCompare(right.doctorName, "zh-Hant")
      )
      .map((performance, index) => ({
        ...performance,
        rank: index + 1
      }));
  };

  const resolveStatsCutoff = (referenceDate: string, rangeEnd: Date) => {
    const now = new Date();
    const referenceEnd = new Date(`${referenceDate}T23:59:59.999`);
    if (formatDateInputValue(now) === referenceDate) {
      return now;
    }
    return referenceEnd < rangeEnd ? referenceEnd : rangeEnd;
  };

  return {
    getAdminDashboard(options) {
      const db = getDb();
      const referenceDate = normalizeReferenceDate(options?.referenceDate);
      const pendingLeaveRequests = db.leave_requests.filter((leave) => leave.status === "pending");
      const pendingRescheduleActions = db.reschedule_actions.filter((item) =>
        ["pending", "draft"].includes(item.status)
      );
      const draftRoutePlans = db.saved_route_plans.filter(
        (routePlan) => routePlan.execution_status === "draft"
      );
      const statisticalRecords = db.route_completion_records;
      const completedRecordScheduleIds = new Set(
        statisticalRecords.flatMap((record) => record.schedule_ids)
      );
      const dailyRecords = statisticalRecords.filter((record) => record.route_date === referenceDate);
      const dailyRouteSchedules = getSchedulesFromCompletionRecords(db, dailyRecords);
      const patientExceptionItems = db.notification_center_items.filter(
        (item) => item.role === "admin" && item.source_type === "patient_exception"
      );
      const pendingPatientExceptionItems = patientExceptionItems.filter(
        (item) => item.role === "admin" && item.status === "pending" && item.source_type === "patient_exception"
      );
      const exceptionScheduleIds = new Set(
        pendingPatientExceptionItems
          .map((item) => item.linked_visit_schedule_id)
          .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
      );
      const exceptionSchedulesByStatus = dailyRouteSchedules.filter(
        (schedule) =>
          ["paused", "issue_pending", "followup_pending", "rescheduled", "cancelled"].includes(schedule.status) ||
          exceptionScheduleIds.has(schedule.id)
      );
      const dailyRouteScheduleIds = new Set(dailyRouteSchedules.map((schedule) => schedule.id));
      const exceptionSchedulesFromNotifications = pendingPatientExceptionItems
        .map((item) =>
          item.linked_visit_schedule_id
            ? db.visit_schedules.find((schedule) => schedule.id === item.linked_visit_schedule_id)
            : undefined
        )
        .filter(
          (schedule): schedule is AppDb["visit_schedules"][number] =>
            schedule !== undefined && dailyRouteScheduleIds.has(schedule.id)
        );
      const exceptionSchedules = [
        ...exceptionSchedulesByStatus,
        ...exceptionSchedulesFromNotifications.filter(
          (schedule) => !exceptionSchedulesByStatus.some((item) => item.id === schedule.id)
        )
      ];
      const currentMonthRange = buildMonthRange(referenceDate, 0);
      const isCurrentMonthRange = (() => {
        const todayMonthRange = buildMonthRange(formatDateInputValue(), 0);
        return currentMonthRange.label === todayMonthRange.label;
      })();
      const currentMonthPausedPatients = isCurrentMonthRange ? buildPausedPatientStats(
        db,
        currentMonthRange.start,
        currentMonthRange.end
      ) : [];
      const currentMonthTemporaryPausedSchedules = buildTemporaryPausedScheduleStats(
        db,
        currentMonthRange.start,
        currentMonthRange.end,
        resolveStatsCutoff(referenceDate, currentMonthRange.end),
        completedRecordScheduleIds
      );
      const currentMonthRecords = statisticalRecords.filter((record) => {
        const routeDate = new Date(`${record.route_date}T00:00:00`);
        return routeDate >= currentMonthRange.start && routeDate < currentMonthRange.end;
      });
      const previousMonthRange = buildMonthRange(referenceDate, -1);
      const previousMonthPausedPatients: ReturnType<typeof buildPausedPatientStats> = [];
      const previousMonthTemporaryPausedSchedules = buildTemporaryPausedScheduleStats(
        db,
        previousMonthRange.start,
        previousMonthRange.end,
        previousMonthRange.end,
        completedRecordScheduleIds
      );
      const previousMonthRecords = statisticalRecords.filter((record) => {
        const routeDate = new Date(`${record.route_date}T00:00:00`);
        return routeDate >= previousMonthRange.start && routeDate < previousMonthRange.end;
      });
      const dailyStart = new Date(`${referenceDate}T00:00:00`);
      const dailyEnd = new Date(dailyStart);
      dailyEnd.setDate(dailyStart.getDate() + 1);
      const dailyPausedPatients =
        referenceDate === formatDateInputValue() ? buildPausedPatientStats(db, dailyStart, dailyEnd) : [];
      const dailyTemporaryPausedSchedules = buildTemporaryPausedScheduleStats(
        db,
        dailyStart,
        dailyEnd,
        resolveStatsCutoff(referenceDate, dailyEnd),
        completedRecordScheduleIds
      );

      return {
        referenceDate,
        daily: {
          ...buildCompletionRecordStats({
            db,
            records: dailyRecords,
            label: referenceDate,
            pausedPatients: dailyPausedPatients,
            temporaryPausedSchedules: dailyTemporaryPausedSchedules
          }),
          date: referenceDate
        },
        currentMonth: buildCompletionRecordStats({
          db,
          records: currentMonthRecords,
          label: currentMonthRange.label,
          pausedPatients: currentMonthPausedPatients,
          temporaryPausedSchedules: currentMonthTemporaryPausedSchedules
        }),
        previousMonth: buildCompletionRecordStats({
          db,
          records: previousMonthRecords,
          label: previousMonthRange.label,
          pausedPatients: previousMonthPausedPatients,
          temporaryPausedSchedules: previousMonthTemporaryPausedSchedules
        }),
        draftRouteCount: draftRoutePlans.length,
        unrecordedCount: dailyRouteSchedules.filter(
          (schedule) =>
            schedule.status === "completed" &&
            !db.visit_records.some((record) => record.visit_schedule_id === schedule.id)
        ).length,
        rescheduleCount: pendingRescheduleActions.length,
        pendingLeaveRequests,
        pendingRescheduleActions,
        draftRoutePlans,
        exceptionSchedules,
        pausedPatients: [...currentMonthTemporaryPausedSchedules, ...currentMonthPausedPatients],
        doctorPerformance: buildDoctorPerformance({
          db,
          records: currentMonthRecords,
          pausedPatients: currentMonthPausedPatients,
          temporaryPausedSchedules: currentMonthTemporaryPausedSchedules
        })
      };
    },
    getLeaveRequests() {
      return [...getDb().leave_requests];
    },
    getRescheduleActions() {
      return [...getDb().reschedule_actions];
    },
    createLeaveRequest(input) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextLeaveRequest = {
          id: `leave-${Date.now()}`,
          doctor_id: input.doctorId,
          start_date: input.startDate,
          end_date: input.endDate,
          reason: input.reason,
          status: input.status ?? "pending",
          handoff_note: input.handoffNote,
          rejection_reason: null,
          created_at: now,
          updated_at: now
        } as const;
        return {
          ...db,
          leave_requests: [nextLeaveRequest, ...db.leave_requests],
          notification_center_items: upsertNotificationCenterItem(
            db,
            buildNotificationCenterItemFromLeaveRequest(
              {
                ...db,
                leave_requests: [nextLeaveRequest, ...db.leave_requests]
              },
              nextLeaveRequest
            )
          )
        };
      });
    },
    updateLeaveRequestStatus(leaveRequestId, status, options) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextLeaveRequests = db.leave_requests.map((leaveRequest) =>
          leaveRequest.id === leaveRequestId
            ? {
                ...leaveRequest,
                status,
                rejection_reason:
                  status === "rejected"
                    ? options?.rejectionReason?.trim() || null
                    : null,
                updated_at: now
              }
            : leaveRequest
        );
        const targetLeaveRequest = nextLeaveRequests.find((leaveRequest) => leaveRequest.id === leaveRequestId);

        const nextDb = {
          ...db,
          leave_requests: nextLeaveRequests,
          notification_center_items: targetLeaveRequest
            ? upsertNotificationCenterItem(
                {
                  ...db,
                  leave_requests: nextLeaveRequests
                },
                {
                  ...buildNotificationCenterItemFromLeaveRequest(
                    {
                      ...db,
                      leave_requests: nextLeaveRequests
                    },
                    targetLeaveRequest
                  ),
                  is_unread: false,
                  updated_at: now
                }
              )
            : db.notification_center_items
          };
        return status === "approved" ? cancelSchedulesForLeave(nextDb, leaveRequestId, now) : nextDb;
      });
    },
    deleteLeaveRequest(leaveRequestId) {
      updateDb((db) => ({
        ...db,
        leave_requests: db.leave_requests.filter((leaveRequest) => leaveRequest.id !== leaveRequestId),
        notification_center_items: db.notification_center_items.filter(
          (item) =>
            item.linked_leave_request_id !== leaveRequestId &&
            item.id !== `nc-leave-${leaveRequestId}`
        )
      }));
    },
    getImpactedSchedules(doctorId, startDate, endDate) {
      return getImpactedSchedules(doctorId, startDate, endDate);
    }
  };
}
