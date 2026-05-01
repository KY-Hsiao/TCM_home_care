import { describe, expect, it } from "vitest";
import { createRepositories } from "../../data/mock/repositories";
import { createSeedDb } from "../../data/seed";
import { createMockGoogleChatWebhookHandler } from "./mock-google-chat-webhook-handler";

function createHarness() {
  let db = createSeedDb();
  const repositories = createRepositories(
    () => db,
    (updater) => {
      db = updater(db);
    }
  );
  const session = {
    role: "admin" as const,
    activeDoctorId: "doc-001",
    activeAdminId: "admin-001",
    activeRoutePlanId: null,
    authenticatedDoctorId: null,
    authenticatedAdminId: "admin-001"
  };
  const webhook = createMockGoogleChatWebhookHandler({
    getRepositories: () => repositories,
    getSession: () => session
  });

  return {
    repositories,
    webhook,
    getDb: () => db
  };
}

describe("mock webhook handler", () => {
  it("會把 Google Chat / webhook 回覆寫回 NotificationTask 與 ContactLog", () => {
    const harness = createHarness();
    const targetSchedule = harness
      .getDb()
      .visit_schedules.find((schedule) => schedule.id === "vs-001")!;
    const targetTask = {
      id: "nt-webhook-test-001",
      template_id: "tpl-008",
      patient_id: targetSchedule.patient_id,
      caregiver_id: targetSchedule.primary_caregiver_id,
      visit_schedule_id: targetSchedule.id,
      status: "awaiting_reply" as const,
      channel: "google_chat" as const,
      scheduled_send_at: "2026-04-30T09:00:00+08:00",
      sent_at: "2026-04-30T09:00:00+08:00",
      recipient_name: "測試家屬",
      recipient_role: "caregiver" as const,
      recipient_target: "google-chat:test",
      trigger_type: "doctor_arrival_feedback",
      preview_payload: { patient_name: "王麗珠" },
      reply_excerpt: null,
      reply_code: null,
      failure_reason: null,
      linked_tracking_session_id: null,
      created_at: "2026-04-30T09:00:00+08:00",
      updated_at: "2026-04-30T09:00:00+08:00"
    };
    harness.repositories.notificationRepository.createTask(targetTask);

    harness.webhook.handleMessage({
      taskId: targetTask.id,
      patientId: targetTask.patient_id,
      scheduleId: targetTask.visit_schedule_id,
      caregiverId: targetTask.caregiver_id,
      message: "醫師已回覆現場狀態",
      action: "message"
    });

    const updatedTask = harness.repositories.notificationRepository
      .getTasks()
      .find((task) => task.id === targetTask.id)!;
    const contactLog = harness.repositories.contactRepository
      .getContactLogsByScheduleId(
      targetTask.visit_schedule_id!
      )
      .find(
        (log) =>
          log.subject === "Google Chat 流程回覆" && log.content === "醫師已回覆現場狀態"
      );

    expect(updatedTask.status).toBe("replied");
    expect(updatedTask.reply_excerpt).toBe("醫師已回覆現場狀態");
    expect(contactLog?.subject).toBe("Google Chat 流程回覆");
  });
});
