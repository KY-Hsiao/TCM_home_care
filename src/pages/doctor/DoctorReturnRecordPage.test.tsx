import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "../../app/providers";
import { createSeedDb } from "../../data/seed";
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
    expect(screen.getByLabelText("病史")).toHaveValue("延續上次病史");
  });
});
