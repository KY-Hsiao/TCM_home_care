import crypto from "node:crypto";

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

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const rawBody = await readRawBody(request);
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const signature = request.headers["x-line-signature"];
  if (channelSecret && !verifySignature(rawBody, signature, channelSecret)) {
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

  console.log(
    JSON.stringify({
      event: "line-webhook-received",
      eventCount: events.length,
      sourceUserIds
    })
  );

  setJson(response, 200, {
    ok: true,
    eventCount: events.length
  });
}
