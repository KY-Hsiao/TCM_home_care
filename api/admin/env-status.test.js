import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./[resource].js";

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

async function callStatus(method = "GET") {
  const response = createResponse();
  await handler({ method, query: { resource: "env-status" } }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

describe("/api/admin/env-status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("回傳必要環境變數是否已設定", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "line-token");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "maps-key");
    vi.stubEnv("GOOGLE_DRIVE_FOLDER_ID", "folder-id");

    const result = await callStatus();

    expect(result.statusCode).toBe(200);
    expect(result.body.variables).toMatchObject({
      LINE_CHANNEL_ACCESS_TOKEN: true,
      LINE_CHANNEL_SECRET: false,
      OPENAI_API_KEY: false,
      GOOGLE_MAPS_API_KEY: true,
      GOOGLE_CALENDAR_ID: false,
      GOOGLE_DRIVE_ACCESS_TOKEN: false,
      GOOGLE_DRIVE_REFRESH_TOKEN: false,
      GOOGLE_DRIVE_CLIENT_ID: false,
      GOOGLE_DRIVE_CLIENT_SECRET: false,
      GOOGLE_DRIVE_FOLDER_ID: true
    });
  });

  it("非 GET 會回傳 405", async () => {
    const result = await callStatus("POST");

    expect(result.statusCode).toBe(405);
    expect(result.headers.Allow).toBe("GET");
  });
});
