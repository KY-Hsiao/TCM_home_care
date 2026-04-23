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
    const targetTask = harness.repositories.notificationRepository
      .getTasks()
      .find((task) => task.id === "nt-014")!;

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
