import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./config.js";

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

function callConfig(method = "GET") {
  const response = createResponse();
  handler({ method }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

describe("/api/maps/config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("會從 Vercel env 回傳內嵌 Google Map 導航需要的 browser key", () => {
    vi.stubEnv("GOOGLE_MAPS_BROWSER_API_KEY", "browser-key");
    vi.stubEnv("GOOGLE_MAPS_MAP_ID", "map-id-1");

    const result = callConfig();

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      mapsApiKey: "browser-key",
      mapId: "map-id-1"
    });
  });

  it("未設定 browser key 時可沿用 GOOGLE_MAPS_API_KEY", () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-map-key");

    const result = callConfig();

    expect(result.statusCode).toBe(200);
    expect(result.body.mapsApiKey).toBe("server-map-key");
  });

  it("缺 key 時回傳明確錯誤", () => {
    vi.stubEnv("GOOGLE_MAPS_BROWSER_API_KEY", "");
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");

    const result = callConfig();

    expect(result.statusCode).toBe(503);
    expect(result.body.reason).toBe("API_KEY_MISSING");
  });
});
