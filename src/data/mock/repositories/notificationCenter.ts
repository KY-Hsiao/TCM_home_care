import type {
  AppDb,
  LeaveRequest,
  NotificationCenterItem,
  NotificationTask,
  Reminder
} from "../../../domain/models";

function trimPayloadValues(payload: Record<string, string>) {
  return Object.values(payload)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function upsertNotificationCenterItem(db: AppDb, item: NotificationCenterItem) {
  const index = db.notification_center_items.findIndex((entry) => entry.id === item.id);
  if (index < 0) {
    return [item, ...db.notification_center_items];
  }
  return db.notification_center_items.map((entry, entryIndex) =>
    entryIndex === index ? item : entry
  );
}

export function buildNotificationCenterItemFromReminder(
  db: AppDb,
  reminder: Reminder
): NotificationCenterItem {
  const linkedSchedule = reminder.related_visit_schedule_id
    ? db.visit_schedules.find((schedule) => schedule.id === reminder.related_visit_schedule_id)
    : undefined;
  const sourceType = reminder.title.startsWith("異常個案｜")
    ? "patient_exception"
    : "reminder";

  return {
    id: `nc-reminder-${reminder.id}`,
    role: reminder.role,
    owner_user_id:
      reminder.role === "doctor" ? linkedSchedule?.assigned_doctor_id ?? null : null,
    source_type: sourceType,
    title: reminder.title,
    content: reminder.detail,
    linked_patient_id: linkedSchedule?.patient_id ?? null,
    linked_visit_schedule_id: reminder.related_visit_schedule_id,
    linked_doctor_id: linkedSchedule?.assigned_doctor_id ?? null,
    linked_leave_request_id: null,
    status: reminder.status,
    is_unread: reminder.status === "pending",
    reply_text: null,
    reply_updated_at: null,
    reply_updated_by_role: null,
    created_at: reminder.created_at,
    updated_at: reminder.updated_at
  };
}

export function buildNotificationCenterItemFromTask(
  db: AppDb,
  task: NotificationTask
): NotificationCenterItem {
  const linkedSchedule = task.visit_schedule_id
    ? db.visit_schedules.find((schedule) => schedule.id === task.visit_schedule_id)
    : undefined;
  const payloadValues = trimPayloadValues(task.preview_payload);
  const title =
    payloadValues[0] ??
    task.recipient_name ??
    (task.trigger_type ? `系統通知｜${task.trigger_type}` : "系統通知");
  const content =
    payloadValues.slice(1).join(" / ") ||
    payloadValues[0] ||
    task.trigger_type ||
    "站內系統通知";

  return {
    id: `nc-task-${task.id}`,
    role: task.recipient_role,
    owner_user_id:
      task.recipient_role === "doctor" ? linkedSchedule?.assigned_doctor_id ?? null : null,
    source_type: "system_notification",
    title,
    content,
    linked_patient_id: task.patient_id,
    linked_visit_schedule_id: task.visit_schedule_id,
    linked_doctor_id: linkedSchedule?.assigned_doctor_id ?? null,
    linked_leave_request_id: null,
    status: task.status,
    is_unread: ["pending", "sent", "awaiting_reply"].includes(task.status),
    reply_text: task.reply_excerpt,
    reply_updated_at: task.reply_excerpt ? task.updated_at : null,
    reply_updated_by_role: task.reply_excerpt ? task.recipient_role : null,
    created_at: task.created_at,
    updated_at: task.updated_at
  };
}

export function buildNotificationCenterItemFromLeaveRequest(
  db: AppDb,
  leaveRequest: LeaveRequest
): NotificationCenterItem {
  const doctor = db.doctors.find((item) => item.id === leaveRequest.doctor_id);
  return {
    id: `nc-leave-${leaveRequest.id}`,
    role: "admin",
    owner_user_id: null,
    source_type: "leave_request",
    title: `醫師請假申請｜${doctor?.name ?? leaveRequest.doctor_id}`,
    content: `${leaveRequest.start_date} 至 ${leaveRequest.end_date}｜${leaveRequest.reason}｜交班：${leaveRequest.handoff_note}`,
    linked_patient_id: null,
    linked_visit_schedule_id: null,
    linked_doctor_id: leaveRequest.doctor_id,
    linked_leave_request_id: leaveRequest.id,
    status: leaveRequest.status,
    is_unread: leaveRequest.status === "pending",
    reply_text: null,
    reply_updated_at: null,
    reply_updated_by_role: null,
    created_at: leaveRequest.created_at,
    updated_at: leaveRequest.updated_at
  };
}
