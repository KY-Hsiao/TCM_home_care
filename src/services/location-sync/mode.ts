import type { DoctorLocationSyncMode } from "../types";

declare global {
  interface Window {
    __TCM_DOCTOR_LOCATION_SYNC_MODE__?: DoctorLocationSyncMode;
  }
}

export function resolveDoctorLocationSyncMode(): DoctorLocationSyncMode {
  if (typeof window !== "undefined" && window.__TCM_DOCTOR_LOCATION_SYNC_MODE__) {
    return window.__TCM_DOCTOR_LOCATION_SYNC_MODE__;
  }

  const envMode = import.meta.env.VITE_DOCTOR_LOCATION_SYNC_MODE;
  if (envMode === "api_polling" || envMode === "mock_local_storage") {
    return envMode;
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return "api_polling";
    }
  }

  return "mock_local_storage";
}
