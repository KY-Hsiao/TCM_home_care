import { describe, expect, it } from "vitest";
import { createRepositories } from "../../data/mock/repositories";
import { createSeedDb } from "../../data/seed";
import type { AppDb } from "../../domain/models";
import { createMockTeamCommunicationRepository } from "./mock-team-communication-repository";

function createRepositoryWithDb(db: AppDb) {
  const repositories = createRepositories(
    () => db,
    (updater) => {
      db = updater(db);
    }
  );
  return createMockTeamCommunicationRepository({
    db,
    repositories
  });
}

describe("mockTeamCommunicationRepository", () => {
  it("團隊通訊只列出過往 24 小時內的訊息", async () => {
    const db = createSeedDb();
    const now = new Date();
    const recentAt = now.toISOString();
    const expiredAt = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    db.contact_logs.push(
      {
        id: "staff-recent",
        patient_id: null,
        visit_schedule_id: null,
        caregiver_id: null,
        doctor_id: "doc-001",
        admin_user_id: "admin-001",
        channel: "web_notice",
        subject: "院內對話｜近期訊息",
        content: "這是 24 小時內訊息。",
        outcome: "行政人員 已送出站內訊息，等待查看。",
        contacted_at: recentAt,
        created_at: recentAt,
        updated_at: recentAt
      },
      {
        id: "staff-expired",
        patient_id: null,
        visit_schedule_id: null,
        caregiver_id: null,
        doctor_id: "doc-001",
        admin_user_id: "admin-001",
        channel: "web_notice",
        subject: "院內對話｜過期訊息",
        content: "這是超過 24 小時的訊息。",
        outcome: "行政人員 已送出站內訊息，等待查看。",
        contacted_at: expiredAt,
        created_at: expiredAt,
        updated_at: expiredAt
      }
    );

    const repository = createRepositoryWithDb(db);
    const messages = await repository.listConversation({
      doctorId: "doc-001",
      adminUserId: "admin-001",
      viewerRole: "doctor",
      viewerUserId: "doc-001"
    });

    expect(messages.map((message) => message.id)).toContain("staff-recent");
    expect(messages.map((message) => message.id)).not.toContain("staff-expired");
  });

  it("團隊通訊未讀數不計入超過 24 小時的訊息", async () => {
    const db = createSeedDb();
    const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.notification_center_items.push({
      id: "nc-staff-expired",
      role: "doctor",
      owner_user_id: "doc-001",
      source_type: "manual_notice",
      title: "院內對話｜過期未讀",
      content: "團隊通訊過期訊息。",
      linked_patient_id: null,
      linked_visit_schedule_id: null,
      linked_doctor_id: "doc-001",
      linked_leave_request_id: null,
      status: "pending",
      is_unread: true,
      reply_text: null,
      reply_updated_at: null,
      reply_updated_by_role: null,
      created_at: expiredAt,
      updated_at: expiredAt
    });

    const repository = createRepositoryWithDb(db);

    await expect(
      repository.getUnreadCount({
        role: "doctor",
        userId: "doc-001",
        doctorId: "doc-001",
        adminUserId: "admin-001"
      })
    ).resolves.toBe(0);
  });
});
