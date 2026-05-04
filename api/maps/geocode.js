function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function isRequiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveGoogleMapsApiKey(requestBody) {
  return (
    String(requestBody?.googleMapsApiKey ?? "").trim() ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ""
  );
}

function normalizeGoogleFailure(status, errorMessage, address) {
  const reason = isRequiredString(status) ? status : "UNKNOWN_ERROR";
  const detail = isRequiredString(errorMessage)
    ? `：${errorMessage.trim()}`
    : reason === "ZERO_RESULTS" && isRequiredString(address)
      ? `：找不到「${address.trim()}」的座標，請確認地址是否完整，或改用更精確的門牌、地標。`
      : "";
  return {
    reason,
    message: `Google Geocoding API 回傳 ${reason}${detail}`
  };
}

function appendUniqueCandidate(candidates, value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (isRequiredString(normalized) && !candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

function stripAddressNoise(address) {
  return address
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(?:,|，|、).+$/g, "")
    .replace(/\s*(?:\d+\s*[樓Ff]|[一二三四五六七八九十]+樓).*$/g, "")
    .trim();
}

function truncateAfterHouseNumber(address) {
  const match = address.match(/^(.+?號)/);
  return match?.[1]?.trim() ?? "";
}

function buildAddressCandidates(address) {
  const candidates = [];
  const trimmedAddress = address.trim();
  const noWhitespaceAddress = trimmedAddress.replace(/\s+/g, "");
  const strippedAddress = stripAddressNoise(trimmedAddress);
  const strippedNoWhitespaceAddress = stripAddressNoise(noWhitespaceAddress);
  const houseNumberAddress =
    truncateAfterHouseNumber(strippedAddress) ||
    truncateAfterHouseNumber(strippedNoWhitespaceAddress);

  [
    trimmedAddress,
    noWhitespaceAddress,
    strippedAddress,
    strippedNoWhitespaceAddress,
    houseNumberAddress,
    `${trimmedAddress} 台灣`,
    `${noWhitespaceAddress} 台灣`,
    strippedAddress ? `${strippedAddress} 台灣` : "",
    strippedNoWhitespaceAddress ? `${strippedNoWhitespaceAddress} 台灣` : "",
    houseNumberAddress ? `${houseNumberAddress} 台灣` : ""
  ].forEach((candidate) => appendUniqueCandidate(candidates, candidate));

  return candidates;
}

async function fetchGoogleGeocode({ address, apiKey }) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("region", "tw");
  url.searchParams.set("components", "country:TW");

  const googleResponse = await fetch(url.toString());
  if (!googleResponse.ok) {
    return {
      ok: false,
      httpStatus: googleResponse.status,
      payload: null
    };
  }

  return {
    ok: true,
    httpStatus: googleResponse.status,
    payload: await googleResponse.json()
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const address = String(request.body?.address ?? "").trim();
  const apiKey = resolveGoogleMapsApiKey(request.body);
  if (!isRequiredString(apiKey)) {
    setJson(response, 503, {
      reason: "API_KEY_MISSING",
      error: "尚未設定 GOOGLE_MAPS_API_KEY 或 VITE_GOOGLE_MAPS_API_KEY，無法補座標。"
    });
    return;
  }

  if (!isRequiredString(address)) {
    setJson(response, 400, {
      reason: "ADDRESS_MISSING",
      error: "缺少地址，無法補座標。"
    });
    return;
  }

  try {
    let lastFailure = null;

    for (const candidateAddress of buildAddressCandidates(address)) {
      const { ok, httpStatus, payload } = await fetchGoogleGeocode({
        address: candidateAddress,
        apiKey
      });
      if (!ok) {
        setJson(response, 502, {
          reason: `HTTP_${httpStatus}`,
          error: `Google Geocoding API HTTP ${httpStatus}，請確認金鑰、Billing 與 API 權限。`
        });
        return;
      }

      const firstResult = payload.status === "OK" ? payload.results?.[0] : null;
      const location = firstResult?.geometry?.location;
      if (
        typeof location?.lat === "number" &&
        typeof location.lng === "number" &&
        Number.isFinite(location.lat) &&
        Number.isFinite(location.lng)
      ) {
        setJson(response, 200, {
          latitude: location.lat,
          longitude: location.lng,
          formattedAddress: firstResult?.formatted_address ?? candidateAddress,
          matchedQuery: candidateAddress
        });
        return;
      }

      lastFailure = normalizeGoogleFailure(payload.status, payload.error_message, candidateAddress);
      if (payload.status && payload.status !== "ZERO_RESULTS") {
        break;
      }
    }

    {
      const failure = lastFailure ?? normalizeGoogleFailure("UNKNOWN_ERROR", "", address);
      setJson(response, 422, {
        reason: failure.reason,
        error: failure.message
      });
      return;
    }
  } catch (error) {
    setJson(response, 502, {
      reason: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : "呼叫 Google Geocoding API 失敗。"
    });
  }
}
