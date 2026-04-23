import { describe, expect, it } from "vitest";
import { applyVisitRecordRules } from "./rules";

describe("applyVisitRecordRules", () => {
  it("會依 arrival_time 自動推導治療開始與結束時間", () => {
    const record = applyVisitRecordRules(
      {
        id: "vr-1",
        visit_schedule_id: "vs-1",
        departure_time: "2026-04-20T08:00:00.000Z",
        arrival_time: "2026-04-20T08:30:00.000Z",
        departure_from_patient_home_time: "2026-04-20T09:15:00.000Z",
        chief_complaint: "腰痛",
        sleep_status: "普通",
        appetite_status: "普通",
        bowel_movement_status: "普通",
        pain_status: "疼痛下降",
        energy_status: "可活動",
        physician_assessment: "持續追蹤",
        treatment_provided: "針灸與衛教",
        doctor_note: "",
        caregiver_feedback: "",
        follow_up_note: "",
        next_visit_suggestion_date: null,
        visit_feedback_code: null,
        visit_feedback_at: null,
        family_followup_status: "not_needed",
        family_followup_sent_at: null,
        created_at: "2026-04-20T08:00:00.000Z",
        updated_at: "2026-04-20T08:00:00.000Z"
      },
      30
    );

    expect(record.treatment_start_time).toBe("2026-04-20T08:30:00.000Z");
    expect(record.treatment_end_time).toBe("2026-04-20T09:00:00.000Z");
    expect(record.stay_duration_minutes).toBe(45);
    expect(record.treatment_duration_minutes).toBe(30);
  });

  it("手動調整時長時會標記 manually adjusted", () => {
    const record = applyVisitRecordRules(
      {
        id: "vr-2",
        visit_schedule_id: "vs-2",
        departure_time: null,
        arrival_time: "2026-04-20T08:30:00.000Z",
        departure_from_patient_home_time: null,
        chief_complaint: "失眠",
        sleep_status: "待追蹤",
        appetite_status: "普通",
        bowel_movement_status: "普通",
        pain_status: "無",
        energy_status: "疲倦",
        physician_assessment: "需延長療程",
        treatment_provided: "針灸",
        doctor_note: "",
        caregiver_feedback: "",
        follow_up_note: "",
        next_visit_suggestion_date: null,
        visit_feedback_code: null,
        visit_feedback_at: null,
        family_followup_status: "not_needed",
        family_followup_sent_at: null,
        created_at: "2026-04-20T08:00:00.000Z",
        updated_at: "2026-04-20T08:00:00.000Z",
        treatment_duration_minutes: 45,
        treatment_duration_manually_adjusted: true
      },
      30
    );

    expect(record.treatment_duration_manually_adjusted).toBe(true);
    expect(record.treatment_end_time).toBe("2026-04-20T09:15:00.000Z");
  });
});
