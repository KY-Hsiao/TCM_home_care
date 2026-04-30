import type { ServicesContextDeps } from "../types";
import type {
  DoctorLocationSampleUpload,
  DoctorLocationSyncService
} from "../types";

const defaultPollingIntervalMs = 10_000;

function buildAdminFeedPath(input: { date: string; timeSlot: "上午" | "下午" }) {
  const search = new URLSearchParams({
    date: input.date,
    time_slot: input.timeSlot
  });
  return `/api/admin/doctor-locations?${search.toString()}`;
}

export function createMockDoctorLocationSyncService(
  deps: ServicesContextDeps
): DoctorLocationSyncService {
  return {
    mode: "mock_local_storage",
    pollingIntervalMs: defaultPollingIntervalMs,
    buildUploadPath() {
      return "/api/doctor-location-samples";
    },
    buildAdminFeedPath,
    pushSample(sample: DoctorLocationSampleUpload) {
      deps.getRepositories().visitRepository.appendDoctorLocationLog({
        id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ...sample
      });
    }
  };
}
