import {
  ensureTeamCommunicationTable,
  mapTeamCommunicationRow,
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

  if (request.method === "GET") {
    const { doctorId, adminUserId } = request.query;
    if (!validateRequiredString(doctorId) || !validateRequiredString(adminUserId)) {
      setJson(response, 400, { error: "缺少 doctorId 或 adminUserId。" });
      return;
    }

    const result = await query(
      `
        SELECT *
        FROM team_communications
        WHERE doctor_id = $1
          AND admin_user_id = $2
        ORDER BY contacted_at ASC
      `,
      [doctorId, adminUserId]
    );

    setJson(response, 200, {
      items: result.rows.map(mapTeamCommunicationRow)
    });
    return;
  }

  if (request.method === "POST") {
    const body = request.body ?? {};
    const requiredFields = [
      body.id,
      body.doctorId,
      body.adminUserId,
      body.senderRole,
      body.senderUserId,
      body.receiverRole,
      body.receiverUserId,
      body.channel,
      body.subject,
      body.content,
      body.outcome,
      body.messageType,
      body.contactedAt
    ];
    if (!requiredFields.every(validateRequiredString)) {
      setJson(response, 400, { error: "團隊通訊建立資料不完整。" });
      return;
    }

    const result = await query(
      `
        INSERT INTO team_communications (
          id,
          doctor_id,
          admin_user_id,
          patient_id,
          visit_schedule_id,
          caregiver_id,
          sender_role,
          sender_user_id,
          receiver_role,
          receiver_user_id,
          message_type,
          call_status,
          channel,
          subject,
          content,
          outcome,
          is_read,
          contacted_at,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, FALSE, $16, $16, $16
        )
        RETURNING *
      `,
      [
        body.id,
        body.doctorId,
        body.adminUserId,
        body.patientId ?? null,
        body.visitScheduleId ?? null,
        body.senderRole,
        body.senderUserId,
        body.receiverRole,
        body.receiverUserId,
        body.messageType,
        body.callStatus ?? null,
        body.channel,
        body.subject,
        body.content,
        body.outcome,
        body.contactedAt
      ]
    );

    setJson(response, 201, {
      item: mapTeamCommunicationRow(result.rows[0])
    });
    return;
  }

  response.setHeader("Allow", "GET, POST");
  setJson(response, 405, { error: "Method Not Allowed" });
}
