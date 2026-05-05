import { afterEach, describe, expect, it, vi } from "vitest";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function importHandlerWithQuery(queryMock) {
  vi.resetModules();
  vi.doMock("@neondatabase/serverless", () => ({
    Pool: vi.fn(() => ({
      query: queryMock
    }))
  }));
  return (await import("./index.js")).default;
}

async function callAppDb(handler, method, body) {
  const response = createResponse();
  await handler({ method, body }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

function createMinimalDb() {
  return {
    patients: [],
    caregivers: [],
    caregiver_chat_bindings: [],
    doctors: [],
    admin_users: [],
    visit_schedules: [],
    saved_route_plans: [],
    visit_records: [],
    contact_logs: [],
    notification_templates: [],
    notification_tasks: [],
    leave_requests: [],
    reschedule_actions: [],
    reminders: [],
    notification_center_items: [],
    doctor_location_logs: []
  };
}

describe("/api/app-db", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@neondatabase/serverless");
    vi.unstubAllEnvs();
  });

  it("GET 會回傳伺服器資料快照", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const db = createMinimalDb();
    const queryMock = vi.fn(async (sql) => {
      if (String(sql).includes("SELECT data")) {
        return {
          rows: [
            {
              data: db,
              updated_at: "2026-05-05T08:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    });
    const handler = await importHandlerWithQuery(queryMock);

    const result = await callAppDb(handler, "GET");

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      db,
      updatedAt: "2026-05-05T08:00:00.000Z"
    });
  });

  it("PUT 會寫入資料快照", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const db = createMinimalDb();
    const queryMock = vi.fn(async (sql) => {
      if (String(sql).includes("INSERT INTO app_db_snapshots")) {
        return {
          rows: [
            {
              data: db,
              updated_at: "2026-05-05T08:10:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    });
    const handler = await importHandlerWithQuery(queryMock);

    const result = await callAppDb(handler, "PUT", { db });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      db,
      updatedAt: "2026-05-05T08:10:00.000Z"
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO app_db_snapshots"),
      expect.arrayContaining(["default", JSON.stringify(db)])
    );
  });

  it("PUT 遇到格式錯誤會拒絕寫入", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const queryMock = vi.fn(async () => ({ rows: [] }));
    const handler = await importHandlerWithQuery(queryMock);

    const result = await callAppDb(handler, "PUT", { db: { patients: [] } });

    expect(result.statusCode).toBe(400);
    expect(result.body.reason).toBe("INVALID_APP_DB");
    expect(result.body.error).toContain("caregivers");
  });

  it("未設定資料庫時回傳明確原因", async () => {
    const handler = await importHandlerWithQuery(vi.fn());

    const result = await callAppDb(handler, "GET");

    expect(result.statusCode).toBe(503);
    expect(result.body.reason).toBe("DATABASE_NOT_CONFIGURED");
    expect(result.body.error).toContain("DATABASE_URL");
  });
});
