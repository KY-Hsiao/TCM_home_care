import {
  buildTimeRange,
  ensureDoctorLocationTable,
  mapDoctorLocationRow,
  query,
  validateRequiredString
} from "../../_lib/doctor-locations.js";

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

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const { date, time_slot: timeSlot } = request.query;
  if (!validateRequiredString(date) && !validateRequiredString(timeSlot)) {
    const result = await query(
      `
        SELECT *
        FROM doctor_location_logs
        WHERE recorded_at >= NOW() - INTERVAL '31 days'
        ORDER BY recorded_at DESC
        LIMIT 500
      `
    );

    setJson(response, 200, {
      items: result.rows.map(mapDoctorLocationRow)
    });
    return;
  }

  if (!validateRequiredString(date) || !validateRequiredString(timeSlot)) {
    setJson(response, 400, { error: "缺少 date 或 time_slot。" });
    return;
  }

  const timeRange = buildTimeRange(date, timeSlot);
  if (!timeRange) {
    setJson(response, 400, { error: "time_slot 格式不正確。" });
    return;
  }

  const result = await query(
    `
      SELECT *
      FROM doctor_location_logs
      WHERE recorded_at >= $1
        AND recorded_at <= $2
      ORDER BY recorded_at DESC
    `,
    [timeRange.startAt, timeRange.endAt]
  );

  setJson(response, 200, {
    items: result.rows.map(mapDoctorLocationRow)
  });
}
