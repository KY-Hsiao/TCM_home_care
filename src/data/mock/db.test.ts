import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDb, MOCK_DB_STORAGE_KEY } from "./db";
import { createSeedDb } from "../seed";
import { createRepositories } from "./repositories";

describe("mock db loader", () => {
  beforeEach(() => {
    vi.useRealTimers();
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

  it("新增服務中個案不會直接塞入已實行路線排程", () => {
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

      expect(result.scheduleSynced).toBe(false);
      expect(result.skippedReason).toBe("請到排程管理頁建立或實行路線");
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
    expect(db.visit_schedules.some((schedule) => schedule.patient_id === "pat-limit-overflow")).toBe(false);
  });

  it("會自動清掉超過一個月的行政端醫師路線暫存", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T09:00:00+08:00"));

    const seeded = createSeedDb();
    const staleRoutePlan = {
      ...seeded.saved_route_plans[0],
      id: "route-expired-001",
      route_group_id: "route-expired-001",
      route_name: "過期路線",
      route_date: "2026-03-20",
      saved_at: "2026-03-20T08:00:00+08:00",
      created_at: "2026-03-20T08:00:00+08:00",
      updated_at: "2026-03-20T08:00:00+08:00"
    };
    const freshRoutePlan = {
      ...seeded.saved_route_plans[0],
      id: "route-fresh-001",
      route_group_id: "route-fresh-001",
      route_name: "保留路線",
      route_date: "2026-04-15",
      saved_at: "2026-04-15T08:00:00+08:00",
      created_at: "2026-04-15T08:00:00+08:00",
      updated_at: "2026-04-15T08:00:00+08:00"
    };

    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seeded,
        saved_route_plans: [staleRoutePlan, freshRoutePlan]
      })
    );

    const db = loadDb();
    const persistedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");

    expect(db.saved_route_plans.map((routePlan) => routePlan.id)).toContain("route-fresh-001");
    expect(db.saved_route_plans.map((routePlan) => routePlan.id)).not.toContain("route-expired-001");
    expect(persistedDb.saved_route_plans.map((routePlan: { id: string }) => routePlan.id)).toEqual([
      "route-fresh-001"
    ]);
  });

  it("會自動修正既有旗山醫院路線起終點舊座標", () => {
    const seeded = createSeedDb();
    const legacyRoutePlan = {
      ...seeded.saved_route_plans[0],
      start_address: "旗山醫院",
      start_latitude: 22.88794,
      start_longitude: 120.48341,
      end_address: "旗山醫院",
      end_latitude: 22.88794,
      end_longitude: 120.48341
    };

    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seeded,
        saved_route_plans: [legacyRoutePlan]
      })
    );

    const db = loadDb();
    const persistedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    const migratedRoutePlan = db.saved_route_plans[0];
    const persistedRoutePlan = persistedDb.saved_route_plans[0];

    expect(migratedRoutePlan.start_latitude).toBe(22.880693);
    expect(migratedRoutePlan.start_longitude).toBe(120.483276);
    expect(migratedRoutePlan.end_latitude).toBe(22.880693);
    expect(migratedRoutePlan.end_longitude).toBe(120.483276);
    expect(persistedRoutePlan.start_latitude).toBe(22.880693);
    expect(persistedRoutePlan.end_longitude).toBe(120.483276);
  });
});
