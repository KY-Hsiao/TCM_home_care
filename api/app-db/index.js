import {
  ensureAppDbSnapshotTable,
  getAppDbSnapshot,
  upsertAppDbSnapshot
} from "../_lib/app-db-snapshot.js";

const REQUIRED_APP_DB_ARRAY_KEYS = [
  "patients",
  "caregivers",
  "caregiver_chat_bindings",
  "doctors",
  "admin_users",
  "visit_schedules",
  "saved_route_plans",
  "visit_records",
  "contact_logs",
  "notification_templates",
  "notification_tasks",
  "leave_requests",
  "reschedule_actions",
  "reminders",
  "notification_center_items",
  "doctor_location_logs"
];

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function normalizeBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return {};
}

function validateAppDbPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "資料快照格式錯誤。";
  }

  const missingKey = REQUIRED_APP_DB_ARRAY_KEYS.find((key) => !Array.isArray(value[key]));
  if (missingKey) {
    return `資料快照缺少 ${missingKey} 清單。`;
  }

  return null;
}

export default async function handler(request, response) {
  if (!["GET", "PUT"].includes(request.method)) {
    response.setHeader("Allow", "GET, PUT");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  try {
    await ensureAppDbSnapshotTable();

    if (request.method === "GET") {
      const snapshot = await getAppDbSnapshot();
      if (!snapshot) {
        setJson(response, 404, {
          reason: "SNAPSHOT_NOT_FOUND",
          error: "尚未建立伺服器資料快照。"
        });
        return;
      }

      setJson(response, 200, snapshot);
      return;
    }

    const body = normalizeBody(request);
    const db = body.db ?? body;
    const validationError = validateAppDbPayload(db);
    if (validationError) {
      setJson(response, 400, {
        reason: "INVALID_APP_DB",
        error: validationError
      });
      return;
    }

    const snapshot = await upsertAppDbSnapshot(db);
    setJson(response, 200, {
      ok: true,
      ...snapshot
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    setJson(response, message.includes("DATABASE_URL") ? 503 : 500, {
      reason: message.includes("DATABASE_URL") ? "DATABASE_NOT_CONFIGURED" : "APP_DB_SYNC_FAILED",
      error: message.includes("DATABASE_URL")
        ? "伺服器資料庫尚未完成設定，請先配置 Neon / Vercel Postgres 的 DATABASE_URL 或 POSTGRES_URL。"
        : "伺服器資料快照存取失敗。"
    });
  }
}
