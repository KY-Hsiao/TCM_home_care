export const ADMIN_API_TOKEN_STORAGE_KEY = "tcm-admin-api-token-settings";

export function clearLegacyAdminApiTokenSettings() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ADMIN_API_TOKEN_STORAGE_KEY);
}
