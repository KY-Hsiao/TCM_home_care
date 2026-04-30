import { appDbSchema, type AppDb } from "../../domain/models";
import { createSeedDb } from "../seed";

export const MOCK_DB_STORAGE_KEY = "tcm-home-care-mvp-db";
const RECOVERY_KEY_PREFIX = "tcm-home-care-mvp-db-recovery";
const ROUTE_PLAN_RETENTION_DAYS = 30;

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

function seedAndPersistDb(): AppDb {
  const seeded = removeExpiredSavedRoutePlans(createSeedDb());
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
    return removeExpiredSavedRoutePlans(createSeedDb());
  }

  const raw = window.localStorage.getItem(MOCK_DB_STORAGE_KEY);
  if (!raw) {
    return seedAndPersistDb();
  }

  try {
    const parsedDb = appDbSchema.parse(JSON.parse(raw));
    const cleanedDb = removeExpiredSavedRoutePlans(parsedDb);
    if (cleanedDb.saved_route_plans.length !== parsedDb.saved_route_plans.length) {
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
    JSON.stringify(removeExpiredSavedRoutePlans(db))
  );
}

export function resetDb(): AppDb {
  const seeded = removeExpiredSavedRoutePlans(createSeedDb());
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
