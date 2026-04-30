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
    `,
    [now, doctorId, adminUserId, viewerRole, viewerUserId]
  );

  setJson(response, 200, {
    ok: true,
    updatedCount: result.rowCount ?? 0
  });
}
