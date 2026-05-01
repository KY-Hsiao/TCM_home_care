import {
  ensureFamilyLineContactsTable,
  listFamilyLineContacts,
  updateFamilyLineContact
} from "../../_lib/family-line-contacts.js";

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

export default async function handler(request, response) {
  if (!["GET", "PATCH", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, PATCH, POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  try {
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
      note: body.note
    });

    if (!updatedContact) {
      setJson(response, 404, { error: "找不到這位 LINE 好友，請先讓對方加入官方帳號並傳送訊息。" });
      return;
    }

    setJson(response, 200, { contact: updatedContact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    setJson(response, message.includes("DATABASE_URL") ? 503 : 500, {
      error: message.includes("DATABASE_URL")
        ? "LINE 名單資料庫尚未完成設定，請先配置 Neon / Vercel Postgres。"
        : "LINE 名單管理資料存取失敗。"
    });
  }
}
