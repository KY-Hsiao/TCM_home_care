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

const SETTINGS_STORAGE_KEY = "tcm-family-line-settings";

function runWithDoctorArrivalReminderTemporarilyDisabled(action: () => void) {
  if (typeof window === "undefined") {
    action();
    return;
  }

  let originalRaw: string | null = null;
  try {
    originalRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const original = originalRaw ? JSON.parse(originalRaw) : {};
    window.localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...original,
        doctorArrivalReminder: false
      })
    );
    action();
  } finally {
    if (originalRaw === null) {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, originalRaw);
    }
  }
}

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
    runWithDoctorArrivalReminderTemporarilyDisabled(() => {
      this.inner.confirmDeparture(scheduleId, confirmedBy);
    });
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
