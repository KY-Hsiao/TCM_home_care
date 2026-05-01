import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./geocode.js";

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

async function callGeocode(body) {
  const response = createResponse();
  await handler({ method: "POST", body }, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body)
  };
}

describe("/api/maps/geocode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("Google 回 OK 時正確回傳座標", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "demo-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [
          {
            formatted_address: "高雄市旗山區延平一路123號",
            geometry: {
              location: {
                lat: 22.88612,
                lng: 120.48234
              }
            }
          }
        ]
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callGeocode({ address: "高雄市旗山區延平一路 123 號" });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      latitude: 22.88612,
      longitude: 120.48234,
      formattedAddress: "高雄市旗山區延平一路123號"
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("https://maps.googleapis.com/maps/api/geocode/json"));
  });

  it("Google 回 ZERO_RESULTS 時回傳明確失敗原因", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "demo-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ZERO_RESULTS",
          results: []
        })
      })
    );

    const result = await callGeocode({ address: "找不到的地址" });

    expect(result.statusCode).toBe(422);
    expect(result.body.reason).toBe("ZERO_RESULTS");
    expect(result.body.error).toContain("Google Geocoding API 回傳 ZERO_RESULTS");
  });

  it("Google 回 REQUEST_DENIED 時回傳明確失敗原因", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "demo-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "REQUEST_DENIED",
          error_message: "This API project is not authorized."
        })
      })
    );

    const result = await callGeocode({ address: "高雄市旗山區延平一路 123 號" });

    expect(result.statusCode).toBe(422);
    expect(result.body.reason).toBe("REQUEST_DENIED");
    expect(result.body.error).toContain("This API project is not authorized.");
  });
});
