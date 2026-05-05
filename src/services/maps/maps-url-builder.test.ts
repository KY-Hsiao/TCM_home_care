import { afterEach, describe, expect, it, vi } from "vitest";
import { createMapsUrlBuilder } from "./maps-url-builder";
import { ADMIN_API_TOKEN_STORAGE_KEY } from "../../shared/utils/admin-api-tokens";

describe("maps url builder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("有自訂定位關鍵字時會優先使用關鍵字做 Google 地圖定位", () => {
    const maps = createMapsUrlBuilder();

    const url = maps.buildNavigationUrl({
      destinationAddress: "高雄市旗山區延平一路 1 號",
      destinationKeyword: "旗山醫院後棟管理室",
      destinationLatitude: 22.88794,
      destinationLongitude: 120.48341
    });

    expect(url).toContain(encodeURIComponent("旗山醫院後棟管理室"));
    expect(url).not.toContain(encodeURIComponent("22.88794,120.48341"));
  });

  it("Android 導航目標會產生 Google Maps app 導航網址", () => {
    const maps = createMapsUrlBuilder();

    const url = maps.buildNavigationUrl({
      destinationAddress: "高雄市旗山區延平一路 1 號",
      destinationKeyword: "旗山醫院後棟管理室",
      destinationLatitude: 22.88794,
      destinationLongitude: 120.48341,
      originLatitude: 22.88,
      originLongitude: 120.48,
      navigationTarget: "android"
    });

    expect(url).toBe(`google.navigation:q=${encodeURIComponent("旗山醫院後棟管理室")}&mode=d`);
    expect(url).not.toContain("origin=");
  });

  it("定位關鍵字為同住址時會回退成住址作為搜尋詞", () => {
    const maps = createMapsUrlBuilder();

    const url = maps.buildPatientMapUrl({
      address: "高雄市旗山區延平一路 1 號",
      locationKeyword: "同住址",
      latitude: 22.88794,
      longitude: 120.48341
    });

    expect(url).toContain(encodeURIComponent("高雄市旗山區延平一路 1 號"));
  });

  it("內嵌地圖會使用可嵌入的 Google Maps embed 網址", () => {
    const maps = createMapsUrlBuilder();

    const url = maps.buildPatientEmbedUrl({
      address: "高雄市旗山區延平一路 1 號",
      locationKeyword: "旗山醫院後棟管理室",
      latitude: 22.88794,
      longitude: 120.48341
    });

    expect(url).toContain("https://maps.google.com/maps?q=");
    expect(url).toContain("output=embed");
    expect(url).toContain(encodeURIComponent("旗山醫院後棟管理室"));
  });

  it("可產生多站路線的 Google Maps directions 網址", () => {
    const maps = createMapsUrlBuilder();

    const url = maps.buildRouteDirectionsUrl({
      origin: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      destination: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      waypoints: [
        {
          address: "高雄市旗山區延平一路 128 號",
          latitude: null,
          longitude: null
        },
        {
          address: "高雄市旗山區中華路 76 號",
          latitude: null,
          longitude: null
        }
      ],
      travelMode: "driving",
      label: "測試路線"
    });

    expect(url).toContain("https://www.google.com/maps/dir/?api=1");
    expect(url).toContain(encodeURIComponent("22.88794,120.48341"));
    expect(url).toContain(encodeURIComponent("高雄市旗山區延平一路 128 號|高雄市旗山區中華路 76 號"));
  });

  it("未設定 embed api key 時，多站路線 embed 網址會回傳 null", () => {
    const maps = createMapsUrlBuilder({ embedApiKey: "" });

    expect(
      maps.buildRouteEmbedDirectionsUrl({
        origin: {
          address: "旗山醫院",
          latitude: 22.88794,
          longitude: 120.48341
        },
        destination: {
          address: "旗山醫院",
          latitude: 22.88794,
          longitude: 120.48341
        },
        waypoints: [],
        travelMode: "driving",
        label: "測試路線"
      })
    ).toBeNull();
  });

  it("未設定 embed api key 時，路線預覽不再使用不穩定的 directions iframe", () => {
    const maps = createMapsUrlBuilder({ embedApiKey: "" });

    const state = maps.getRoutePreviewState({
      origin: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      destination: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      waypoints: [
        {
          address: "高雄市旗山區延平一路 128 號",
          latitude: null,
          longitude: null
        }
      ],
      travelMode: "driving",
      label: "測試路線"
    });

    expect(state.embedUrl).toBeNull();
    expect(state.externalUrl).toContain("https://www.google.com/maps/dir/?api=1");
    expect(state.fallbackReason).toBeNull();
  });

  it("設定 embed api key 時，可產生 directions iframe 網址", () => {
    const maps = createMapsUrlBuilder({ embedApiKey: "demo-key" });

    const url = maps.buildRouteEmbedDirectionsUrl({
      origin: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      destination: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      waypoints: [
        {
          address: "高雄市旗山區延平一路 128 號",
          latitude: null,
          longitude: null
        }
      ],
      travelMode: "driving",
      label: "測試路線"
    });

    expect(url).toContain("https://www.google.com/maps/embed/v1/directions");
    expect(url).toContain("key=demo-key");
    expect(url).toContain("mode=driving");
  });

  it("一般 Google Maps API key 也可作為 embed key 使用", () => {
    const maps = createMapsUrlBuilder({ embedApiKey: "general-map-key" });

    const url = maps.buildNavigationEmbedUrl({
      destinationAddress: "高雄市旗山區延平一路 128 號",
      destinationLatitude: 22.886,
      destinationLongitude: 120.482,
      originLatitude: 22.88794,
      originLongitude: 120.48341
    });

    expect(url).toContain("https://www.google.com/maps/embed/v1/directions");
    expect(url).toContain("key=general-map-key");
    expect(url).toContain(encodeURIComponent("22.88794,120.48341"));
  });

  it("waypoint 超過上限時會回傳 fallback 狀態", () => {
    const maps = createMapsUrlBuilder({ embedApiKey: "demo-key" });

    const state = maps.getRoutePreviewState({
      origin: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      destination: {
        address: "旗山醫院",
        latitude: 22.88794,
        longitude: 120.48341
      },
      waypoints: Array.from({ length: 10 }, (_, index) => ({
        address: `高雄市旗山區測試路 ${index + 1} 號`,
        latitude: null,
        longitude: null
      })),
      travelMode: "driving",
      label: "測試路線"
    });

    expect(state.embedUrl).toBeNull();
    expect(state.externalUrl).toBeNull();
    expect(state.fallbackReason).toContain("超過目前 Google 路線預覽上限");
  });

  it("可透過後端 geocoding API 取得地址座標", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latitude: 22.88612,
        longitude: 120.48234,
        formattedAddress: "高雄市旗山區延平一路123號"
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    const maps = createMapsUrlBuilder();

    const result = await maps.geocodeAddress({ address: "高雄市旗山區延平一路 123 號" });

    expect(result).toEqual({
      latitude: 22.88612,
      longitude: 120.48234,
      formattedAddress: "高雄市旗山區延平一路123號"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/geocode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          address: "高雄市旗山區延平一路 123 號",
          googleMapsApiKey: ""
        })
      })
    );
  });

  it("補座標時會帶入行政端輸入的 Google Maps API key", async () => {
    window.localStorage.setItem(
      ADMIN_API_TOKEN_STORAGE_KEY,
      JSON.stringify({ googleMapsApiKey: "browser-google-key" })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latitude: 22.88612,
        longitude: 120.48234,
        formattedAddress: "高雄市旗山區延平一路123號"
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    const maps = createMapsUrlBuilder();

    await maps.geocodeAddress({ address: "高雄市旗山區延平一路 123 號" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/geocode",
      expect.objectContaining({
        body: JSON.stringify({
          address: "高雄市旗山區延平一路 123 號",
          googleMapsApiKey: "browser-google-key"
        })
      })
    );
  });

  it("後端 geocoding API 失敗時會保留可讀錯誤原因", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        reason: "REQUEST_DENIED",
        error: "Google Geocoding API 回傳 REQUEST_DENIED：API key 未啟用 Geocoding API"
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    const maps = createMapsUrlBuilder();

    await expect(maps.geocodeAddress({ address: "高雄市旗山區延平一路 123 號" })).resolves.toBeNull();
    expect(maps.getLastGeocodeError()).toBe("Google Geocoding API 回傳 REQUEST_DENIED：API key 未啟用 Geocoding API");
  });

  it("地址空白時不會送出 geocoding request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const maps = createMapsUrlBuilder();

    await expect(maps.geocodeAddress({ address: " " })).resolves.toBeNull();
    expect(maps.getLastGeocodeError()).toBe("缺少地址，無法補座標。");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
