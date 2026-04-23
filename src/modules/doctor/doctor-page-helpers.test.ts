import { describe, expect, it } from "vitest";
import type { VisitRecord, VisitSchedule } from "../../domain/models";
import type { TrackingRuntime } from "../../services/types";
import {
  buildReadonlySummary,
  isVisitUnlocked,
  shouldPromptArrival
} from "./doctor-page-helpers";

function buildSchedule(
  id: string,
  routeOrder: number,
  status: VisitSchedule["status"]
): VisitSchedule {
  return {
    id,
    patient_id: `pat-${routeOrder}`,
    assigned_doctor_id: "doc-001",
    primary_caregiver_id: `cg-${routeOrder}`,
    scheduled_start_at: `2026-04-23T0${routeOrder}:00:00.000Z`,
    scheduled_end_at: `2026-04-23T0${routeOrder + 1}:00:00.000Z`,
    estimated_treatment_minutes: 30,
    address_snapshot: "台北市文山區示範路 1 號",
    location_keyword_snapshot: "同住址",
    home_latitude_snapshot: 25.01,
    home_longitude_snapshot: 121.52,
    arrival_radius_meters: 100,
    geofence_status: "idle",
    google_maps_link: "https://maps.google.com",
    area: "台北市文山區",
    service_time_slot: "星期四上午",
    route_order: routeOrder,
    route_group_id: "doc-001-2026-04-23",
    tracking_mode: "hybrid",
    tracking_started_at: null,
    tracking_stopped_at: null,
    arrival_confirmed_by: null,
    departure_confirmed_by: null,
    last_feedback_code: null,
    reminder_tags: [],
    status,
    visit_type: "例行訪視",
    note: "測試資料",
    created_at: "2026-04-23T00:00:00.000Z",
    updated_at: "2026-04-23T00:00:00.000Z"
  };
}

function buildRuntime(overrides?: Partial<TrackingRuntime>): TrackingRuntime {
  return {
    scheduleId: "vs-001",
    doctorId: "doc-001",
    patientId: "pat-001",
    patientName: "王小明",
    targetPatientId: "pat-001",
    routeOrder: 1,
    scenarioId: "normal_arrival_complete",
    watchStatus: "running",
    geofenceStatus: "tracking",
    latestSample: null,
    latestDistanceMeters: null,
    latestAccuracy: 15,
    permissionState: "granted",
    fallbackMessage: null,
    startedAt: null,
    completedAt: null,
    lastUpdatedAt: null,
    proximityTriggeredAt: null,
    arrivalConfirmationPending: false,
    stopReason: null,
    googleShareFallbackActive: false,
    doctorFeedbackCode: null,
    familyFollowUpStatus: "not_needed",
    eventLog: [],
    samplesProcessed: 0,
    insideCandidateCount: 0,
    insideCandidateStartedAt: null,
    outsideCandidateCount: 0,
    outsideCandidateStartedAt: null,
    ...overrides
  };
}

describe("doctor page helpers", () => {
  it("前一站尚未完成時，下一站應維持鎖定", () => {
    const schedules = [
      buildSchedule("vs-001", 1, "tracking"),
      buildSchedule("vs-002", 2, "scheduled")
    ];

    expect(isVisitUnlocked(schedules, "vs-002", undefined)).toBe(false);
  });

  it("若本站已經開始出發，就算前一站未完成也應維持解鎖", () => {
    const schedules = [
      buildSchedule("vs-001", 1, "tracking"),
      buildSchedule("vs-002", 2, "scheduled")
    ];
    const record = {
      departure_time: "2026-04-23T09:00:00.000Z"
    } as VisitRecord;

    expect(isVisitUnlocked(schedules, "vs-002", record)).toBe(true);
  });

  it("逼近患者住家時應提示可按已抵達", () => {
    const schedule = buildSchedule("vs-001", 1, "tracking");

    expect(
      shouldPromptArrival(
        schedule,
        buildRuntime({
          latestDistanceMeters: 80
        })
      )
    ).toBe(true);
  });

  it("距離仍遠且未進入 proximity 狀態時，不應提示已抵達", () => {
    const schedule = buildSchedule("vs-001", 1, "tracking");

    expect(
      shouldPromptArrival(
        schedule,
        buildRuntime({
          latestDistanceMeters: 260
        })
      )
    ).toBe(false);
  });

  it("時間摘要會包含車程時間與離開患者時間", () => {
    const summary = buildReadonlySummary({
      id: "vr-001",
      visit_schedule_id: "vs-001",
      departure_time: "2026-04-23T08:00:00.000",
      arrival_time: "2026-04-23T08:18:00.000",
      departure_from_patient_home_time: "2026-04-23T09:05:00.000",
      stay_duration_minutes: 47,
      treatment_start_time: "2026-04-23T08:18:00.000",
      treatment_end_time: "2026-04-23T08:48:00.000",
      treatment_duration_minutes: 30,
      treatment_duration_manually_adjusted: false,
      chief_complaint: "",
      sleep_status: "",
      appetite_status: "",
      bowel_movement_status: "",
      pain_status: "",
      energy_status: "",
      inspection_tags: [],
      inspection_other: "",
      listening_tags: [],
      listening_other: "",
      inquiry_tags: [],
      inquiry_other: "",
      palpation_tags: [],
      palpation_other: "",
      physician_assessment: "",
      treatment_provided: "",
      doctor_note: "",
      caregiver_feedback: "",
      follow_up_note: "",
      medical_history_note: "",
      generated_record_text: "",
      next_visit_suggestion_date: null,
      visit_feedback_code: null,
      visit_feedback_at: null,
      family_followup_status: "not_needed",
      family_followup_sent_at: null,
      created_at: "2026-04-23T08:00:00.000",
      updated_at: "2026-04-23T09:05:00.000"
    });

    expect(summary.find((item) => item.label === "車程時間")?.value).toBe("18 分鐘");
    expect(summary.find((item) => item.label === "離開患者時間")?.value).toContain("2026/04/23 09:05");
  });
});
