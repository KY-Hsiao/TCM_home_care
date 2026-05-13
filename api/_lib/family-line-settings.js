import { Pool } from "@neondatabase/serverless";

const DEFAULT_SETTINGS = {
  doctorLeaveAutoBroadcast: false,
  doctorArrivalReminder: true,
  afterReturnCare: true
};

let ensured = false;
let poolInstance = null;

function getPool() {
  if (poolInstance) return poolInstance;
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL/POSTGRES_URL");
  poolInstance = new Pool({ connectionString });
  return poolInstance;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

export function normalizeFamilyLineSettings(value = {}) {
  return {
    doctorLeaveAutoBroadcast:
      typeof value.doctorLeaveAutoBroadcast === "boolean"
        ? value.doctorLeaveAutoBroadcast
        : DEFAULT_SETTINGS.doctorLeaveAutoBroadcast,
    doctorArrivalReminder:
      typeof value.doctorArrivalReminder === "boolean"
        ? value.doctorArrivalReminder
        : DEFAULT_SETTINGS.doctorArrivalReminder,
    afterReturnCare:
      typeof value.afterReturnCare === "boolean"
        ? value.afterReturnCare
        : DEFAULT_SETTINGS.afterReturnCare
  };
}

export async function ensureFamilyLineSettingsTable() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS family_line_settings (
      settings_key TEXT PRIMARY KEY,
      settings_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  ensured = true;
}

export async function getFamilyLineSettings() {
  await ensureFamilyLineSettingsTable();
  const result = await query(
    "SELECT settings_payload, updated_at FROM family_line_settings WHERE settings_key = 'default' LIMIT 1;"
  );
  if (!result.rows[0]) {
    return { settings: DEFAULT_SETTINGS, updatedAt: null };
  }
  return {
    settings: normalizeFamilyLineSettings(result.rows[0].settings_payload),
    updatedAt: new Date(result.rows[0].updated_at).toISOString()
  };
}

export async function updateFamilyLineSettings(settings) {
  await ensureFamilyLineSettingsTable();
  const normalized = normalizeFamilyLineSettings(settings);
  const now = new Date().toISOString();
  const result = await query(
    `
      INSERT INTO family_line_settings (settings_key, settings_payload, updated_at)
      VALUES ('default', $1::jsonb, $2)
      ON CONFLICT (settings_key) DO UPDATE SET
        settings_payload = EXCLUDED.settings_payload,
        updated_at = EXCLUDED.updated_at
      RETURNING settings_payload, updated_at;
    `,
    [JSON.stringify(normalized), now]
  );
  return {
    settings: normalizeFamilyLineSettings(result.rows[0]?.settings_payload ?? normalized),
    updatedAt: new Date(result.rows[0]?.updated_at ?? now).toISOString()
  };
}
