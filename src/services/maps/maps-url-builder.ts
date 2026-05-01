import type {
  GeocodedAddressResult,
  MapsUrlBuilder,
  RouteMapInput,
  RouteMapLocation,
  RouteMapPreviewState
} from "../types";
import { resolveLocationKeyword } from "../../shared/utils/location-keyword";

const MAX_ROUTE_PREVIEW_WAYPOINTS = 9;

type GoogleGeocodingResponse = {
  status?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
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
      originLongitude
    }) {
      const destination = resolveMapQuery({
        address: destinationAddress,
        locationKeyword: destinationKeyword,
        latitude: destinationLatitude,
        longitude: destinationLongitude
      });
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
      if (!embedApiKey || !normalizedAddress || typeof fetch !== "function") {
        return null;
      }

      try {
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("address", normalizedAddress);
        url.searchParams.set("key", embedApiKey);
        url.searchParams.set("language", "zh-TW");
        url.searchParams.set("region", "tw");

        const response = await fetch(url.toString(), { signal });
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as GoogleGeocodingResponse;
        const firstResult = payload.status === "OK" ? payload.results?.[0] : null;
        const location = firstResult?.geometry?.location;
        if (
          typeof location?.lat !== "number" ||
          typeof location.lng !== "number" ||
          !Number.isFinite(location.lat) ||
          !Number.isFinite(location.lng)
        ) {
          return null;
        }

        return {
          latitude: location.lat,
          longitude: location.lng,
          formattedAddress: firstResult?.formatted_address ?? normalizedAddress
        };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        return null;
      }
    },
    buildCoordinateLabel(latitude, longitude) {
      if (latitude === null || longitude === null) {
        return "尚未取得精確座標";
      }
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
  };
}
