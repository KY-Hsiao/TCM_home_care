import crypto from "node:crypto";
import {
  ensureFamilyLineContactsTable,
  listFamilyLineContacts,
  upsertFamilyLineContact
} from "../_lib/family-line-contacts.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

async function readRawBody(request) {
  if (typeof request.body === "string") {
    return request.body;
  }
  if (request.body && typeof request.body === "object") {
    return JSON.stringify(request.body);
  }
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifySignature(rawBody, signature, channelSecret) {
  const normalizedSignature = Array.isArray(signature) ? signature[0] : signature;
  if (!channelSecret || !normalizedSignature) {
    return false;
  }
  const digest = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  const digestBuffer = Buffer.from(digest);
  const signatureBuffer = Buffer.from(normalizedSignature);
  return (
    digestBuffer.length === signatureBuffer.length &&
    crypto.timingSafeEqual(digestBuffer, signatureBuffer)
  );
}

async function fetchLineProfile(userId) {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) {
    return {
      userId,
      displayName: userId
    };
  }

  const lineResponse = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${channelAccessToken}`
    }
  });
  if (!lineResponse.ok) {
    return {
      userId,
      displayName: userId
    };
  }

  const payload = await lineResponse.json().catch(() => ({}));
  return {
    userId,
    displayName: String(payload?.displayName ?? userId),
    pictureUrl: String(payload?.pictureUrl ?? ""),
    statusMessage: String(payload?.statusMessage ?? "")
  };
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    try {
      await ensureFamilyLineContactsTable();
      const contacts = await listFamilyLineContacts();
      setJson(response, 200, {
        ok: true,
        accepts: "POST",
        message: "LINE webhook endpoint 已啟用；瀏覽器開啟只會顯示狀態，LINE 訊息需由 LINE Developers 以 POST 傳入。",
        databaseConnected: true,
        savedLineContactCount: contacts.length,
        lineChannelSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
        lineChannelAccessTokenConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setJson(response, 200, {
        ok: false,
        accepts: "POST",
        message: "LINE webhook endpoint 存在，但目前無法連到 LINE 名單資料庫。",
        databaseConnected: false,
        databaseError: message.includes("DATABASE_URL")
          ? "尚未設定 DATABASE_URL/POSTGRES_URL。"
          : "資料庫連線或資料表初始化失敗。",
        lineChannelSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
        lineChannelAccessTokenConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN)
      });
    }
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const rawBody = await readRawBody(request);
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const signature = request.headers["x-line-signature"];
  if (channelSecret && !verifySignature(rawBody, signature, channelSecret)) {
    console.error(
      JSON.stringify({
        event: "line-webhook-signature-failed",
        hasSignature: Boolean(signature),
        rawBodyLength: rawBody.length
      })
    );
    setJson(response, 401, { error: "LINE webhook signature 驗證失敗。" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    setJson(response, 400, { error: "LINE webhook payload 格式錯誤。" });
    return;
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const sourceUserIds = events
    .map((event) => event?.source?.userId)
    .filter((userId) => typeof userId === "string" && userId.length > 0);
  const uniqueSourceUserIds = Array.from(new Set(sourceUserIds));

  let storedCount = 0;
  let storageWarning = "";
  try {
    await ensureFamilyLineContactsTable();
    const profiles = await Promise.all(uniqueSourceUserIds.map((userId) => fetchLineProfile(userId)));
    const storedContacts = await Promise.all(
      profiles.map((profile) =>
        upsertFamilyLineContact({
          ...profile,
          source: "webhook"
        })
      )
    );
    storedCount = storedContacts.filter(Boolean).length;
  } catch (error) {
    storageWarning =
      error instanceof Error && error.message.includes("DATABASE_URL")
        ? "LINE webhook 已收到，但尚未設定 DATABASE_URL/POSTGRES_URL，無法寫入名單。"
        : "LINE webhook 已收到，但寫入 LINE 名單資料庫失敗。";
    console.error(
      JSON.stringify({
        event: "line-webhook-contact-storage-failed",
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }

  console.log(
    JSON.stringify({
      event: "line-webhook-received",
      eventCount: events.length,
      sourceUserIds: uniqueSourceUserIds,
      storedCount
    })
  );

  setJson(response, 200, {
    ok: true,
    eventCount: events.length,
    storedCount,
    warning: storageWarning || undefined
  });
}
