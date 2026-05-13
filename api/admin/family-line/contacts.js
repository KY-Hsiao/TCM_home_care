import {
  ensureFamilyLineContactsTable,
  listFamilyLineContacts,
  updateFamilyLineContact
} from "../../_lib/family-line-contacts.js";
import {
  getFamilyLineSettings,
  getFamilyLineTemplateDrafts,
  normalizeFamilyLineSettings,
  normalizeFamilyLineTemplateDrafts,
  updateFamilyLineSettings,
  updateFamilyLineTemplateDrafts
} from "../../_lib/family-line-settings.js";

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

function getResource(request) {
  const queryResource = request.query?.resource;
  if (Array.isArray(queryResource)) {
    return String(queryResource[0] ?? "");
  }
  if (queryResource) {
    return String(queryResource);
  }
  try {
    const url = new URL(request.url || "", "http://localhost");
    return url.searchParams.get("resource") || "";
  } catch {
    return "";
  }
}

export default async function handler(request, response) {
  if (!["GET", "PATCH", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, PATCH, POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const resource = getResource(request);

  try {
    if (resource === "settings") {
      if (request.method === "GET") {
        const result = await getFamilyLineSettings();
        setJson(response, 200, result);
        return;
      }

      const body = normalizeBody(request);
      const result = await updateFamilyLineSettings(
        normalizeFamilyLineSettings(body.settings ?? body)
      );
      setJson(response, 200, result);
      return;
    }

    if (resource === "templates") {
      if (request.method === "GET") {
        const result = await getFamilyLineTemplateDrafts();
        setJson(response, 200, result);
        return;
      }

      const body = normalizeBody(request);
      const result = await updateFamilyLineTemplateDrafts(
        normalizeFamilyLineTemplateDrafts(body.templates ?? body)
      );
      setJson(response, 200, result);
      return;
    }

    await ensureFamilyLineContactsTable();

    if (request.method === "GET") {
      const contacts = await listFamilyLineContacts();
      setJson(response, 200, { contacts, friends: contacts });
      return;
    }

    const body = normalizeBody(request);
    const updatedContact = await updateFamilyLineContact({
      lineUserId: body.lineUserId ?? body.userId,
      linkedPatientIds: body.linkedPatientIds,
      contactRole: body.contactRole,
      note: body.note
    });

    if (!updatedContact) {
      setJson(response, 404, { error: "找不到這位 LINE 好友，請先讓對方加入官方帳號並傳送訊息。" });
      return;
    }

    setJson(response, 200, { contact: updatedContact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const missingDatabase = message.includes("DATABASE_URL") || message.includes("POSTGRES_URL");
    const isSettings = resource === "settings";
    const isTemplates = resource === "templates";
    setJson(response, missingDatabase ? 503 : 500, {
      error: missingDatabase
        ? isSettings
          ? "LINE 發訊息設定資料庫尚未完成設定，請先配置 Neon / Vercel Postgres。"
          : isTemplates
            ? "LINE 訊息模板資料庫尚未完成設定，請先配置 Neon / Vercel Postgres。"
            : "LINE 名單資料庫尚未完成設定，請先配置 Neon / Vercel Postgres。"
        : isSettings
          ? "LINE 發訊息設定存取失敗。"
          : isTemplates
            ? "LINE 訊息模板存取失敗。"
            : "LINE 名單管理資料存取失敗。"
    });
  }
}
