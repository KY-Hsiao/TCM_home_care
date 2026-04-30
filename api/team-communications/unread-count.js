import {
  ensureTeamCommunicationTable,
  query,
  validateRequiredString
} from "../_lib/team-communications.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

export default async function handler(request, response) {
  try {
    await ensureTeamCommunicationTable();
  } catch {
    setJson(response, 503, {
      error: "團隊通訊資料庫尚未完成設定，請先配置 Neon / Vercel Postgres 整合。"
    });
    return;
  }

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
    `,
    [role, userId, doctorId ?? null, adminUserId ?? null, readAfterValue]
  );

  setJson(response, 200, {
    count: result.rows[0]?.count ?? 0
  });
}
