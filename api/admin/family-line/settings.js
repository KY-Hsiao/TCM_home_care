import {
  getFamilyLineSettings,
  normalizeFamilyLineSettings,
  updateFamilyLineSettings
} from "../../_lib/family-line-settings.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function normalizeBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(request, response) {
  if (!["GET", "PATCH", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, PATCH, POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  try {
    if (request.method === "GET") {
      const result = await getFamilyLineSettings();
      setJson(response, 200, result);
      return;
    }

    const body = normalizeBody(request);
    const result = await updateFamilyLineSettings(normalizeFamilyLineSettings(body.settings ?? body));
    setJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    setJson(response, message.includes("DATABASE_URL") ? 503 : 500, {
      error: message.includes("DATABASE_URL")
        ? "LINE 聯繫設定資料庫尚未完成設定，請先配置 Neon / Vercel Postgres。"
        : "LINE 聯繫設定存取失敗。"
    });
  }
}
