import { describe, expect, it } from "vitest";
import { createSeedDb } from "../data/seed";
import { buildTodayScheduleRisks } from "./schedule-risk";

describe("buildTodayScheduleRisks", () => {
  it("用 seed/mock 規則產生今日行程風險提示", () => {
    const db = createSeedDb();
    const today = db.visit_schedules.find((schedule) => schedule.id === "vs-002")!.scheduled_start_at.slice(0, 10);
    const risks = buildTodayScheduleRisks({
      db,
      referenceDate: today,
      now: new Date(`${today}T17:30:00+08:00`),
      limit: 20
    });

    expect(risks.map((risk) => risk.title)).toEqual(
      expect.arrayContaining(["可能延誤", "路線過長", "缺 LINE 綁定"])
    );
  });

  it("會提示缺地址座標與醫師請假影響", () => {
    const db = createSeedDb();
    const routeDate = "2026-05-20";
    db.visit_schedules = [
      {
        ...db.visit_schedules[0],
        id: "vs-risk-coordinate",
        patient_id: "pat-011",
        assigned_doctor_id: "doc-001",
        primary_caregiver_id: "cg-014",
        scheduled_start_at: `${routeDate}T09:00:00+08:00`,
        scheduled_end_at: `${routeDate}T10:00:00+08:00`,
        home_latitude_snapshot: null,
        home_longitude_snapshot: null,
        geofence_status: "coordinate_missing",
        status: "scheduled"
      }
    ];
    db.saved_route_plans = [];
    db.leave_requests = [
      {
        id: "leave-risk",
        doctor_id: "doc-001",
        start_date: routeDate,
        end_date: routeDate,
        reason: "臨時請假",
        status: "pending",
        handoff_note: "需改派",
        rejection_reason: null,
        created_at: `${routeDate}T07:00:00+08:00`,
        updated_at: `${routeDate}T07:00:00+08:00`
      }
    ];

    const risks = buildTodayScheduleRisks({
      db,
      referenceDate: routeDate,
      now: new Date(`${routeDate}T08:00:00+08:00`)
    });

    expect(risks.map((risk) => risk.title)).toEqual(
      expect.arrayContaining(["缺地址座標", "醫師請假影響"])
    );
  });
});
