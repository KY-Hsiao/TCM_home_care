import type { ConfirmationSource, VisitFeedbackCode } from "../../domain/enums";
import type { VisitSchedule } from "../../domain/models";
import type { VisitDetail } from "../../domain/repository";
import type {
  DoctorLocationSyncService,
  GeolocationProviderAdapter,
  GeolocationScenario,
  ServicesContextDeps,
  TrackingRuntime,
  VisitAutomationService
} from "../types";
import { MockVisitAutomationService } from "./visit-automation-service";

/**
 * Decorates the original visit automation service and removes the legacy
 * next-stop LINE arrival reminder side effect.
 *
 * The legacy implementation sends a second arrival reminder from
 * `confirmDeparture()` by calling `sendArrivalReminderForNextStop()`. That
 * message includes the next patient's name and duplicates the explicit
 * button-based reminder in `public/line-arrival-click-target.js`.
 *
 * This class keeps the visit workflow delegated to the original service, but
 * shields `confirmDeparture()` from the legacy reminder path. The explicit
 * departure/next-stop button remains the single supported LINE arrival
 * reminder trigger.
 */
export class VisitAutomationServiceWithoutNextStopArrivalReminder
  implements VisitAutomationService
{
  private readonly inner: MockVisitAutomationService;

  constructor(
    deps: ServicesContextDeps,
    geolocationProvider: GeolocationProviderAdapter,
    doctorLocationSync: DoctorLocationSyncService
  ) {
    this.inner = new MockVisitAutomationService(deps, geolocationProvider, doctorLocationSync);
  }

  getScenarios(): GeolocationScenario[] {
    return this.inner.getScenarios();
  }

  getTrackingState(scheduleId: string): TrackingRuntime | undefined {
    return this.inner.getTrackingState(scheduleId);
  }

  getTrackingStates(): Record<string, TrackingRuntime> {
    return this.inner.getTrackingStates();
  }

  subscribe(listener: () => void): () => void {
    return this.inner.subscribe(listener);
  }

  configureTracking(
    scheduleId: string,
    input: Partial<Pick<TrackingRuntime, "scenarioId">>
  ): void {
    this.inner.configureTracking(scheduleId, input);
  }

  startTracking(detail: VisitDetail): void {
    this.inner.startTracking(detail);
  }

  pauseTracking(scheduleId: string): void {
    this.inner.pauseTracking(scheduleId);
  }

  resumeTracking(detail: VisitDetail): void {
    this.inner.resumeTracking(detail);
  }

  confirmArrival(scheduleId: string, confirmedBy: ConfirmationSource): void {
    this.inner.confirmArrival(scheduleId, confirmedBy);
  }

  recordDoctorFeedback(scheduleId: string, feedbackCode: VisitFeedbackCode): void {
    this.inner.recordDoctorFeedback(scheduleId, feedbackCode);
  }

  confirmDeparture(scheduleId: string, confirmedBy: ConfirmationSource): void {
    const previousFetch = typeof window !== "undefined" ? window.fetch : undefined;

    if (typeof window !== "undefined" && typeof previousFetch === "function") {
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("/api/admin/family-line/send")) {
          const body = typeof init?.body === "string" ? init.body : "";
          if (
            body.includes("已完成前一站") &&
            body.includes("接下來會前往") &&
            body.includes("的住處")
          ) {
            return new Response(
              JSON.stringify({
                sentCount: 0,
                failedCount: 0,
                attemptedCount: 0,
                skippedCount: 1,
                suppressed: true,
                suppressedReason: "legacy_next_stop_named_arrival_trigger_removed"
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" }
              }
            );
          }
        }
        return previousFetch(input, init);
      }) as typeof window.fetch;
    }

    try {
      this.inner.confirmDeparture(scheduleId, confirmedBy);
    } finally {
      if (typeof window !== "undefined" && previousFetch) {
        window.fetch = previousFetch;
      }
    }
  }

  confirmReturnToEndpoint(scheduleId: string, confirmedBy: ConfirmationSource): void {
    this.inner.confirmReturnToEndpoint(scheduleId, confirmedBy);
  }

  resetTracking(scheduleId: string): void {
    this.inner.resetTracking(scheduleId);
  }

  resetAll(): void {
    this.inner.resetAll();
  }

  getDisplayStatus(
    schedule: VisitSchedule,
    arrivalTime: string | null,
    departureTime: string | null
  ): string {
    return this.inner.getDisplayStatus(schedule, arrivalTime, departureTime);
  }
}
