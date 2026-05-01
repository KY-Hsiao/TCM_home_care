import type {
  DoctorLocationLog,
  NotificationTask,
  Patient,
  VisitSchedule
} from "../domain/models";
import type { AppRepositories, SessionState, VisitDetail } from "../domain/repository";
import type {
  ConfirmationSource,
  FamilyFollowUpStatus,
  GeofenceStatus,
  RecipientRole,
  VisitFeedbackCode
} from "../domain/enums";

export type ChatFeature =
  | "card_message"
  | "external_form_link"
  | "button_actions"
  | "member_binding";

export type ChatNotificationEventType =
  | "visit_reminder"
  | "visit_today"
  | "visit_delay"
  | "visit_reschedule"
  | "visit_coverage"
  | "visit_completed"
  | "doctor_departure_check"
  | "doctor_arrival_feedback"
  | "doctor_emergency_alert"
  | "family_followup_normal"
  | "family_followup_absent"
  | "family_followup_admin"
  | "family_followup_urgent";

export type ChatActionItem = {
  label: string;
  action: string;
};

export type ChatNotificationPayload = {
  eventType: ChatNotificationEventType;
  subject: string;
  body: string;
  templateCode: string;
  cardDraft: string;
  actions: ChatActionItem[];
  previewPayload: Record<string, string>;
};

export type ChatNotificationEvent = {
  patient: Patient;
  schedule: VisitSchedule;
  recipientName: string;
  recipientRole: RecipientRole;
  recipientTarget: string;
  caregiverId: string | null;
  payload: ChatNotificationPayload;
  triggerType?: string;
  linkedTrackingSessionId?: string | null;
};

export type WebhookReplyAction =
  | "message"
  | "approve"
  | "reschedule_request"
  | "admin_note"
  | "doctor_note"
  | "doctor_departed"
  | "doctor_arrived_confirmed"
  | "doctor_feedback_normal"
  | "doctor_feedback_absent"
  | "doctor_feedback_admin"
  | "doctor_feedback_urgent"
  | "doctor_visit_finished";

export type WebhookReplyInput = {
  taskId: string;
  patientId: string;
  scheduleId: string | null;
  caregiverId: string | null;
  message: string;
  action: WebhookReplyAction;
};

export type RouteMapLocation = {
  address: string;
  locationKeyword?: string | null;
  label?: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type RouteMapInput = {
  origin: RouteMapLocation;
  destination: RouteMapLocation;
  waypoints: RouteMapLocation[];
  travelMode: "driving";
  label: string;
};

export type RouteMapPreviewState = {
  embedUrl: string | null;
  externalUrl: string | null;
  fallbackReason: string | null;
  waypointCount: number;
};

export type GeocodedAddressResult = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
};

export type FamilyEntryContext = {
  patientId?: string;
  scheduleId?: string;
  taskId?: string;
  action?: string;
};

export type ProviderPermissionState =
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported";

export type DoctorLocationTimeSlot = "上午" | "下午";

export type DoctorLocationSyncMode = "mock_local_storage" | "api_polling";

export type DoctorLocationSampleUpload = Omit<DoctorLocationLog, "id">;

export type GeolocationScenarioId =
  | "normal_arrival_complete"
  | "gps_drift"
  | "low_accuracy"
  | "permission_denied"
  | "signal_lost"
  | "coordinate_missing";

export type GeolocationScenario = {
  id: GeolocationScenarioId;
  label: string;
  description: string;
};

export type GeolocationSample = Omit<DoctorLocationLog, "id" | "doctor_id"> & {
  kind: "sample" | "signal_lost";
  note?: string;
};

export type GeolocationProviderEvent =
  | {
      type: "permission_denied";
      watchId: string;
      scheduleId: string;
      message: string;
    }
  | {
      type: "sample";
      watchId: string;
      scheduleId: string;
      sample: GeolocationSample;
    }
  | {
      type: "completed";
      watchId: string;
      scheduleId: string;
    };

export type TrackingWatchStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "error";

export type TrackingRuntime = {
  scheduleId: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  targetPatientId: string;
  routeOrder: number;
  scenarioId: GeolocationScenarioId;
  watchStatus: TrackingWatchStatus;
  geofenceStatus: GeofenceStatus;
  latestSample: GeolocationSample | null;
  latestDistanceMeters: number | null;
  latestAccuracy: number | null;
  permissionState: ProviderPermissionState;
  fallbackMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastUpdatedAt: string | null;
  proximityTriggeredAt: string | null;
  arrivalConfirmationPending: boolean;
  stopReason: string | null;
  googleShareFallbackActive: boolean;
  doctorFeedbackCode: VisitFeedbackCode | null;
  familyFollowUpStatus: FamilyFollowUpStatus;
  eventLog: string[];
  samplesProcessed: number;
  insideCandidateCount: number;
  insideCandidateStartedAt: string | null;
  outsideCandidateCount: number;
  outsideCandidateStartedAt: string | null;
};

export interface NotificationPayloadBuilder {
  buildPayload(input: {
    type: ChatNotificationEventType;
    detail: VisitDetail;
    summary?: string;
    delayMinutes?: number;
    coverageDoctorName?: string;
    rescheduleNote?: string;
    feedbackCode?: VisitFeedbackCode | null;
  }): ChatNotificationPayload;
}

export interface ChatServiceAdapter {
  sendNotification(event: ChatNotificationEvent): NotificationTask | undefined;
  replyToEvent(input: WebhookReplyInput): NotificationTask | undefined;
  buildFamilyEntryUrl(context: FamilyEntryContext): string;
  supports(feature: ChatFeature): boolean;
}

export interface WebhookHandler {
  handleBinding(input: {
    caregiverId: string;
    googleChatUserId: string;
    googleAccountEmail: string;
    displayName: string;
  }): void;
  handleMessage(input: WebhookReplyInput): void;
  handlePostback(input: WebhookReplyInput): void;
  handleFamilyFormSubmit(input: WebhookReplyInput & { formData: Record<string, string> }): void;
}

export interface MapsUrlBuilder {
  buildPatientMapUrl(input: {
    address: string;
    locationKeyword?: string | null;
    latitude: number | null;
    longitude: number | null;
  }): string;
  buildPatientEmbedUrl(input: {
    address: string;
    locationKeyword?: string | null;
    latitude: number | null;
    longitude: number | null;
  }): string;
  buildNavigationUrl(input: {
    destinationAddress: string;
    destinationKeyword?: string | null;
    destinationLatitude: number | null;
    destinationLongitude: number | null;
    originLatitude?: number | null;
    originLongitude?: number | null;
  }): string;
  buildNavigationEmbedUrl(input: {
    destinationAddress: string;
    destinationKeyword?: string | null;
    destinationLatitude: number | null;
    destinationLongitude: number | null;
    originLatitude?: number | null;
    originLongitude?: number | null;
  }): string | null;
  buildRouteDirectionsUrl(input: RouteMapInput): string;
  buildRouteEmbedDirectionsUrl(input: RouteMapInput): string | null;
  getRoutePreviewState(input: RouteMapInput): RouteMapPreviewState;
  geocodeAddress(input: {
    address: string;
    signal?: AbortSignal;
  }): Promise<GeocodedAddressResult | null>;
  buildCoordinateLabel(latitude: number | null, longitude: number | null): string;
}

export interface GeolocationProviderAdapter {
  startWatch(input: {
    watchId: string;
    scheduleId: string;
    doctorId: string;
    patient: Patient;
    schedule: VisitSchedule;
    scenarioId: GeolocationScenarioId;
  }): void;
  pauseWatch(watchId: string): void;
  resumeWatch(watchId: string): void;
  stopWatch(watchId: string): void;
  subscribe(listener: (event: GeolocationProviderEvent) => void): () => void;
  getPermissionState(
    scenarioId?: GeolocationScenarioId
  ): ProviderPermissionState;
}

export interface DoctorLocationSyncService {
  mode: DoctorLocationSyncMode;
  pollingIntervalMs: number;
  buildUploadPath(): string;
  buildAdminFeedPath(input: {
    date: string;
    timeSlot: DoctorLocationTimeSlot;
  }): string;
  buildAdminLatestFeedPath(): string;
  pushSample(sample: DoctorLocationSampleUpload): Promise<void> | void;
}

export interface VisitAutomationService {
  getScenarios(): GeolocationScenario[];
  getTrackingState(scheduleId: string): TrackingRuntime | undefined;
  getTrackingStates(): Record<string, TrackingRuntime>;
  subscribe(listener: () => void): () => void;
  configureTracking(
    scheduleId: string,
    input: Partial<Pick<TrackingRuntime, "scenarioId">>
  ): void;
  startTracking(detail: VisitDetail): void;
  pauseTracking(scheduleId: string): void;
  resumeTracking(detail: VisitDetail): void;
  confirmArrival(scheduleId: string, confirmedBy: ConfirmationSource): void;
  recordDoctorFeedback(scheduleId: string, feedbackCode: VisitFeedbackCode): void;
  confirmDeparture(scheduleId: string, confirmedBy: ConfirmationSource): void;
  resetTracking(scheduleId: string): void;
  resetAll(): void;
  getDisplayStatus(
    schedule: VisitSchedule,
    arrivalTime: string | null,
    departureTime: string | null
  ): string;
}

export type AppServices = {
  payloadBuilder: NotificationPayloadBuilder;
  maps: MapsUrlBuilder;
  geolocation: GeolocationProviderAdapter;
  doctorLocationSync: DoctorLocationSyncService;
  visitAutomation: VisitAutomationService;
};

export type ServicesContextDeps = {
  getRepositories: () => AppRepositories;
  getSession: () => SessionState;
};
