import { z } from "zod";
import {
  confirmationSourceValues,
  contactChannelValues,
  familyFollowUpStatusValues,
  geocodingStatusValues,
  geofenceStatusValues,
  leaveRequestStatusValues,
  locationSourceValues,
  notificationStatusValues,
  patientStatusValues,
  recipientRoleValues,
  reminderStatusValues,
  routeExecutionStatusValues,
  routeItemStatusValues,
  scheduleChangeActionValues,
  trackingModeValues,
  userRoleValues,
  visitFeedbackCodeValues,
  visitStatusValues
} from "./enums";

const baseTimestamps = {
  created_at: z.string(),
  updated_at: z.string()
};

export const patientSchema = z.object({
  id: z.string(),
  chart_number: z.string(),
  name: z.string(),
  service_needs: z.array(z.string()).default([]),
  preferred_service_slot: z.string().default(""),
  gender: z.string(),
  date_of_birth: z.string(),
  phone: z.string(),
  address: z.string(),
  home_address: z.string(),
  location_keyword: z.string().default("同住址"),
  home_latitude: z.number().nullable(),
  home_longitude: z.number().nullable(),
  geocoding_status: z.enum(geocodingStatusValues),
  google_maps_link: z.string(),
  patient_tag: z.string(),
  primary_diagnosis: z.string(),
  preferred_doctor_id: z.string(),
  important_medical_history: z.string(),
  precautions: z.string(),
  medication_summary: z.string(),
  last_visit_summary: z.string(),
  next_follow_up_focus: z.string(),
  reminder_tags: z.array(z.string()),
  status: z.enum(patientStatusValues),
  notes: z.string(),
  ...baseTimestamps
});

export type Patient = z.infer<typeof patientSchema>;

export const caregiverSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  name: z.string(),
  relationship: z.string(),
  phone: z.string(),
  preferred_contact_channel: z.enum(contactChannelValues),
  is_primary: z.boolean(),
  receives_notifications: z.boolean(),
  notes: z.string(),
  ...baseTimestamps
});

export type Caregiver = z.infer<typeof caregiverSchema>;

export const caregiverChatBindingSchema = z.object({
  id: z.string(),
  caregiver_id: z.string(),
  google_chat_user_id: z.string(),
  google_account_email: z.string(),
  google_account_logged_in: z.boolean(),
  display_name: z.string(),
  is_active: z.boolean(),
  bound_at: z.string(),
  last_interaction_at: z.string().nullable(),
  ...baseTimestamps
});

export type CaregiverChatBinding = z.infer<typeof caregiverChatBindingSchema>;

export const doctorSchema = z.object({
  id: z.string(),
  name: z.string(),
  license_number: z.string().default(""),
  phone: z.string(),
  specialty: z.string().default(""),
  service_area: z.string().default(""),
  google_chat_user_id: z.string().default(""),
  google_account_email: z.string().nullable(),
  google_account_logged_in: z.boolean().default(false),
  google_location_share_url: z.string().nullable(),
  google_location_share_enabled: z.boolean(),
  available_service_slots: z.array(z.string()).default([]),
  status: z.enum(["active", "off_duty"] as const),
  ...baseTimestamps
});

export type Doctor = z.infer<typeof doctorSchema>;

export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  job_title: z.string(),
  email: z.string().default(""),
  google_chat_user_id: z.string().default(""),
  google_account_email: z.string().default(""),
  google_account_logged_in: z.boolean().default(false),
  phone: z.string(),
  ...baseTimestamps
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const visitScheduleSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  assigned_doctor_id: z.string(),
  primary_caregiver_id: z.string(),
  scheduled_start_at: z.string(),
  scheduled_end_at: z.string(),
  estimated_treatment_minutes: z.number().default(30),
  address_snapshot: z.string(),
  location_keyword_snapshot: z.string().default("同住址"),
  home_latitude_snapshot: z.number().nullable(),
  home_longitude_snapshot: z.number().nullable(),
  arrival_radius_meters: z.number().default(100),
  geofence_status: z.enum(geofenceStatusValues),
  google_maps_link: z.string(),
  area: z.string(),
  service_time_slot: z.string().default(""),
  route_order: z.number().default(1),
  route_group_id: z.string(),
  tracking_mode: z.enum(trackingModeValues),
  tracking_started_at: z.string().nullable(),
  tracking_stopped_at: z.string().nullable(),
  arrival_confirmed_by: z.enum(confirmationSourceValues).nullable(),
  departure_confirmed_by: z.enum(confirmationSourceValues).nullable(),
  last_feedback_code: z.enum(visitFeedbackCodeValues).nullable(),
  reminder_tags: z.array(z.string()),
  status: z.enum(visitStatusValues),
  visit_type: z.string(),
  note: z.string(),
  ...baseTimestamps
});

export type VisitSchedule = z.infer<typeof visitScheduleSchema>;

export const savedRoutePlanSchema = z.object({
  id: z.string(),
  doctor_id: z.string(),
  route_group_id: z.string(),
  route_name: z.string(),
  route_date: z.string(),
  route_weekday: z.string(),
  service_time_slot: z.enum(["上午", "下午"] as const),
  optimize_by: z.enum(["time", "distance"] as const),
  schedule_ids: z.array(z.string()),
  route_items: z.array(
    z.object({
      patient_id: z.string(),
      schedule_id: z.string().nullable(),
      checked: z.boolean(),
      route_order: z.number().nullable(),
      status: z.enum(routeItemStatusValues),
      patient_name: z.string(),
      address: z.string()
    })
  ),
  execution_status: z.enum(routeExecutionStatusValues),
  executed_at: z.string().nullable(),
  start_address: z.string(),
  start_latitude: z.number().nullable(),
  start_longitude: z.number().nullable(),
  end_address: z.string(),
  end_latitude: z.number().nullable(),
  end_longitude: z.number().nullable(),
  total_minutes: z.number(),
  total_distance_kilometers: z.number(),
  saved_at: z.string(),
  ...baseTimestamps
});

export type SavedRoutePlan = z.infer<typeof savedRoutePlanSchema>;

export const visitRecordSchema = z.object({
  id: z.string(),
  visit_schedule_id: z.string(),
  departure_time: z.string().nullable(),
  arrival_time: z.string().nullable(),
  departure_from_patient_home_time: z.string().nullable(),
  stay_duration_minutes: z.number().nullable(),
  treatment_start_time: z.string().nullable(),
  treatment_end_time: z.string().nullable(),
  treatment_duration_minutes: z.number().nullable(),
  treatment_duration_manually_adjusted: z.boolean(),
  chief_complaint: z.string(),
  sleep_status: z.string(),
  appetite_status: z.string(),
  bowel_movement_status: z.string(),
  pain_status: z.string(),
  energy_status: z.string(),
  inspection_tags: z.array(z.string()).default([]),
  inspection_other: z.string().default(""),
  listening_tags: z.array(z.string()).default([]),
  listening_other: z.string().default(""),
  inquiry_tags: z.array(z.string()).default([]),
  inquiry_other: z.string().default(""),
  palpation_tags: z.array(z.string()).default([]),
  palpation_other: z.string().default(""),
  physician_assessment: z.string(),
  treatment_provided: z.string(),
  doctor_note: z.string(),
  caregiver_feedback: z.string(),
  follow_up_note: z.string(),
  medical_history_note: z.string().default(""),
  generated_record_text: z.string().default(""),
  next_visit_suggestion_date: z.string().nullable(),
  visit_feedback_code: z.enum(visitFeedbackCodeValues).nullable(),
  visit_feedback_at: z.string().nullable(),
  family_followup_status: z.enum(familyFollowUpStatusValues),
  family_followup_sent_at: z.string().nullable(),
  ...baseTimestamps
});

export type VisitRecord = z.infer<typeof visitRecordSchema>;

export const contactLogSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  visit_schedule_id: z.string().nullable(),
  caregiver_id: z.string().nullable(),
  doctor_id: z.string().nullable(),
  admin_user_id: z.string().nullable(),
  channel: z.enum(contactChannelValues),
  subject: z.string(),
  content: z.string(),
  outcome: z.string(),
  contacted_at: z.string(),
  ...baseTimestamps
});

export type ContactLog = z.infer<typeof contactLogSchema>;

export const notificationTemplateSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  category: z.string(),
  channel: z.enum(contactChannelValues),
  subject_template: z.string(),
  body_template: z.string(),
  card_message_draft: z.string(),
  variables: z.array(z.string()),
  ...baseTimestamps
});

export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

export const notificationTaskSchema = z.object({
  id: z.string(),
  template_id: z.string(),
  patient_id: z.string(),
  caregiver_id: z.string().nullable(),
  visit_schedule_id: z.string().nullable(),
  status: z.enum(notificationStatusValues),
  channel: z.enum(contactChannelValues),
  scheduled_send_at: z.string(),
  sent_at: z.string().nullable(),
  recipient_name: z.string(),
  recipient_role: z.enum(recipientRoleValues),
  recipient_target: z.string(),
  trigger_type: z.string(),
  preview_payload: z.record(z.string(), z.string()),
  reply_excerpt: z.string().nullable(),
  reply_code: z.string().nullable(),
  failure_reason: z.string().nullable(),
  linked_tracking_session_id: z.string().nullable(),
  ...baseTimestamps
});

export type NotificationTask = z.infer<typeof notificationTaskSchema>;

export const leaveRequestSchema = z.object({
  id: z.string(),
  doctor_id: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  reason: z.string(),
  status: z.enum(leaveRequestStatusValues),
  handoff_note: z.string(),
  ...baseTimestamps
});

export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

export const rescheduleActionSchema = z.object({
  id: z.string(),
  visit_schedule_id: z.string(),
  requested_by_role: z.enum(userRoleValues),
  action_type: z.enum(scheduleChangeActionValues),
  original_start_at: z.string(),
  original_end_at: z.string(),
  new_start_at: z.string(),
  new_end_at: z.string(),
  new_doctor_id: z.string().nullable(),
  reason: z.string(),
  change_summary: z.string(),
  status: z.string(),
  ...baseTimestamps
});

export type RescheduleAction = z.infer<typeof rescheduleActionSchema>;

export const reminderSchema = z.object({
  id: z.string(),
  role: z.enum(userRoleValues),
  title: z.string(),
  detail: z.string(),
  due_at: z.string(),
  related_visit_schedule_id: z.string().nullable(),
  status: z.enum(reminderStatusValues),
  ...baseTimestamps
});

export type Reminder = z.infer<typeof reminderSchema>;

export const doctorLocationLogSchema = z.object({
  id: z.string(),
  doctor_id: z.string(),
  recorded_at: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number(),
  source: z.enum(locationSourceValues),
  linked_visit_schedule_id: z.string().nullable()
});

export type DoctorLocationLog = z.infer<typeof doctorLocationLogSchema>;

export const appDbSchema = z.object({
  patients: z.array(patientSchema),
  caregivers: z.array(caregiverSchema),
  caregiver_chat_bindings: z.array(caregiverChatBindingSchema),
  doctors: z.array(doctorSchema),
  admin_users: z.array(adminUserSchema),
  visit_schedules: z.array(visitScheduleSchema),
  saved_route_plans: z.array(savedRoutePlanSchema),
  visit_records: z.array(visitRecordSchema),
  contact_logs: z.array(contactLogSchema),
  notification_templates: z.array(notificationTemplateSchema),
  notification_tasks: z.array(notificationTaskSchema),
  leave_requests: z.array(leaveRequestSchema),
  reschedule_actions: z.array(rescheduleActionSchema),
  reminders: z.array(reminderSchema),
  doctor_location_logs: z.array(doctorLocationLogSchema)
});

export type AppDb = z.infer<typeof appDbSchema>;
