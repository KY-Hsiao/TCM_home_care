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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常情境會先觸發逼近確認，再由醫師確認後完成離開並記錄停用中的通知流程", () => {
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
    expect(proximitySchedule.status).toBe("proximity_pending");

    harness.services.visitAutomation.confirmArrival("vs-015", "doctor");
    harness.services.visitAutomation.recordDoctorFeedback("vs-015", "normal");

    vi.advanceTimersByTime(1200);

    const updatedRecord = harness.repositories.visitRepository.getVisitRecordByScheduleId("vs-015");
    const updatedSchedule = harness.repositories.visitRepository.getScheduleDetail("vs-015")!.schedule;

    expect(updatedRecord?.arrival_time).not.toBeNull();
    expect(updatedRecord?.departure_from_patient_home_time).not.toBeNull();
    expect(updatedSchedule.status).toBe("completed");
    expect(updatedSchedule.geofence_status).toBe("completed");
    expect(harness.repositories.notificationRepository.getTasks().length).toBe(initialTaskCount);
    expect(
      harness.services.visitAutomation
        .getTrackingState(detail.schedule.id)
        ?.eventLog.some(
          (entry) =>
            entry.includes("通知任務功能已停用") ||
            entry.includes("家屬追蹤訊息功能已停用")
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

    expect(familyTasks).toHaveLength(0);
    expect(
      harness.services.visitAutomation
        .getTrackingState(detail.schedule.id)
        ?.eventLog.some(
          (entry) =>
            entry.includes("家屬通知功能已停用") ||
            entry.includes("家屬追蹤訊息功能已停用")
        )
    ).toBe(true);
  });
});
