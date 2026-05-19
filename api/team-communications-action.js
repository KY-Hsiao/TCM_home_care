import {
  ensureTeamCommunicationTable,
  purgeExpiredTeamCommunications,
  query,
  TEAM_COMMUNICATION_RETENTION_SQL,
  validateRequiredString
} from "./_lib/team-communications.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function resolveQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function ensureTableOrFail(response) {
  try {
    await ensureTeamCommunicationTable();
    return true;
  } catch {
    setJson(response, 503, {
      error: "團隊通訊資料庫尚未完成設定，請先配置 Neon / Vercel Postgres 整合。"
    });
    return false;
  }
}

async function markConversationRead(request, response) {
  if (request.method !== "PATCH") {
    response.setHeader("Allow", "PATCH");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const { doctorId, adminUserId, viewerRole, viewerUserId } = request.body ?? {};
  if (
    !validateRequiredString(doctorId) ||
    !validateRequiredString(adminUserId) ||
    !validateRequiredString(viewerRole) ||
    !validateRequiredString(viewerUserId)
  ) {
    setJson(response, 400, { error: "缺少對話已讀標記必要資料。" });
    return;
  }

  const now = new Date().toISOString();
  await purgeExpiredTeamCommunications();
  const result = await query(
    `
      UPDATE team_communications
      SET is_read = TRUE,
          read_at = COALESCE(read_at, $1),
          updated_at = $1
      WHERE doctor_id = $2
        AND admin_user_id = $3
        AND receiver_role = $4
        AND receiver_user_id = $5
        AND is_read = FALSE
        AND contacted_at >= ${TEAM_COMMUNICATION_RETENTION_SQL}
    `,
    [now, doctorId, adminUserId, viewerRole, viewerUserId]
  );

  setJson(response, 200, {
    ok: true,
    updatedCount: result.rowCount ?? 0
  });
}

async function getUnreadCount(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const { role, userId, doctorId, adminUserId, readAfter } = request.query;
  if (!validateRequiredString(role) || !validateRequiredString(userId)) {
    setJson(response, 400, { error: "缺少 role 或 userId。" });
    return;
  }
  const readAfterValue = validateRequiredString(readAfter) ? readAfter : null;
  await purgeExpiredTeamCommunications();

  const result = await query(
    `
      SELECT COUNT(*)::int AS count
      FROM team_communications
      WHERE receiver_role = $1
        AND receiver_user_id = $2
        AND is_read = FALSE
        AND ($3::text IS NULL OR doctor_id = $3)
        AND ($4::text IS NULL OR admin_user_id = $4)
        AND ($5::timestamptz IS NULL OR contacted_at > $5)
        AND contacted_at >= ${TEAM_COMMUNICATION_RETENTION_SQL}
    `,
    [role, userId, doctorId ?? null, adminUserId ?? null, readAfterValue]
  );

  setJson(response, 200, {
    count: result.rows[0]?.count ?? 0
  });
}

async function markMessageRead(request, response) {
  if (request.method !== "PATCH") {
    response.setHeader("Allow", "PATCH");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const id = String(resolveQueryValue(request.query?.id) ?? "").trim();
  const { viewerRole, viewerUserId } = request.body ?? {};
  if (!validateRequiredString(id) || !validateRequiredString(viewerRole) || !validateRequiredString(viewerUserId)) {
    setJson(response, 400, { error: "缺少已讀標記必要資料。" });
    return;
  }

  const now = new Date().toISOString();
  await purgeExpiredTeamCommunications();
  await query(
    `
      UPDATE team_communications
      SET is_read = TRUE,
          read_at = $1,
          updated_at = $1
      WHERE id = $2
        AND receiver_role = $3
        AND receiver_user_id = $4
        AND contacted_at >= ${TEAM_COMMUNICATION_RETENTION_SQL}
    `,
    [now, id, viewerRole, viewerUserId]
  );

  setJson(response, 200, { ok: true });
}

export default async function handler(request, response) {
  const action = String(resolveQueryValue(request.query?.action) ?? "").trim();
  const tableReady = await ensureTableOrFail(response);
  if (!tableReady) {
    return;
  }

  if (action === "read") {
    await markConversationRead(request, response);
    return;
  }
  if (action === "unread-count") {
    await getUnreadCount(request, response);
    return;
  }
  if (action === "message-read") {
    await markMessageRead(request, response);
    return;
  }

  setJson(response, 404, {
    error: "找不到指定的團隊通訊 API。"
  });
}
