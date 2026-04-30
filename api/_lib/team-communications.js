import { Pool } from "@neondatabase/serverless";

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS team_communications (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL,
    admin_user_id TEXT NOT NULL,
    patient_id TEXT,
    visit_schedule_id TEXT,
    caregiver_id TEXT,
    sender_role TEXT NOT NULL,
    sender_user_id TEXT NOT NULL,
    receiver_role TEXT NOT NULL,
    receiver_user_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    call_status TEXT,
    channel TEXT NOT NULL,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    outcome TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    contacted_at TIMESTAMPTZ NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`;

const INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS team_communications_conversation_idx ON team_communications (doctor_id, admin_user_id, contacted_at DESC);",
  "CREATE INDEX IF NOT EXISTS team_communications_unread_idx ON team_communications (receiver_role, receiver_user_id, is_read, contacted_at DESC);"
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

  poolInstance = new Pool({
    connectionString
  });
  return poolInstance;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function ensureTeamCommunicationTable() {
  if (ensured) {
    return;
  }
  await query(TABLE_SQL);
  for (const statement of INDEX_SQL) {
    await query(statement);
  }
  ensured = true;
}

export function mapTeamCommunicationRow(row) {
  return {
    id: row.id,
    patient_id: row.patient_id,
    visit_schedule_id: row.visit_schedule_id,
    caregiver_id: row.caregiver_id,
    doctor_id: row.doctor_id,
    admin_user_id: row.admin_user_id,
    channel: row.channel,
    subject: row.subject,
    content: row.content,
    outcome: row.outcome,
    contacted_at: new Date(row.contacted_at).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    sender_role: row.sender_role,
    sender_user_id: row.sender_user_id,
    receiver_role: row.receiver_role,
    receiver_user_id: row.receiver_user_id,
    message_type: row.message_type,
    call_status: row.call_status,
    is_read: Boolean(row.is_read),
    read_at: row.read_at ? new Date(row.read_at).toISOString() : null
  };
}

export function validateRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
