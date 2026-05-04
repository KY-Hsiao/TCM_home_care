export type AdminApiTokenSettings = {
  lineChannelAccessToken: string;
  lineChannelSecret: string;
  googleMapsApiKey: string;
};

export const ADMIN_API_TOKEN_STORAGE_KEY = "tcm-admin-api-token-settings";

export const defaultAdminApiTokenSettings: AdminApiTokenSettings = {
  lineChannelAccessToken: "",
  lineChannelSecret: "",
  googleMapsApiKey: ""
};

export function loadAdminApiTokenSettings(): AdminApiTokenSettings {
  if (typeof window === "undefined") {
    return defaultAdminApiTokenSettings;
  }
  try {
    const raw = window.localStorage.getItem(ADMIN_API_TOKEN_STORAGE_KEY);
    return raw
      ? {
          ...defaultAdminApiTokenSettings,
          ...JSON.parse(raw)
        }
      : defaultAdminApiTokenSettings;
  } catch {
    return defaultAdminApiTokenSettings;
  }
}

export function persistAdminApiTokenSettings(settings: AdminApiTokenSettings) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ADMIN_API_TOKEN_STORAGE_KEY, JSON.stringify(settings));
}
