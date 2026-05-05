import { describe, expect, it } from "vitest";
import {
  buildReturnRecordCsv,
  buildPreviousFourDiagnosisSelections,
  buildReturnRecordDraft,
  calculateTreatmentDurationMinutes,
  fourDiagnosisOptions,
  resolvePreviousMedicalHistory
} from "./doctor-return-record";

describe("doctor return record helpers", () => {
  it("長照慢性臥床版四診名單順序正確", () => {
    expect(fourDiagnosisOptions.inspection).toEqual([
      "少神",
      "倦容",
      "面色淡白",
      "面色萎黃",
      "面浮",
      "唇乾",
      "唇色淡白",
      "舌淡白",
      "舌紅",
      "舌暗紫",
      "舌胖大",
      "齒痕舌",
      "舌苔薄白",
      "舌苔白膩",
      "舌苔黃膩",
      "其他"
    ]);
  });

  it("會依規則產生回院病歷草稿格式", () => {
    const draft = buildReturnRecordDraft({
      chiefComplaint: "腰痠、夜尿多",
      treatmentStartTime: "2026-04-21T09:00",
      treatmentEndTime: "2026-04-21T10:00",
      inspection_tags: ["少神", "舌淡白", "其他"],
      inspection_other: "眼神反應慢",
      listening_tags: ["語音低弱"],
      listening_other: "",
      inquiry_tags: ["夜尿多", "其他"],
      inquiry_other: "翻身時易喘",
      palpation_tags: ["脈細"],
      palpation_other: "",
      medicalHistory: "延續上次病史，仍偶有夜醒。"
    });

    expect(draft).toBe(
      "治療日期：1150421\n開始治療時間：0900\n結束治療時間：1000\n四診：望 少神、舌淡白、其他：眼神反應慢；聞 語音低弱；問 夜尿多、其他：翻身時易喘；切 脈細\n主訴：腰痠、夜尿多\n病史：延續上次病史，仍偶有夜醒。"
    );
  });

  it("勾選其他但未填文字時仍會保留其他", () => {
    const draft = buildReturnRecordDraft({
      chiefComplaint: "腹脹",
      treatmentStartTime: "2026-04-21T09:00",
      treatmentEndTime: "2026-04-21T09:30",
      inspection_tags: ["其他"],
      inspection_other: "",
      listening_tags: [],
      listening_other: "",
      inquiry_tags: [],
      inquiry_other: "",
      palpation_tags: [],
      palpation_other: "",
      medicalHistory: "腹脹反覆。"
    });

    expect(draft).toContain("四診：望 其他；聞 未勾選；問 未勾選；切 未勾選");
  });

  it("會優先延續上一筆的病史欄位", () => {
    expect(
      resolvePreviousMedicalHistory(
        {
          id: "vr-1",
          visit_schedule_id: "vs-1",
          departure_time: null,
          arrival_time: null,
          departure_from_patient_home_time: null,
          stay_duration_minutes: null,
          treatment_start_time: null,
          treatment_end_time: null,
          treatment_duration_minutes: null,
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
          treatment_chinese_medicine_checked: false,
          treatment_chinese_medicine_note: "",
          treatment_acupuncture_checked: false,
          treatment_acupuncture_note: "",
          treatment_topical_medication_checked: false,
          treatment_topical_medication_note: "",
          doctor_note: "",
          caregiver_feedback: "",
          follow_up_note: "",
          medical_history_note: "上次記錄的病史",
          generated_record_text: "",
          next_visit_suggestion_date: null,
          visit_feedback_code: null,
          visit_feedback_at: null,
          family_followup_status: "not_needed",
          family_followup_sent_at: null,
          created_at: "2026-04-21T09:00:00.000Z",
          updated_at: "2026-04-21T09:00:00.000Z"
        },
        "重要病史 fallback"
      )
    ).toBe("上次記錄的病史");
  });

  it("會帶回上一筆四診其他欄位", () => {
    expect(
      buildPreviousFourDiagnosisSelections({
        id: "vr-2",
        visit_schedule_id: "vs-2",
        departure_time: null,
        arrival_time: null,
        departure_from_patient_home_time: null,
        stay_duration_minutes: null,
        treatment_start_time: null,
        treatment_end_time: null,
        treatment_duration_minutes: null,
        treatment_duration_manually_adjusted: false,
        chief_complaint: "",
        sleep_status: "",
        appetite_status: "",
        bowel_movement_status: "",
        pain_status: "",
        energy_status: "",
        inspection_tags: ["其他"],
        inspection_other: "眼神反應慢",
        listening_tags: [],
        listening_other: "",
        inquiry_tags: ["其他"],
        inquiry_other: "夜間痰多",
        palpation_tags: [],
        palpation_other: "",
        physician_assessment: "",
        treatment_provided: "",
        treatment_chinese_medicine_checked: false,
        treatment_chinese_medicine_note: "",
        treatment_acupuncture_checked: false,
        treatment_acupuncture_note: "",
        treatment_topical_medication_checked: false,
        treatment_topical_medication_note: "",
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
        created_at: "2026-04-21T09:00:00.000Z",
        updated_at: "2026-04-21T09:00:00.000Z"
      })
    ).toEqual({
      inspection_tags: ["其他"],
      inspection_other: "眼神反應慢",
      listening_tags: [],
      listening_other: "",
      inquiry_tags: ["其他"],
      inquiry_other: "夜間痰多",
      palpation_tags: [],
      palpation_other: ""
    });
  });

  it("會正確計算開始與結束治療分鐘數", () => {
    expect(calculateTreatmentDurationMinutes("2026-04-21T09:00", "2026-04-21T09:45")).toBe(45);
  });

  it("會輸出適合 Excel 開啟的回院病歷 CSV", () => {
    const csv = buildReturnRecordCsv([
      {
        routeDate: "2026-05-10",
        routeName: "2026/05/10 上午出巡",
        doctorName: "蕭坤元醫師",
        serviceTimeSlot: "上午",
        routeOrder: 1,
        patientName: "王麗珠",
        chartNumber: "TCM-001",
        scheduledStartAt: "2026-05-10T01:10:00.000Z",
        scheduledEndAt: "2026-05-10T01:50:00.000Z",
        departureFromPatientHomeTime: "2026-05-10T01:55:00.000Z",
        returnRecordStartTime: "2026-05-10T02:20:00.000Z",
        returnRecordEndTime: "2026-05-10T02:50:00.000Z",
        chiefComplaint: "腰痠,夜尿多",
        fourDiagnosisSummary: "四診：望 少神；聞 語音低弱",
        medicalHistory: "糖尿病、其他：夜醒",
        isException: true,
        reminderNote: "請追蹤夜間翻身狀況",
        generatedRecordText:
          "治療日期：1150510\n開始治療時間：1020\n結束治療時間：1050\n四診：望 少神；聞 語音低弱\n主訴：腰痠,夜尿多",
        linkedHomeVisitScheduleId: "vs-home-1",
        returnRecordScheduleId: "vs-return-1"
      }
    ]);

    expect(csv).toContain(
      "出巡日期,路線名稱,醫師,服務時段,站序,個案姓名,病歷號,居家訪視開始,居家訪視結束,離開個案時間,回院病歷開始,回院病歷結束,主訴,四診摘要,病史,異常個案,提醒內容,病歷全文,居家訪視排程ID,回院病歷排程ID"
    );
    expect(csv).toContain("2026/05/10,2026/05/10 上午出巡,蕭坤元醫師,上午,1,王麗珠,TCM-001");
    expect(csv).toContain("\"腰痠,夜尿多\"");
    expect(csv).toContain(
      "\"治療日期：1150510\n開始治療時間：1020\n結束治療時間：1050\n四診：望 少神；聞 語音低弱\n主訴：腰痠,夜尿多\""
    );
  });
});
