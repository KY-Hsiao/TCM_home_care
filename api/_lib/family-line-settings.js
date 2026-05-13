import { Pool } from "@neondatabase/serverless";

const DEFAULT_SETTINGS = {
  doctorLeaveAutoBroadcast: false,
  doctorArrivalReminder: true,
  afterReturnCare: true
};

const DEFAULT_TEMPLATE_DRAFTS = {
  doctor_leave: {
    subject: "醫師請假公告",
    content: "您好，{醫師} 因請假需調整部分居家訪視安排。行政人員會再與您確認後續改派或改期時間，造成不便敬請見諒。"
  },
  arrival_reminder: {
    subject: "醫師即將抵達提醒",
    content: "您好，{醫師} 預計稍後抵達，請協助家中環境與個案狀態準備。若臨時不便，請盡快回覆行政人員。"
  },
  after_return: {
    subject: "訪視後關心",
    content: "您好，今日居家訪視已完成，請持續觀察個案狀態、補充水分並依醫師建議照護。若有不適或疑問，請回覆此 LINE 訊息。"
  },
  custom_notice: {
    subject: "居家照護公告",
    content: "您好，這裡是中醫居家照護團隊，提醒您留意今日照護安排。"
  }
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

function normalizeTemplateDraft(value, fallback) {
  const draft = value && typeof value === "object" ? value : {};
  return {
    subject:
      typeof draft.subject === "string" && draft.subject.trim()
        ? draft.subject
        : fallback.subject,
    content:
      typeof draft.content === "string" && draft.content.trim()
        ? draft.content
        : fallback.content
  };
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

export function normalizeFamilyLineTemplateDrafts(value = {}) {
  const templates = value && typeof value === "object" ? value : {};
  return {
    doctor_leave: normalizeTemplateDraft(templates.doctor_leave, DEFAULT_TEMPLATE_DRAFTS.doctor_leave),
    arrival_reminder: normalizeTemplateDraft(templates.arrival_reminder, DEFAULT_TEMPLATE_DRAFTS.arrival_reminder),
    after_return: normalizeTemplateDraft(templates.after_return, DEFAULT_TEMPLATE_DRAFTS.after_return),
    custom_notice: normalizeTemplateDraft(templates.custom_notice, DEFAULT_TEMPLATE_DRAFTS.custom_notice)
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

export async function getFamilyLineTemplateDrafts() {
  await ensureFamilyLineSettingsTable();
  const result = await query(
    "SELECT settings_payload, updated_at FROM family_line_settings WHERE settings_key = 'templates' LIMIT 1;"
  );
  if (!result.rows[0]) {
    return { templates: DEFAULT_TEMPLATE_DRAFTS, updatedAt: null };
  }
  return {
    templates: normalizeFamilyLineTemplateDrafts(result.rows[0].settings_payload),
    updatedAt: new Date(result.rows[0].updated_at).toISOString()
  };
}

export async function updateFamilyLineTemplateDrafts(templates) {
  await ensureFamilyLineSettingsTable();
  const normalized = normalizeFamilyLineTemplateDrafts(templates);
  const now = new Date().toISOString();
  const result = await query(
    `
      INSERT INTO family_line_settings (settings_key, settings_payload, updated_at)
      VALUES ('templates', $1::jsonb, $2)
      ON CONFLICT (settings_key) DO UPDATE SET
        settings_payload = EXCLUDED.settings_payload,
        updated_at = EXCLUDED.updated_at
      RETURNING settings_payload, updated_at;
    `,
    [JSON.stringify(normalized), now]
  );
  return {
    templates: normalizeFamilyLineTemplateDrafts(result.rows[0]?.settings_payload ?? normalized),
    updatedAt: new Date(result.rows[0]?.updated_at ?? now).toISOString()
  };
}
