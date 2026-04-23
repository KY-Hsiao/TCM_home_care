export const visitStatusValues = [
  "scheduled",
  "waiting_departure",
  "preparing",
  "on_the_way",
  "tracking",
  "proximity_pending",
  "arrived",
  "in_treatment",
  "followup_pending",
  "issue_pending",
  "paused",
  "completed",
  "rescheduled",
  "cancelled"
] as const;

export type VisitStatus = (typeof visitStatusValues)[number];

export const notificationStatusValues = [
  "pending",
  "sent",
  "failed",
  "awaiting_reply",
  "replied",
  "closed"
] as const;

export type NotificationStatus = (typeof notificationStatusValues)[number];

export const patientStatusValues = ["active", "paused", "closed"] as const;
export type PatientStatus = (typeof patientStatusValues)[number];

export const userRoleValues = ["doctor", "admin", "caregiver"] as const;
export type UserRole = (typeof userRoleValues)[number];

export const leaveRequestStatusValues = [
  "pending",
  "approved",
  "rejected"
] as const;
export type LeaveRequestStatus = (typeof leaveRequestStatusValues)[number];

export const scheduleChangeActionValues = [
  "reschedule",
  "coverage",
  "notify_only",
  "pause_visit",
  "cancel"
] as const;
export type ScheduleChangeAction = (typeof scheduleChangeActionValues)[number];

export const reminderStatusValues = ["pending", "done", "dismissed"] as const;
export type ReminderStatus = (typeof reminderStatusValues)[number];

export const contactChannelValues = ["phone", "google_chat", "web_notice", "sms", "in_person"] as const;
export type ContactChannel = (typeof contactChannelValues)[number];

export const locationSourceValues = [
  "gps",
  "network",
  "manual_seed"
] as const;
export type LocationSource = (typeof locationSourceValues)[number];

export const geocodingStatusValues = [
  "missing",
  "pending",
  "resolved",
  "approximate",
  "failed"
] as const;
export type GeocodingStatus = (typeof geocodingStatusValues)[number];

export const geofenceStatusValues = [
  "idle",
  "tracking",
  "inside_candidate",
  "proximity_pending",
  "arrived",
  "outside_candidate",
  "completed",
  "coordinate_missing",
  "permission_denied",
  "low_accuracy",
  "signal_lost"
] as const;
export type GeofenceStatus = (typeof geofenceStatusValues)[number];

export const trackingModeValues = ["google_chat", "google_share", "hybrid"] as const;
export type TrackingMode = (typeof trackingModeValues)[number];

export const routeItemStatusValues = [
  "scheduled",
  "on_the_way",
  "in_treatment",
  "completed",
  "paused"
] as const;
export type RouteItemStatus = (typeof routeItemStatusValues)[number];

export const routeExecutionStatusValues = ["draft", "executing", "archived"] as const;
export type RouteExecutionStatus = (typeof routeExecutionStatusValues)[number];

export const confirmationSourceValues = ["doctor", "admin", "system"] as const;
export type ConfirmationSource = (typeof confirmationSourceValues)[number];

export const recipientRoleValues = ["doctor", "caregiver"] as const;
export type RecipientRole = (typeof recipientRoleValues)[number];

export const visitFeedbackCodeValues = [
  "normal",
  "absent",
  "admin_followup",
  "urgent"
] as const;
export type VisitFeedbackCode = (typeof visitFeedbackCodeValues)[number];

export const familyFollowUpStatusValues = [
  "not_needed",
  "draft_ready",
  "sent"
] as const;
export type FamilyFollowUpStatus = (typeof familyFollowUpStatusValues)[number];
