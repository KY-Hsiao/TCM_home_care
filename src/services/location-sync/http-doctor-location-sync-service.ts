import type {
  DoctorLocationSampleUpload,
  DoctorLocationSyncService,
  DoctorLocationTimeSlot
} from "../types";

const defaultPollingIntervalMs = 10_000;

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function buildAdminFeedPath(baseUrl: string, input: { date: string; timeSlot: DoctorLocationTimeSlot }) {
  const search = new URLSearchParams({
    date: input.date,
    time_slot: input.timeSlot
  });
  return `${normalizeBaseUrl(baseUrl)}/admin/doctor-locations?${search.toString()}`;
}

export function createHttpDoctorLocationSyncService(baseUrl = ""): DoctorLocationSyncService {
  return {
    mode: "api_polling",
    pollingIntervalMs: defaultPollingIntervalMs,
    buildUploadPath() {
      return `${normalizeBaseUrl(baseUrl)}/doctor-location-samples`;
    },
    buildAdminFeedPath(input) {
      return buildAdminFeedPath(baseUrl, input);
    },
    async pushSample(sample: DoctorLocationSampleUpload) {
      await fetch(`${normalizeBaseUrl(baseUrl)}/doctor-location-samples`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(sample)
      });
    }
  };
}
