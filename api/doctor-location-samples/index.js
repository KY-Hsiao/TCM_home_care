import {
  ensureDoctorLocationTable,
  mapDoctorLocationRow,
  query,
  validateFiniteNumber,
  validateRequiredString
} from "../_lib/doctor-locations.js";

function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

export default async function handler(request, response) {
  try {
    await ensureDoctorLocationTable();
  } catch {
    setJson(response, 503, {
      error: "醫師定位資料庫尚未完成設定，請先配置 Neon / Vercel Postgres 整合。"
    });
    return;
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const body = request.body ?? {};
  if (
    !validateRequiredString(body.doctor_id) ||
    !validateRequiredString(body.recorded_at) ||
    !validateFiniteNumber(body.latitude) ||
    !validateFiniteNumber(body.longitude) ||
    !validateFiniteNumber(body.accuracy) ||
    !validateRequiredString(body.source)
  ) {
    setJson(response, 400, { error: "醫師定位上傳資料不完整。" });
    return;
  }

  const now = new Date().toISOString();
  const id = `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await query(
    `
      INSERT INTO doctor_location_logs (
        id,
        doctor_id,
        recorded_at,
        latitude,
        longitude,
        accuracy,
        source,
        linked_visit_schedule_id,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
      RETURNING *
    `,
    [
      id,
      body.doctor_id,
      body.recorded_at,
      body.latitude,
      body.longitude,
      body.accuracy,
      body.source,
      body.linked_visit_schedule_id ?? null,
      now
    ]
  );

  setJson(response, 201, { item: mapDoctorLocationRow(result.rows[0]) });
}
