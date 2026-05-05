import { Pool } from "@neondatabase/serverless";

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_db_snapshots (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`;

const DEFAULT_SNAPSHOT_ID = "default";

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

export async function ensureAppDbSnapshotTable() {
  if (ensured) {
    return;
  }
  await query(TABLE_SQL);
  ensured = true;
}

export async function getAppDbSnapshot(snapshotId = DEFAULT_SNAPSHOT_ID) {
  const result = await query(
    `
      SELECT data, updated_at
      FROM app_db_snapshots
      WHERE id = $1;
    `,
    [snapshotId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    db: row.data,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function upsertAppDbSnapshot(db, snapshotId = DEFAULT_SNAPSHOT_ID) {
  const now = new Date().toISOString();
  const result = await query(
    `
      INSERT INTO app_db_snapshots (id, data, updated_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = EXCLUDED.updated_at
      RETURNING data, updated_at;
    `,
    [snapshotId, JSON.stringify(db), now]
  );
  const row = result.rows[0];

  return {
    db: row.data,
    updatedAt: new Date(row.updated_at).toISOString()
  };
}
