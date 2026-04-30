import { BrowserGeolocationAdapter } from "./geolocation/browser-geolocation-adapter";
import { HybridGeolocationProvider } from "./geolocation/hybrid-geolocation-provider";
import { MockGeolocationProvider } from "./geolocation/mock-geolocation-provider";
import { createHttpDoctorLocationSyncService } from "./location-sync/http-doctor-location-sync-service";
import { resolveDoctorLocationSyncMode } from "./location-sync/mode";
import { createMockDoctorLocationSyncService } from "./location-sync/mock-doctor-location-sync-service";
import { createNotificationPayloadBuilder } from "./chat/notification-payload-builder";
import { createMapsUrlBuilder } from "./maps/maps-url-builder";
import type { AppServices, ServicesContextDeps } from "./types";
import { MockVisitAutomationService } from "./visit-automation/visit-automation-service";

export function createAppServices(deps: ServicesContextDeps): AppServices {
  const payloadBuilder = createNotificationPayloadBuilder();
  const maps = createMapsUrlBuilder();
  const geolocation = new HybridGeolocationProvider(
    new BrowserGeolocationAdapter(),
    new MockGeolocationProvider()
  );
  const doctorLocationSync =
    resolveDoctorLocationSyncMode() === "api_polling"
      ? createHttpDoctorLocationSyncService()
      : createMockDoctorLocationSyncService(deps);
  const visitAutomation = new MockVisitAutomationService(
    deps,
    geolocation,
    doctorLocationSync
  );

  return {
    payloadBuilder,
    maps,
    geolocation,
    doctorLocationSync,
    visitAutomation
  };
}
