function setJson(response, statusCode, payload) {
  response.status(statusCode).setHeader("Content-Type", "application/json");
  response.send(JSON.stringify(payload));
}

function resolveGoogleMapsBrowserApiKey() {
  return (
    process.env.GOOGLE_MAPS_BROWSER_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ""
  );
}

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    setJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  const apiKey = resolveGoogleMapsBrowserApiKey();
  if (!apiKey.trim()) {
    setJson(response, 503, {
      ok: false,
      reason: "API_KEY_MISSING",
      error: "尚未設定 GOOGLE_MAPS_BROWSER_API_KEY 或 GOOGLE_MAPS_API_KEY，無法載入內嵌 Google Map 導航。"
    });
    return;
  }

  setJson(response, 200, {
    ok: true,
    mapsApiKey: apiKey,
    mapId: process.env.GOOGLE_MAPS_MAP_ID || process.env.VITE_GOOGLE_MAPS_MAP_ID || ""
  });
}
