import type {
  GeocodedAddressResult,
  MapsUrlBuilder,
  RouteMapInput,
  RouteMapLocation,
  RouteMapPreviewState
} from "../types";
import { resolveLocationKeyword } from "../../shared/utils/location-keyword";
import { loadAdminApiTokenSettings } from "../../shared/utils/admin-api-tokens";

const MAX_ROUTE_PREVIEW_WAYPOINTS = 9;

type GoogleGeocodingResponse = {
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  reason?: string;
  error?: string;
  status?: string;
  error_message?: string;
};

function formatCoordinateQuery(latitude: number | null, longitude: number | null): string | null {
  if (latitude === null || longitude === null) {
    return null;
  }
  return `${latitude},${longitude}`;
}

function resolveMapQuery({
  address,
  locationKeyword,
  latitude,
  longitude
}: RouteMapLocation): string {
  const keywordQuery = locationKeyword
    ? resolveLocationKeyword(locationKeyword, address)
    : null;
  const coordinateQuery = formatCoordinateQuery(latitude, longitude);
  return keywordQuery ?? coordinateQuery ?? address;
}

function resolveEmbedApiKey(defaultEmbedApiKey: string) {
  return defaultEmbedApiKey || loadAdminApiTokenSettings().googleMapsApiKey.trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildInternalNavigationDataUrl(input: {
  origin: string | null;
  destination: string;
}) {
  const originText = input.origin ?? "尚未取得醫師目前定位，系統將以即時定位流程更新狀態";
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif; background: #f8fafc; color: #172033; }
    body { margin: 0; background: linear-gradient(180deg, #f8fafc 0%, #eef6f2 100%); }
    .wrap { min-height: 100vh; box-sizing: border-box; padding: 20px; display: grid; place-items: center; }
    .card { width: min(720px, 100%); box-sizing: border-box; border: 1px solid #dbe3df; border-radius: 28px; background: #fff; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12); padding: 24px; }
    .eyebrow { margin: 0; color: #d76a5f; font-size: 12px; font-weight: 800; letter-spacing: 0.18em; }
    h1 { margin: 10px 0 8px; font-size: clamp(24px, 5vw, 36px); line-height: 1.15; }
    .hint { margin: 0; color: #64748b; font-size: 15px; line-height: 1.7; }
    .status { margin-top: 18px; display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .chip { border-radius: 18px; background: #f1f5f9; padding: 12px; text-align: center; }
    .chip span { display: block; color: #64748b; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; }
    .chip strong { display: block; margin-top: 6px; font-size: 15px; }
    .route { margin-top: 22px; display: grid; gap: 12px; }
    .stop { border: 1px solid #e2e8f0; border-radius: 20px; padding: 16px; background: #f8fafc; }
    .stop span { display: block; color: #64748b; font-size: 12px; font-weight: 800; letter-spacing: 0.08em; }
    .stop strong { display: block; margin-top: 6px; font-size: 17px; line-height: 1.45; word-break: break-word; }
    .arrow { width: 38px; height: 38px; border-radius: 999px; display: grid; place-items: center; background: #2f6f5e; color: white; font-weight: 900; margin: -4px auto; }
    .pulse { margin-top: 22px; border-radius: 22px; background: #ecfdf5; color: #166534; padding: 14px 16px; font-size: 14px; line-height: 1.6; border: 1px solid #bbf7d0; }
    .note { margin: 14px 0 0; border-radius: 18px; background: #fff7ed; color: #9a3412; padding: 12px 14px; font-size: 13px; line-height: 1.6; }
    @media (max-width: 560px) { .status { grid-template-columns: 1fr; } .card { padding: 18px; border-radius: 22px; } }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card" aria-label="系統內嵌導航介面">
      <p class="eyebrow">系統內嵌導航</p>
      <h1>導航進行中</h1>
      <p class="hint">本畫面不會跳出程式。醫師保持在此頁面，系統會依外層即時定位流程判斷行進與抵達狀態；抵達後請按外層「已抵達，回到即時導航」。</p>
      <div class="status" aria-label="導航狀態">
        <div class="chip"><span>模式</span><strong>居家訪視導航</strong></div>
        <div class="chip"><span>交通</span><strong>開車</strong></div>
        <div class="chip"><span>狀態</span><strong>行進中</strong></div>
      </div>
      <div class="route">
        <div class="stop"><span>目前位置</span><strong>${escapeHtml(originText)}</strong></div>
        <div class="arrow">↓</div>
        <div class="stop"><span>目的地</span><strong>${escapeHtml(input.destination)}</strong></div>
      </div>
      <div class="pulse">請依醫師端即時定位與外層狀態操作。到達個案家後，直接按外層的抵達按鈕，系統會寫入抵達時間並切換後續治療流程。</div>
      <p class="note">Google 的手機逐步語音導航不能完整嵌入一般網頁 iframe；此處改為系統內建導航流程，不再把外開 Google Maps 作為主流程。</p>
    </section>
  </main>
</body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function buildRouteWaypointQuery(waypoints: RouteMapInput["waypoints"]) {
  return waypoints.map((waypoint) => resolveMapQuery(waypoint)).join("|");
}

function buildRouteDirectionsQuery(input: RouteMapInput) {
  const origin = resolveMapQuery(input.origin);
  const destination = resolveMapQuery(input.destination);
  const waypoints = buildRouteWaypointQuery(input.waypoints);

  return { origin, destination, waypoints, travelMode: input.travelMode };
}

export function createMapsUrlBuilder(options?: { embedApiKey?: string | null }): MapsUrlBuilder {
  const embedApiKey =
    options?.embedApiKey ??
    import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY ??
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ??
    "";
  let lastGeocodeError: string | null = null;

  return {
    buildPatientMapUrl({ address, locationKeyword, latitude, longitude }) {
      const query = resolveMapQuery({ address, locationKeyword, latitude, longitude });
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    },
    buildPatientEmbedUrl({ address, locationKeyword, latitude, longitude }) {
      const query = resolveMapQuery({ address, locationKeyword, latitude, longitude });
      return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`;
    },
    buildNavigationUrl({
      destinationAddress,
      destinationKeyword,
      destinationLatitude,
      destinationLongitude,
      originLatitude,
      originLongitude,
      navigationTarget = "web"
    }) {
      const destination = resolveMapQuery({
        address: destinationAddress,
        locationKeyword: destinationKeyword,
        latitude: destinationLatitude,
        longitude: destinationLongitude
      });
      if (navigationTarget === "android") {
        return `google.navigation:q=${encodeURIComponent(destination)}&mode=d`;
      }
      const origin = formatCoordinateQuery(originLatitude ?? null, originLongitude ?? null);
      return buildInternalNavigationDataUrl({ origin, destination });
    },
    buildNavigationEmbedUrl({
      destinationAddress,
      destinationKeyword,
      destinationLatitude,
      destinationLongitude,
      originLatitude,
      originLongitude
    }) {
      const origin = formatCoordinateQuery(originLatitude ?? null, originLongitude ?? null);
      const destination = resolveMapQuery({
        address: destinationAddress,
        locationKeyword: destinationKeyword,
        latitude: destinationLatitude,
        longitude: destinationLongitude
      });
      const resolvedEmbedApiKey = resolveEmbedApiKey(embedApiKey);
      if (!origin || !resolvedEmbedApiKey) {
        return buildInternalNavigationDataUrl({ origin, destination });
      }
      return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(resolvedEmbedApiKey)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=driving`;
    },
    buildRouteDirectionsUrl(input) {
      const { origin, destination, waypoints, travelMode } = buildRouteDirectionsQuery(input);
      const waypointQuery = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${encodeURIComponent(travelMode)}${waypointQuery}`;
    },
    buildRouteEmbedDirectionsUrl(input) {
      const resolvedEmbedApiKey = resolveEmbedApiKey(embedApiKey);
      if (!resolvedEmbedApiKey) return null;
      const { origin, destination, waypoints, travelMode } = buildRouteDirectionsQuery(input);
      const waypointQuery = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
      return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(resolvedEmbedApiKey)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=${encodeURIComponent(travelMode)}${waypointQuery}`;
    },
    getRoutePreviewState(input): RouteMapPreviewState {
      if (input.waypoints.length > MAX_ROUTE_PREVIEW_WAYPOINTS) {
        return {
          embedUrl: null,
          externalUrl: null,
          fallbackReason: `此路線共有 ${input.waypoints.length} 個停留點，已超過目前 Google 路線預覽上限。`,
          waypointCount: input.waypoints.length
        };
      }

      return {
        embedUrl: this.buildRouteEmbedDirectionsUrl(input),
        externalUrl: this.buildRouteDirectionsUrl(input),
        fallbackReason: null,
        waypointCount: input.waypoints.length
      };
    },
    async geocodeAddress({ address, signal }): Promise<GeocodedAddressResult | null> {
      const normalizedAddress = address.trim();
      lastGeocodeError = null;
      if (!normalizedAddress) {
        lastGeocodeError = "缺少地址，無法補座標。";
        return null;
      }
      if (typeof fetch !== "function") {
        lastGeocodeError = "目前執行環境無法送出補座標 request。";
        return null;
      }

      try {
        const response = await fetch("/api/maps/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: normalizedAddress,
            googleMapsApiKey: loadAdminApiTokenSettings().googleMapsApiKey.trim()
          }),
          signal
        });
        const payload = (await response.json().catch(() => null)) as GoogleGeocodingResponse | null;
        if (!response.ok) {
          lastGeocodeError =
            payload?.error ??
            (payload?.reason || payload?.status
              ? `Google Geocoding API 回傳 ${payload.reason ?? payload.status}${
                  payload?.error_message ? `：${payload.error_message}` : ""
                }`
              : `補座標 API HTTP ${response.status}`);
          return null;
        }

        if (
          typeof payload?.latitude !== "number" ||
          typeof payload.longitude !== "number" ||
          !Number.isFinite(payload.latitude) ||
          !Number.isFinite(payload.longitude)
        ) {
          lastGeocodeError = "補座標 API 回傳格式不完整。";
          return null;
        }

        return {
          latitude: payload.latitude,
          longitude: payload.longitude,
          formattedAddress: payload.formattedAddress ?? normalizedAddress
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        lastGeocodeError = error instanceof Error ? error.message : "補座標 API 呼叫失敗。";
        return null;
      }
    },
    getLastGeocodeError() { return lastGeocodeError; },
    buildCoordinateLabel(latitude, longitude) {
      if (latitude === null || longitude === null) return "尚未取得精確座標";
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
  };
}
