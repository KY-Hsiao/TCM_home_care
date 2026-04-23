import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb } from "./db";
import { createSeedDb } from "../seed";
import { createRepositories } from "./repositories";

describe("mock db loader", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("遇到損壞的 localStorage 資料時會自動回復 seed db", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.localStorage.setItem("tcm-home-care-mvp-db", "{invalid-json");

    const db = loadDb();

    expect(db.patients.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem("tcm-home-care-mvp-db")).toContain("\"patients\"");
    expect(
      Object.keys(window.localStorage).some((key) =>
        key.startsWith("tcm-home-care-mvp-db-recovery-")
      )
    ).toBe(true);

    consoleErrorSpy.mockRestore();
  });

  it("同一位醫師同一服務時段在同一天最多只會排入 8 位個案", () => {
    let db = createSeedDb();
    const repositories = createRepositories(
      () => db,
      (updater) => {
        db = updater(db);
      }
    );

    for (let index = 0; index < 8; index += 1) {
      const result = repositories.patientRepository.upsertPatient({
        ...db.patients[0],
        id: `pat-limit-${index}`,
        chart_number: "",
        name: `測試個案${index}`,
        service_needs: ["中藥"],
        preferred_service_slot: "上午 09:00-13:00",
        preferred_doctor_id: "doc-001",
        address: `台北市文山區測試路 ${index + 1} 號`,
        home_address: `台北市文山區測試路 ${index + 1} 號`,
        location_keyword: "同住址",
        google_maps_link: `https://example.com/${index}`,
        status: "active"
      });

      expect(result.scheduleSynced).toBe(true);
    }

    repositories.patientRepository.upsertPatient({
      ...db.patients[0],
      id: "pat-limit-overflow",
      chart_number: "",
      name: "超額個案",
      service_needs: ["針灸"],
      preferred_service_slot: "上午 09:00-13:00",
      preferred_doctor_id: "doc-001",
      address: "台北市文山區測試路 999 號",
      home_address: "台北市文山區測試路 999 號",
      location_keyword: "同住址",
      google_maps_link: "https://example.com/overflow",
      status: "active"
    });

    const sameDaySlotSchedules = db.visit_schedules.filter(
      (schedule) =>
        schedule.assigned_doctor_id === "doc-001" &&
        schedule.service_time_slot === "上午 09:00-13:00" &&
        schedule.scheduled_start_at.slice(0, 10) === db.visit_schedules
          .find((item) => item.patient_id === "pat-limit-0")
          ?.scheduled_start_at.slice(0, 10)
    );

    expect(sameDaySlotSchedules.length).toBeLessThanOrEqual(8);
  });
});
