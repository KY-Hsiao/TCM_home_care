import type {
  DesktopLineAutomationSettings,
  OpenDoctorLineChatRequest,
  OpenDoctorLineChatResult
} from "../types";

type WindowOpenFn = (
  url?: string | URL,
  target?: string,
  features?: string
) => Window | null;

function buildFallbackResult(message: string): OpenDoctorLineChatResult {
  return {
    success: false,
    stage: "fallback",
    message,
    fallbackRecommended: true
  };
}

export function isConfiguredLineUrl(url: string): boolean {
  const normalized = url.trim();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("line:")) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function openExternalContactTarget(
  url: string,
  target: "_self" | "_blank" = "_self",
  openFn: WindowOpenFn = window.open.bind(window)
): boolean {
  const normalized = url.trim();
  if (!normalized) {
    return false;
  }

  const features = target === "_blank" ? "noopener,noreferrer" : undefined;
  return openFn(normalized, target, features) !== null;
}

export async function requestDoctorLineChat(
  request: OpenDoctorLineChatRequest,
  settings: DesktopLineAutomationSettings,
  fetchImpl: typeof fetch = fetch
): Promise<OpenDoctorLineChatResult> {
  if (!request.lineSearchKeyword.trim()) {
    return buildFallbackResult("此醫師尚未設定 LINE 搜尋關鍵字。");
  }

  if (!settings.enabled) {
    return buildFallbackResult("桌面 LINE 自動化目前未啟用。");
  }

  const helperBaseUrl = settings.helper_base_url.trim().replace(/\/+$/, "");
  if (!helperBaseUrl) {
    return buildFallbackResult("尚未設定桌面 LINE helper 位址。");
  }

  try {
    const response = await fetchImpl(`${helperBaseUrl}/line/open-chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        doctorId: request.doctorId,
        doctorName: request.doctorName,
        lineSearchKeyword: request.lineSearchKeyword.trim(),
        phone: request.phone,
        launchLineIfNeeded: settings.launch_line_if_needed,
        lineWindowHint: settings.line_window_hint
      })
    });

    if (!response.ok) {
      return buildFallbackResult(`桌面 LINE helper 回應失敗（HTTP ${response.status}）。`);
    }

    const payload = (await response.json()) as Partial<OpenDoctorLineChatResult>;
    return {
      success: Boolean(payload.success),
      stage: payload.stage ?? "helper_request",
      message: payload.message ?? "已送出 LINE 對話切換要求。",
      fallbackRecommended:
        payload.fallbackRecommended ?? !Boolean(payload.success)
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `無法連線到桌面 LINE helper：${error.message}`
        : "無法連線到桌面 LINE helper。";
    return buildFallbackResult(message);
  }
}
