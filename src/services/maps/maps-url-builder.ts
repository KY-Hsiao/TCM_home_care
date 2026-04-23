import type { MapsUrlBuilder } from "../types";
import { resolveLocationKeyword } from "../../shared/utils/location-keyword";

function formatCoordinateQuery(latitude: number | null, longitude: number | null): string | null {
  if (latitude === null || longitude === null) {
    return null;
  }
  return `${latitude},${longitude}`;
}

export function createMapsUrlBuilder(): MapsUrlBuilder {
  return {
    buildPatientMapUrl({ address, locationKeyword, latitude, longitude }) {
      const keywordQuery = locationKeyword
        ? resolveLocationKeyword(locationKeyword, address)
        : null;
      const coordinateQuery = formatCoordinateQuery(latitude, longitude);
      const query = keywordQuery ?? coordinateQuery ?? address;
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    },
    buildPatientEmbedUrl({ address, locationKeyword, latitude, longitude }) {
      const keywordQuery = locationKeyword
        ? resolveLocationKeyword(locationKeyword, address)
        : null;
      const coordinateQuery = formatCoordinateQuery(latitude, longitude);
      const query = keywordQuery ?? coordinateQuery ?? address;
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
      const keywordDestination = destinationKeyword
        ? resolveLocationKeyword(destinationKeyword, destinationAddress)
        : null;
      const destination =
        keywordDestination ??
        formatCoordinateQuery(destinationLatitude, destinationLongitude) ??
        destinationAddress;
      const origin = formatCoordinateQuery(originLatitude ?? null, originLongitude ?? null);
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${
        origin ? `&origin=${encodeURIComponent(origin)}` : ""
      }`;
    },
    buildCoordinateLabel(latitude, longitude) {
      if (latitude === null || longitude === null) {
        return "尚未取得精確座標";
      }
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
  };
}
