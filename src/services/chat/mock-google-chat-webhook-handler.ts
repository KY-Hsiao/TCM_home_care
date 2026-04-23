import type { ContactLog } from "../../domain/models";
import type { ServicesContextDeps, WebhookHandler } from "../types";

function buildContactLog(
  input: {
    patientId: string;
    scheduleId: string | null;
    caregiverId: string | null;
    message: string;
    subject: string;
    outcome: string;
    doctorId: string | null;
    adminUserId: string | null;
  }
): ContactLog {
  const now = new Date().toISOString();
  return {
    id: `cl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    patient_id: input.patientId,
    visit_schedule_id: input.scheduleId,
    caregiver_id: input.caregiverId,
    doctor_id: input.doctorId,
    admin_user_id: input.adminUserId,
    channel: "google_chat",
    subject: input.subject,
    content: input.message,
    outcome: input.outcome,
    contacted_at: now,
    created_at: now,
    updated_at: now
  };
}

export function createMockGoogleChatWebhookHandler(deps: ServicesContextDeps): WebhookHandler {
  return {
    handleBinding(input) {
      deps.getRepositories().patientRepository.upsertCaregiverChatBinding(input.caregiverId, {
        googleChatUserId: input.googleChatUserId,
        googleAccountEmail: input.googleAccountEmail,
        googleAccountLoggedIn: true,
        displayName: input.displayName,
        isActive: true
      });
    },
    handleMessage(input) {
      const repositories = deps.getRepositories();
      repositories.notificationRepository.updateTaskStatus(input.taskId, {
        status: "replied",
        replyExcerpt: input.message,
        replyCode: input.action
      });
      repositories.contactRepository.createContactLog(
        buildContactLog({
          patientId: input.patientId,
          scheduleId: input.scheduleId,
          caregiverId: input.caregiverId,
          message: input.message,
          subject: "Google Chat 流程回覆",
          outcome: "已寫回通知任務與聯絡紀錄。",
          doctorId: null,
          adminUserId: deps.getSession().activeAdminId
        })
      );
    },
    handlePostback(input) {
      const repositories = deps.getRepositories();
      if (input.scheduleId) {
        if (input.action === "doctor_arrived_confirmed") {
          repositories.visitRepository.confirmArrival(input.scheduleId, "doctor");
        }
        if (input.action === "doctor_feedback_normal") {
          repositories.visitRepository.confirmArrival(input.scheduleId, "doctor");
          repositories.visitRepository.recordVisitFeedback(input.scheduleId, "normal");
        }
        if (input.action === "doctor_feedback_absent") {
          repositories.visitRepository.confirmArrival(input.scheduleId, "doctor");
          repositories.visitRepository.recordVisitFeedback(input.scheduleId, "absent");
        }
        if (input.action === "doctor_feedback_admin") {
          repositories.visitRepository.confirmArrival(input.scheduleId, "doctor");
          repositories.visitRepository.recordVisitFeedback(input.scheduleId, "admin_followup");
        }
        if (input.action === "doctor_feedback_urgent") {
          repositories.visitRepository.confirmArrival(input.scheduleId, "doctor");
          repositories.visitRepository.recordVisitFeedback(input.scheduleId, "urgent");
        }
        if (input.action === "doctor_visit_finished") {
          repositories.visitRepository.confirmDeparture(input.scheduleId, "doctor");
        }
      }

      const outcome =
        input.action === "approve"
          ? "流程已確認可配合。"
          : input.action === "reschedule_request"
            ? "流程提出改期需求。"
            : input.action === "doctor_feedback_normal"
              ? "醫師回覆正常看診。"
              : input.action === "doctor_feedback_absent"
                ? "醫師回覆不在家。"
                : input.action === "doctor_feedback_admin"
                  ? "醫師回覆行政追蹤。"
                  : input.action === "doctor_feedback_urgent"
                    ? "醫師回覆緊急處置。"
                    : input.action === "doctor_arrived_confirmed"
                    ? "醫師已確認抵達。"
                    : input.action === "doctor_visit_finished"
                      ? "醫師已確認離開。"
            : "流程透過 Google Chat 卡片按鈕留言。";
      this.handleMessage({
        ...input,
        message: input.message || outcome,
        action: "message"
      });
    },
    handleFamilyFormSubmit(input) {
      const repositories = deps.getRepositories();
      const summary = Object.entries(input.formData)
        .map(([key, value]) => `${key}: ${value}`)
        .join(" / ");
      repositories.notificationRepository.updateTaskStatus(input.taskId, {
        status: "replied",
        replyExcerpt: summary || input.message
      });
      repositories.contactRepository.createContactLog(
        buildContactLog({
          patientId: input.patientId,
          scheduleId: input.scheduleId,
          caregiverId: input.caregiverId,
          message: summary || input.message,
          subject: "Google Chat 流程表單提交",
          outcome: "已寫回 ContactLog / NotificationTask mock 流程。",
          doctorId: null,
          adminUserId: deps.getSession().activeAdminId
        })
      );
    }
  };
}
