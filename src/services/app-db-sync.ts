import { appDbSchema, type AppDb } from "../domain/models";

const APP_DB_SYNC_ENDPOINT = "/api/app-db";
const APP_DB_SYNC_DEBOUNCE_MS = 800;
const TIMESTAMP_FIELD_NAMES = [
  "updated_at",
  "created_at",
  "saved_at",
  "recorded_at",
  "scheduled_start_at",
  "contacted_at"
];

function canUseServerSync() {
  return (
    typeof window !== "undefined" &&
    typeof fetch === "function" &&
    import.meta.env.MODE !== "test"
  );
}

export function getAppDbSyncDebounceMs() {
  return APP_DB_SYNC_DEBOUNCE_MS;
}

export function resolveAppDbLatestTimestamp(db: AppDb): number {
  let latestTimestamp = 0;

  Object.values(db).forEach((records) => {
    records.forEach((record) => {
      TIMESTAMP_FIELD_NAMES.forEach((fieldName) => {
        const value = (record as Record<string, unknown>)[fieldName];
        if (typeof value !== "string" || !value.trim()) {
          return;
        }
        const timestamp = Date.parse(value);
        if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
          latestTimestamp = timestamp;
        }
      });
    });
  });

  return latestTimestamp;
}

export function shouldPreferLocalAppDb(localDb: AppDb, serverDb: AppDb) {
  return resolveAppDbLatestTimestamp(localDb) > resolveAppDbLatestTimestamp(serverDb);
}

export async function fetchServerAppDb(): Promise<AppDb | null> {
  if (!canUseServerSync()) {
    return null;
  }

  try {
    const response = await fetch(APP_DB_SYNC_ENDPOINT, { cache: "no-store" });
    if (response.status === 404 || response.status === 503) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const payload = (await response.json()) as { db?: unknown };
    const parsed = appDbSchema.safeParse(payload.db);
    if (!parsed.success) {
      console.warn("伺服器資料快照格式不符，已保留本機資料。", parsed.error);
      return null;
    }

    return parsed.data;
  } catch (error) {
    console.warn("讀取伺服器資料快照失敗，已保留本機資料。", error);
    return null;
  }
}

export async function persistServerAppDb(db: AppDb): Promise<boolean> {
  if (!canUseServerSync()) {
    return false;
  }

  try {
    const response = await fetch(APP_DB_SYNC_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ db })
    });
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    return true;
  } catch (error) {
    console.warn("寫入伺服器資料快照失敗，已保留本機資料。", error);
    return false;
  }
}
