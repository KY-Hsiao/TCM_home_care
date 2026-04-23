export const sameAddressLocationKeyword = "同住址";

export function normalizeLocationKeyword(keyword: string | null | undefined) {
  const normalized = keyword?.trim() ?? "";
  return normalized || sameAddressLocationKeyword;
}

export function resolveLocationKeyword(keyword: string | null | undefined, address: string) {
  const normalizedKeyword = normalizeLocationKeyword(keyword);
  if (normalizedKeyword === sameAddressLocationKeyword) {
    return address.trim() || normalizedKeyword;
  }
  return normalizedKeyword;
}

export function buildGoogleMapsSearchUrl(keyword: string | null | undefined, address: string) {
  const query = resolveLocationKeyword(keyword, address);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
