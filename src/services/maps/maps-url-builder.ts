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

function buildRouteWaypointQuery(waypoints: RouteMapInput["waypoints"]) {
  return waypoints.map((waypoint) => resolveMapQuery(waypoint)).join("|");
}

function buildRouteDirectionsQuery(input: RouteMapInput) {
  const origin = resolveMapQuery(input.origin);
  const destination = resolveMapQuery(input.destination);
  const waypoints = buildRouteWaypointQuery(input.waypoints);

  return {
    origin,
    destination,
    waypoints,
    travelMode: input.travelMode
  };
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
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${
        origin ? `&origin=${encodeURIComponent(origin)}` : ""
      }`;
    },
    buildNavigationEmbedUrl({
      destinationAddress,
      destinationKeyword,
      destinationLatitude,
      destinationLongitude,
      originLatitude,
      originLongitude
    }) {
      if (!embedApiKey) {
        return null;
      }
      const origin = formatCoordinateQuery(originLatitude ?? null, originLongitude ?? null);
      if (!origin) {
        return null;
      }
      const destination = resolveMapQuery({
        address: destinationAddress,
        locationKeyword: destinationKeyword,
        latitude: destinationLatitude,
        longitude: destinationLongitude
      });
      return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(embedApiKey)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=driving`;
    },
    buildRouteDirectionsUrl(input) {
      const { origin, destination, waypoints, travelMode } = buildRouteDirectionsQuery(input);
      const waypointQuery = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
      return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${encodeURIComponent(travelMode)}${waypointQuery}`;
    },
    buildRouteEmbedDirectionsUrl(input) {
      if (!embedApiKey) {
        return null;
      }
      const { origin, destination, waypoints, travelMode } = buildRouteDirectionsQuery(input);
      const waypointQuery = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
      return `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(embedApiKey)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=${encodeURIComponent(travelMode)}${waypointQuery}`;
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
          headers: {
            "Content-Type": "application/json"
          },
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
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        lastGeocodeError = error instanceof Error ? error.message : "補座標 API 呼叫失敗。";
        return null;
      }
    },
    getLastGeocodeError() {
      return lastGeocodeError;
    },
    buildCoordinateLabel(latitude, longitude) {
      if (latitude === null || longitude === null) {
        return "尚未取得精確座標";
      }
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
  };
}
