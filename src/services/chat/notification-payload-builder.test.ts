import { describe, expect, it } from "vitest";
import { createSeedDb } from "../../data/seed";
import { createRepositories } from "../../data/mock/repositories";
import { createNotificationPayloadBuilder } from "./notification-payload-builder";

function buildDetail() {
  let db = createSeedDb();
  const repositories = createRepositories(
    () => db,
    (updater) => {
      db = updater(db);
    }
  );
  return repositories.visitRepository.getScheduleDetail("vs-015")!;
}

describe("notification payload builder", () => {
  it("會為六種通知事件建立 payload", () => {
    const builder = createNotificationPayloadBuilder();
    const detail = buildDetail();
    const types = [
      "visit_reminder",
      "visit_today",
      "visit_delay",
      "visit_reschedule",
      "visit_coverage",
      "visit_completed"
    ] as const;

    const payloads = types.map((type) =>
      builder.buildPayload({
        type,
        detail,
        delayMinutes: 15,
        coverageDoctorName: "代理醫師",
        rescheduleNote: "改到下週二上午",
        summary: "訪後摘要內容"
      })
    );

    expect(payloads).toHaveLength(6);
    expect(payloads.every((item) => item.subject.length > 0)).toBe(true);
    expect(payloads.every((item) => item.actions.length > 0)).toBe(true);
    expect(payloads[0].templateCode).toBe("visit_reminder_in_app");
    expect(payloads[0].cardDraft).toContain("cardsV2");
    expect(payloads[0].previewPayload.address).toBe(detail.schedule.address_snapshot);
    expect(payloads[5].previewPayload.summary).toBe("訪後摘要內容");
  });
});
