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

  const countServiceSlotOccurrences = (serviceSlot: string, start: Date, end: Date) => {
    const targetWeekday = parseServiceSlotWeekday(serviceSlot);
    if (targetWeekday === null) {
      return 0;
    }

    let count = 0;
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor < end) {
      if (cursor.getDay() === targetWeekday) {
        count += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  };

  const buildPausedPatientStats = (db: AppDb, start: Date, end: Date) =>
    db.patients
      .filter((patient) => patient.status === "paused")
      .map((patient) => {
        const doctor = db.doctors.find((item) => item.id === patient.preferred_doctor_id);
        return {
          source: "patient_status" as const,
          patientId: patient.id,
          patientName: patient.name,
          doctorId: patient.preferred_doctor_id,
          doctorName: doctor?.name ?? patient.preferred_doctor_id,
          serviceSlot: patient.preferred_service_slot,
          expectedVisitCount: countServiceSlotOccurrences(patient.preferred_service_slot, start, end),
          reminderTags: patient.reminder_tags
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
    excludedScheduleIds: Set<string>
  ) =>
    db.visit_schedules
      .filter((schedule) => {
        const scheduleStart = new Date(schedule.scheduled_start_at);
        return (
          schedule.status === "paused" &&
          scheduleStart >= start &&
          scheduleStart < end &&
          !excludedScheduleIds.has(schedule.id)
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

  const buildCompletionRecordStats = (
    records: AppDb["route_completion_records"],
    label: string,
    pausedPatientExpectedCount = 0,
    pausedTemporaryScheduleCount = 0
  ) => {
    const completedRoutePausedCount = records.reduce((count, record) => count + record.paused_count, 0);
    const pausedScheduledCount = completedRoutePausedCount + pausedTemporaryScheduleCount;
    return {
      label,
      executedVisitCount: records.reduce((count, record) => count + record.executed_visit_count, 0),
      pausedCount: pausedScheduledCount + pausedPatientExpectedCount,
      urgentCount: records.reduce((count, record) => count + record.urgent_count, 0),
      routePlanCount: records.length,
      pausedScheduledCount,
      pausedPatientExpectedCount,
      pausedTemporaryScheduleCount
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
      performance.pausedCount += record.paused_count;
      performance.urgentCount += record.urgent_count;
    });

    input.pausedPatients.forEach((patient) => {
      const performance = ensurePerformance(patient.doctorId, patient.doctorName);
      performance.pausedCount += patient.expectedVisitCount;
    });

    input.temporaryPausedSchedules.forEach((patient) => {
      const performance = ensurePerformance(patient.doctorId, patient.doctorName);
      performance.pausedCount += 1;
    });

    return Array.from(performanceByDoctorId.values())
      .map((performance) => {
        const completionRate =
          performance.routePlanCount > 0
            ? Math.round((performance.completedRouteCount / performance.routePlanCount) * 100)
            : 0;
        const score =
          performance.executedVisitCount * 10 +
          performance.completedRouteCount * 5 -
          performance.pausedCount * 4 -
          performance.urgentCount * 8;
        return {
          ...performance,
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
      const currentMonthPausedPatients = buildPausedPatientStats(
        db,
        currentMonthRange.start,
        currentMonthRange.end
      );
      const currentMonthTemporaryPausedSchedules = buildTemporaryPausedScheduleStats(
        db,
        currentMonthRange.start,
        currentMonthRange.end,
        completedRecordScheduleIds
      );
      const currentMonthRecords = statisticalRecords.filter((record) => {
        const routeDate = new Date(`${record.route_date}T00:00:00`);
        return routeDate >= currentMonthRange.start && routeDate < currentMonthRange.end;
      });
      const previousMonthRange = buildMonthRange(referenceDate, -1);
      const previousMonthPausedPatients = buildPausedPatientStats(
        db,
        previousMonthRange.start,
        previousMonthRange.end
      );
      const previousMonthTemporaryPausedSchedules = buildTemporaryPausedScheduleStats(
        db,
        previousMonthRange.start,
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
      const dailyPausedPatients = buildPausedPatientStats(db, dailyStart, dailyEnd);
      const dailyTemporaryPausedSchedules = buildTemporaryPausedScheduleStats(
        db,
        dailyStart,
        dailyEnd,
        completedRecordScheduleIds
      );

      return {
        referenceDate,
        daily: {
          ...buildCompletionRecordStats(
            dailyRecords,
            referenceDate,
            dailyPausedPatients.reduce((count, patient) => count + patient.expectedVisitCount, 0),
            dailyTemporaryPausedSchedules.length
          ),
          date: referenceDate
        },
        currentMonth: buildCompletionRecordStats(
          currentMonthRecords,
          currentMonthRange.label,
          currentMonthPausedPatients.reduce((count, patient) => count + patient.expectedVisitCount, 0),
          currentMonthTemporaryPausedSchedules.length
        ),
        previousMonth: buildCompletionRecordStats(
          previousMonthRecords,
          previousMonthRange.label,
          previousMonthPausedPatients.reduce((count, patient) => count + patient.expectedVisitCount, 0),
          previousMonthTemporaryPausedSchedules.length
        ),
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
