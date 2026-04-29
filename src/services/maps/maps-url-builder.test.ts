import { describe, expect, it } from "vitest";
import { createMapsUrlBuilder } from "./maps-url-builder";

describe("maps url builder", () => {
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
});
