import { adminUsersSeed } from "./admins";
import { caregiverChatBindingsSeed, caregiversSeed } from "./caregivers";
import { doctorsSeed } from "./doctors";
import { contactLogsSeed } from "./logs";
import { notificationTasksSeed, notificationTemplatesSeed } from "./notifications";
import { patientsSeed } from "./patients";
import { savedRoutePlansSeed } from "./route-plans";
import {
  doctorLocationLogsSeed,
  leaveRequestsSeed,
  remindersSeed,
  rescheduleActionsSeed,
  visitRecordsSeed,
  visitSchedulesSeed
} from "./visits";
import { appDbSchema, type AppDb } from "../../domain/models";

export function createSeedDb(): AppDb {
  return appDbSchema.parse({
    patients: patientsSeed,
    caregivers: caregiversSeed,
    caregiver_chat_bindings: caregiverChatBindingsSeed,
    doctors: doctorsSeed,
    admin_users: adminUsersSeed,
    visit_schedules: visitSchedulesSeed,
    saved_route_plans: savedRoutePlansSeed,
    visit_records: visitRecordsSeed,
    contact_logs: contactLogsSeed,
    notification_templates: notificationTemplatesSeed,
    notification_tasks: notificationTasksSeed,
    leave_requests: leaveRequestsSeed,
    reschedule_actions: rescheduleActionsSeed,
    reminders: remindersSeed,
    doctor_location_logs: doctorLocationLogsSeed
  });
}
