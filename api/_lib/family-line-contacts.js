import { Pool } from "@neondatabase/serverless";

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS family_line_contacts (
    line_user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    picture_url TEXT,
    status_message TEXT,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'webhook',
    linked_patient_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`;

const INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS family_line_contacts_updated_idx ON family_line_contacts (updated_at DESC);"
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

async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function ensureFamilyLineContactsTable() {
  if (ensured) {
    return;
  }
  await query(TABLE_SQL);
  for (const statement of INDEX_SQL) {
    await query(statement);
  }
  ensured = true;
}

function normalizeLinkedPatientIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

export function mapFamilyLineContactRow(row) {
  return {
    userId: row.line_user_id,
    displayName: row.display_name || row.line_user_id,
    pictureUrl: row.picture_url ?? "",
    statusMessage: row.status_message ?? "",
    note: row.note ?? "",
    source: row.source ?? "webhook",
    linkedPatientIds: normalizeLinkedPatientIds(row.linked_patient_ids),
    firstSeenAt: new Date(row.first_seen_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function upsertFamilyLineContact(contact) {
  const lineUserId = String(contact?.lineUserId ?? contact?.userId ?? "").trim();
  if (!lineUserId) {
    return null;
  }

  const now = new Date().toISOString();
  const displayName = String(contact?.displayName ?? lineUserId).trim() || lineUserId;
  const pictureUrl = String(contact?.pictureUrl ?? "").trim() || null;
  const statusMessage = String(contact?.statusMessage ?? "").trim() || null;
  const source = String(contact?.source ?? "webhook").trim() || "webhook";

  const result = await query(
    `
      INSERT INTO family_line_contacts (
        line_user_id,
        display_name,
        picture_url,
        status_message,
        source,
        first_seen_at,
        last_seen_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6, $6)
      ON CONFLICT (line_user_id) DO UPDATE SET
        display_name = CASE
          WHEN EXCLUDED.display_name <> family_line_contacts.line_user_id
          THEN EXCLUDED.display_name
          ELSE family_line_contacts.display_name
        END,
        picture_url = COALESCE(EXCLUDED.picture_url, family_line_contacts.picture_url),
        status_message = COALESCE(EXCLUDED.status_message, family_line_contacts.status_message),
        source = EXCLUDED.source,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
      RETURNING *;
    `,
    [lineUserId, displayName, pictureUrl, statusMessage, source, now]
  );

  return result.rows[0] ? mapFamilyLineContactRow(result.rows[0]) : null;
}

export async function listFamilyLineContacts() {
  const result = await query(
    `
      SELECT *
      FROM family_line_contacts
      ORDER BY last_seen_at DESC, updated_at DESC;
    `
  );
  return result.rows.map(mapFamilyLineContactRow);
}

export async function updateFamilyLineContact(contact) {
  const lineUserId = String(contact?.lineUserId ?? contact?.userId ?? "").trim();
  if (!lineUserId) {
    throw new Error("Missing lineUserId");
  }

  const linkedPatientIds = normalizeLinkedPatientIds(contact?.linkedPatientIds);
  const note = String(contact?.note ?? "").trim();
  const now = new Date().toISOString();

  const result = await query(
    `
      UPDATE family_line_contacts
      SET linked_patient_ids = $2::jsonb,
          note = $3,
          updated_at = $4
      WHERE line_user_id = $1
      RETURNING *;
    `,
    [lineUserId, JSON.stringify(linkedPatientIds), note, now]
  );

  return result.rows[0] ? mapFamilyLineContactRow(result.rows[0]) : null;
}
