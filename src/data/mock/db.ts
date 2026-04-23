import { appDbSchema, type AppDb } from "../../domain/models";
import { createSeedDb } from "../seed";

export const MOCK_DB_STORAGE_KEY = "tcm-home-care-mvp-db";
const RECOVERY_KEY_PREFIX = "tcm-home-care-mvp-db-recovery";

function seedAndPersistDb(): AppDb {
  const seeded = createSeedDb();
  window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

export function loadDb(): AppDb {
  if (typeof window === "undefined") {
    return createSeedDb();
  }

  const raw = window.localStorage.getItem(MOCK_DB_STORAGE_KEY);
  if (!raw) {
    return seedAndPersistDb();
  }

  try {
    return appDbSchema.parse(JSON.parse(raw));
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

  window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(db));
}

export function resetDb(): AppDb {
  const seeded = createSeedDb();
  persistDb(seeded);
  return seeded;
}
