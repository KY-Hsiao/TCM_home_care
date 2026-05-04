import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRepositories } from "../../data/mock/repositories";
import { createSeedDb } from "../../data/seed";
import { createAppServices } from "../index";

function createHarness() {
  let db = createSeedDb();
  const repositories = createRepositories(
    () => db,
    (updater) => {
      db = updater(db);
    }
  );
  const session = {
    role: "doctor" as const,
    activeDoctorId: "doc-001",
    activeAdminId: "admin-001",
    activeRoutePlanId: null,
    authenticatedDoctorId: "doc-001",
    authenticatedAdminId: null
  };
  const services = createAppServices({
    getRepositories: () => repositories,
    getSession: () => session
  });

  return {
    repositories,
    services
  };
}

describe("visit automation service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("正常情境會先記錄接近目的地時間，再由醫師手動確認抵達與離開", () => {
    const harness = createHarness();
    const detail = harness.repositories.visitRepository.getScheduleDetail("vs-015")!;
    const initialTaskCount = harness.repositories.notificationRepository.getTasks().length;
    const nextRecord = harness.repositories.visitRepository.startVisitTravel(detail.schedule.id);

    harness.services.visitAutomation.startTracking({
      ...detail,
      record: nextRecord ?? detail.record,
      schedule: {
        ...detail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });

    vi.advanceTimersByTime(1600);

    const proximitySchedule = harness.repositories.visitRepository.getScheduleDetail("vs-015")!.schedule;
    const proximityRuntime = harness.services.visitAutomation.getTrackingState(detail.schedule.id);
    expect(proximitySchedule.status).toBe("on_the_way");
    expect(proximityRuntime?.proximityTriggeredAt).not.toBeNull();

    harness.services.visitAutomation.confirmArrival("vs-015", "doctor");
    harness.services.visitAutomation.recordDoctorFeedback("vs-015", "normal");
    harness.services.visitAutomation.confirmDeparture("vs-015", "doctor");

    const updatedRecord = harness.repositories.visitRepository.getVisitRecordByScheduleId("vs-015");
    const updatedSchedule = harness.repositories.visitRepository.getScheduleDetail("vs-015")!.schedule;
    const locationLogs = harness.repositories.visitRepository.getDoctorLocationLogs(detail.doctor.id);

    expect(updatedRecord?.arrival_time).not.toBeNull();
    expect(updatedRecord?.departure_from_patient_home_time).not.toBeNull();
    expect(updatedRecord?.arrival_time).toBe(proximityRuntime?.proximityTriggeredAt);
    expect(updatedSchedule.status).toBe("completed");
    expect(updatedSchedule.geofence_status).toBe("completed");
    expect(locationLogs.some((log) => log.linked_visit_schedule_id === detail.schedule.id)).toBe(true);
    expect(harness.repositories.notificationRepository.getTasks().length).toBe(initialTaskCount);
    expect(
      harness.services.visitAutomation
        .getTrackingState(detail.schedule.id)
        ?.eventLog.some(
          (entry) =>
            entry.includes("已記錄接近目的地時間") ||
            entry.includes("手動確認抵達")
        )
    ).toBe(true);
  });

  it("低精度情境不應觸發抵達", () => {
    const harness = createHarness();
    const detail = harness.repositories.visitRepository.getScheduleDetail("vs-015")!;
    const nextRecord = harness.repositories.visitRepository.startVisitTravel(detail.schedule.id);
    harness.services.visitAutomation.configureTracking(detail.schedule.id, {
      scenarioId: "low_accuracy"
    });

    harness.services.visitAutomation.startTracking({
      ...detail,
      record: nextRecord ?? detail.record,
      schedule: {
        ...detail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });

    vi.advanceTimersByTime(2000);

    const updatedRecord = harness.repositories.visitRepository.getVisitRecordByScheduleId("vs-015");
    const updatedSchedule = harness.repositories.visitRepository.getScheduleDetail("vs-015")!.schedule;

    expect(updatedRecord?.arrival_time).toBeNull();
    expect(updatedSchedule.geofence_status).toBe("low_accuracy");
  });

  it("離開前一站時會自動發送下一站家屬 LINE 抵達前提醒", async () => {
    const harness = createHarness();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sentCount: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(
      "tcm-admin-api-token-settings",
      JSON.stringify({
        lineChannelAccessToken: "browser-line-token",
        lineChannelSecret: "",
        googleMapsApiKey: ""
      })
    );
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-next",
          displayName: "下一站家屬 LINE",
          lineUserId: "Unextstopaaaaaaaaaaaaaaaaaaaaaaaaa",
          linkedPatientIds: ["pat-007"],
          note: "主要照顧者",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );

    harness.services.visitAutomation.confirmArrival("vs-015", "doctor");
    harness.services.visitAutomation.recordDoctorFeedback("vs-015", "normal");
    harness.services.visitAutomation.confirmDeparture("vs-015", "doctor");
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/family-line/send",
      expect.objectContaining({
        method: "POST"
      })
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.subject).toBe("醫師即將抵達提醒");
    expect(requestBody.content).toContain("已完成前一站");
    expect(requestBody.recipients).toEqual([
      expect.objectContaining({
        caregiverId: "line-contact-next",
        patientId: "pat-007",
        doctorId: "doc-001",
        lineUserId: "Unextstopaaaaaaaaaaaaaaaaaaaaaaaaa"
      })
    ]);
    expect(requestBody.lineChannelAccessToken).toBe("browser-line-token");
    await vi.waitFor(() => {
      expect(harness.repositories.contactRepository.getContactLogsByScheduleId("vs-016")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channel: "line",
            outcome: "前一站離開後自動發送抵達前提醒"
          })
        ])
      );
    });
  });

  it("離開前一站時若本機沒有關聯名單，會先從後端 LINE 名單載入再自動發送", async () => {
    const harness = createHarness();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            contacts: [
              {
                userId: "Uremotecontactaaaaaaaaaaaaaaaaaaa",
                displayName: "後端保存家屬 LINE",
                linkedPatientIds: ["pat-007"],
                note: "主要照顧者",
                source: "webhook",
                updatedAt: "2026-05-01T00:00:00.000Z"
              }
            ]
          })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sentCount: 1 })
      });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(
      "tcm-admin-api-token-settings",
      JSON.stringify({
        lineChannelAccessToken: "browser-line-token",
        lineChannelSecret: "",
        googleMapsApiKey: ""
      })
    );

    harness.services.visitAutomation.confirmArrival("vs-015", "doctor");
    harness.services.visitAutomation.recordDoctorFeedback("vs-015", "normal");
    harness.services.visitAutomation.confirmDeparture("vs-015", "doctor");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/admin/family-line/contacts", { cache: "no-store" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/family-line/send",
      expect.objectContaining({ method: "POST" })
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(requestBody.recipients).toEqual([
      expect.objectContaining({
        caregiverName: "後端保存家屬 LINE",
        patientId: "pat-007",
        lineUserId: "Uremotecontactaaaaaaaaaaaaaaaaaaa"
      })
    ]);
    expect(window.localStorage.getItem("tcm-family-line-managed-contacts")).toContain("pat-007");
  });

  it("家屬相關流程移除後，仍不應建立任何家屬通知", () => {
    const harness = createHarness();
    const detail = harness.repositories.visitRepository.getScheduleDetail("vs-015")!;
    const nextRecord = harness.repositories.visitRepository.startVisitTravel(detail.schedule.id);

    harness.services.visitAutomation.startTracking({
      ...detail,
      record: nextRecord ?? detail.record,
      schedule: {
        ...detail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });

    vi.advanceTimersByTime(1600);

    harness.services.visitAutomation.confirmArrival("vs-015", "doctor");
    harness.services.visitAutomation.recordDoctorFeedback("vs-015", "absent");

    vi.advanceTimersByTime(1200);

    const familyTasks = harness.repositories.notificationRepository
      .getTasksByRecipientRole("caregiver")
      .filter(
        (task) =>
          task.linked_tracking_session_id === detail.schedule.id &&
          task.trigger_type.startsWith("family_followup_")
      );
    const updatedSchedule = harness.repositories.visitRepository.getScheduleDetail("vs-015")!.schedule;
    const runtime = harness.services.visitAutomation.getTrackingState(detail.schedule.id);

    expect(familyTasks).toHaveLength(0);
    expect(updatedSchedule.status).toBe("paused");
    expect(runtime?.stopReason).toBe("patient_absent");
    expect(runtime?.eventLog.some((entry) => entry.includes("醫師回覆：absent"))).toBe(true);
  });
});
