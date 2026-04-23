import { compareAsc, isAfter, isBefore, isSameDay } from "date-fns";
import type {
  AppDb,
  RescheduleAction,
  SavedRoutePlan,
  VisitRecord,
  VisitSchedule
} from "../../../domain/models";
import type {
  ConfirmationSource,
  FamilyFollowUpStatus,
  UserRole,
  VisitFeedbackCode,
  VisitStatus
} from "../../../domain/enums";
import { applyVisitRecordRules } from "../../../domain/rules";
import type { RoutePlanningWindow, VisitRepository } from "../../../domain/repository";

function sortSchedules<T extends { scheduled_start_at: string; route_order?: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const orderDiff =
      (left.route_order ?? Number.MAX_SAFE_INTEGER) -
      (right.route_order ?? Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return compareAsc(new Date(left.scheduled_start_at), new Date(right.scheduled_start_at));
  });
}

function estimateDistanceKilometers(
  originLatitude: number | null | undefined,
  originLongitude: number | null | undefined,
  destinationLatitude: number | null | undefined,
  destinationLongitude: number | null | undefined
) {
  if (
    originLatitude === null ||
    originLatitude === undefined ||
    originLongitude === null ||
    originLongitude === undefined ||
    destinationLatitude === null ||
    destinationLatitude === undefined ||
    destinationLongitude === null ||
    destinationLongitude === undefined
  ) {
    return null;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destinationLatitude - originLatitude);
  const deltaLongitude = toRadians(destinationLongitude - originLongitude);
  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(toRadians(originLatitude)) *
      Math.cos(toRadians(destinationLatitude)) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function estimateTravelMinutes(
  originLatitude: number | null | undefined,
  originLongitude: number | null | undefined,
  destinationLatitude: number | null | undefined,
  destinationLongitude: number | null | undefined
) {
  const distanceKilometers = estimateDistanceKilometers(
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude
  );

  if (distanceKilometers === null) {
    return 20;
  }

  return Math.max(5, Math.round((distanceKilometers / 28) * 60));
}

function resolveScheduleServiceTimeSlot(schedule: VisitSchedule): "上午" | "下午" {
  if (schedule.service_time_slot.includes("上午")) {
    return "上午";
  }
  if (schedule.service_time_slot.includes("下午")) {
    return "下午";
  }
  return new Date(schedule.scheduled_start_at).getHours() < 13 ? "上午" : "下午";
}

function buildRoutePlanningWindow(options?: RoutePlanningWindow): Required<RoutePlanningWindow> {
  return {
    date: options?.date ?? new Date().toISOString().slice(0, 10),
    serviceTimeSlot: options?.serviceTimeSlot ?? "上午"
  };
}

function getRoutePlanningSchedules(
  db: AppDb,
  doctorId: string,
  options?: RoutePlanningWindow
) {
  const routeWindow = buildRoutePlanningWindow(options);
  return db.visit_schedules.filter(
    (schedule) =>
      schedule.assigned_doctor_id === doctorId &&
      schedule.scheduled_start_at.slice(0, 10) === routeWindow.date &&
      resolveScheduleServiceTimeSlot(schedule) === routeWindow.serviceTimeSlot &&
      !["completed", "cancelled"].includes(schedule.status)
  );
}

function buildShortestTravelRoute(
  schedules: VisitSchedule[],
  origin?:
    | {
        latitude: number;
        longitude: number;
      }
    | undefined
) {
  if (schedules.length <= 1) {
    return sortSchedules(schedules);
  }

  const remaining = [...schedules];
  const route: VisitSchedule[] = [];
  let currentPoint =
    origin ??
    (() => {
      const earliest = sortSchedules(remaining)[0];
      return earliest.home_latitude_snapshot !== null &&
        earliest.home_longitude_snapshot !== null
        ? {
            latitude: earliest.home_latitude_snapshot,
            longitude: earliest.home_longitude_snapshot
          }
        : undefined;
    })();

  while (remaining.length > 0) {
    const nextIndex = remaining.reduce((bestIndex, schedule, index) => {
      if (bestIndex === -1) {
        return index;
      }

      const bestSchedule = remaining[bestIndex];
      const bestTravelMinutes = currentPoint
        ? estimateTravelMinutes(
            currentPoint.latitude,
            currentPoint.longitude,
            bestSchedule.home_latitude_snapshot,
            bestSchedule.home_longitude_snapshot
          )
        : Number.MAX_SAFE_INTEGER;
      const scheduleTravelMinutes = currentPoint
        ? estimateTravelMinutes(
            currentPoint.latitude,
            currentPoint.longitude,
            schedule.home_latitude_snapshot,
            schedule.home_longitude_snapshot
          )
        : Number.MAX_SAFE_INTEGER;

      if (scheduleTravelMinutes !== bestTravelMinutes) {
        return scheduleTravelMinutes < bestTravelMinutes ? index : bestIndex;
      }

      return compareAsc(
        new Date(schedule.scheduled_start_at),
        new Date(bestSchedule.scheduled_start_at)
      ) < 0
        ? index
        : bestIndex;
    }, -1);

    const [nextSchedule] = remaining.splice(nextIndex, 1);
    route.push(nextSchedule);
    if (
      nextSchedule.home_latitude_snapshot !== null &&
      nextSchedule.home_longitude_snapshot !== null
    ) {
      currentPoint = {
        latitude: nextSchedule.home_latitude_snapshot,
        longitude: nextSchedule.home_longitude_snapshot
      };
    }
  }

  return route.map((schedule, index) => ({
    ...schedule,
    route_order: index + 1
  }));
}

function buildBlankRecord(schedule: VisitSchedule, departureTime: string | null): VisitRecord {
  const now = new Date().toISOString();
  return applyVisitRecordRules(
    {
      id: `vr-${schedule.id}`,
      visit_schedule_id: schedule.id,
      departure_time: departureTime,
      arrival_time: null,
      departure_from_patient_home_time: null,
      chief_complaint: schedule.visit_type,
      sleep_status: "",
      appetite_status: "",
      bowel_movement_status: "",
      pain_status: "",
      energy_status: "",
      inspection_tags: [],
      inspection_other: "",
      listening_tags: [],
      listening_other: "",
      inquiry_tags: [],
      inquiry_other: "",
      palpation_tags: [],
      palpation_other: "",
      physician_assessment: "",
      treatment_provided: "",
      doctor_note: "",
      caregiver_feedback: "",
      follow_up_note: "",
      medical_history_note: "",
      generated_record_text: "",
      next_visit_suggestion_date: null,
      visit_feedback_code: null,
      visit_feedback_at: null,
      family_followup_status: "not_needed",
      family_followup_sent_at: null,
      created_at: now,
      updated_at: now
    },
    schedule.estimated_treatment_minutes
  );
}

function deriveScheduleStatus(record: VisitRecord, fallbackStatus: VisitStatus): VisitStatus {
  if (record.departure_from_patient_home_time) {
    return record.family_followup_status === "draft_ready"
      ? "followup_pending"
      : "completed";
  }
  if (record.visit_feedback_code === "urgent" || record.visit_feedback_code === "admin_followup") {
    return "issue_pending";
  }
  if (record.visit_feedback_code === "normal" && record.arrival_time) {
    return "in_treatment";
  }
  if (record.arrival_time) {
    return "arrived";
  }
  if (record.departure_time) {
    return "tracking";
  }
  return fallbackStatus;
}

function patchSchedule(db: AppDb, visitScheduleId: string, patch: Partial<VisitSchedule>) {
  const now = new Date().toISOString();
  return db.visit_schedules.map((schedule) =>
    schedule.id === visitScheduleId ? { ...schedule, ...patch, updated_at: now } : schedule
  );
}

function upsertRecordList(db: AppDb, record: VisitRecord) {
  const index = db.visit_records.findIndex(
    (item) => item.visit_schedule_id === record.visit_schedule_id
  );
  if (index >= 0) {
    return db.visit_records.map((item, itemIndex) => (itemIndex === index ? record : item));
  }
  return [record, ...db.visit_records];
}

function upsertSavedRoutePlanList(db: AppDb, routePlan: SavedRoutePlan) {
  const index = db.saved_route_plans.findIndex((item) => item.id === routePlan.id);
  if (index >= 0) {
    return db.saved_route_plans.map((item, itemIndex) => (itemIndex === index ? routePlan : item));
  }
  return [routePlan, ...db.saved_route_plans];
}

function deleteSavedRoutePlanList(db: AppDb, routePlanId: string) {
  return db.saved_route_plans.filter((routePlan) => routePlan.id !== routePlanId);
}

function buildChangeAction(
  input: Omit<RescheduleAction, "id" | "created_at" | "updated_at">
): RescheduleAction {
  const now = new Date().toISOString();
  return {
    ...input,
    id: `rs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: now,
    updated_at: now
  };
}

export function createVisitRepository(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): VisitRepository {
  return {
    getDoctorDashboard(doctorId) {
      const db = getDb();
      const doctor = db.doctors.find((item) => item.id === doctorId) ?? db.doctors[0];
      const schedules = sortSchedules(
        db.visit_schedules.filter((schedule) => schedule.assigned_doctor_id === doctor.id)
      );
      const todaySchedules = schedules.filter((schedule) =>
        isSameDay(new Date(schedule.scheduled_start_at), new Date())
      );
      const activeSchedules = todaySchedules.filter((schedule) =>
        [
          "waiting_departure",
          "preparing",
          "on_the_way",
          "tracking",
          "proximity_pending",
          "arrived",
          "in_treatment",
          "issue_pending"
        ].includes(schedule.status)
      );
      const reminders = db.reminders.filter(
        (reminder) => reminder.role === "doctor" && reminder.status === "pending"
      );
      const todayRecordCount = db.visit_records.filter((record) => {
        const schedule = db.visit_schedules.find(
          (scheduleItem) => scheduleItem.id === record.visit_schedule_id
        );
        return schedule
          ? isSameDay(new Date(schedule.scheduled_start_at), new Date())
          : false;
      }).length;

      return {
        doctor,
        todaySchedules,
        activeSchedules,
        reminders,
        todayRecordCount,
        pendingFamilyNotifications: db.notification_tasks.filter(
          (task) =>
            task.recipient_role === "caregiver" &&
            ["pending", "awaiting_reply"].includes(task.status) &&
            task.visit_schedule_id !== null &&
            db.visit_schedules.some(
              (schedule) =>
                schedule.id === task.visit_schedule_id &&
                schedule.assigned_doctor_id === doctor.id
            )
        ).length
      };
    },
    getSchedules(filters) {
      let schedules = getDb().visit_schedules;
      if (filters?.doctorId) {
        schedules = schedules.filter(
          (schedule) => schedule.assigned_doctor_id === filters.doctorId
        );
      }
      if (filters?.patientId) {
        schedules = schedules.filter((schedule) => schedule.patient_id === filters.patientId);
      }
      if (filters?.statuses?.length) {
        schedules = schedules.filter((schedule) => filters.statuses?.includes(schedule.status));
      }
      if (filters?.dateFrom) {
        schedules = schedules.filter((schedule) =>
          !isBefore(new Date(schedule.scheduled_start_at), new Date(filters.dateFrom!))
        );
      }
      if (filters?.dateTo) {
        schedules = schedules.filter((schedule) =>
          !isAfter(new Date(schedule.scheduled_start_at), new Date(filters.dateTo!))
        );
      }
      if (filters?.area) {
        schedules = schedules.filter((schedule) => schedule.area.includes(filters.area!));
      }
      return sortSchedules(schedules);
    },
    getSuggestedRoute(doctorId, options) {
      const db = getDb();
      const doctorSchedules = getRoutePlanningSchedules(db, doctorId, options);
      const latestLocation = db.doctor_location_logs
        .filter((log) => log.doctor_id === doctorId)
        .sort((left, right) => compareAsc(new Date(right.recorded_at), new Date(left.recorded_at)))[0];

      return [...doctorSchedules].sort((left, right) => {
        const leftDistanceBias =
          latestLocation && left.home_latitude_snapshot !== null && left.home_longitude_snapshot !== null
            ? Math.abs(left.home_latitude_snapshot - latestLocation.latitude) +
              Math.abs(left.home_longitude_snapshot - latestLocation.longitude)
            : 0;
        const rightDistanceBias =
          latestLocation && right.home_latitude_snapshot !== null && right.home_longitude_snapshot !== null
            ? Math.abs(right.home_latitude_snapshot - latestLocation.latitude) +
              Math.abs(right.home_longitude_snapshot - latestLocation.longitude)
            : 0;

        if (left.route_order !== right.route_order) {
          return left.route_order - right.route_order;
        }
        if (leftDistanceBias !== rightDistanceBias) {
          return leftDistanceBias - rightDistanceBias;
        }
        return compareAsc(new Date(left.scheduled_start_at), new Date(right.scheduled_start_at));
      });
    },
    getShortestTravelRoute(doctorId, options) {
      const db = getDb();
      const doctorSchedules = getRoutePlanningSchedules(db, doctorId, options);
      const latestLocation = db.doctor_location_logs
        .filter((log) => log.doctor_id === doctorId)
        .sort((left, right) =>
          compareAsc(new Date(right.recorded_at), new Date(left.recorded_at))
        )[0];

      return buildShortestTravelRoute(
        doctorSchedules,
        latestLocation
          ? {
              latitude: latestLocation.latitude,
              longitude: latestLocation.longitude
            }
          : undefined
      );
    },
    getScheduleDetail(id) {
      const db = getDb();
      const schedule = db.visit_schedules.find((item) => item.id === id);
      if (!schedule) {
        return undefined;
      }
      return {
        schedule,
        patient: db.patients.find((item) => item.id === schedule.patient_id)!,
        doctor: db.doctors.find((item) => item.id === schedule.assigned_doctor_id)!,
        caregiver: db.caregivers.find((item) => item.id === schedule.primary_caregiver_id),
        record: db.visit_records.find((record) => record.visit_schedule_id === schedule.id),
        notifications: db.notification_tasks.filter(
          (task) => task.visit_schedule_id === schedule.id
        )
      };
    },
    getVisitRecordByScheduleId(visitScheduleId) {
      return getDb().visit_records.find(
        (record) => record.visit_schedule_id === visitScheduleId
      );
    },
    getSavedRoutePlans(filters) {
      let routePlans = getDb().saved_route_plans;
      if (filters?.doctorId) {
        routePlans = routePlans.filter((routePlan) => routePlan.doctor_id === filters.doctorId);
      }
      if (filters?.routeDate) {
        routePlans = routePlans.filter((routePlan) => routePlan.route_date === filters.routeDate);
      }
      if (filters?.serviceTimeSlot) {
        routePlans = routePlans.filter(
          (routePlan) => routePlan.service_time_slot === filters.serviceTimeSlot
        );
      }
      return routePlans.slice().sort((left, right) => {
        const dateDiff = compareAsc(new Date(left.route_date), new Date(right.route_date));
        if (dateDiff !== 0) {
          return dateDiff;
        }
        if (left.service_time_slot !== right.service_time_slot) {
          return left.service_time_slot === "上午" ? -1 : 1;
        }
        return compareAsc(new Date(right.saved_at), new Date(left.saved_at));
      });
    },
    getSavedRoutePlanById(routePlanId) {
      return getDb().saved_route_plans.find((routePlan) => routePlan.id === routePlanId);
    },
    getDoctorRouteSchedules(doctorId, routePlanId) {
      const db = getDb();
      const fallbackTodaySchedules = sortSchedules(
        db.visit_schedules.filter(
          (schedule) =>
            schedule.assigned_doctor_id === doctorId &&
            isSameDay(new Date(schedule.scheduled_start_at), new Date())
        )
      );
      if (!routePlanId) {
        return fallbackTodaySchedules;
      }
      const routePlan = db.saved_route_plans.find(
        (item) => item.id === routePlanId && item.doctor_id === doctorId
      );
      if (!routePlan) {
        return fallbackTodaySchedules;
      }
      const scheduleById = new Map(
        db.visit_schedules
          .filter((schedule) => schedule.assigned_doctor_id === doctorId)
          .map((schedule) => [schedule.id, schedule])
      );
      const selectedSchedules = routePlan.schedule_ids
        .map((scheduleId) => scheduleById.get(scheduleId))
        .filter((schedule): schedule is VisitSchedule => Boolean(schedule));
      return selectedSchedules.length > 0 ? selectedSchedules : fallbackTodaySchedules;
    },
    upsertSchedule(schedule) {
      updateDb((db) => ({
        ...db,
        visit_schedules: patchSchedule(db, schedule.id, schedule)
      }));
    },
    upsertSavedRoutePlan(routePlan) {
      updateDb((db) => ({
        ...db,
        saved_route_plans: upsertSavedRoutePlanList(db, routePlan)
      }));
    },
    deleteSavedRoutePlan(routePlanId) {
      updateDb((db) => ({
        ...db,
        saved_route_plans: deleteSavedRoutePlanList(db, routePlanId)
      }));
    },
    upsertVisitRecord(record: VisitRecord) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const normalizedRecord = { ...record, updated_at: now };
        const currentSchedule = db.visit_schedules.find(
          (schedule) => schedule.id === record.visit_schedule_id
        );

        return {
          ...db,
          visit_records: upsertRecordList(db, normalizedRecord),
          visit_schedules: patchSchedule(db, record.visit_schedule_id, {
            status: deriveScheduleStatus(normalizedRecord, currentSchedule?.status ?? "scheduled")
          })
        };
      });
    },
    startVisitTravel(visitScheduleId, departureTime = new Date().toISOString()) {
      const db = getDb();
      const schedule = db.visit_schedules.find((item) => item.id === visitScheduleId);
      const existingRecord = db.visit_records.find(
        (item) => item.visit_schedule_id === visitScheduleId
      );
      if (!schedule) {
        return undefined;
      }

      const nextRecord = applyVisitRecordRules(
        {
          ...(existingRecord ?? buildBlankRecord(schedule, departureTime)),
          departure_time: departureTime,
          updated_at: new Date().toISOString()
        },
        schedule.estimated_treatment_minutes
      );

      updateDb((currentDb) => ({
        ...currentDb,
        visit_records: upsertRecordList(currentDb, nextRecord),
        visit_schedules: patchSchedule(currentDb, visitScheduleId, {
          status: "tracking",
          geofence_status: "tracking",
          tracking_started_at: departureTime,
          tracking_stopped_at: null
        })
      }));

      return nextRecord;
    },
    updateRouteOrder(visitScheduleId, routeOrder) {
      updateDb((db) => ({
        ...db,
        visit_schedules: patchSchedule(db, visitScheduleId, { route_order: routeOrder })
      }));
    },
    confirmArrival(visitScheduleId, confirmedBy, recordedAt = new Date().toISOString()) {
      const db = getDb();
      const schedule = db.visit_schedules.find((item) => item.id === visitScheduleId);
      const existingRecord = db.visit_records.find(
        (item) => item.visit_schedule_id === visitScheduleId
      );
      if (!schedule) {
        return undefined;
      }
      const nextRecord = applyVisitRecordRules(
        {
          ...(existingRecord ?? buildBlankRecord(schedule, null)),
          arrival_time: recordedAt,
          updated_at: recordedAt
        },
        schedule.estimated_treatment_minutes
      );

      updateDb((currentDb) => ({
        ...currentDb,
        visit_records: upsertRecordList(currentDb, nextRecord),
        visit_schedules: patchSchedule(currentDb, visitScheduleId, {
          status: nextRecord.visit_feedback_code === "normal" ? "in_treatment" : "arrived",
          geofence_status: "arrived",
          arrival_confirmed_by: confirmedBy
        })
      }));
      return nextRecord;
    },
    confirmDeparture(visitScheduleId, confirmedBy, recordedAt = new Date().toISOString()) {
      const db = getDb();
      const schedule = db.visit_schedules.find((item) => item.id === visitScheduleId);
      const existingRecord = db.visit_records.find(
        (item) => item.visit_schedule_id === visitScheduleId
      );
      if (!schedule || !existingRecord) {
        return undefined;
      }

      const nextFamilyStatus: FamilyFollowUpStatus =
        existingRecord.visit_feedback_code && existingRecord.visit_feedback_code !== "normal"
          ? "draft_ready"
          : existingRecord.family_followup_status;

      const nextRecord = applyVisitRecordRules(
        {
          ...existingRecord,
          departure_from_patient_home_time: recordedAt,
          family_followup_status: nextFamilyStatus,
          updated_at: recordedAt
        },
        schedule.estimated_treatment_minutes
      );

      updateDb((currentDb) => ({
        ...currentDb,
        visit_records: upsertRecordList(currentDb, nextRecord),
        visit_schedules: patchSchedule(currentDb, visitScheduleId, {
          status: nextFamilyStatus === "draft_ready" ? "followup_pending" : "completed",
          geofence_status: "completed",
          departure_confirmed_by: confirmedBy,
          tracking_stopped_at: recordedAt
        })
      }));
      return nextRecord;
    },
    recordVisitFeedback(visitScheduleId, feedbackCode, recordedAt = new Date().toISOString()) {
      const db = getDb();
      const schedule = db.visit_schedules.find((item) => item.id === visitScheduleId);
      const existingRecord = db.visit_records.find(
        (item) => item.visit_schedule_id === visitScheduleId
      );
      if (!schedule) {
        return undefined;
      }
      const nextRecord = applyVisitRecordRules(
        {
          ...(existingRecord ?? buildBlankRecord(schedule, null)),
          visit_feedback_code: feedbackCode,
          visit_feedback_at: recordedAt,
          family_followup_status: feedbackCode === "normal" ? "not_needed" : "draft_ready",
          updated_at: recordedAt
        },
        schedule.estimated_treatment_minutes
      );

      const nextStatus: VisitStatus =
        feedbackCode === "normal"
          ? nextRecord.arrival_time
            ? "in_treatment"
            : "arrived"
          : "issue_pending";

      updateDb((currentDb) => ({
        ...currentDb,
        visit_records: upsertRecordList(currentDb, nextRecord),
        visit_schedules: patchSchedule(currentDb, visitScheduleId, {
          status: nextStatus,
          last_feedback_code: feedbackCode
        })
      }));
      return nextRecord;
    },
    updateFamilyFollowUpStatus(visitScheduleId, status, sentAt = null) {
      const db = getDb();
      const schedule = db.visit_schedules.find((item) => item.id === visitScheduleId);
      const existingRecord = db.visit_records.find(
        (item) => item.visit_schedule_id === visitScheduleId
      );
      if (!schedule || !existingRecord) {
        return undefined;
      }
      const nextRecord = {
        ...existingRecord,
        family_followup_status: status,
        family_followup_sent_at: sentAt,
        updated_at: new Date().toISOString()
      };

      updateDb((currentDb) => ({
        ...currentDb,
        visit_records: upsertRecordList(currentDb, nextRecord),
        visit_schedules: patchSchedule(currentDb, visitScheduleId, {
          status: status === "sent" ? "completed" : "followup_pending"
        })
      }));
      return nextRecord;
    },
    rescheduleVisit(input) {
      updateDb((db) => {
        const schedule = db.visit_schedules.find((item) => item.id === input.visitScheduleId);
        if (!schedule) {
          return db;
        }
        const now = new Date().toISOString();
        return {
          ...db,
          visit_schedules: db.visit_schedules.map((item) =>
            item.id === input.visitScheduleId
              ? {
                  ...item,
                  scheduled_start_at: input.newStartAt,
                  scheduled_end_at: input.newEndAt,
                  status: "rescheduled",
                  note: `${item.note}｜改期：${input.reason}`,
                  updated_at: now
                }
              : item
          ),
          reschedule_actions: [
            buildChangeAction({
              visit_schedule_id: input.visitScheduleId,
              requested_by_role: input.requestedByRole,
              action_type: "reschedule",
              original_start_at: schedule.scheduled_start_at,
              original_end_at: schedule.scheduled_end_at,
              new_start_at: input.newStartAt,
              new_end_at: input.newEndAt,
              new_doctor_id: null,
              reason: input.reason,
              change_summary: input.changeSummary,
              status: "approved"
            }),
            ...db.reschedule_actions
          ]
        };
      });
    },
    coverVisit(input) {
      updateDb((db) => {
        const schedule = db.visit_schedules.find((item) => item.id === input.visitScheduleId);
        if (!schedule) {
          return db;
        }
        const now = new Date().toISOString();
        return {
          ...db,
          visit_schedules: db.visit_schedules.map((item) =>
            item.id === input.visitScheduleId
              ? {
                  ...item,
                  assigned_doctor_id: input.newDoctorId,
                  note: `${item.note}｜代班：${input.reason}`,
                  updated_at: now
                }
              : item
          ),
          reschedule_actions: [
            buildChangeAction({
              visit_schedule_id: input.visitScheduleId,
              requested_by_role: input.requestedByRole,
              action_type: "coverage",
              original_start_at: schedule.scheduled_start_at,
              original_end_at: schedule.scheduled_end_at,
              new_start_at: schedule.scheduled_start_at,
              new_end_at: schedule.scheduled_end_at,
              new_doctor_id: input.newDoctorId,
              reason: input.reason,
              change_summary: input.changeSummary,
              status: "approved"
            }),
            ...db.reschedule_actions
          ]
        };
      });
    },
    cancelVisit(visitScheduleId, reason, changeSummary) {
      updateDb((db) => {
        const schedule = db.visit_schedules.find((item) => item.id === visitScheduleId);
        if (!schedule) {
          return db;
        }
        const now = new Date().toISOString();
        return {
          ...db,
          visit_schedules: db.visit_schedules.map((item) =>
            item.id === visitScheduleId
              ? { ...item, status: "cancelled", note: `${item.note}｜取消：${reason}`, updated_at: now }
              : item
          ),
          reschedule_actions: [
            buildChangeAction({
              visit_schedule_id: visitScheduleId,
              requested_by_role: "admin",
              action_type: "cancel",
              original_start_at: schedule.scheduled_start_at,
              original_end_at: schedule.scheduled_end_at,
              new_start_at: schedule.scheduled_start_at,
              new_end_at: schedule.scheduled_end_at,
              new_doctor_id: null,
              reason,
              change_summary: changeSummary,
              status: "approved"
            }),
            ...db.reschedule_actions
          ]
        };
      });
    },
    pauseVisit(visitScheduleId, reason, changeSummary) {
      updateDb((db) => {
        const schedule = db.visit_schedules.find((item) => item.id === visitScheduleId);
        if (!schedule) {
          return db;
        }
        const now = new Date().toISOString();
        return {
          ...db,
          visit_schedules: db.visit_schedules.map((item) =>
            item.id === visitScheduleId
              ? { ...item, status: "cancelled", note: `${item.note}｜暫停本次：${reason}`, updated_at: now }
              : item
          ),
          reschedule_actions: [
            buildChangeAction({
              visit_schedule_id: visitScheduleId,
              requested_by_role: "admin",
              action_type: "pause_visit",
              original_start_at: schedule.scheduled_start_at,
              original_end_at: schedule.scheduled_end_at,
              new_start_at: schedule.scheduled_start_at,
              new_end_at: schedule.scheduled_end_at,
              new_doctor_id: null,
              reason,
              change_summary: changeSummary,
              status: "approved"
            }),
            ...db.reschedule_actions
          ]
        };
      });
    },
    getReminders(role: UserRole, ownerId?: string) {
      const reminders = getDb()
        .reminders.filter((reminder) => reminder.role === role)
        .sort((left, right) => compareAsc(new Date(left.due_at), new Date(right.due_at)));
      if (!ownerId) {
        return reminders;
      }
      return reminders.filter((reminder) => {
        if (!reminder.related_visit_schedule_id) {
          return true;
        }
        const schedule = getDb().visit_schedules.find(
          (item) => item.id === reminder.related_visit_schedule_id
        );
        return schedule ? schedule.assigned_doctor_id === ownerId : false;
      });
    },
    appendDoctorLocationLog(log) {
      updateDb((db) => ({
        ...db,
        doctor_location_logs: [log, ...db.doctor_location_logs]
      }));
    },
    getDoctorLocationLogs(doctorId) {
      return getDb().doctor_location_logs.filter((log) => log.doctor_id === doctorId);
    }
  };
}
