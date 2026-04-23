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
  RouteItemStatus,
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
  const filtered = db.saved_route_plans.filter(
    (item) =>
      item.id !== routePlan.id &&
      !(
        item.doctor_id === routePlan.doctor_id &&
        item.route_date === routePlan.route_date &&
        item.route_weekday === routePlan.route_weekday &&
        item.service_time_slot === routePlan.service_time_slot
      )
  );
  return [routePlan, ...filtered];
}

function upsertReminderList(db: AppDb, reminder: AppDb["reminders"][number]) {
  const index = db.reminders.findIndex((item) => item.id === reminder.id);
  if (index >= 0) {
    return db.reminders.map((item, itemIndex) => (itemIndex === index ? reminder : item));
  }
  return [reminder, ...db.reminders];
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

function resolveRouteItemStatus(status: VisitStatus): RouteItemStatus {
  if (["completed", "followup_pending"].includes(status)) {
    return "completed";
  }
  if (status === "paused") {
    return "paused";
  }
  if (["arrived", "in_treatment"].includes(status)) {
    return "in_treatment";
  }
  if (["on_the_way", "tracking", "proximity_pending"].includes(status)) {
    return "on_the_way";
  }
  return "scheduled";
}

function buildRouteScopeId(doctorId: string, routeDate: string, routeWeekday: string, serviceTimeSlot: "上午" | "下午") {
  return `route-${doctorId}-${routeDate}-${routeWeekday}-${serviceTimeSlot}`;
}

function buildRouteScheduleDateTime(routeDate: string, serviceTimeSlot: "上午" | "下午", order: number) {
  const baseHour = serviceTimeSlot === "上午" ? 9 : 14;
  const baseDate = new Date(`${routeDate}T00:00:00`);
  baseDate.setHours(baseHour + Math.max(order - 1, 0), 0, 0, 0);
  return baseDate.toISOString();
}

function syncRoutePlansForSchedule(
  db: AppDb,
  scheduleId: string,
  patch: Partial<{
    status: RouteItemStatus;
    routeOrder: number | null;
  }>
) {
  return db.saved_route_plans.map((routePlan) => {
    let changed = false;
    const nextRouteItems = routePlan.route_items.map((item) => {
      if (item.schedule_id !== scheduleId) {
        return item;
      }
      changed = true;
      return {
        ...item,
        status: patch.status ?? item.status,
        route_order: patch.routeOrder === undefined ? item.route_order : patch.routeOrder
      };
    });
    return changed ? { ...routePlan, route_items: nextRouteItems } : routePlan;
  });
}

function executeRoutePlanInDb(db: AppDb, routePlanId: string) {
  const routePlan = db.saved_route_plans.find((item) => item.id === routePlanId);
  if (!routePlan) {
    return {
      db,
      executedRoutePlan: undefined as SavedRoutePlan | undefined
    };
  }

  const now = new Date().toISOString();
  const patientsById = new Map(db.patients.map((patient) => [patient.id, patient]));
  const primaryCaregiverByPatientId = new Map(
    db.caregivers
      .filter((caregiver) => caregiver.is_primary)
      .map((caregiver) => [caregiver.patient_id, caregiver.id])
  );
  const anyCaregiverByPatientId = new Map(
    db.caregivers.map((caregiver) => [caregiver.patient_id, caregiver.id])
  );

  let nextSchedules = [...db.visit_schedules];
  const checkedCount = routePlan.route_items.filter((item) => item.checked).length;
  let pausedIndex = 0;

  const nextRouteItems: SavedRoutePlan["route_items"] = routePlan.route_items
    .filter((item) => {
      const patient = patientsById.get(item.patient_id);
      return Boolean(patient) && patient?.status !== "closed";
    })
    .map((item) => {
      const patient = patientsById.get(item.patient_id)!;
      const routeOrder = item.checked
        ? item.route_order ?? 1
        : checkedCount + pausedIndex++ + 1;
      const scheduledStart = buildRouteScheduleDateTime(
        routePlan.route_date,
        routePlan.service_time_slot,
        routeOrder
      );
      const scheduledEnd = new Date(
        new Date(scheduledStart).getTime() + 60 * 60 * 1000
      ).toISOString();
      const existingScheduleIndex = nextSchedules.findIndex(
        (schedule) => schedule.id === item.schedule_id
      );
      const scheduleId = item.schedule_id ?? `vs-${routePlan.id}-${patient.id}`;
      const nextStatus: VisitStatus = item.checked ? "scheduled" : "paused";
      const baseSchedule: VisitSchedule =
        existingScheduleIndex >= 0
          ? nextSchedules[existingScheduleIndex]
          : {
              id: scheduleId,
              patient_id: patient.id,
              assigned_doctor_id: routePlan.doctor_id,
              primary_caregiver_id:
                primaryCaregiverByPatientId.get(patient.id) ??
                anyCaregiverByPatientId.get(patient.id) ??
                "",
              scheduled_start_at: scheduledStart,
              scheduled_end_at: scheduledEnd,
              estimated_treatment_minutes: 30,
              address_snapshot: patient.home_address || patient.address,
              location_keyword_snapshot: patient.location_keyword,
              home_latitude_snapshot: patient.home_latitude,
              home_longitude_snapshot: patient.home_longitude,
              arrival_radius_meters: 100,
              geofence_status:
                patient.home_latitude === null || patient.home_longitude === null
                  ? "coordinate_missing"
                  : "idle",
              google_maps_link: patient.google_maps_link,
              area: patient.address,
              service_time_slot: `${routePlan.route_weekday}${routePlan.service_time_slot}`,
              route_order: routeOrder,
              route_group_id: routePlan.id,
              tracking_mode: "hybrid",
              tracking_started_at: null,
              tracking_stopped_at: null,
              arrival_confirmed_by: null,
              departure_confirmed_by: null,
              last_feedback_code: null,
              reminder_tags: [...patient.reminder_tags, ...patient.service_needs],
              status: nextStatus,
              visit_type:
                patient.service_needs.length > 0
                  ? `${patient.service_needs.join(" / ")} / ${patient.primary_diagnosis}`
                  : patient.primary_diagnosis,
              note: "由排程管理頁實行路線",
              created_at: now,
              updated_at: now
            };

      const nextSchedule = {
        ...baseSchedule,
        id: scheduleId,
        patient_id: patient.id,
        assigned_doctor_id: routePlan.doctor_id,
        scheduled_start_at: scheduledStart,
        scheduled_end_at: scheduledEnd,
        address_snapshot: patient.home_address || patient.address,
        location_keyword_snapshot: patient.location_keyword,
        home_latitude_snapshot: patient.home_latitude,
        home_longitude_snapshot: patient.home_longitude,
        google_maps_link: patient.google_maps_link,
        service_time_slot: `${routePlan.route_weekday}${routePlan.service_time_slot}`,
        route_order: routeOrder,
        route_group_id: routePlan.id,
        reminder_tags: [...patient.reminder_tags, ...patient.service_needs],
        status: nextStatus,
        note: "由排程管理頁實行路線",
        updated_at: now
      };

      if (existingScheduleIndex >= 0) {
        nextSchedules[existingScheduleIndex] = nextSchedule;
      } else {
        nextSchedules.unshift(nextSchedule);
      }

      return {
        ...item,
        schedule_id: scheduleId,
        route_order: item.checked ? item.route_order ?? routeOrder : null,
        status: item.checked ? ("scheduled" as const) : ("paused" as const),
        patient_name: patient.name,
        address: patient.home_address || patient.address
      };
    });

  let executedRoutePlan: SavedRoutePlan | undefined;
  const nextSavedRoutePlans = db.saved_route_plans.map((item) => {
    if (
      item.doctor_id === routePlan.doctor_id &&
      item.execution_status === "executing" &&
      item.id !== routePlan.id
    ) {
      return {
        ...item,
        execution_status: "archived" as const,
        updated_at: now
      };
    }
    if (item.id !== routePlan.id) {
      return item;
    }
    const nextPlan = {
      ...item,
      route_items: nextRouteItems,
      schedule_ids: nextRouteItems
        .map((routeItem) => routeItem.schedule_id)
        .filter((scheduleId): scheduleId is string => Boolean(scheduleId)),
      execution_status: "executing" as const,
      executed_at: now,
      updated_at: now
    };
    executedRoutePlan = nextPlan;
    return nextPlan;
  });

  return {
    db: {
      ...db,
      visit_schedules: nextSchedules,
      saved_route_plans: nextSavedRoutePlans
    },
    executedRoutePlan
  };
}

function resetRoutePlanProgressInDb(db: AppDb, routePlanId: string) {
  const routePlan = db.saved_route_plans.find((item) => item.id === routePlanId);
  if (!routePlan) {
    return {
      db,
      resetRoutePlan: undefined as SavedRoutePlan | undefined
    };
  }

  const now = new Date().toISOString();
  const patientById = new Map(db.patients.map((patient) => [patient.id, patient]));
  const routePatientIdSet = new Set(routePlan.route_items.map((item) => item.patient_id));
  const routeServiceTimeSlot = `${routePlan.route_weekday}${routePlan.service_time_slot}`;
  const associatedRouteSchedules = db.visit_schedules.filter(
    (schedule) =>
      schedule.route_group_id === routePlan.id ||
      (routePatientIdSet.has(schedule.patient_id) &&
      schedule.assigned_doctor_id === routePlan.doctor_id &&
        schedule.scheduled_start_at.slice(0, 10) === routePlan.route_date &&
        schedule.service_time_slot === routeServiceTimeSlot)
  );
  const routeScheduleById = new Map(
    associatedRouteSchedules.map((schedule) => [schedule.id, schedule])
  );
  const routeScheduleByPatientId = new Map(
    associatedRouteSchedules.map((schedule) => [schedule.patient_id, schedule])
  );
  const orderedRouteItems = routePlan.route_items
    .slice()
    .sort((left, right) => {
      const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.patient_name.localeCompare(right.patient_name, "zh-Hant");
    });
  const activeRouteItems = orderedRouteItems.filter((item) => {
    const patient = patientById.get(item.patient_id);
    return patient?.status !== "closed";
  });

  let checkedOrder = 0;
  const checkedItemCount = activeRouteItems.filter((item) => item.checked).length;
  let pausedOrder = 0;
  const scheduleOrderByScheduleId = new Map<string, number>();
  const normalizedRouteItems = activeRouteItems.map((item) => {
    const resolvedScheduleId =
      (item.schedule_id && routeScheduleById.has(item.schedule_id) ? item.schedule_id : null) ??
      routeScheduleByPatientId.get(item.patient_id)?.id ??
      item.schedule_id;
    const nextRouteItem = {
      ...item,
      schedule_id: resolvedScheduleId,
      route_order: item.checked ? ++checkedOrder : null,
      status: item.checked ? ("scheduled" as const) : ("paused" as const)
    };

    if (resolvedScheduleId) {
      scheduleOrderByScheduleId.set(
        resolvedScheduleId,
        item.checked ? checkedOrder : checkedItemCount + ++pausedOrder
      );
    }

    return nextRouteItem;
  });

  const scheduleIdSet = new Set(
    [
      ...associatedRouteSchedules.map((schedule) => schedule.id),
      ...normalizedRouteItems
      .map((item) => item.schedule_id)
      .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
    ]
  );

  let resetRoutePlan: SavedRoutePlan | undefined;
  const nextSavedRoutePlans = db.saved_route_plans.map((item) => {
    if (item.id !== routePlanId) {
      return item;
    }

    const nextPlan = {
      ...item,
      route_items: normalizedRouteItems,
      execution_status: "executing" as const,
      updated_at: now
    };
    resetRoutePlan = nextPlan;
    return nextPlan;
  });

  return {
    ...(() => {
      const cleanedDb = {
        ...db,
        visit_records: db.visit_records.filter((record) => !scheduleIdSet.has(record.visit_schedule_id)),
        visit_schedules: db.visit_schedules.filter((schedule) => !scheduleIdSet.has(schedule.id)),
        saved_route_plans: nextSavedRoutePlans
      };
      const result = executeRoutePlanInDb(cleanedDb, routePlanId);
      resetRoutePlan = result.executedRoutePlan;
      return {
        db: result.db,
        resetRoutePlan
      };
    })()
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
      if (filters?.executionStatus) {
        routePlans = routePlans.filter(
          (routePlan) => routePlan.execution_status === filters.executionStatus
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
    getActiveRoutePlan(doctorId) {
      const today = new Date().toISOString().slice(0, 10);
      const activePlans = getDb().saved_route_plans
        .filter(
          (routePlan) =>
            routePlan.doctor_id === doctorId && routePlan.execution_status === "executing"
        )
        .sort((left, right) => {
          if (left.route_date === today && right.route_date !== today) {
            return -1;
          }
          if (left.route_date !== today && right.route_date === today) {
            return 1;
          }
          return compareAsc(new Date(right.executed_at ?? right.saved_at), new Date(left.executed_at ?? left.saved_at));
        });
      return activePlans[0];
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
      const activeRoutePlan = db.saved_route_plans
        .filter(
          (item) => item.doctor_id === doctorId && item.execution_status === "executing"
        )
        .sort((left, right) =>
          compareAsc(new Date(right.executed_at ?? right.saved_at), new Date(left.executed_at ?? left.saved_at))
        )[0];
      const routePlan =
        (routePlanId
          ? db.saved_route_plans.find((item) => item.id === routePlanId && item.doctor_id === doctorId)
          : undefined) ?? activeRoutePlan;
      if (!routePlan) {
        return fallbackTodaySchedules;
      }
      const scheduleById = new Map(
        db.visit_schedules
          .filter((schedule) => schedule.assigned_doctor_id === doctorId)
          .map((schedule) => [schedule.id, schedule])
      );
      const selectedSchedules = routePlan.route_items
        .slice()
        .sort((left, right) => {
          const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          return left.patient_name.localeCompare(right.patient_name, "zh-Hant");
        })
        .map((item) => item.schedule_id)
        .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
        .map((scheduleId) => scheduleById.get(scheduleId))
        .filter((schedule): schedule is VisitSchedule => Boolean(schedule));
      return selectedSchedules.length > 0 ? selectedSchedules : fallbackTodaySchedules;
    },
    upsertSchedule(schedule) {
      updateDb((db) => ({
        ...db,
        visit_schedules: patchSchedule(db, schedule.id, schedule),
        saved_route_plans: syncRoutePlansForSchedule(db, schedule.id, {
          status: resolveRouteItemStatus(schedule.status),
          routeOrder: schedule.route_order ?? null
        })
      }));
    },
    upsertSavedRoutePlan(routePlan) {
      updateDb((db) => ({
        ...db,
        saved_route_plans: upsertSavedRoutePlanList(db, {
          ...routePlan,
          id:
            routePlan.id ||
            buildRouteScopeId(
              routePlan.doctor_id,
              routePlan.route_date,
              routePlan.route_weekday,
              routePlan.service_time_slot
            )
        })
      }));
    },
    deleteSavedRoutePlan(routePlanId) {
      updateDb((db) => ({
        ...db,
        saved_route_plans: deleteSavedRoutePlanList(db, routePlanId)
      }));
    },
    executeRoutePlan(routePlanId) {
      let executedRoutePlan: SavedRoutePlan | undefined;

      updateDb((db) => {
        const result = executeRoutePlanInDb(db, routePlanId);
        executedRoutePlan = result.executedRoutePlan;
        return result.db;
      });

      return executedRoutePlan;
    },
    upsertSavedRoutePlanAndExecute(routePlan) {
      let executedRoutePlan: SavedRoutePlan | undefined;

      updateDb((db) => {
        const normalizedRoutePlan = {
          ...routePlan,
          id:
            routePlan.id ||
            buildRouteScopeId(
              routePlan.doctor_id,
              routePlan.route_date,
              routePlan.route_weekday,
              routePlan.service_time_slot
            )
        };
        const nextDb = {
          ...db,
          saved_route_plans: upsertSavedRoutePlanList(db, normalizedRoutePlan)
        };
        const result = executeRoutePlanInDb(nextDb, normalizedRoutePlan.id);
        executedRoutePlan = result.executedRoutePlan;
        return result.db;
      });

      return executedRoutePlan;
    },
    resetRoutePlanProgress(routePlanId) {
      let resetRoutePlan: SavedRoutePlan | undefined;

      updateDb((db) => {
        const result = resetRoutePlanProgressInDb(db, routePlanId);
        resetRoutePlan = result.resetRoutePlan;
        return result.db;
      });

      return resetRoutePlan;
    },
    syncRouteItemStatus(routePlanId, patientId, status) {
      updateDb((db) => ({
        ...db,
        saved_route_plans: db.saved_route_plans.map((routePlan) =>
          routePlan.id !== routePlanId
            ? routePlan
            : {
                ...routePlan,
                route_items: routePlan.route_items.map((item) =>
                  item.patient_id === patientId ? { ...item, status } : item
                )
              }
        )
      }));
    },
    upsertVisitRecord(record: VisitRecord) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const normalizedRecord = { ...record, updated_at: now };
        const currentSchedule = db.visit_schedules.find(
          (schedule) => schedule.id === record.visit_schedule_id
        );
        const nextStatus = deriveScheduleStatus(normalizedRecord, currentSchedule?.status ?? "scheduled");

        return {
          ...db,
          visit_records: upsertRecordList(db, normalizedRecord),
          visit_schedules: patchSchedule(db, record.visit_schedule_id, {
            status: nextStatus
          }),
          saved_route_plans: syncRoutePlansForSchedule(db, record.visit_schedule_id, {
            status: resolveRouteItemStatus(nextStatus)
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
        }),
        saved_route_plans: syncRoutePlansForSchedule(currentDb, visitScheduleId, {
          status: "on_the_way"
        })
      }));

      return nextRecord;
    },
    updateRouteOrder(visitScheduleId, routeOrder) {
      updateDb((db) => ({
        ...db,
        visit_schedules: patchSchedule(db, visitScheduleId, { route_order: routeOrder }),
        saved_route_plans: syncRoutePlansForSchedule(db, visitScheduleId, {
          routeOrder
        })
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
        }),
        saved_route_plans: syncRoutePlansForSchedule(currentDb, visitScheduleId, {
          status: "in_treatment"
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
        }),
        saved_route_plans: syncRoutePlansForSchedule(currentDb, visitScheduleId, {
          status: "completed"
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
          arrival_time:
            feedbackCode === "absent"
              ? existingRecord?.arrival_time ?? recordedAt
              : existingRecord?.arrival_time ?? null,
          departure_from_patient_home_time:
            feedbackCode === "absent" ? recordedAt : existingRecord?.departure_from_patient_home_time ?? null,
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
          : feedbackCode === "absent"
            ? "paused"
          : "issue_pending";

      updateDb((currentDb) => ({
        ...currentDb,
        visit_records: upsertRecordList(currentDb, nextRecord),
        visit_schedules: patchSchedule(currentDb, visitScheduleId, {
          status: nextStatus,
          last_feedback_code: feedbackCode,
          geofence_status: feedbackCode === "absent" ? "completed" : schedule.geofence_status,
          tracking_stopped_at: feedbackCode === "absent" ? recordedAt : schedule.tracking_stopped_at
        }),
        saved_route_plans: syncRoutePlansForSchedule(currentDb, visitScheduleId, {
          status: resolveRouteItemStatus(nextStatus)
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
        }),
        saved_route_plans: syncRoutePlansForSchedule(currentDb, visitScheduleId, {
          status: status === "sent" ? "completed" : "completed"
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
          saved_route_plans: syncRoutePlansForSchedule(db, input.visitScheduleId, {
            status: "scheduled"
          }),
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
          saved_route_plans: syncRoutePlansForSchedule(db, input.visitScheduleId, {
            status: "scheduled"
          }),
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
          saved_route_plans: syncRoutePlansForSchedule(db, visitScheduleId, {
            status: "paused"
          }),
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
              ? { ...item, status: "paused", note: `${item.note}｜暫停本次：${reason}`, updated_at: now }
              : item
          ),
          saved_route_plans: syncRoutePlansForSchedule(db, visitScheduleId, {
            status: "paused"
          }),
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
        .reminders.filter((reminder) => {
          if (reminder.role === role) {
            return true;
          }
          if (!reminder.related_visit_schedule_id) {
            return false;
          }
          const schedule = getDb().visit_schedules.find(
            (item) => item.id === reminder.related_visit_schedule_id
          );
          if (!schedule) {
            return false;
          }
          if (role === "admin") {
            return true;
          }
          return ownerId ? schedule.assigned_doctor_id === ownerId : true;
        })
        .sort((left, right) => compareAsc(new Date(left.due_at), new Date(right.due_at)));
      if (!ownerId) {
        return reminders;
      }
      return reminders.filter((reminder) => {
        if (!reminder.related_visit_schedule_id) {
          return reminder.role === role;
        }
        const schedule = getDb().visit_schedules.find(
          (item) => item.id === reminder.related_visit_schedule_id
        );
        if (!schedule) {
          return false;
        }
        if (role === "admin") {
          return true;
        }
        return schedule.assigned_doctor_id === ownerId;
      });
    },
    createReminder(reminder) {
      updateDb((db) => ({
        ...db,
        reminders: upsertReminderList(db, reminder)
      }));
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
