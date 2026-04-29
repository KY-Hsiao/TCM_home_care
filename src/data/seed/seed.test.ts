import { describe, expect, it } from "vitest";
import { createSeedDb } from ".";

describe("seed data", () => {
  it("符合 MVP 指定的最低資料量", () => {
    const db = createSeedDb();

    expect(db.doctors).toHaveLength(2);
    expect(db.admin_users).toHaveLength(2);
    expect(db.patients).toHaveLength(16);
    expect(db.visit_schedules.length).toBeGreaterThanOrEqual(20);
    expect(db.saved_route_plans.length).toBeGreaterThanOrEqual(2);
    expect(db.visit_records.length).toBeGreaterThanOrEqual(20);
    expect(db.contact_logs.length).toBeGreaterThanOrEqual(20);
    expect(db.notification_tasks).toHaveLength(0);
    expect(db.reminders).toHaveLength(0);
    expect(db.leave_requests).toHaveLength(0);
    expect(db.notification_center_items).toHaveLength(0);
    expect(db.doctor_location_logs.length).toBeGreaterThanOrEqual(30);
  });

  it("每位服務中的個案至少有一筆符合偏好服務時段的未取消排程", () => {
    const db = createSeedDb();

    db.patients
      .filter((patient) => patient.status === "active")
      .forEach((patient) => {
        expect(
          db.visit_schedules.some(
            (schedule) =>
              schedule.patient_id === patient.id &&
              schedule.status !== "cancelled" &&
              schedule.service_time_slot === patient.preferred_service_slot
          )
        ).toBe(true);
      });
  });
});
