import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "../../app/providers";
import { createSeedDb } from "../../data/seed";
import { toDateTimeLocalValue } from "../../shared/utils/format";
import { DoctorReturnRecordPage } from "./DoctorReturnRecordPage";

function renderWithProviders(page: ReactNode, initialEntry = "/doctor/return-records") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppProviders>{page}</AppProviders>
    </MemoryRouter>
  );
}

describe("DoctorReturnRecordPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  it("會顯示長照慢性臥床版四診選單，且勾選其他後出現輸入框", () => {
    renderWithProviders(<DoctorReturnRecordPage />);

    expect(screen.getByLabelText("主訴")).toBeInTheDocument();
    expect(screen.queryByLabelText("主訴其他內容")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("主訴"), {
      target: { value: "其他" }
    });

    expect(screen.queryByLabelText("提醒內容")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "加入提醒中心，讓醫師與行政後續追蹤" }));

    expect(screen.getByLabelText("主訴其他內容")).toBeInTheDocument();
    expect(screen.getByLabelText("提醒內容")).toBeInTheDocument();
    expect(screen.getByLabelText("相關外傷")).toBeInTheDocument();
    expect(screen.getByLabelText("病史其他內容")).toBeInTheDocument();

    const inspectionFieldset = screen.getByText("望").closest("fieldset");
    if (!inspectionFieldset) {
      throw new Error("找不到望診區塊");
    }

    expect(within(inspectionFieldset).getByLabelText("少神")).toBeInTheDocument();
    expect(within(inspectionFieldset).getByLabelText("舌苔黃膩")).toBeInTheDocument();
    expect(screen.queryByLabelText("望 其他")).not.toBeInTheDocument();

    fireEvent.click(within(inspectionFieldset).getByLabelText("其他"));

    expect(screen.getByLabelText("望 其他")).toBeInTheDocument();
  });

  it("會帶入上一筆四診其他內容", () => {
    const seeded = createSeedDb();
    seeded.visit_records.unshift({
      id: "vr-return-seeded",
      visit_schedule_id: "vs-024",
      departure_time: null,
      arrival_time: null,
      departure_from_patient_home_time: null,
      stay_duration_minutes: 30,
      treatment_start_time: "2026-04-24T01:00:00.000Z",
      treatment_end_time: "2026-04-24T01:30:00.000Z",
      treatment_duration_minutes: 30,
      treatment_duration_manually_adjusted: true,
      chief_complaint: "翻身不適",
      sleep_status: "",
      appetite_status: "",
      bowel_movement_status: "",
      pain_status: "",
      energy_status: "",
      inspection_tags: ["少神", "其他"],
      inspection_other: "眼神反應較慢",
      listening_tags: ["其他"],
      listening_other: "夜間痰聲明顯",
      inquiry_tags: ["疲倦乏力"],
      inquiry_other: "",
      palpation_tags: ["脈細"],
      palpation_other: "",
      physician_assessment: "測試用病歷",
      treatment_provided: "測試",
      doctor_note: "測試",
      caregiver_feedback: "",
      follow_up_note: "延續上次病史",
      medical_history_note: "延續上次病史",
      generated_record_text:
        "1150424 09000930\n四診：望 少神、其他：眼神反應較慢；聞 其他：夜間痰聲明顯；問 疲倦乏力；切 脈細\n主訴：翻身不適\n病史：延續上次病史",
      next_visit_suggestion_date: null,
      visit_feedback_code: null,
      visit_feedback_at: null,
      family_followup_status: "not_needed",
      family_followup_sent_at: null,
      created_at: "2026-04-24T01:00:00.000Z",
      updated_at: "2026-04-24T02:00:00.000Z"
    });
    window.localStorage.setItem("tcm-home-care-mvp-db", JSON.stringify(seeded));

    renderWithProviders(<DoctorReturnRecordPage />, "/doctor/return-records?patientId=pat-001");

    const inspectionFieldset = screen.getByText("望").closest("fieldset");
    const listeningFieldset = screen.getByText("聞").closest("fieldset");
    if (!inspectionFieldset || !listeningFieldset) {
      throw new Error("找不到四診區塊");
    }

    expect(within(inspectionFieldset).getByLabelText("其他")).toBeChecked();
    expect(screen.getByLabelText("望 其他")).toHaveValue("眼神反應較慢");
    expect(within(listeningFieldset).getByLabelText("其他")).toBeChecked();
    expect(screen.getByLabelText("聞 其他")).toHaveValue("夜間痰聲明顯");
    expect(screen.getByLabelText("其他", { selector: 'input[value="其他"][name="medical_history_tags"]' })).toBeChecked();
    expect(screen.getByLabelText("病史其他內容")).toHaveValue("延續上次病史");
  });

  it("會優先帶入最近一筆居家治療時間作為回院病歷設定時間", () => {
    const seeded = createSeedDb();
    const baseSchedule = seeded.visit_schedules.find((schedule) => schedule.patient_id === "pat-001");
    if (!baseSchedule) {
      throw new Error("找不到測試用個案排程");
    }

    seeded.visit_schedules.unshift({
      ...baseSchedule,
      id: "vs-home-latest",
      assigned_doctor_id: "doc-001",
      scheduled_start_at: "2026-04-24T01:10:00.000Z",
      scheduled_end_at: "2026-04-24T01:50:00.000Z",
      tracking_stopped_at: "2026-04-24T01:55:00.000Z",
      status: "completed",
      visit_type: "居家訪視",
      service_time_slot: "上午",
      updated_at: "2026-04-24T01:55:00.000Z"
    });
    seeded.visit_records.unshift({
      id: "vr-home-latest",
      visit_schedule_id: "vs-home-latest",
      departure_time: "2026-04-24T00:55:00.000Z",
      arrival_time: "2026-04-24T01:05:00.000Z",
      departure_from_patient_home_time: "2026-04-24T01:55:00.000Z",
      stay_duration_minutes: 50,
      treatment_start_time: "2026-04-24T01:10:00.000Z",
      treatment_end_time: "2026-04-24T01:50:00.000Z",
      treatment_duration_minutes: 40,
      treatment_duration_manually_adjusted: true,
      chief_complaint: "治療後追蹤",
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
      visit_feedback_code: "normal",
      visit_feedback_at: "2026-04-24T01:50:00.000Z",
      family_followup_status: "not_needed",
      family_followup_sent_at: null,
      created_at: "2026-04-24T00:55:00.000Z",
      updated_at: "2026-04-24T01:55:00.000Z"
    });
    window.localStorage.setItem("tcm-home-care-mvp-db", JSON.stringify(seeded));

    renderWithProviders(<DoctorReturnRecordPage />, "/doctor/return-records?patientId=pat-001");

    expect(screen.getByLabelText("開始治療時間")).toHaveValue(
      toDateTimeLocalValue("2026-04-24T01:10:00.000Z")
    );
    expect(screen.getByLabelText("結束治療時間")).toHaveValue(
      toDateTimeLocalValue("2026-04-24T01:50:00.000Z")
    );
    expect(screen.getByText(/已自動帶入最近一筆居家治療時間/)).toBeInTheDocument();
  });

  it("勾選異常個案後會同步建立醫師與行政提醒", () => {
    renderWithProviders(<DoctorReturnRecordPage />, "/doctor/return-records?patientId=pat-001");

    fireEvent.click(screen.getByRole("checkbox", { name: "勾選為異常個案，建立病歷後同步提醒醫師與行政追蹤" }));
    fireEvent.change(screen.getByLabelText("主訴"), {
      target: { value: "其他" }
    });
    fireEvent.change(screen.getByLabelText("主訴其他內容"), {
      target: { value: "治療後出現明顯頭暈與虛弱" }
    });
    fireEvent.click(screen.getByRole("button", { name: "建立回院病歷" }));

    return waitFor(() => {
      const storedDb = JSON.parse(window.localStorage.getItem("tcm-home-care-mvp-db") ?? "{}");
      const abnormalReminders = (storedDb.reminders ?? []).filter((reminder: { title: string }) =>
        reminder.title?.includes("異常個案｜王麗珠")
      );

      expect(abnormalReminders).toHaveLength(2);
      expect(abnormalReminders.map((reminder: { role: string }) => reminder.role).sort()).toEqual([
        "admin",
        "doctor"
      ]);
      expect(window.alert).toHaveBeenCalledWith("回院病歷已建立，異常個案提醒已同步到醫師與行政提醒中心。");
    });
  });

  it("勾選加入提醒中心後會同步建立醫師與行政提醒", () => {
    renderWithProviders(<DoctorReturnRecordPage />, "/doctor/return-records?patientId=pat-001");

    fireEvent.click(screen.getByRole("checkbox", { name: "加入提醒中心，讓醫師與行政後續追蹤" }));
    fireEvent.change(screen.getByLabelText("提醒內容"), {
      target: { value: "請於下次回診前追蹤睡眠與吞嚥變化" }
    });
    fireEvent.click(screen.getByRole("button", { name: "建立回院病歷" }));

    return waitFor(() => {
      const storedDb = JSON.parse(window.localStorage.getItem("tcm-home-care-mvp-db") ?? "{}");
      const reminders = (storedDb.reminders ?? []).filter((reminder: { title: string }) =>
        reminder.title?.includes("回院病歷提醒｜王麗珠")
      );

      expect(reminders).toHaveLength(2);
      expect(reminders.map((reminder: { role: string }) => reminder.role).sort()).toEqual([
        "admin",
        "doctor"
      ]);
      expect(reminders[0].detail).toContain("請於下次回診前追蹤睡眠與吞嚥變化");
      expect(window.alert).toHaveBeenCalledWith("回院病歷已建立，提醒內容已同步到醫師與行政提醒中心。");
    });
  });
});
