import { appDbSchema, type AppDb } from "../../domain/models";
import { createSeedDb } from "../seed";

export const MOCK_DB_STORAGE_KEY = "tcm-home-care-mvp-db";
const RECOVERY_KEY_PREFIX = "tcm-home-care-mvp-db-recovery";
const ROUTE_PLAN_RETENTION_DAYS = 30;
const REMOVED_LEGACY_DOCTOR_ID = "doc-002";
const REMOVED_LEGACY_DOCTOR_NAME = "林若謙醫師";
const REMOVED_SUPPORT_DOCTOR_NAME = "支援醫師";
const HOSPITAL_ADDRESS = "旗山醫院";
const HOSPITAL_LATITUDE = 22.880693;
const HOSPITAL_LONGITUDE = 120.483276;
const LEGACY_HOSPITAL_LATITUDE = 22.88794;
const LEGACY_HOSPITAL_LONGITUDE = 120.48341;

export function hasLocalDbSnapshot(): boolean {
  return typeof window !== "undefined" && Boolean(window.localStorage.getItem(MOCK_DB_STORAGE_KEY));
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function removeExpiredSavedRoutePlans(db: AppDb, now = new Date()): AppDb {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - ROUTE_PLAN_RETENTION_DAYS);
  const cutoffDate = formatLocalDate(cutoff);
  const nextSavedRoutePlans = db.saved_route_plans.filter(
    (routePlan) => routePlan.route_date >= cutoffDate
  );

  if (nextSavedRoutePlans.length === db.saved_route_plans.length) {
    return db;
  }

  return {
    ...db,
    saved_route_plans: nextSavedRoutePlans
  };
}

function isRemovedLegacyDoctor(doctor: AppDb["doctors"][number]) {
  return (
    doctor.id === REMOVED_LEGACY_DOCTOR_ID ||
    doctor.name === REMOVED_LEGACY_DOCTOR_NAME ||
    doctor.name === REMOVED_SUPPORT_DOCTOR_NAME
  );
}

function removeLegacyDoctorSeed(db: AppDb): AppDb {
  const removedDoctorIds = new Set(
    db.doctors.filter((doctor) => isRemovedLegacyDoctor(doctor)).map((doctor) => doctor.id)
  );
  removedDoctorIds.add(REMOVED_LEGACY_DOCTOR_ID);
  if (removedDoctorIds.size === 0) {
    return db;
  }

  const fallbackDoctorId =
    db.doctors.find((doctor) => !removedDoctorIds.has(doctor.id))?.id ?? "doc-001";
  const removedScheduleIds = new Set(
    db.visit_schedules
      .filter((schedule) => removedDoctorIds.has(schedule.assigned_doctor_id))
      .map((schedule) => schedule.id)
  );
  const removedLeaveRequestIds = new Set(
    db.leave_requests
      .filter((leaveRequest) => removedDoctorIds.has(leaveRequest.doctor_id))
      .map((leaveRequest) => leaveRequest.id)
  );

  return {
    ...db,
    doctors: db.doctors.filter((doctor) => !removedDoctorIds.has(doctor.id)),
    patients: db.patients.map((patient) =>
      removedDoctorIds.has(patient.preferred_doctor_id)
        ? {
            ...patient,
            preferred_doctor_id: fallbackDoctorId
          }
        : patient
    ),
    visit_schedules: db.visit_schedules.filter(
      (schedule) => !removedDoctorIds.has(schedule.assigned_doctor_id)
    ),
    saved_route_plans: db.saved_route_plans.filter(
      (routePlan) =>
        !removedDoctorIds.has(routePlan.doctor_id) &&
        !routePlan.schedule_ids.some((scheduleId) => removedScheduleIds.has(scheduleId))
    ),
    visit_records: db.visit_records.filter((record) => !removedScheduleIds.has(record.visit_schedule_id)),
    contact_logs: db.contact_logs.filter(
      (log) =>
        (!log.doctor_id || !removedDoctorIds.has(log.doctor_id)) &&
        (!log.visit_schedule_id || !removedScheduleIds.has(log.visit_schedule_id))
    ),
    notification_tasks: db.notification_tasks.filter(
      (task) => !task.visit_schedule_id || !removedScheduleIds.has(task.visit_schedule_id)
    ),
    leave_requests: db.leave_requests.filter(
      (leaveRequest) => !removedDoctorIds.has(leaveRequest.doctor_id)
    ),
    reschedule_actions: db.reschedule_actions.filter(
      (action) =>
        !removedScheduleIds.has(action.visit_schedule_id) &&
        (!action.new_doctor_id || !removedDoctorIds.has(action.new_doctor_id))
    ),
    reminders: db.reminders.filter(
      (reminder) =>
        !reminder.related_visit_schedule_id ||
        !removedScheduleIds.has(reminder.related_visit_schedule_id)
    ),
    notification_center_items: db.notification_center_items.filter(
      (item) =>
        (!item.linked_doctor_id || !removedDoctorIds.has(item.linked_doctor_id)) &&
        (!item.linked_visit_schedule_id || !removedScheduleIds.has(item.linked_visit_schedule_id)) &&
        (!item.linked_leave_request_id || !removedLeaveRequestIds.has(item.linked_leave_request_id))
    ),
    doctor_location_logs: db.doctor_location_logs.filter(
      (log) =>
        !removedDoctorIds.has(log.doctor_id) &&
        (!log.linked_visit_schedule_id || !removedScheduleIds.has(log.linked_visit_schedule_id))
    )
  };
}

function isLegacyHospitalCoordinate(latitude: number | null, longitude: number | null) {
  return latitude === LEGACY_HOSPITAL_LATITUDE && longitude === LEGACY_HOSPITAL_LONGITUDE;
}

function normalizeHospitalRoutePlanEndpoints(db: AppDb): AppDb {
  let didChange = false;
  const savedRoutePlans = db.saved_route_plans.map((routePlan) => {
    const shouldFixStart =
      routePlan.start_address === HOSPITAL_ADDRESS &&
      isLegacyHospitalCoordinate(routePlan.start_latitude, routePlan.start_longitude);
    const shouldFixEnd =
      routePlan.end_address === HOSPITAL_ADDRESS &&
      isLegacyHospitalCoordinate(routePlan.end_latitude, routePlan.end_longitude);

    if (!shouldFixStart && !shouldFixEnd) {
      return routePlan;
    }

    didChange = true;
    return {
      ...routePlan,
      start_latitude: shouldFixStart ? HOSPITAL_LATITUDE : routePlan.start_latitude,
      start_longitude: shouldFixStart ? HOSPITAL_LONGITUDE : routePlan.start_longitude,
      end_latitude: shouldFixEnd ? HOSPITAL_LATITUDE : routePlan.end_latitude,
      end_longitude: shouldFixEnd ? HOSPITAL_LONGITUDE : routePlan.end_longitude
    };
  });

  return didChange
    ? {
        ...db,
        saved_route_plans: savedRoutePlans
      }
    : db;
}

export function normalizeAppDbForCurrentVersion(db: AppDb): AppDb {
  return normalizeHospitalRoutePlanEndpoints(removeExpiredSavedRoutePlans(removeLegacyDoctorSeed(db)));
}

function seedAndPersistDb(): AppDb {
  const seeded = normalizeAppDbForCurrentVersion(createSeedDb());
  window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function parseDbSnapshot(raw: string | null): AppDb | null {
  if (!raw) {
    return null;
  }

  try {
    return appDbSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error("解析本機同步資料失敗。", error);
    return null;
  }
}

export function loadDb(): AppDb {
  if (typeof window === "undefined") {
    return normalizeAppDbForCurrentVersion(createSeedDb());
  }

  const raw = window.localStorage.getItem(MOCK_DB_STORAGE_KEY);
  if (!raw) {
    return seedAndPersistDb();
  }

  try {
    const parsedDb = appDbSchema.parse(JSON.parse(raw));
    const cleanedDb = normalizeAppDbForCurrentVersion(parsedDb);
    if (cleanedDb !== parsedDb) {
      window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(cleanedDb));
    }
    return cleanedDb;
  } catch (error) {
    const recoveryKey = `${RECOVERY_KEY_PREFIX}-${Date.now()}`;
    window.localStorage.setItem(recoveryKey, raw);
    console.error("讀取本機資料失敗，已改用預設假資料重新建立。", error);
    return seedAndPersistDb();
  }
}

export function persistDb(db: AppDb): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    MOCK_DB_STORAGE_KEY,
    JSON.stringify(normalizeAppDbForCurrentVersion(db))
  );
}

export function subscribeDbStorage(listener: (db: AppDb) => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== MOCK_DB_STORAGE_KEY) {
      return;
    }

    const nextDb = parseDbSnapshot(event.newValue);
    listener(nextDb ? normalizeAppDbForCurrentVersion(nextDb) : normalizeAppDbForCurrentVersion(createSeedDb()));
  };

  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
