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
  "route_completion_records",
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
const REMOVED_LEGACY_DOCTOR_ID = "doc-002";
const REMOVED_LEGACY_DOCTOR_NAMES = new Set(["林若謙醫師", "支援醫師"]);
const STATISTICAL_ROUTE_STATUSES = new Set(["executing", "archived", "completed"]);

function buildTaipeiDateRange(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    return null;
  }

  return {
    timeMin: `${dateValue}T00:00:00+08:00`,
    timeMax: `${dateValue}T23:59:59+08:00`
  };
}

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

function resolveResource(request) {
  if (typeof request.query?.resource === "string") {
    return request.query.resource;
  }

  try {
    const url = new URL(request.url ?? "", "https://tcm-home-care.local");
    return url.searchParams.get("resource") ?? "";
  } catch {
    return "";
  }
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

function buildRouteCompletionRecordId(routePlan) {
  return `route-completion-${routePlan.id}-${routePlan.route_date}-${routePlan.service_time_slot}`;
}

function resolveRouteUrgentCount(db, routePlan) {
  const scheduleIds = new Set(
    Array.isArray(routePlan.route_items)
      ? routePlan.route_items.map((item) => item.schedule_id).filter(Boolean)
      : []
  );
  const urgentScheduleIds = new Set(
    db.visit_schedules
      .filter((schedule) => scheduleIds.has(schedule.id) && schedule.last_feedback_code === "urgent")
      .map((schedule) => schedule.id)
  );
  db.notification_center_items.forEach((item) => {
    if (
      item.linked_visit_schedule_id &&
      scheduleIds.has(item.linked_visit_schedule_id) &&
      item.status === "pending" &&
      item.source_type === "patient_exception" &&
      (String(item.title ?? "").includes("urgent") ||
        String(item.content ?? "").includes("urgent") ||
        String(item.title ?? "").includes("緊急"))
    ) {
      urgentScheduleIds.add(item.linked_visit_schedule_id);
    }
  });
  return urgentScheduleIds.size;
}

function buildRouteCompletionRecord(db, routePlan, recordedAt) {
  const routeItems = Array.isArray(routePlan.route_items) ? routePlan.route_items : [];
  const now = recordedAt || new Date().toISOString();
  const completedAt =
    routePlan.execution_status === "completed" || routePlan.execution_status === "archived" ? now : null;
  return {
    id: buildRouteCompletionRecordId(routePlan),
    route_plan_id: routePlan.id,
    doctor_id: routePlan.doctor_id,
    route_date: routePlan.route_date,
    route_weekday: routePlan.route_weekday,
    service_time_slot: routePlan.service_time_slot,
    route_name: routePlan.route_name,
    executed_visit_count: routeItems.filter((item) => item.checked && item.status !== "paused").length,
    paused_count: routeItems.filter((item) => !item.checked || item.status === "paused").length,
    urgent_count: resolveRouteUrgentCount(db, routePlan),
    schedule_ids: routeItems.map((item) => item.schedule_id).filter(Boolean),
    route_item_keys: routeItems.map((item, index) => item.schedule_id || `${item.patient_id}:${index + 1}`),
    source_execution_status: routePlan.execution_status,
    recorded_at: routePlan.executed_at || routePlan.updated_at || now,
    completed_at: completedAt,
    created_at: routePlan.created_at || now,
    updated_at: now
  };
}

function backfillRouteCompletionRecords(db) {
  const recordById = new Map(
    (Array.isArray(db.route_completion_records) ? db.route_completion_records : []).map((record) => [
      record.id,
      record
    ])
  );
  const savedRoutePlans = Array.isArray(db.saved_route_plans) ? db.saved_route_plans : [];
  const backfillDb = {
    ...db,
    visit_schedules: Array.isArray(db.visit_schedules) ? db.visit_schedules : [],
    notification_center_items: Array.isArray(db.notification_center_items) ? db.notification_center_items : []
  };
  savedRoutePlans
    .filter(
      (routePlan) =>
        STATISTICAL_ROUTE_STATUSES.has(routePlan.execution_status) &&
        Array.isArray(routePlan.route_items) &&
        routePlan.route_items.length > 0
    )
    .forEach((routePlan) => {
      const nextRecord = buildRouteCompletionRecord(backfillDb, routePlan, routePlan.updated_at);
      const existing = recordById.get(nextRecord.id);
      recordById.set(nextRecord.id, existing ? { ...nextRecord, created_at: existing.created_at } : nextRecord);
    });
  return {
    ...db,
    route_completion_records: Array.from(recordById.values())
  };
}

function isRemovedLegacyDoctor(doctor) {
  return (
    doctor?.id === REMOVED_LEGACY_DOCTOR_ID ||
    REMOVED_LEGACY_DOCTOR_NAMES.has(String(doctor?.name ?? ""))
  );
}

function normalizeAppDbPayload(db) {
  db = backfillRouteCompletionRecords({
    ...db,
    route_completion_records: Array.isArray(db.route_completion_records) ? db.route_completion_records : []
  });
  const doctors = Array.isArray(db.doctors) ? db.doctors : [];
  const removedDoctorIds = new Set(
    doctors.filter((doctor) => isRemovedLegacyDoctor(doctor)).map((doctor) => doctor.id)
  );
  removedDoctorIds.add(REMOVED_LEGACY_DOCTOR_ID);
  if (removedDoctorIds.size === 0) {
    return db;
  }

  const fallbackDoctorId = doctors.find((doctor) => !removedDoctorIds.has(doctor.id))?.id ?? "doc-001";
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
    route_completion_records: db.route_completion_records.filter(
      (record) =>
        !removedDoctorIds.has(record.doctor_id) &&
        !record.schedule_ids.some((scheduleId) => removedScheduleIds.has(scheduleId))
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

async function handleAppDbSync(request, response) {
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

      const normalizedDb = normalizeAppDbPayload(snapshot.db);
      if (JSON.stringify(normalizedDb) !== JSON.stringify(snapshot.db)) {
        const migratedSnapshot = await upsertAppDbSnapshot(normalizedDb);
        setJson(response, 200, migratedSnapshot);
        return;
      }

      setJson(response, 200, snapshot);
      return;
    }

    const body = normalizeBody(request);
    const db = body.db ?? body;
    const dbWithCurrentSchema = {
      ...db,
      route_completion_records: Array.isArray(db?.route_completion_records) ? db.route_completion_records : []
    };
    const validationError = validateAppDbPayload(dbWithCurrentSchema);
    if (validationError) {
      setJson(response, 400, {
        reason: "INVALID_APP_DB",
        error: validationError
      });
      return;
    }

    const normalizedDb = normalizeAppDbPayload(dbWithCurrentSchema);
    const snapshot = await upsertAppDbSnapshot(normalizedDb);
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

async function handleGoogleCalendarEvents(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const body = normalizeBody(request);
  const calendarId = String(process.env.GOOGLE_CALENDAR_ID ?? "").trim();
  const googleApiKey = String(process.env.GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
  const dateValue = String(body.date ?? "").trim();
  const dateRange = buildTaipeiDateRange(dateValue);

  if (!calendarId) {
    setJson(response, 400, {
      reason: "CALENDAR_ID_MISSING",
      error: "尚未設定 Google Calendar ID，無法讀取特定日期行程。"
    });
    return;
  }
  if (!googleApiKey) {
    setJson(response, 400, {
      reason: "GOOGLE_API_KEY_MISSING",
      error: "尚未設定 Google API Key，無法讀取 Google 日曆。"
    });
    return;
  }
  if (!dateRange) {
    setJson(response, 400, {
      reason: "DATE_INVALID",
      error: "請提供 YYYY-MM-DD 格式的日期。"
    });
    return;
  }

  try {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    );
    url.searchParams.set("key", googleApiKey);
    url.searchParams.set("timeMin", dateRange.timeMin);
    url.searchParams.set("timeMax", dateRange.timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeZone", "Asia/Taipei");

    const calendarResponse = await fetch(url.toString());
    const payload = await calendarResponse.json();
    if (!calendarResponse.ok) {
      if (calendarResponse.status === 404) {
        setJson(response, 502, {
          reason: "CALENDAR_NOT_FOUND_OR_PRIVATE",
          error:
            "Google Calendar 找不到這個日曆，或目前日曆未公開給 API Key 讀取。請確認 GOOGLE_CALENDAR_ID 是否正確，並將該日曆設為公開可讀，或改用 OAuth / Service Account 授權。"
        });
        return;
      }
      setJson(response, 502, {
        reason: payload.error?.status ?? `HTTP_${calendarResponse.status}`,
        error: payload.error?.message ?? "Google Calendar API 讀取失敗。"
      });
      return;
    }

    const events = Array.isArray(payload.items)
      ? payload.items.map((event) => ({
          id: String(event.id ?? ""),
          summary: String(event.summary ?? "未命名行程"),
          start: event.start?.dateTime ?? event.start?.date ?? "",
          end: event.end?.dateTime ?? event.end?.date ?? "",
          htmlLink: event.htmlLink ?? ""
        }))
      : [];

    setJson(response, 200, {
      ok: true,
      date: dateValue,
      events
    });
  } catch (error) {
    setJson(response, 502, {
      reason: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : "呼叫 Google Calendar API 失敗。"
    });
  }
}

async function triggerGitHubWorkflow() {
  const token = process.env.GITHUB_DEPLOY_TOKEN;
  const owner = process.env.GITHUB_DEPLOY_OWNER;
  const repo = process.env.GITHUB_DEPLOY_REPO;
  const workflowId = process.env.GITHUB_DEPLOY_WORKFLOW_ID || "deploy-vercel.yml";
  const ref = process.env.GITHUB_DEPLOY_BRANCH || "main";

  if (!token || !owner || !repo) {
    return {
      triggered: false
    };
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ ref })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub workflow 觸發失敗：${response.status} ${detail}`);
  }

  return {
    triggered: true,
    message: `已觸發 GitHub workflow：${workflowId}（${ref}）`
  };
}

async function triggerVercelHook() {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    return {
      triggered: false
    };
  }

  const response = await fetch(hookUrl, {
    method: "POST"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Vercel deploy hook 觸發失敗：${response.status} ${detail}`);
  }

  return {
    triggered: true,
    message: "已直接觸發 Vercel 部署。"
  };
}

export default async function handler(request, response) {
  if (resolveResource(request) === "app-db") {
    await handleAppDbSync(request, response);
    return;
  }

  if (resolveResource(request) === "calendar-events") {
    await handleGoogleCalendarEvents(request, response);
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const configuredSecret = process.env.DEPLOY_SYNC_SHARED_SECRET;
  if (!configuredSecret) {
    setJson(response, 503, {
      error: "尚未設定 DEPLOY_SYNC_SHARED_SECRET，無法啟用線上更新按鈕。"
    });
    return;
  }

  const suppliedSecret = request.body?.secret;
  if (typeof suppliedSecret !== "string" || suppliedSecret !== configuredSecret) {
    setJson(response, 401, {
      error: "部署密碼不正確。"
    });
    return;
  }

  try {
    const githubResult = await triggerGitHubWorkflow();
    if (githubResult.triggered) {
      setJson(response, 200, {
        ok: true,
        mode: "github_workflow",
        message: `${githubResult.message}，後續將由 workflow 接續觸發 Vercel。`
      });
      return;
    }

    const vercelResult = await triggerVercelHook();
    if (vercelResult.triggered) {
      setJson(response, 200, {
        ok: true,
        mode: "vercel_hook",
        message: vercelResult.message
      });
      return;
    }

    setJson(response, 503, {
      error: "尚未設定 GitHub workflow 或 Vercel deploy hook，無法同步更新線上版本。"
    });
  } catch (error) {
    setJson(response, 502, {
      error: error instanceof Error ? error.message : "線上更新失敗。"
    });
  }
}
