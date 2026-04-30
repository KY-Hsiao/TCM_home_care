import { Pool } from "@neondatabase/serverless";

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS doctor_location_logs (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL,
    linked_visit_schedule_id TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`;

const INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS doctor_location_logs_doctor_time_idx ON doctor_location_logs (doctor_id, recorded_at DESC);",
  "CREATE INDEX IF NOT EXISTS doctor_location_logs_time_idx ON doctor_location_logs (recorded_at DESC);"
];

let ensured = false;
let poolInstance = null;

function resolveConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function getPool() {
  if (poolInstance) {
    return poolInstance;
  }

  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL/POSTGRES_URL");
  }

  poolInstance = new Pool({ connectionString });
  return poolInstance;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function ensureDoctorLocationTable() {
  if (ensured) {
    return;
  }
  await query(TABLE_SQL);
  for (const statement of INDEX_SQL) {
    await query(statement);
  }
  ensured = true;
}

export function mapDoctorLocationRow(row) {
  return {
    id: row.id,
    doctor_id: row.doctor_id,
    recorded_at: new Date(row.recorded_at).toISOString(),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: Number(row.accuracy),
    source: row.source,
    linked_visit_schedule_id: row.linked_visit_schedule_id ?? null
  };
}

export function validateRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildTimeRange(date, timeSlot) {
  if (!validateRequiredString(date) || !validateRequiredString(timeSlot)) {
    return null;
  }

  if (timeSlot === "上午") {
    return {
      startAt: `${date}T00:00:00+08:00`,
      endAt: `${date}T12:59:59.999+08:00`
    };
  }

  if (timeSlot === "下午") {
    return {
      startAt: `${date}T12:00:00+08:00`,
      endAt: `${date}T23:59:59.999+08:00`
    };
  }

  return null;
}
