function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasRefreshTokenConfig(env = process.env) {
  return (
    isRequiredString(env.GOOGLE_DRIVE_REFRESH_TOKEN) &&
    isRequiredString(env.GOOGLE_DRIVE_CLIENT_ID) &&
    isRequiredString(env.GOOGLE_DRIVE_CLIENT_SECRET)
  );
}

export async function resolveGoogleDriveAccessToken(env = process.env) {
  const staticAccessToken = String(env.GOOGLE_DRIVE_ACCESS_TOKEN ?? "").trim();
  if (hasRefreshTokenConfig(env)) {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: String(env.GOOGLE_DRIVE_CLIENT_ID ?? "").trim(),
        client_secret: String(env.GOOGLE_DRIVE_CLIENT_SECRET ?? "").trim(),
        refresh_token: String(env.GOOGLE_DRIVE_REFRESH_TOKEN ?? "").trim(),
        grant_type: "refresh_token"
      })
    });
    const payload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !isRequiredString(payload.access_token)) {
      return {
        ok: false,
        statusCode: 503,
        reason: payload.error ?? `HTTP_${tokenResponse.status}`,
        error:
          payload.error_description ??
          "Google Drive refresh token 換取 access token 失敗，請重新確認 Vercel 環境變數。"
      };
    }

    return {
      ok: true,
      accessToken: payload.access_token
    };
  }

  if (isRequiredString(staticAccessToken)) {
    return {
      ok: true,
      accessToken: staticAccessToken
    };
  }

  return {
    ok: false,
    statusCode: 503,
    reason: "GOOGLE_DRIVE_AUTH_ENV_MISSING",
    error:
      "尚未設定 Google Drive 授權。請在 Vercel 設定 GOOGLE_DRIVE_REFRESH_TOKEN、GOOGLE_DRIVE_CLIENT_ID、GOOGLE_DRIVE_CLIENT_SECRET，或暫時設定 GOOGLE_DRIVE_ACCESS_TOKEN。"
  };
}

export function formatGoogleDriveApiError(payload, fallbackMessage, status) {
  const reason = payload?.error?.status ?? payload?.error ?? `HTTP_${status}`;
  const rawMessage = payload?.error?.message ?? payload?.error_description ?? "";
  const isAuthError =
    status === 401 ||
    reason === "UNAUTHENTICATED" ||
    /invalid authentication credentials/i.test(rawMessage);

  if (isAuthError) {
    return {
      reason: "GOOGLE_DRIVE_AUTH_INVALID",
      error:
        "Google Drive 授權已失效。請改用 refresh token 設定，或更新 Vercel 的 GOOGLE_DRIVE_ACCESS_TOKEN 後重新部署。"
    };
  }

  return {
    reason,
    error: rawMessage || fallbackMessage
  };
}
