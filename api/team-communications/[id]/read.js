import {
  ensureTeamCommunicationTable,
  query,
  validateRequiredString
} from "../../_lib/team-communications.js";

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

  const { id } = request.query;
  const { viewerRole, viewerUserId } = request.body ?? {};
  if (!validateRequiredString(id) || !validateRequiredString(viewerRole) || !validateRequiredString(viewerUserId)) {
    setJson(response, 400, { error: "缺少已讀標記必要資料。" });
    return;
  }

  const now = new Date().toISOString();
  await query(
    `
      UPDATE team_communications
      SET is_read = TRUE,
          read_at = $1,
          updated_at = $1
      WHERE id = $2
        AND receiver_role = $3
        AND receiver_user_id = $4
    `,
    [now, id, viewerRole, viewerUserId]
  );

  setJson(response, 200, { ok: true });
}
