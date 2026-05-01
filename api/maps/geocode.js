function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveGoogleMapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";
}

function normalizeGoogleFailure(status, errorMessage) {
  const reason = isRequiredString(status) ? status : "UNKNOWN_ERROR";
  const detail = isRequiredString(errorMessage) ? `：${errorMessage.trim()}` : "";
  return {
    reason,
    message: `Google Geocoding API 回傳 ${reason}${detail}`
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const apiKey = resolveGoogleMapsApiKey();
  if (!isRequiredString(apiKey)) {
    setJson(response, 503, {
      reason: "API_KEY_MISSING",
      error: "尚未設定 GOOGLE_MAPS_API_KEY 或 VITE_GOOGLE_MAPS_API_KEY，無法補座標。"
    });
    return;
  }

  const address = String(request.body?.address ?? "").trim();
  if (!isRequiredString(address)) {
    setJson(response, 400, {
      reason: "ADDRESS_MISSING",
      error: "缺少地址，無法補座標。"
    });
    return;
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("language", "zh-TW");
    url.searchParams.set("region", "tw");

    const googleResponse = await fetch(url.toString());
    if (!googleResponse.ok) {
      setJson(response, 502, {
        reason: `HTTP_${googleResponse.status}`,
        error: `Google Geocoding API HTTP ${googleResponse.status}，請確認金鑰、Billing 與 API 權限。`
      });
      return;
    }

    const payload = await googleResponse.json();
    const firstResult = payload.status === "OK" ? payload.results?.[0] : null;
    const location = firstResult?.geometry?.location;

    if (
      typeof location?.lat !== "number" ||
      typeof location.lng !== "number" ||
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng)
    ) {
      const failure = normalizeGoogleFailure(payload.status, payload.error_message);
      setJson(response, 422, {
        reason: failure.reason,
        error: failure.message
      });
      return;
    }

    setJson(response, 200, {
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: firstResult?.formatted_address ?? address
    });
  } catch (error) {
    setJson(response, 502, {
      reason: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : "呼叫 Google Geocoding API 失敗。"
    });
  }
}
