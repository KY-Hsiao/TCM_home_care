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
