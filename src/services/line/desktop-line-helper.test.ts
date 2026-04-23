import { describe, expect, it, vi } from "vitest";
import {
  isConfiguredLineUrl,
  openExternalContactTarget,
  requestDoctorLineChat
} from "./desktop-line-helper";
import { getDefaultDesktopLineAutomationSettings } from "./desktop-line-settings";

describe("desktop-line-helper", () => {
  it("可辨識已設定的 LINE 連結", () => {
    expect(isConfiguredLineUrl("line://msg/text/hello")).toBe(true);
    expect(isConfiguredLineUrl("https://line.me/R/ti/p/%40demo")).toBe(true);
    expect(isConfiguredLineUrl("")).toBe(false);
    expect(isConfiguredLineUrl("not-a-url")).toBe(false);
  });

  it("可透過 window.open 開啟外部聯絡目標", () => {
    const openFn = vi.fn().mockReturnValue({});

    expect(openExternalContactTarget("tel:0912-000-000", "_self", openFn)).toBe(true);
    expect(openFn).toHaveBeenCalledWith("tel:0912-000-000", "_self", undefined);
  });

  it("helper 停用時會直接回傳 fallback", async () => {
    const result = await requestDoctorLineChat(
      {
        doctorId: "doc-001",
        doctorName: "蕭坤元醫師",
        lineSearchKeyword: "蕭坤元",
        phone: "0912-110-001"
      },
      {
        ...getDefaultDesktopLineAutomationSettings(),
        enabled: false
      },
      vi.fn()
    );

    expect(result.success).toBe(false);
    expect(result.stage).toBe("fallback");
    expect(result.fallbackRecommended).toBe(true);
  });

  it("helper 成功時會回傳結構化結果", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        stage: "open_chat",
        message: "已切換到蕭坤元醫師的 LINE 對話。",
        fallbackRecommended: false
      })
    });

    const result = await requestDoctorLineChat(
      {
        doctorId: "doc-001",
        doctorName: "蕭坤元醫師",
        lineSearchKeyword: "蕭坤元",
        phone: "0912-110-001"
      },
      {
        ...getDefaultDesktopLineAutomationSettings(),
        enabled: true
      },
      fetchImpl as typeof fetch
    );

    expect(result.success).toBe(true);
    expect(result.stage).toBe("open_chat");
    expect(result.fallbackRecommended).toBe(false);
  });
});
