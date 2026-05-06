import {
  formatGoogleDriveApiError,
  resolveGoogleDriveAccessToken
} from "../_lib/google-drive-auth.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isConfigured(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function handleEnvStatus(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  setJson(response, 200, {
    ok: true,
    variables: {
      LINE_CHANNEL_ACCESS_TOKEN: isConfigured(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      LINE_CHANNEL_SECRET: isConfigured(process.env.LINE_CHANNEL_SECRET),
      OPENAI_API_KEY: isConfigured(process.env.OPENAI_API_KEY),
      GOOGLE_MAPS_API_KEY:
        isConfigured(process.env.GOOGLE_MAPS_API_KEY) ||
        isConfigured(process.env.VITE_GOOGLE_MAPS_API_KEY),
      GOOGLE_CALENDAR_ID: isConfigured(process.env.GOOGLE_CALENDAR_ID),
      GOOGLE_DRIVE_ACCESS_TOKEN: isConfigured(process.env.GOOGLE_DRIVE_ACCESS_TOKEN),
      GOOGLE_DRIVE_REFRESH_TOKEN: isConfigured(process.env.GOOGLE_DRIVE_REFRESH_TOKEN),
      GOOGLE_DRIVE_CLIENT_ID: isConfigured(process.env.GOOGLE_DRIVE_CLIENT_ID),
      GOOGLE_DRIVE_CLIENT_SECRET: isConfigured(process.env.GOOGLE_DRIVE_CLIENT_SECRET),
      GOOGLE_DRIVE_FOLDER_ID: isConfigured(process.env.GOOGLE_DRIVE_FOLDER_ID)
    }
  });
}

async function testGptConnection(response) {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!isConfigured(apiKey)) {
    setJson(response, 503, {
      reason: "OPENAI_API_KEY_MISSING",
      error: "尚未設定 OPENAI_API_KEY，無法測試 GPT 連線。"
    });
    return;
  }

  const openAiResponse = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const payload = await openAiResponse.json().catch(() => ({}));
  if (!openAiResponse.ok) {
    setJson(response, openAiResponse.status === 401 ? 401 : 502, {
      reason: payload.error?.code ?? payload.error?.type ?? `HTTP_${openAiResponse.status}`,
      error:
        payload.error?.message ??
        `GPT 連線測試失敗：HTTP ${openAiResponse.status}`
    });
    return;
  }

  setJson(response, 200, {
    ok: true,
    service: "gpt",
    message: "GPT 連線正常。"
  });
}

async function testGoogleDriveConnection(response) {
  const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID ?? "").trim();
  if (!isConfigured(folderId)) {
    setJson(response, 503, {
      reason: "GOOGLE_DRIVE_FOLDER_ID_MISSING",
      error: "尚未設定 GOOGLE_DRIVE_FOLDER_ID，無法測試 Google Drive 連線。"
    });
    return;
  }

  const auth = await resolveGoogleDriveAccessToken();
  if (!auth.ok) {
    setJson(response, auth.statusCode, {
      reason: auth.reason,
      error: auth.error
    });
    return;
  }

  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set(
    "q",
    `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`
  );
  listUrl.searchParams.set("fields", "files(id,name),nextPageToken");
  listUrl.searchParams.set("pageSize", "1");
  const driveResponse = await fetch(listUrl.toString(), {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`
    }
  });
  const payload = await driveResponse.json().catch(() => ({}));
  if (!driveResponse.ok) {
    setJson(
      response,
      driveResponse.status === 401 ? 401 : 502,
      formatGoogleDriveApiError(
        payload,
        `Google Drive 連線測試失敗：HTTP ${driveResponse.status}`,
        driveResponse.status
      )
    );
    return;
  }

  setJson(response, 200, {
    ok: true,
    service: "google-drive",
    message: "Google Drive 連線正常，已確認病歷資料夾可讀取。"
  });
}

async function handleConnectionTest(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const service = String(resolveQueryValue(request.query?.service) ?? "").trim();
  try {
    if (service === "gpt") {
      await testGptConnection(response);
      return;
    }
    if (service === "google-drive") {
      await testGoogleDriveConnection(response);
      return;
    }

    setJson(response, 400, {
      reason: "UNSUPPORTED_SERVICE",
      error: "不支援的連線測試項目。"
    });
  } catch (error) {
    setJson(response, 502, {
      reason: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : "連線測試失敗。"
    });
  }
}

export default async function handler(request, response) {
  const resource = String(resolveQueryValue(request.query?.resource) ?? "").trim();
  if (resource === "env-status") {
    handleEnvStatus(request, response);
    return;
  }
  if (resource === "connection-test") {
    await handleConnectionTest(request, response);
    return;
  }

  setJson(response, 404, {
    reason: "ADMIN_RESOURCE_NOT_FOUND",
    error: "找不到指定的行政端 API。"
  });
}
