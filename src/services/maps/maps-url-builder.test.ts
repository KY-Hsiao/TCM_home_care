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
});
