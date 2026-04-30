import type {
  DoctorLocationSampleUpload,
  DoctorLocationSyncService
} from "../types";

const defaultPollingIntervalMs = 10_000;

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

export function createHttpDoctorLocationSyncService(baseUrl = ""): DoctorLocationSyncService {
  return {
    mode: "api_polling",
    pollingIntervalMs: defaultPollingIntervalMs,
    buildUploadPath() {
      return `${normalizeBaseUrl(baseUrl)}/api/doctor-location-samples`;
    },
    buildAdminFeedPath(input) {
      const search = new URLSearchParams({
        date: input.date,
        time_slot: input.timeSlot
      });
      return `${normalizeBaseUrl(baseUrl)}/api/admin/doctor-locations?${search.toString()}`;
    },
    async pushSample(sample: DoctorLocationSampleUpload) {
      await fetch(`${normalizeBaseUrl(baseUrl)}/api/doctor-location-samples`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(sample)
      });
    }
  };
}
