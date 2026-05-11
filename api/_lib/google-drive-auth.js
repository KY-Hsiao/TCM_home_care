import { createSign } from "node:crypto";

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasServiceAccountConfig(env = process.env) {
  return (
    isRequiredString(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL) &&
    isRequiredString(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY)
  );
}

export function hasRefreshTokenConfig(env = process.env) {
  return (
    isRequiredString(env.GOOGLE_DRIVE_REFRESH_TOKEN) &&
    isRequiredString(env.GOOGLE_DRIVE_CLIENT_ID) &&
    isRequiredString(env.GOOGLE_DRIVE_CLIENT_SECRET)
  );
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizePrivateKey(value) {
  return String(value ?? "").trim().replace(/\\n/g, "\n");
}

function createServiceAccountJwt(env = process.env) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const payload = {
    iss: String(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL ?? "").trim(),
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY));
  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function resolveServiceAccountAccessToken(env = process.env) {
  let assertion;
  try {
    assertion = createServiceAccountJwt(env);
  } catch (error) {
    return {
      ok: false,
      statusCode: 503,
      reason: "GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY_INVALID",
      error:
        error instanceof Error
          ? `Google Drive Service Account private key 無法使用：${error.message}`
          : "Google Drive Service Account private key 無法使用。"
    };
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
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
        "Google Drive Service Account 換取 access token 失敗，請確認 service account 是否啟用且 private key 是否正確。"
    };
  }

  return {
    ok: true,
    accessToken: payload.access_token
  };
}

export async function resolveGoogleDriveAccessToken(env = process.env) {
  const staticAccessToken = String(env.GOOGLE_DRIVE_ACCESS_TOKEN ?? "").trim();
  if (hasServiceAccountConfig(env)) {
    return resolveServiceAccountAccessToken(env);
  }

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
      "尚未設定 Google Drive 授權。請在 Vercel 設定 Service Account Client Email 與 Private Key，或設定 GOOGLE_DRIVE_REFRESH_TOKEN、GOOGLE_DRIVE_CLIENT_ID、GOOGLE_DRIVE_CLIENT_SECRET；GOOGLE_DRIVE_ACCESS_TOKEN 只建議作為短效備援。"
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
        "Google Drive 授權已失效。請改用 Service Account 或 refresh token 設定，或更新 Vercel 的 GOOGLE_DRIVE_ACCESS_TOKEN 後重新部署。"
    };
  }

  return {
    reason,
    error: rawMessage || fallbackMessage
  };
}
