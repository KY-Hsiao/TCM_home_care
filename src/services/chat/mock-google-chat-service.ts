import type { NotificationTask } from "../../domain/models";
import type {
  ChatServiceAdapter,
  ChatNotificationEvent,
  ServicesContextDeps,
  WebhookReplyInput
} from "../types";

export function createMockGoogleChatServiceAdapter(
  deps: ServicesContextDeps
): ChatServiceAdapter {
  return {
    sendNotification(event: ChatNotificationEvent) {
      const repositories = deps.getRepositories();
      const now = new Date().toISOString();
      const task: NotificationTask = {
        id: `nt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        template_id: event.payload.templateCode,
        patient_id: event.patient.id,
        caregiver_id: event.caregiverId,
        visit_schedule_id: event.schedule.id,
        status: "awaiting_reply",
        channel: "google_chat",
        scheduled_send_at: now,
        sent_at: now,
        recipient_name: event.recipientName,
        recipient_role: event.recipientRole,
        recipient_target: event.recipientTarget,
        trigger_type: event.triggerType ?? event.payload.eventType,
        preview_payload: {
          ...event.payload.previewPayload,
          subject: event.payload.subject,
          body: event.payload.body,
          family_entry_url: this.buildFamilyEntryUrl({
            patientId: event.patient.id,
            scheduleId: event.schedule.id
          }),
          card_actions: event.payload.actions.map((item) => item.label).join(" / ")
        },
        reply_excerpt: null,
        reply_code: null,
        failure_reason: null,
        linked_tracking_session_id: event.linkedTrackingSessionId ?? event.schedule.id,
        created_at: now,
        updated_at: now
      };
      repositories.notificationRepository.createTask(task);
      return task;
    },
    replyToEvent(input: WebhookReplyInput) {
      const repositories = deps.getRepositories();
      const targetTask = repositories.notificationRepository
        .getTasks()
        .find((task) => task.id === input.taskId);

      if (!targetTask) {
        return undefined;
      }

      repositories.notificationRepository.updateTaskStatus(targetTask.id, {
        status: "replied",
        replyExcerpt: input.message
      });
      return repositories.notificationRepository
        .getTasks()
        .find((task) => task.id === input.taskId);
    },
    buildFamilyEntryUrl(context) {
      const query = new URLSearchParams();
      if (context.patientId) {
        query.set("patientId", context.patientId);
      }
      if (context.scheduleId) {
        query.set("scheduleId", context.scheduleId);
      }
      if (context.taskId) {
        query.set("taskId", context.taskId);
      }
      if (context.action) {
        query.set("action", context.action);
      }
      return `/admin/patients${query.toString() ? `?${query}` : ""}`;
    },
    supports(feature) {
      return ["card_message", "button_actions", "external_form_link", "member_binding"].includes(feature);
    }
  };
}
