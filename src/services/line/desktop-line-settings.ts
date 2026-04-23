import type { DesktopLineAutomationSettings } from "../types";

export const DESKTOP_LINE_SETTINGS_STORAGE_KEY = "tcm-home-care-desktop-line-settings";

const defaultDesktopLineAutomationSettings: DesktopLineAutomationSettings = {
  enabled: false,
  helper_base_url: "http://127.0.0.1:8765",
  launch_line_if_needed: true,
  line_window_hint: "LINE"
};

export function getDefaultDesktopLineAutomationSettings(): DesktopLineAutomationSettings {
  return { ...defaultDesktopLineAutomationSettings };
}

export function normalizeDesktopLineAutomationSettings(
  input?: Partial<DesktopLineAutomationSettings> | null
): DesktopLineAutomationSettings {
  return {
    enabled: Boolean(input?.enabled),
    helper_base_url:
      input?.helper_base_url?.trim().replace(/\/+$/, "") ||
      defaultDesktopLineAutomationSettings.helper_base_url,
    launch_line_if_needed:
      input?.launch_line_if_needed ?? defaultDesktopLineAutomationSettings.launch_line_if_needed,
    line_window_hint:
      input?.line_window_hint?.trim() || defaultDesktopLineAutomationSettings.line_window_hint
  };
}

export function loadDesktopLineAutomationSettings(): DesktopLineAutomationSettings {
  if (typeof window === "undefined") {
    return getDefaultDesktopLineAutomationSettings();
  }

  const raw = window.localStorage.getItem(DESKTOP_LINE_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return getDefaultDesktopLineAutomationSettings();
  }

  try {
    return normalizeDesktopLineAutomationSettings(JSON.parse(raw));
  } catch (error) {
    console.error("讀取桌面 LINE 自動化設定失敗，已改用預設值。", error);
    return getDefaultDesktopLineAutomationSettings();
  }
}

export function persistDesktopLineAutomationSettings(
  settings: DesktopLineAutomationSettings
): DesktopLineAutomationSettings {
  const normalized = normalizeDesktopLineAutomationSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      DESKTOP_LINE_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  }
  return normalized;
}
