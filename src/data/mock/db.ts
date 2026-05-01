import { appDbSchema, type AppDb } from "../../domain/models";
import { createSeedDb } from "../seed";

export const MOCK_DB_STORAGE_KEY = "tcm-home-care-mvp-db";
const RECOVERY_KEY_PREFIX = "tcm-home-care-mvp-db-recovery";
const ROUTE_PLAN_RETENTION_DAYS = 30;
const REMOVED_LEGACY_DOCTOR_ID = "doc-002";
const REMOVED_LEGACY_DOCTOR_NAME = "林若謙醫師";

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

function removeLegacyLinDoctorSeed(db: AppDb): AppDb {
  const legacyDoctor = db.doctors.find(
    (doctor) => doctor.id === REMOVED_LEGACY_DOCTOR_ID && doctor.name === REMOVED_LEGACY_DOCTOR_NAME
  );
  if (!legacyDoctor) {
    return db;
  }

  const removedScheduleIds = new Set(
    db.visit_schedules
      .filter((schedule) => schedule.assigned_doctor_id === REMOVED_LEGACY_DOCTOR_ID)
      .map((schedule) => schedule.id)
  );
  const removedLeaveRequestIds = new Set(
    db.leave_requests
      .filter((leaveRequest) => leaveRequest.doctor_id === REMOVED_LEGACY_DOCTOR_ID)
      .map((leaveRequest) => leaveRequest.id)
  );

  return {
    ...db,
    doctors: db.doctors.filter((doctor) => doctor.id !== REMOVED_LEGACY_DOCTOR_ID),
    visit_schedules: db.visit_schedules.filter(
      (schedule) => schedule.assigned_doctor_id !== REMOVED_LEGACY_DOCTOR_ID
    ),
    saved_route_plans: db.saved_route_plans.filter(
      (routePlan) =>
        routePlan.doctor_id !== REMOVED_LEGACY_DOCTOR_ID &&
        !routePlan.schedule_ids.some((scheduleId) => removedScheduleIds.has(scheduleId))
    ),
    visit_records: db.visit_records.filter((record) => !removedScheduleIds.has(record.visit_schedule_id)),
    contact_logs: db.contact_logs.filter(
      (log) =>
        log.doctor_id !== REMOVED_LEGACY_DOCTOR_ID &&
        (!log.visit_schedule_id || !removedScheduleIds.has(log.visit_schedule_id))
    ),
    notification_tasks: db.notification_tasks.filter(
      (task) => !task.visit_schedule_id || !removedScheduleIds.has(task.visit_schedule_id)
    ),
    leave_requests: db.leave_requests.filter(
      (leaveRequest) => leaveRequest.doctor_id !== REMOVED_LEGACY_DOCTOR_ID
    ),
    reschedule_actions: db.reschedule_actions.filter(
      (action) =>
        !removedScheduleIds.has(action.visit_schedule_id) &&
        action.new_doctor_id !== REMOVED_LEGACY_DOCTOR_ID
    ),
    reminders: db.reminders.filter(
      (reminder) =>
        !reminder.related_visit_schedule_id ||
        !removedScheduleIds.has(reminder.related_visit_schedule_id)
    ),
    notification_center_items: db.notification_center_items.filter(
      (item) =>
        item.linked_doctor_id !== REMOVED_LEGACY_DOCTOR_ID &&
        (!item.linked_visit_schedule_id || !removedScheduleIds.has(item.linked_visit_schedule_id)) &&
        (!item.linked_leave_request_id || !removedLeaveRequestIds.has(item.linked_leave_request_id))
    ),
    doctor_location_logs: db.doctor_location_logs.filter(
      (log) =>
        log.doctor_id !== REMOVED_LEGACY_DOCTOR_ID &&
        (!log.linked_visit_schedule_id || !removedScheduleIds.has(log.linked_visit_schedule_id))
    )
  };
}

function seedAndPersistDb(): AppDb {
  const seeded = removeExpiredSavedRoutePlans(removeLegacyLinDoctorSeed(createSeedDb()));
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
    return removeExpiredSavedRoutePlans(removeLegacyLinDoctorSeed(createSeedDb()));
  }

  const raw = window.localStorage.getItem(MOCK_DB_STORAGE_KEY);
  if (!raw) {
    return seedAndPersistDb();
  }

  try {
    const parsedDb = appDbSchema.parse(JSON.parse(raw));
    const migratedDb = removeLegacyLinDoctorSeed(parsedDb);
    const cleanedDb = removeExpiredSavedRoutePlans(migratedDb);
    if (migratedDb !== parsedDb || cleanedDb !== migratedDb) {
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
    JSON.stringify(removeExpiredSavedRoutePlans(removeLegacyLinDoctorSeed(db)))
  );
}

export function resetDb(): AppDb {
  const seeded = removeExpiredSavedRoutePlans(removeLegacyLinDoctorSeed(createSeedDb()));
  persistDb(seeded);
  return seeded;
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
    listener(nextDb ?? createSeedDb());
  };

  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
