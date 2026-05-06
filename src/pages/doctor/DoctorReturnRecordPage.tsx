import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addMinutes } from "date-fns";
import { useForm, useWatch } from "react-hook-form";
import { useAppContext } from "../../app/use-app-context";
import type { Reminder, VisitRecord, VisitSchedule } from "../../domain/models";
import type { VisitDetail } from "../../domain/repository";
import {
  buildPreviousMedicalHistorySelections,
  buildPreviousTreatmentProvidedSelections,
  buildPreviousFourDiagnosisSelections,
  buildFourDiagnosisSummary,
  buildFourDiagnosisSummaryFromRecord,
  buildReturnRecordCopyText,
  buildReturnRecordCsv,
  buildReturnRecordDraft,
  buildReturnRecordHtml,
  buildReturnRecordHtmlFileName,
  buildTreatmentProvidedSummary,
  calculateTreatmentDurationMinutes,
  extractReminderNoteFromRecord,
  fourDiagnosisOptions,
  isExceptionReturnRecord,
  joinMedicalHistory,
  medicalHistoryOptions,
  resolvePreviousMedicalHistory
} from "../../modules/doctor/doctor-return-record";
import { Panel } from "../../shared/ui/Panel";
import {
  formatDateOnly,
  formatDateTimeFull,
  fromDateTimeLocalValue,
  toDateTimeLocalValue
} from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";

type ReturnRecordFormValues = {
  route_key: string;
  patient_id: string;
  mark_as_exception: boolean;
  add_to_reminders: boolean;
  reminder_note: string;
  chief_complaint_option: string;
  chief_complaint_other: string;
  treatment_start_time: string;
  treatment_end_time: string;
  inspection_tags: string[];
  inspection_other: string;
  listening_tags: string[];
  listening_other: string;
  inquiry_tags: string[];
  inquiry_other: string;
  palpation_tags: string[];
  palpation_other: string;
  medical_history_tags: string[];
  medical_history_other: string;
  treatment_chinese_medicine_checked: boolean;
  treatment_chinese_medicine_note: string;
  treatment_acupuncture_checked: boolean;
  treatment_acupuncture_note: string;
  treatment_topical_medication_checked: boolean;
  treatment_topical_medication_note: string;
  generated_record_text: string;
};

type FourDiagnosisField =
  | "inspection_tags"
  | "listening_tags"
  | "inquiry_tags"
  | "palpation_tags";

type FourDiagnosisOtherField =
  | "inspection_other"
  | "listening_other"
  | "inquiry_other"
  | "palpation_other";

type ReturnRecordTimeDefaults = {
  treatmentStartTime: string;
  treatmentEndTime: string;
  hint: string;
};

type CompletedHomeVisitContext = {
  detail: VisitDetail;
  record: VisitRecord;
  completedAt: string;
};

type VisitTreatmentWindow = {
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number | null;
};

type ReturnRecordCsvDraftOverride = {
  patientId: string;
  returnRecordStartTime: string | null;
  returnRecordEndTime: string | null;
  chiefComplaint: string;
  fourDiagnosisSummary: string;
  medicalHistory: string;
  isException: boolean;
  reminderNote: string;
  generatedRecordText: string;
};

type ReturnRecordDraftStorage = Record<string, ReturnRecordFormValues>;

type DriveReturnRecordFile = {
  id: string;
  name: string;
  modifiedTime?: string | null;
  webViewLink?: string | null;
};

type DriveHistoryState = {
  status: "idle" | "loading" | "ready" | "error";
  message: string;
  files: DriveReturnRecordFile[];
};

type RouteOption = {
  key: string;
  routeName: string;
  routeDate: string;
  serviceTimeSlot: "上午" | "下午";
  routeGroupId: string | null;
  schedules: VisitSchedule[];
};

const fourDiagnosisSections: Array<{
  field: FourDiagnosisField;
  otherField: FourDiagnosisOtherField;
  label: string;
  options: readonly string[];
}> = [
  {
    field: "inspection_tags",
    otherField: "inspection_other",
    label: "望",
    options: fourDiagnosisOptions.inspection
  },
  {
    field: "listening_tags",
    otherField: "listening_other",
    label: "聞",
    options: fourDiagnosisOptions.listening
  },
  {
    field: "inquiry_tags",
    otherField: "inquiry_other",
    label: "問",
    options: fourDiagnosisOptions.inquiry
  },
  {
    field: "palpation_tags",
    otherField: "palpation_other",
    label: "切",
    options: fourDiagnosisOptions.palpation
  }
];

const chiefComplaintOptions = [
  "中風",
  "腦傷",
  "脊隨損傷",
  "癌症",
  "失智",
  "老化衰弱",
  "其他"
] as const;

const returnRecordDraftStorageKey = "tcm-return-record-drafts";

function normalizeReturnRecordFormValues(values: ReturnRecordFormValues): ReturnRecordFormValues {
  return {
    ...values,
    mark_as_exception: Boolean(values.mark_as_exception),
    add_to_reminders: Boolean(values.add_to_reminders),
    inspection_tags: Array.isArray(values.inspection_tags) ? values.inspection_tags : [],
    listening_tags: Array.isArray(values.listening_tags) ? values.listening_tags : [],
    inquiry_tags: Array.isArray(values.inquiry_tags) ? values.inquiry_tags : [],
    palpation_tags: Array.isArray(values.palpation_tags) ? values.palpation_tags : [],
    medical_history_tags: Array.isArray(values.medical_history_tags) ? values.medical_history_tags : [],
    treatment_chinese_medicine_checked: Boolean(values.treatment_chinese_medicine_checked),
    treatment_acupuncture_checked: Boolean(values.treatment_acupuncture_checked),
    treatment_topical_medication_checked: Boolean(values.treatment_topical_medication_checked)
  };
}

function loadReturnRecordDraftStorage(): ReturnRecordDraftStorage {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(returnRecordDraftStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ReturnRecordDraftStorage)
      : {};
  } catch {
    return {};
  }
}

function persistReturnRecordDraftStorage(storage: ReturnRecordDraftStorage) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(returnRecordDraftStorageKey, JSON.stringify(storage));
}

function buildReturnRecordDraftStorageKey(input: {
  doctorId: string;
  routeKey: string;
  patientId: string;
}) {
  return `${input.doctorId}::${input.routeKey}::${input.patientId}`;
}

function resolvePreviousChiefComplaintFields(chiefComplaint: string | undefined) {
  const trimmedChiefComplaint = chiefComplaint?.trim() ?? "";
  if (!trimmedChiefComplaint) {
    return {
      chiefComplaintOption: "",
      chiefComplaintOther: ""
    };
  }

  if (
    chiefComplaintOptions.some((option) => option !== "其他" && option === trimmedChiefComplaint)
  ) {
    return {
      chiefComplaintOption: trimmedChiefComplaint,
      chiefComplaintOther: ""
    };
  }

  return {
    chiefComplaintOption: "其他",
    chiefComplaintOther: trimmedChiefComplaint
  };
}

function buildInitialStartTime() {
  return toDateTimeLocalValue(new Date().toISOString());
}

function buildInitialEndTime() {
  return toDateTimeLocalValue(addMinutes(new Date(), 30).toISOString());
}

function buildFallbackTimeDefaults(): ReturnRecordTimeDefaults {
  return {
    treatmentStartTime: buildInitialStartTime(),
    treatmentEndTime: buildInitialEndTime(),
    hint: "尚未找到剛完成的居家訪視，先帶入目前時間。"
  };
}

function buildReturnRecordFormValues(input: {
  routeKey: string;
  patientId: string;
  timeDefaults: ReturnRecordTimeDefaults;
  previousRecord?: VisitRecord;
  selectedPatientMedicalHistory: string;
  loadPrevious: boolean;
}): ReturnRecordFormValues {
  if (!input.loadPrevious) {
    return {
      route_key: input.routeKey,
      patient_id: input.patientId,
      mark_as_exception: false,
      add_to_reminders: false,
      reminder_note: "",
      chief_complaint_option: "",
      chief_complaint_other: "",
      treatment_start_time: input.timeDefaults.treatmentStartTime,
      treatment_end_time: input.timeDefaults.treatmentEndTime,
      inspection_tags: [],
      inspection_other: "",
      listening_tags: [],
      listening_other: "",
      inquiry_tags: [],
      inquiry_other: "",
      palpation_tags: [],
      palpation_other: "",
      medical_history_tags: [],
      medical_history_other: "",
      treatment_chinese_medicine_checked: false,
      treatment_chinese_medicine_note: "",
      treatment_acupuncture_checked: false,
      treatment_acupuncture_note: "",
      treatment_topical_medication_checked: false,
      treatment_topical_medication_note: "",
      generated_record_text: ""
    };
  }

  const previousSelections = buildPreviousFourDiagnosisSelections(input.previousRecord);
  const previousMedicalHistorySelections = buildPreviousMedicalHistorySelections(
    input.previousRecord,
    input.selectedPatientMedicalHistory
  );
  const previousTreatmentProvidedSelections =
    buildPreviousTreatmentProvidedSelections(input.previousRecord);
  const previousChiefComplaintFields = resolvePreviousChiefComplaintFields(
    input.previousRecord?.chief_complaint
  );

  return {
    route_key: input.routeKey,
    patient_id: input.patientId,
    mark_as_exception: false,
    add_to_reminders: false,
    reminder_note: extractReminderNoteFromRecord(input.previousRecord),
    chief_complaint_option: previousChiefComplaintFields.chiefComplaintOption,
    chief_complaint_other: previousChiefComplaintFields.chiefComplaintOther,
    treatment_start_time: input.timeDefaults.treatmentStartTime,
    treatment_end_time: input.timeDefaults.treatmentEndTime,
    ...previousSelections,
    ...previousMedicalHistorySelections,
    ...previousTreatmentProvidedSelections,
    generated_record_text: ""
  };
}

function buildInitialGeneratedRecordText(values: ReturnRecordFormValues) {
  const chiefComplaint =
    values.chief_complaint_option === "其他"
      ? values.chief_complaint_other
      : values.chief_complaint_option;
  return buildReturnRecordDraft({
    chiefComplaint,
    treatmentStartTime: values.treatment_start_time,
    treatmentEndTime: values.treatment_end_time,
    inspection_tags: values.inspection_tags,
    inspection_other: values.inspection_other,
    listening_tags: values.listening_tags,
    listening_other: values.listening_other,
    inquiry_tags: values.inquiry_tags,
    inquiry_other: values.inquiry_other,
    palpation_tags: values.palpation_tags,
    palpation_other: values.palpation_other,
    medicalHistory: joinMedicalHistory(
      values.medical_history_tags,
      values.medical_history_other
    ),
    treatmentProvidedSummary: buildTreatmentProvidedSummary(values),
    reminderNote: values.add_to_reminders ? values.reminder_note : ""
  });
}

function splitKnownTags(value: string, options: readonly string[]) {
  const parts = value
    .split("、")
    .map((item) => item.trim())
    .filter((item) => item && item !== "未勾選" && item !== "未填寫");
  const knownTags = options.filter((option) => option !== "其他" && parts.includes(option));
  const otherParts = parts
    .filter((item) => item.startsWith("其他："))
    .map((item) => item.replace(/^其他：/, "").trim())
    .filter(Boolean);
  const unmatchedParts = parts.filter(
    (item) =>
      item !== "其他" &&
      !item.startsWith("其他：") &&
      !knownTags.includes(item)
  );
  const hasOther =
    parts.includes("其他") || otherParts.length > 0 || unmatchedParts.length > 0;

  return {
    tags: hasOther ? [...knownTags, "其他"] : knownTags,
    other: [...otherParts, ...unmatchedParts].join("、")
  };
}

function parseFourDiagnosisSummary(summary: string) {
  const sections = {
    inspection: "",
    listening: "",
    inquiry: "",
    palpation: ""
  };
  summary
    .replace(/^四診：/, "")
    .split("；")
    .map((item) => item.trim())
    .forEach((item) => {
      if (item.startsWith("望")) {
        sections.inspection = item.replace(/^望\s*/, "");
      } else if (item.startsWith("聞")) {
        sections.listening = item.replace(/^聞\s*/, "");
      } else if (item.startsWith("問")) {
        sections.inquiry = item.replace(/^問\s*/, "");
      } else if (item.startsWith("切")) {
        sections.palpation = item.replace(/^切\s*/, "");
      }
    });

  const inspection = splitKnownTags(sections.inspection, fourDiagnosisOptions.inspection);
  const listening = splitKnownTags(sections.listening, fourDiagnosisOptions.listening);
  const inquiry = splitKnownTags(sections.inquiry, fourDiagnosisOptions.inquiry);
  const palpation = splitKnownTags(sections.palpation, fourDiagnosisOptions.palpation);

  return {
    inspection_tags: inspection.tags,
    inspection_other: inspection.other,
    listening_tags: listening.tags,
    listening_other: listening.other,
    inquiry_tags: inquiry.tags,
    inquiry_other: inquiry.other,
    palpation_tags: palpation.tags,
    palpation_other: palpation.other
  };
}

function buildMedicalHistorySelectionsFromText(value: string) {
  const parsed = splitKnownTags(value, medicalHistoryOptions);
  return {
    medical_history_tags: parsed.tags,
    medical_history_other: parsed.other
  };
}

function extractGeneratedRecordLine(text: string, label: string) {
  const matchedLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${label}：`));
  return matchedLine?.replace(`${label}：`, "").trim() ?? "";
}

function parseTreatmentProvidedSummary(value: string) {
  const parts = value
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean);
  const findNote = (label: string) =>
    parts
      .find((item) => item === label || item.startsWith(`${label}：`))
      ?.replace(`${label}：`, "")
      .trim() ?? "";
  const hasTreatment = (label: string) =>
    parts.some((item) => item === label || item.startsWith(`${label}：`));

  return {
    treatment_chinese_medicine_checked: hasTreatment("中藥"),
    treatment_chinese_medicine_note: findNote("中藥"),
    treatment_acupuncture_checked: hasTreatment("針灸"),
    treatment_acupuncture_note: findNote("針灸"),
    treatment_topical_medication_checked: hasTreatment("外用藥"),
    treatment_topical_medication_note: findNote("外用藥")
  };
}

function textOfSection(card: Element, title: string, selector = "p") {
  const section = Array.from(card.querySelectorAll("section")).find(
    (candidate) => candidate.querySelector("h3")?.textContent?.trim() === title
  );
  return section?.querySelector(selector)?.textContent?.trim() ?? "";
}

function textOfMeta(card: Element, title: string) {
  const groups = Array.from(card.querySelectorAll(".meta-grid > div"));
  const matchedGroup = groups.find(
    (group) => group.querySelector("dt")?.textContent?.trim() === title
  );
  return matchedGroup?.querySelector("dd")?.textContent?.trim() ?? "";
}

function buildDriveReturnRecordFormValues(input: {
  html: string;
  chartNumber: string;
  patientName: string;
  routeKey: string;
  patientId: string;
  timeDefaults: ReturnRecordTimeDefaults;
}) {
  if (typeof DOMParser === "undefined") {
    return null;
  }

  const document = new DOMParser().parseFromString(input.html, "text/html");
  const cards = Array.from(document.querySelectorAll(".record-card"));
  const matchedCard = cards.find((card) => {
    const cardChartNumber = card.querySelector("h2 span")?.textContent?.trim();
    const heading = card.querySelector("h2")?.textContent?.trim() ?? "";
    return (
      cardChartNumber === input.chartNumber ||
      heading.includes(input.chartNumber) ||
      heading.includes(input.patientName)
    );
  });

  if (!matchedCard) {
    return null;
  }

  const chiefComplaintText = textOfMeta(matchedCard, "主訴");
  const fourDiagnosisSummary = textOfSection(matchedCard, "四診摘要");
  const medicalHistoryText = textOfSection(matchedCard, "病史");
  const reminderNote = textOfSection(matchedCard, "提醒內容");
  const generatedRecordText = textOfSection(matchedCard, "病歷全文", "pre");
  const previousChiefComplaintFields = resolvePreviousChiefComplaintFields(
    chiefComplaintText === "未填寫" ? "" : chiefComplaintText
  );
  const treatmentProvidedSummary =
    extractGeneratedRecordLine(generatedRecordText, "處置");

  const values: ReturnRecordFormValues = {
    route_key: input.routeKey,
    patient_id: input.patientId,
    mark_as_exception: textOfMeta(matchedCard, "異常個案") === "是",
    add_to_reminders: Boolean(reminderNote),
    reminder_note: reminderNote,
    chief_complaint_option: previousChiefComplaintFields.chiefComplaintOption,
    chief_complaint_other: previousChiefComplaintFields.chiefComplaintOther,
    treatment_start_time: input.timeDefaults.treatmentStartTime,
    treatment_end_time: input.timeDefaults.treatmentEndTime,
    ...parseFourDiagnosisSummary(fourDiagnosisSummary),
    ...buildMedicalHistorySelectionsFromText(medicalHistoryText === "未填寫" ? "" : medicalHistoryText),
    ...parseTreatmentProvidedSummary(treatmentProvidedSummary),
    generated_record_text: generatedRecordText === "未填寫" ? "" : generatedRecordText
  };

  return normalizeReturnRecordFormValues(values);
}

function buildCsvDraftOverrideFromValues(
  values: ReturnRecordFormValues,
  patientId: string
): ReturnRecordCsvDraftOverride {
  const resolvedChiefComplaint =
    values.chief_complaint_option === "其他"
      ? values.chief_complaint_other
      : values.chief_complaint_option;
  const medicalHistory = joinMedicalHistory(
    values.medical_history_tags,
    values.medical_history_other
  );
  return {
    patientId,
    returnRecordStartTime:
      fromDateTimeLocalValue(values.treatment_start_time) ?? null,
    returnRecordEndTime:
      fromDateTimeLocalValue(values.treatment_end_time) ?? null,
    chiefComplaint: resolvedChiefComplaint,
    fourDiagnosisSummary: buildFourDiagnosisSummary({
      inspection_tags: values.inspection_tags,
      inspection_other: values.inspection_other,
      listening_tags: values.listening_tags,
      listening_other: values.listening_other,
      inquiry_tags: values.inquiry_tags,
      inquiry_other: values.inquiry_other,
      palpation_tags: values.palpation_tags,
      palpation_other: values.palpation_other
    }),
    medicalHistory,
    isException: values.mark_as_exception,
    reminderNote: values.add_to_reminders ? values.reminder_note.trim() : "",
    generatedRecordText: values.generated_record_text
  };
}

function hasReturnRecordDraftContent(values: ReturnRecordFormValues) {
  return Boolean(
    values.mark_as_exception ||
      values.add_to_reminders ||
      values.reminder_note.trim() ||
      values.chief_complaint_option ||
      values.chief_complaint_other.trim() ||
      values.inspection_tags.length ||
      values.inspection_other.trim() ||
      values.listening_tags.length ||
      values.listening_other.trim() ||
      values.inquiry_tags.length ||
      values.inquiry_other.trim() ||
      values.palpation_tags.length ||
      values.palpation_other.trim() ||
      values.medical_history_tags.length ||
      values.medical_history_other.trim() ||
      values.treatment_chinese_medicine_checked ||
      values.treatment_chinese_medicine_note.trim() ||
      values.treatment_acupuncture_checked ||
      values.treatment_acupuncture_note.trim() ||
      values.treatment_topical_medication_checked ||
      values.treatment_topical_medication_note.trim() ||
      values.generated_record_text.trim()
  );
}

function resolveVisitTreatmentWindow(detail: VisitDetail, record: VisitRecord | undefined): VisitTreatmentWindow {
  const startTime = record?.treatment_start_time ?? record?.arrival_time ?? null;
  const durationMinutes =
    record?.treatment_duration_minutes ?? detail.schedule.estimated_treatment_minutes ?? null;
  const endTime =
    record?.treatment_end_time ??
    (startTime && durationMinutes !== null
      ? addMinutes(new Date(startTime), durationMinutes).toISOString()
      : null);

  return {
    startTime,
    endTime,
    durationMinutes
  };
}

function resolveLatestCompletedHomeVisit(input: {
  doctorId: string;
  repositories: ReturnType<typeof useAppContext>["repositories"];
  patientId?: string;
  routeKey?: string;
}): CompletedHomeVisitContext | null {
  const schedules = input.repositories.visitRepository
    .getSchedules({ doctorId: input.doctorId, patientId: input.patientId })
    .filter(
      (schedule) =>
        schedule.visit_type !== "回院病歷" &&
        schedule.service_time_slot !== "回院病歷" &&
        (!input.routeKey || buildRouteOptionKey(schedule) === input.routeKey)
    );

  const completedVisits = schedules
    .map((schedule) => {
      const detail = input.repositories.visitRepository.getScheduleDetail(schedule.id);
      const record = detail?.record;
      const isCompletedVisit =
        schedule.status === "completed" ||
        schedule.status === "followup_pending" ||
        Boolean(record?.departure_from_patient_home_time);
      const completedAt =
        record?.departure_from_patient_home_time ??
        record?.treatment_end_time ??
        record?.updated_at ??
        null;
      if (!detail || !record || !completedAt || !isCompletedVisit) {
        return null;
      }
      return {
        detail,
        record,
        completedAt
      } satisfies CompletedHomeVisitContext;
    })
    .filter((item): item is CompletedHomeVisitContext => Boolean(item))
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());

  return completedVisits[0] ?? null;
}

function buildRouteOptionKey(schedule: VisitSchedule) {
  return schedule.route_group_id
    ? `route-group:${schedule.route_group_id}`
    : `route-slot:${schedule.assigned_doctor_id}:${schedule.scheduled_start_at.slice(0, 10)}:${schedule.service_time_slot}`;
}

function resolveExistingRouteOptionKey(
  routeOptions: RouteOption[],
  matchedVisit: CompletedHomeVisitContext | null
) {
  if (!matchedVisit) {
    return undefined;
  }

  return routeOptions.find((option) =>
    option.schedules.some((schedule) => schedule.id === matchedVisit.detail.schedule.id)
  )?.key;
}

function resolveReturnRecordTimeDefaults(
  matchedVisit: CompletedHomeVisitContext | null
): ReturnRecordTimeDefaults {
  if (!matchedVisit) {
    return buildFallbackTimeDefaults();
  }

  const treatmentWindow = resolveVisitTreatmentWindow(
    matchedVisit.detail,
    matchedVisit.record
  );
  if (!treatmentWindow.startTime || !treatmentWindow.endTime) {
    return buildFallbackTimeDefaults();
  }

  return {
    treatmentStartTime: toDateTimeLocalValue(treatmentWindow.startTime),
    treatmentEndTime: toDateTimeLocalValue(treatmentWindow.endTime),
    hint: `已對應剛完成的居家訪視：${maskPatientName(matchedVisit.detail.patient.name)} / ${formatDateTimeFull(
      treatmentWindow.startTime
    )} 至 ${formatDateTimeFull(treatmentWindow.endTime)}`
  };
}

function buildScheduleFromRecord(
  patientId: string,
  doctorId: string,
  startAt: string,
  endAt: string,
  area: string,
  address: string,
  googleMapsLink: string,
  latitude: number | null,
  longitude: number | null,
  estimatedMinutes: number,
  note: string,
  linkedScheduleId?: string
): VisitSchedule {
  const now = new Date().toISOString();
  const uniqueKey = Date.now();
  return {
    id: `vs-return-${uniqueKey}`,
    patient_id: patientId,
    assigned_doctor_id: doctorId,
    primary_caregiver_id: "",
    scheduled_start_at: startAt,
    scheduled_end_at: endAt,
    estimated_treatment_minutes: estimatedMinutes,
    address_snapshot: address,
    location_keyword_snapshot: "同住址",
    home_latitude_snapshot: latitude,
    home_longitude_snapshot: longitude,
    arrival_radius_meters: 100,
    geofence_status: "completed",
    google_maps_link: googleMapsLink,
    area,
    service_time_slot: "回院病歷",
    route_order: 1,
    route_group_id: linkedScheduleId ? `return-${linkedScheduleId}` : `return-${patientId}-${startAt.slice(0, 10)}`,
    tracking_mode: "hybrid",
    tracking_started_at: null,
    tracking_stopped_at: endAt,
    arrival_confirmed_by: null,
    departure_confirmed_by: null,
    last_feedback_code: null,
    reminder_tags: ["回院病歷"],
    status: "completed",
    visit_type: "回院病歷",
    note,
    created_at: now,
    updated_at: now
  };
}

function buildAbnormalCaseReminders(
  patientName: string,
  chiefComplaint: string,
  relatedVisitScheduleId: string
): Reminder[] {
  const now = new Date().toISOString();
  const maskedPatientName = maskPatientName(patientName);
  const title = `異常個案｜${maskedPatientName}`;
  const detail = chiefComplaint
    ? `${maskedPatientName} 已於回院病歷勾選為異常個案，主訴：${chiefComplaint}`
    : `${maskedPatientName} 已於回院病歷勾選為異常個案，請查看回院病歷內容。`;

  return (["doctor", "admin"] as const).map((role, index) => ({
    id: `rem-return-abnormal-${Date.now()}-${index}`,
    role,
    title,
    detail,
    due_at: now,
    related_visit_schedule_id: relatedVisitScheduleId,
    status: "pending",
    created_at: now,
    updated_at: now
  }));
}

function buildReturnRecordReminders(
  patientName: string,
  reminderNote: string,
  relatedVisitScheduleId: string
): Reminder[] {
  const now = new Date().toISOString();
  const maskedPatientName = maskPatientName(patientName);
  const title = `回院病歷提醒｜${maskedPatientName}`;
  const detail = reminderNote.trim()
    ? `${maskedPatientName} 回院病歷提醒：${reminderNote.trim()}`
    : `${maskedPatientName} 已新增回院病歷提醒，請查看病歷內容。`;

  return (["doctor", "admin"] as const).map((role, index) => ({
    id: `rem-return-note-${Date.now()}-${index}`,
    role,
    title,
    detail,
    due_at: now,
    related_visit_schedule_id: relatedVisitScheduleId,
    status: "pending",
    created_at: now,
    updated_at: now
  }));
}

function isReturnRecordSchedule(schedule: VisitSchedule) {
  return (
    schedule.visit_type === "回院病歷" ||
    schedule.service_time_slot === "回院病歷"
  );
}

function findLatestReturnRecord(
  records: VisitRecord[],
  schedules: VisitSchedule[]
) {
  const returnScheduleIds = new Set(
    schedules
      .filter((schedule) => isReturnRecordSchedule(schedule))
      .map((schedule) => schedule.id)
  );
  const sortedRecords = [...records].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
  return (
    sortedRecords.find(
      (record) =>
        returnScheduleIds.has(record.visit_schedule_id) ||
        record.visit_schedule_id.startsWith("vs-return-")
    ) ?? sortedRecords[0]
  );
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
}

async function uploadHtmlToGoogleDrive(input: {
  filename: string;
  html: string;
}) {
  const response = await fetch("/api/admin/google-drive?action=upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = (await response.json().catch(() => ({}))) as {
    webViewLink?: string;
    error?: string;
  };
  if (!response.ok) {
    return {
      ok: false,
      message: payload.error ?? `Google Drive 上傳失敗：HTTP ${response.status}`
    };
  }
  return {
    ok: true,
    message: payload.webViewLink
      ? `已儲存到 Google Drive：${payload.webViewLink}`
      : "已儲存到 Google Drive。"
  };
}

async function fetchGoogleDriveRecordFiles() {
  const response = await fetch("/api/admin/google-drive?action=records");
  const payload = (await response.json().catch(() => ({}))) as {
    files?: DriveReturnRecordFile[];
    error?: string;
    reason?: string;
  };
  if (!response.ok) {
    const error = new Error(payload.error ?? `Google Drive 病歷檔清單讀取失敗：HTTP ${response.status}`);
    error.name = payload.reason ?? `HTTP_${response.status}`;
    throw error;
  }
  return Array.isArray(payload.files) ? payload.files : [];
}

function formatGoogleDriveHistoryError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "GOOGLE_DRIVE_AUTH_INVALID") {
      return "Google Drive 授權已失效，無法載入已儲存檔案。請到 Vercel 改設定 GOOGLE_DRIVE_REFRESH_TOKEN、GOOGLE_DRIVE_CLIENT_ID、GOOGLE_DRIVE_CLIENT_SECRET，或更新短效 GOOGLE_DRIVE_ACCESS_TOKEN 後重新部署。";
    }
    if (error.name === "GOOGLE_DRIVE_AUTH_ENV_MISSING" || error.name === "GOOGLE_DRIVE_ENV_MISSING") {
      return "Google Drive 尚未完成 Vercel 環境變數設定，請確認 GOOGLE_DRIVE_FOLDER_ID 與 Drive 授權變數。";
    }
    return error.message;
  }
  return "Google Drive 歷史病歷檔讀取失敗。";
}

async function fetchGoogleDriveRecordHtml(fileId: string) {
  const response = await fetch(
    `/api/admin/google-drive?action=records&fileId=${encodeURIComponent(fileId)}`
  );
  const payload = (await response.json().catch(() => ({}))) as {
    file?: DriveReturnRecordFile;
    html?: string;
    error?: string;
    reason?: string;
  };
  if (!response.ok) {
    const error = new Error(payload.error ?? `Google Drive 病歷檔讀取失敗：HTTP ${response.status}`);
    error.name = payload.reason ?? `HTTP_${response.status}`;
    throw error;
  }
  return {
    file: payload.file,
    html: payload.html ?? ""
  };
}

function parseDriveRecordDateFromName(name: string) {
  const matchedDate = name.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!matchedDate) {
    return "";
  }
  return `${matchedDate[1]}-${matchedDate[2]}-${matchedDate[3]}`;
}

function formatDriveRecordFileLabel(file: DriveReturnRecordFile) {
  const dateText = parseDriveRecordDateFromName(file.name);
  const modifiedText = file.modifiedTime
    ? `，更新 ${formatDateTimeFull(file.modifiedTime)}`
    : "";
  return `${dateText ? `${dateText}｜` : ""}${file.name}${modifiedText}`;
}

type DoctorReturnRecordPageProps = {
  embeddedWindow?: boolean;
  onCloseWindow?: () => void;
};

export function DoctorReturnRecordPage({
  embeddedWindow = false,
  onCloseWindow
}: DoctorReturnRecordPageProps = {}) {
  const { repositories, session } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isReturnRecordModalOpen, setIsReturnRecordModalOpen] = useState(true);
  const [googleDriveStatus, setGoogleDriveStatus] = useState<string | null>(null);
  const [copiedPatientId, setCopiedPatientId] = useState<string | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<ReturnRecordDraftStorage>(() =>
    loadReturnRecordDraftStorage()
  );
  const [draftSaveMessage, setDraftSaveMessage] = useState<string | null>(null);
  const [driveHistory, setDriveHistory] = useState<DriveHistoryState>({
    status: "idle",
    message: "",
    files: []
  });
  const [selectedDriveFileId, setSelectedDriveFileId] = useState("");
  const [isLoadingDriveRecord, setIsLoadingDriveRecord] = useState(false);
  const activeDoctor = useMemo(
    () =>
      repositories.patientRepository
        .getDoctors()
        .find((doctor) => doctor.id === session.activeDoctorId),
    [repositories, session.activeDoctorId]
  );
  const homeVisitSchedules = useMemo(
    () =>
      repositories.visitRepository
        .getSchedules({
          doctorId: session.activeDoctorId
        })
        .filter((schedule) => !isReturnRecordSchedule(schedule)),
    [repositories, session.activeDoctorId]
  );
  const latestCompletedHomeVisit = useMemo(
    () =>
      resolveLatestCompletedHomeVisit({
        doctorId: session.activeDoctorId,
        repositories
      }),
    [repositories, session.activeDoctorId]
  );
  const requestedPatientLatestCompletedVisit = useMemo(
    () =>
      searchParams.get("patientId")
        ? resolveLatestCompletedHomeVisit({
            doctorId: session.activeDoctorId,
            repositories,
            patientId: searchParams.get("patientId") ?? undefined
          })
        : null,
    [repositories, searchParams, session.activeDoctorId]
  );
  const routeOptions = useMemo(() => {
    const savedRoutePlans = repositories.visitRepository
      .getSavedRoutePlans({ doctorId: session.activeDoctorId })
      .filter((routePlan) => Boolean(routePlan.route_group_id));
    const homeVisitScheduleById = new Map(
      homeVisitSchedules.map((schedule) => [schedule.id, schedule] as const)
    );
    const homeVisitSchedulesByRouteGroupId = homeVisitSchedules.reduce<Map<string, VisitSchedule[]>>(
      (result, schedule) => {
        const routeGroupId = schedule.route_group_id;
        const existingSchedules = result.get(routeGroupId) ?? [];
        result.set(routeGroupId, [...existingSchedules, schedule]);
        return result;
      },
      new Map<string, VisitSchedule[]>()
    );

    const routeOptionDrafts: Array<RouteOption | null> = savedRoutePlans.map((routePlan) => {
        const schedulesFromRouteItems = routePlan.route_items
          .map((item) => (item.schedule_id ? homeVisitScheduleById.get(item.schedule_id) : null))
          .filter((schedule): schedule is VisitSchedule => Boolean(schedule));
        const fallbackSchedules = homeVisitSchedulesByRouteGroupId.get(routePlan.route_group_id) ?? [];
        const orderedSchedules = (schedulesFromRouteItems.length > 0
          ? schedulesFromRouteItems
          : [...fallbackSchedules].sort((left, right) => {
              const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
              const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
              if (leftOrder !== rightOrder) {
                return leftOrder - rightOrder;
              }
              return new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime();
            })
        ).filter(
          (schedule, index, collection) =>
            collection.findIndex((item) => item.id === schedule.id) === index
        );

        if (!orderedSchedules.length) {
          return null;
        }

        return {
          key: `route-group:${routePlan.route_group_id}`,
          routeName: routePlan.route_name,
          routeDate: routePlan.route_date,
          serviceTimeSlot: routePlan.service_time_slot,
          routeGroupId: routePlan.route_group_id,
          schedules: orderedSchedules
        } satisfies RouteOption;
      });

    const savedRouteOptions = routeOptionDrafts
      .filter((option): option is RouteOption => option !== null);
    const savedScheduleIds = new Set(
      savedRouteOptions.flatMap((option) => option.schedules.map((schedule) => schedule.id))
    );
    const fallbackScheduleIds = new Set(
      [requestedPatientLatestCompletedVisit, latestCompletedHomeVisit]
        .map((visit) => visit?.detail.schedule.id)
        .filter((id): id is string => Boolean(id))
    );
    const fallbackRouteOptions = Array.from(
      homeVisitSchedules
        .filter(
          (schedule) =>
            !savedScheduleIds.has(schedule.id) &&
            fallbackScheduleIds.has(schedule.id)
        )
        .reduce<Map<string, VisitSchedule[]>>((result, schedule) => {
          const key = buildRouteOptionKey(schedule);
          const existingSchedules = result.get(key) ?? [];
          result.set(key, [...existingSchedules, schedule]);
          return result;
        }, new Map<string, VisitSchedule[]>())
        .entries()
    ).map(([key, schedules]) => {
      const sortedSchedules = [...schedules].sort((left, right) => {
        const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime();
      });
      const firstSchedule = sortedSchedules[0];
      const routeDate = firstSchedule.scheduled_start_at.slice(0, 10);
      const serviceTimeSlot = firstSchedule.service_time_slot.includes("下午")
        ? "下午"
        : "上午";
      return {
        key,
        routeName: `${formatDateOnly(routeDate)} ${serviceTimeSlot}出巡`,
        routeDate,
        serviceTimeSlot,
        routeGroupId: firstSchedule.route_group_id || null,
        schedules: sortedSchedules
      } satisfies RouteOption;
    });

    return [...savedRouteOptions, ...fallbackRouteOptions]
      .sort((left, right) => {
        const leftLatest = Math.max(
          ...left.schedules.map((schedule) => new Date(schedule.updated_at).getTime())
        );
        const rightLatest = Math.max(
          ...right.schedules.map((schedule) => new Date(schedule.updated_at).getTime())
        );
        return rightLatest - leftLatest;
      });
  }, [
    homeVisitSchedules,
    latestCompletedHomeVisit,
    repositories,
    requestedPatientLatestCompletedVisit,
    session.activeDoctorId
  ]);

  const defaultRouteKey =
    routeOptions.find((option) => option.key === searchParams.get("routeKey"))?.key ??
    resolveExistingRouteOptionKey(routeOptions, requestedPatientLatestCompletedVisit) ??
    resolveExistingRouteOptionKey(routeOptions, latestCompletedHomeVisit) ??
    routeOptions[0]?.key ??
    "";
  const defaultRoute = routeOptions.find((option) => option.key === defaultRouteKey) ?? routeOptions[0];
  const defaultRouteCompletedVisit =
    defaultRoute
      ? resolveLatestCompletedHomeVisit({
          doctorId: session.activeDoctorId,
          repositories,
          routeKey: defaultRoute.key
        })
      : null;
  const defaultRoutePatients = (defaultRoute?.schedules ?? [])
    .map((schedule) => repositories.patientRepository.getPatientById(schedule.patient_id))
    .filter((patient): patient is NonNullable<typeof patient> => Boolean(patient))
    .filter((patient, index, collection) => collection.findIndex((item) => item.id === patient.id) === index);

  const defaultPatientId =
    defaultRoutePatients.find((patient) => patient.id === searchParams.get("patientId"))?.id ??
    defaultRouteCompletedVisit?.detail.patient.id ??
    requestedPatientLatestCompletedVisit?.detail.patient.id ??
    latestCompletedHomeVisit?.detail.patient.id ??
    defaultRoutePatients[0]?.id ??
    "";
  const initialTimeDefaults = resolveReturnRecordTimeDefaults(
    defaultPatientId
      ? resolveLatestCompletedHomeVisit({
          doctorId: session.activeDoctorId,
          repositories,
          patientId: defaultPatientId,
          routeKey: defaultRouteKey || undefined
        }) ??
          resolveLatestCompletedHomeVisit({
            doctorId: session.activeDoctorId,
            repositories,
            patientId: defaultPatientId
          })
      : null
  );

  const { control, formState, getValues, handleSubmit, register, reset, setValue } =
    useForm<ReturnRecordFormValues>({
      defaultValues: {
        route_key: defaultRouteKey,
        patient_id: defaultPatientId,
        mark_as_exception: false,
        add_to_reminders: false,
        reminder_note: "",
        chief_complaint_option: "",
        chief_complaint_other: "",
        treatment_start_time: initialTimeDefaults.treatmentStartTime,
        treatment_end_time: initialTimeDefaults.treatmentEndTime,
        inspection_tags: [],
        inspection_other: "",
        listening_tags: [],
        listening_other: "",
        inquiry_tags: [],
        inquiry_other: "",
        palpation_tags: [],
        palpation_other: "",
        medical_history_tags: [],
        medical_history_other: "",
        treatment_chinese_medicine_checked: false,
        treatment_chinese_medicine_note: "",
        treatment_acupuncture_checked: false,
        treatment_acupuncture_note: "",
        treatment_topical_medication_checked: false,
        treatment_topical_medication_note: "",
        generated_record_text: ""
      }
    });

  const selectedRouteKey = useWatch({ control, name: "route_key" });
  const selectedRoute =
    routeOptions.find((option) => option.key === selectedRouteKey) ?? routeOptions[0];
  const routePatients = useMemo(
    () =>
      (selectedRoute?.schedules ?? [])
        .map((schedule) => repositories.patientRepository.getPatientById(schedule.patient_id))
        .filter((patient): patient is NonNullable<typeof patient> => Boolean(patient))
        .filter((patient, index, collection) => collection.findIndex((item) => item.id === patient.id) === index),
    [repositories, selectedRoute]
  );
  const selectedRouteCompletedVisit = useMemo(
    () =>
      selectedRoute
        ? resolveLatestCompletedHomeVisit({
            doctorId: session.activeDoctorId,
            repositories,
            routeKey: selectedRoute.key
          })
        : null,
    [repositories, selectedRoute, session.activeDoctorId]
  );
  const selectedPatientId = useWatch({ control, name: "patient_id" });
  const selectedProfile = useMemo(
    () =>
      selectedPatientId
        ? repositories.patientRepository.getPatientProfile(selectedPatientId)
        : undefined,
    [repositories, selectedPatientId]
  );
  const returnRecordTimeDefaults = useMemo(
    () => {
      const routeMatchedVisit = selectedPatientId
        ? resolveLatestCompletedHomeVisit({
            doctorId: session.activeDoctorId,
            repositories,
            patientId: selectedPatientId,
            routeKey: selectedRoute?.key
          })
        : null;
      const patientMatchedVisit = selectedPatientId
        ? resolveLatestCompletedHomeVisit({
            doctorId: session.activeDoctorId,
            repositories,
            patientId: selectedPatientId
          })
        : null;

      return resolveReturnRecordTimeDefaults(routeMatchedVisit ?? patientMatchedVisit);
    },
    [repositories, selectedPatientId, selectedRoute, session.activeDoctorId]
  );
  const matchedCompletedVisit = useMemo(
    () => {
      const routeMatchedVisit = selectedPatientId
        ? resolveLatestCompletedHomeVisit({
            doctorId: session.activeDoctorId,
            repositories,
            patientId: selectedPatientId,
            routeKey: selectedRoute?.key
          })
        : null;
      const patientMatchedVisit = selectedPatientId
        ? resolveLatestCompletedHomeVisit({
            doctorId: session.activeDoctorId,
            repositories,
            patientId: selectedPatientId
          })
        : null;

      return routeMatchedVisit ?? patientMatchedVisit;
    },
    [repositories, selectedPatientId, selectedRoute, session.activeDoctorId]
  );
  const previousRecord = useMemo(
    () =>
      selectedProfile && selectedPatientId
        ? findLatestReturnRecord(
            selectedProfile.visitRecords,
            repositories.visitRepository.getSchedules({
              doctorId: session.activeDoctorId,
              patientId: selectedPatientId
            })
          )
        : undefined,
    [repositories, selectedPatientId, selectedProfile, session.activeDoctorId]
  );
  const previousAutoDraftRef = useRef("");
  const autoLoadedDriveRecordKeyRef = useRef("");
  const formDirtyRef = useRef(false);
  formDirtyRef.current = formState.isDirty;
  const previousRecordUpdatedAt = previousRecord?.updated_at ?? "";
  const selectedPatientMedicalHistory = selectedProfile?.patient.important_medical_history ?? "";
  const selectedDraftKey = useMemo(
    () =>
      selectedRoute?.key && selectedPatientId
        ? buildReturnRecordDraftStorageKey({
            doctorId: session.activeDoctorId,
            routeKey: selectedRoute.key,
            patientId: selectedPatientId
          })
        : "",
    [selectedPatientId, selectedRoute?.key, session.activeDoctorId]
  );
  const selectedSavedDraft = selectedDraftKey ? savedDrafts[selectedDraftKey] : undefined;

  const saveDraftValues = (values: ReturnRecordFormValues, options?: { silent?: boolean }) => {
    const draftKey =
      values.route_key && values.patient_id
        ? buildReturnRecordDraftStorageKey({
            doctorId: session.activeDoctorId,
            routeKey: values.route_key,
            patientId: values.patient_id
          })
        : selectedDraftKey;
    if (!draftKey) {
      return;
    }
    const normalizedValues = normalizeReturnRecordFormValues(values);
    setSavedDrafts((current) => {
      const next = {
        ...current,
        [draftKey]: normalizedValues
      };
      persistReturnRecordDraftStorage(next);
      return next;
    });
    if (!options?.silent) {
      setDraftSaveMessage("已儲存此個案暫存，切換個案或匯出此次巡診時會保留這份內容。");
    }
  };

  const saveCurrentFormDraftSilently = () => {
    const values = normalizeReturnRecordFormValues(getValues());
    if (!values.patient_id || !values.route_key || !hasReturnRecordDraftContent(values)) {
      return;
    }
    saveDraftValues(values, { silent: true });
  };

  const loadPreviousRecordIntoForm = () => {
    if (!selectedPatientId) {
      return;
    }
    const nextValues = buildReturnRecordFormValues({
      routeKey: selectedRoute?.key ?? "",
      patientId: selectedPatientId,
      timeDefaults: returnRecordTimeDefaults,
      previousRecord,
      selectedPatientMedicalHistory,
      loadPrevious: true
    });
    const initialDraft = buildInitialGeneratedRecordText(nextValues);
    previousAutoDraftRef.current = initialDraft;
    reset({
      ...nextValues,
      generated_record_text: initialDraft
    });
    setDraftSaveMessage("已載入此個案前次病歷內容，可再依本次狀況修改。");
  };

  const loadDriveHistoryFiles = useCallback(async () => {
    setDriveHistory((current) => ({
      ...current,
      status: "loading",
      message: "正在讀取 Google Drive 歷史病歷檔。"
    }));
    try {
      const files = await fetchGoogleDriveRecordFiles();
      setDriveHistory({
        status: "ready",
        files,
        message: files.length
          ? `已讀取 ${files.length} 個 Google Drive 歷史病歷檔，請選擇要載入的日期或檔案。`
          : "Google Drive 病歷資料夾內目前沒有可載入的 HTML 病歷檔。"
      });
      setSelectedDriveFileId((currentFileId) =>
        files.some((file) => file.id === currentFileId) ? currentFileId : files[0]?.id ?? ""
      );
    } catch (error) {
      setDriveHistory({
        status: "error",
        files: [],
        message: formatGoogleDriveHistoryError(error)
      });
      setSelectedDriveFileId("");
    }
  }, []);

  useEffect(() => {
    if (!selectedProfile || driveHistory.status !== "idle") {
      return;
    }

    void loadDriveHistoryFiles();
  }, [driveHistory.status, loadDriveHistoryFiles, selectedProfile]);

  const loadDriveRecordIntoForm = useCallback(
    async (
      fileId: string,
      options: {
        mode: "auto" | "manual";
        shouldApply?: () => boolean;
      }
    ) => {
      if (!selectedProfile || !selectedPatientId) {
        return false;
      }

      const result = await fetchGoogleDriveRecordHtml(fileId);
      if (options.shouldApply && !options.shouldApply()) {
        return false;
      }
      const nextValues = buildDriveReturnRecordFormValues({
        html: result.html,
        chartNumber: selectedProfile.patient.chart_number,
        patientName: selectedProfile.patient.name,
        routeKey: selectedRoute?.key ?? "",
        patientId: selectedPatientId,
        timeDefaults: returnRecordTimeDefaults
      });
      if (!nextValues) {
        if (options.mode === "manual") {
          setDriveHistory((current) => ({
            ...current,
            status: "error",
            message: "選定的 Google Drive 病歷檔內找不到目前個案，請改選其他日期或檔案。"
          }));
        }
        return false;
      }

      if (options.shouldApply && !options.shouldApply()) {
        return false;
      }

      const initialDraft =
        nextValues.generated_record_text || buildInitialGeneratedRecordText(nextValues);
      previousAutoDraftRef.current = initialDraft;
      reset({
        ...nextValues,
        generated_record_text: initialDraft
      });
      setSelectedDriveFileId(fileId);
      setDraftSaveMessage(
        options.mode === "auto"
          ? `已自動從 Google Drive 載入「${result.file?.name ?? "歷史病歷檔"}」作為此個案預先症狀，可再依本次狀況修改。`
          : `已從 Google Drive 載入「${result.file?.name ?? "選定病歷檔"}」中的此個案內容，可再依本次狀況修改。`
      );
      setDriveHistory((current) => ({
        ...current,
        status: "ready",
        message:
          options.mode === "auto"
            ? "已自動套用 Google Drive 中符合目前個案的歷史病歷；仍可改選其他檔案再載入。"
            : "已載入選定的 Google Drive 病歷檔。"
      }));
      return true;
    },
    [reset, returnRecordTimeDefaults, selectedPatientId, selectedProfile, selectedRoute?.key]
  );

  useEffect(() => {
    if (
      driveHistory.status !== "ready" ||
      !driveHistory.files.length ||
      !selectedProfile ||
      !selectedPatientId ||
      selectedSavedDraft ||
      formState.isDirty
    ) {
      return;
    }

    const autoLoadKey = [
      selectedPatientId,
      selectedProfile.patient.chart_number,
      driveHistory.files.map((file) => file.id).join(",")
    ].join("::");
    if (autoLoadedDriveRecordKeyRef.current === autoLoadKey) {
      return;
    }
    autoLoadedDriveRecordKeyRef.current = autoLoadKey;

    let isCurrentAttempt = true;
    setIsLoadingDriveRecord(true);
    setDriveHistory((current) => ({
      ...current,
      message: "正在從 Google Drive 歷史病歷檔尋找目前個案內容。"
    }));

    void (async () => {
      try {
        for (const file of driveHistory.files) {
          const loaded = await loadDriveRecordIntoForm(file.id, {
            mode: "auto",
            shouldApply: () => isCurrentAttempt && !formDirtyRef.current
          });
          if (!isCurrentAttempt) {
            return;
          }
          if (loaded) {
            return;
          }
        }
        setDriveHistory((current) => ({
          ...current,
          status: "ready",
          message: `已讀取 ${driveHistory.files.length} 個 Google Drive 歷史病歷檔，但找不到目前個案內容；可改選其他檔案手動載入。`
        }));
      } catch (error) {
        if (!isCurrentAttempt) {
          return;
        }
        setDriveHistory((current) => ({
          ...current,
          status: "error",
          message: formatGoogleDriveHistoryError(error)
        }));
      } finally {
        if (isCurrentAttempt) {
          setIsLoadingDriveRecord(false);
        }
      }
    })();

    return () => {
      isCurrentAttempt = false;
    };
  }, [
    driveHistory.files,
    driveHistory.status,
    formState.isDirty,
    loadDriveRecordIntoForm,
    selectedPatientId,
    selectedProfile,
    selectedSavedDraft
  ]);

  const loadSelectedDriveRecordIntoForm = async () => {
    if (!selectedProfile || !selectedPatientId || !selectedDriveFileId) {
      return;
    }

    setIsLoadingDriveRecord(true);
    setDriveHistory((current) => ({
      ...current,
      message: "正在載入選定的 Google Drive 病歷檔。"
    }));
    try {
      await loadDriveRecordIntoForm(selectedDriveFileId, { mode: "manual" });
    } catch (error) {
      setDriveHistory((current) => ({
        ...current,
        status: "error",
        message: formatGoogleDriveHistoryError(error)
      }));
    } finally {
      setIsLoadingDriveRecord(false);
    }
  };

  useEffect(() => {
    if (!selectedRoute) {
      return;
    }

    const nextPatientId =
      routePatients.find((patient) => patient.id === selectedPatientId)?.id ??
      selectedRouteCompletedVisit?.detail.patient.id ??
      routePatients[0]?.id ??
      "";

    if (nextPatientId && nextPatientId !== selectedPatientId) {
      setValue("patient_id", nextPatientId, { shouldDirty: false, shouldTouch: false });
    }
  }, [
    routePatients,
    selectedPatientId,
    selectedRoute,
    selectedRouteCompletedVisit,
    setValue
  ]);

  useEffect(() => {
    if (!selectedPatientId) {
      return;
    }

    const nextValues = selectedSavedDraft
      ? normalizeReturnRecordFormValues({
          ...selectedSavedDraft,
          route_key: selectedRoute?.key ?? selectedSavedDraft.route_key,
          patient_id: selectedPatientId
        })
      : buildReturnRecordFormValues({
          routeKey: selectedRoute?.key ?? "",
          patientId: selectedPatientId,
          timeDefaults: returnRecordTimeDefaults,
          previousRecord,
          selectedPatientMedicalHistory,
          loadPrevious: false
        });
    const initialDraft =
      nextValues.generated_record_text || buildInitialGeneratedRecordText(nextValues);
    previousAutoDraftRef.current = initialDraft;
    reset({
      ...nextValues,
      generated_record_text: initialDraft
    });
    setSearchParams(
      {
        routeKey: selectedRoute?.key ?? "",
        patientId: selectedPatientId
      },
      { replace: true }
    );
  }, [
    previousRecordUpdatedAt,
    previousRecord,
    reset,
    returnRecordTimeDefaults.treatmentEndTime,
    returnRecordTimeDefaults.treatmentStartTime,
    selectedSavedDraft,
    selectedPatientId,
    selectedRoute,
    selectedPatientMedicalHistory,
    setSearchParams
  ]);

  const watchedValues = useWatch({ control });
  const closeReturnRecordWindow = () => {
    if (onCloseWindow) {
      onCloseWindow();
      return;
    }
    setIsReturnRecordModalOpen(false);
  };
  const resolvedChiefComplaint = useMemo(() => {
    const draftValues = watchedValues ?? getValues();
    if (draftValues?.chief_complaint_option === "其他") {
      return draftValues.chief_complaint_other ?? "";
    }
    return draftValues?.chief_complaint_option ?? "";
  }, [getValues, watchedValues]);
  const autoDraft = useMemo(() => {
    const draftValues = watchedValues ?? getValues();
    if (
      !draftValues.treatment_start_time ||
      !draftValues.treatment_end_time
    ) {
      return "";
    }

    return buildReturnRecordDraft({
      chiefComplaint: resolvedChiefComplaint,
      treatmentStartTime: draftValues.treatment_start_time,
      treatmentEndTime: draftValues.treatment_end_time,
      inspection_tags: draftValues.inspection_tags ?? [],
      inspection_other: draftValues.inspection_other ?? "",
      listening_tags: draftValues.listening_tags ?? [],
      listening_other: draftValues.listening_other ?? "",
      inquiry_tags: draftValues.inquiry_tags ?? [],
      inquiry_other: draftValues.inquiry_other ?? "",
      palpation_tags: draftValues.palpation_tags ?? [],
      palpation_other: draftValues.palpation_other ?? "",
      medicalHistory: joinMedicalHistory(
        draftValues.medical_history_tags ?? [],
        draftValues.medical_history_other ?? ""
      ),
      treatmentProvidedSummary: buildTreatmentProvidedSummary({
        treatment_chinese_medicine_checked:
          draftValues.treatment_chinese_medicine_checked ?? false,
        treatment_chinese_medicine_note:
          draftValues.treatment_chinese_medicine_note ?? "",
        treatment_acupuncture_checked:
          draftValues.treatment_acupuncture_checked ?? false,
        treatment_acupuncture_note:
          draftValues.treatment_acupuncture_note ?? "",
        treatment_topical_medication_checked:
          draftValues.treatment_topical_medication_checked ?? false,
        treatment_topical_medication_note:
          draftValues.treatment_topical_medication_note ?? ""
      }),
      reminderNote: draftValues.add_to_reminders ? draftValues.reminder_note ?? "" : ""
    });
  }, [getValues, resolvedChiefComplaint, watchedValues]);

  useEffect(() => {
    const currentDraft = getValues("generated_record_text");
    if (!currentDraft || currentDraft === previousAutoDraftRef.current) {
      setValue("generated_record_text", autoDraft, { shouldDirty: false });
    }
    previousAutoDraftRef.current = autoDraft;
  }, [autoDraft, getValues, setValue]);

  const currentDraftCsvOverride = useMemo(() => {
    const draftValues = watchedValues ?? getValues();
    if (!selectedPatientId) {
      return null;
    }

    return buildCsvDraftOverrideFromValues(
      normalizeReturnRecordFormValues(draftValues as ReturnRecordFormValues),
      selectedPatientId
    );
  }, [getValues, selectedPatientId, watchedValues]);

  const exportRows = useMemo(() => {
    if (!selectedRoute || !activeDoctor) {
      return [];
    }

    return selectedRoute.schedules
      .map((schedule) => {
        const detail = repositories.visitRepository.getScheduleDetail(schedule.id);
        if (!detail) {
          return null;
        }
        const homeVisitTreatmentWindow = resolveVisitTreatmentWindow(detail, detail.record);

        const linkedReturnSchedule = repositories.visitRepository
          .getSchedules({
            doctorId: session.activeDoctorId,
            patientId: detail.patient.id
          })
          .filter((item) => isReturnRecordSchedule(item))
          .filter((item) => item.route_group_id === `return-${schedule.id}`)
          .sort(
            (left, right) =>
              new Date(right.scheduled_start_at).getTime() -
              new Date(left.scheduled_start_at).getTime()
          )[0];
        const linkedReturnRecord = linkedReturnSchedule
          ? repositories.visitRepository.getVisitRecordByScheduleId(linkedReturnSchedule.id)
          : undefined;
        const referenceRecord = linkedReturnRecord ?? detail.record;
        const savedDraftKey =
          selectedRoute?.key
            ? buildReturnRecordDraftStorageKey({
                doctorId: session.activeDoctorId,
                routeKey: selectedRoute.key,
                patientId: detail.patient.id
              })
            : "";
        const savedDraftOverride =
          savedDraftKey && savedDrafts[savedDraftKey]
            ? (() => {
                const normalizedSavedDraft = normalizeReturnRecordFormValues(
                  savedDrafts[savedDraftKey]
                );
                return hasReturnRecordDraftContent(normalizedSavedDraft)
                  ? buildCsvDraftOverrideFromValues(normalizedSavedDraft, detail.patient.id)
                  : null;
              })()
            : null;
        const currentDraftOverride =
          currentDraftCsvOverride &&
          currentDraftCsvOverride.generatedRecordText.trim() &&
          currentDraftCsvOverride.patientId === detail.patient.id
            ? currentDraftCsvOverride
            : savedDraftOverride;

        return {
          routeDate: selectedRoute.routeDate,
          routeName: selectedRoute.routeName,
          doctorName: activeDoctor.name,
          serviceTimeSlot: selectedRoute.serviceTimeSlot,
          routeOrder: schedule.route_order ?? null,
          patientName: detail.patient.name,
          chartNumber: detail.patient.chart_number,
          scheduledStartAt:
            homeVisitTreatmentWindow.startTime ?? schedule.scheduled_start_at,
          scheduledEndAt:
            homeVisitTreatmentWindow.endTime ?? schedule.scheduled_end_at,
          departureFromPatientHomeTime:
            detail.record?.departure_from_patient_home_time ?? null,
          returnRecordStartTime:
            currentDraftOverride?.returnRecordStartTime ??
            linkedReturnRecord?.treatment_start_time ??
            null,
          returnRecordEndTime:
            currentDraftOverride?.returnRecordEndTime ??
            linkedReturnRecord?.treatment_end_time ??
            null,
          chiefComplaint:
            currentDraftOverride?.chiefComplaint ??
            referenceRecord?.chief_complaint ??
            "",
          fourDiagnosisSummary:
            currentDraftOverride?.fourDiagnosisSummary ??
            buildFourDiagnosisSummaryFromRecord(referenceRecord),
          medicalHistory:
            currentDraftOverride?.medicalHistory ??
            resolvePreviousMedicalHistory(referenceRecord, ""),
          isException:
            currentDraftOverride?.isException ??
            isExceptionReturnRecord(referenceRecord),
          reminderNote:
            currentDraftOverride?.reminderNote ??
            extractReminderNoteFromRecord(referenceRecord),
          generatedRecordText:
            currentDraftOverride?.generatedRecordText ??
            referenceRecord?.generated_record_text ??
            "",
          linkedHomeVisitScheduleId: schedule.id,
          returnRecordScheduleId: linkedReturnSchedule?.id ?? ""
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [
    activeDoctor,
    currentDraftCsvOverride,
    repositories,
    savedDrafts,
    selectedRoute,
    session.activeDoctorId
  ]);
  const exportFileName = useMemo(() => {
    if (!exportRows.length) {
      return "";
    }

    const routeDateToken = exportRows[0].routeDate.replace(/-/g, "");
    const routeNameToken = exportRows[0].routeName
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "");
    return `此次出巡病歷_${routeDateToken}_${routeNameToken}.csv`;
  }, [exportRows]);
  const htmlExportFileName = useMemo(() => {
    if (!exportRows.length) {
      return "";
    }
    return buildReturnRecordHtmlFileName({
      routeDate: exportRows[0].routeDate,
      doctorName: exportRows[0].doctorName,
      serviceTimeSlot: exportRows[0].serviceTimeSlot
    });
  }, [exportRows]);

  const htmlExportText = useMemo(() => buildReturnRecordHtml(exportRows), [exportRows]);

  const handleExportCsv = () => {
    if (!exportRows.length) {
      window.alert("尚未找到此次出巡可匯出的病歷資料。");
      return;
    }

    const csvText = buildReturnRecordCsv(exportRows);
    const blob = new Blob(["\uFEFF", csvText], {
      type: "text/csv;charset=utf-8;"
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = exportFileName || "此次出巡病歷.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  const handleExportHtml = () => {
    if (!exportRows.length) {
      window.alert("尚未找到此次出巡可匯出的病歷資料。");
      return;
    }
    downloadTextFile(
      htmlExportFileName || "居家個案病例紀錄.html",
      htmlExportText,
      "text/html;charset=utf-8"
    );
  };

  const handleSaveHtmlToGoogleDrive = async () => {
    if (!exportRows.length) {
      window.alert("尚未找到此次出巡可儲存的病歷資料。");
      return;
    }
    setGoogleDriveStatus("正在儲存到 Google Drive。");
    const result = await uploadHtmlToGoogleDrive({
      filename: htmlExportFileName || "居家個案病例紀錄.html",
      html: htmlExportText
    });
    setGoogleDriveStatus(result.message);
    if (!result.ok) {
      window.alert(result.message);
    }
  };

  const handleCopyRecord = async (row: (typeof exportRows)[number]) => {
    const copyText = buildReturnRecordCopyText(row);
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = copyText;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedPatientId(row.linkedHomeVisitScheduleId);
    window.setTimeout(() => setCopiedPatientId(null), 1600);
  };

  const handleSaveCurrentDraft = () => {
    const values = normalizeReturnRecordFormValues(getValues());
    saveDraftValues(values);
  };

  const onSubmit = (values: ReturnRecordFormValues) => {
    const normalizedValues = normalizeReturnRecordFormValues(values);
    saveDraftValues(normalizedValues, { silent: true });
    if (!selectedProfile) {
      window.alert("請先選擇個案。");
      return;
    }

    const treatmentStartTime = fromDateTimeLocalValue(normalizedValues.treatment_start_time);
    const treatmentEndTime = fromDateTimeLocalValue(normalizedValues.treatment_end_time);
    if (!treatmentStartTime || !treatmentEndTime) {
      window.alert("請完整填寫開始與結束治療時間。");
      return;
    }

    if (new Date(treatmentEndTime) <= new Date(treatmentStartTime)) {
      window.alert("結束治療時間需晚於開始治療時間。");
      return;
    }

    const chiefComplaint =
      normalizedValues.chief_complaint_option === "其他"
        ? normalizedValues.chief_complaint_other.trim()
        : normalizedValues.chief_complaint_option;
    const medicalHistory = joinMedicalHistory(
      normalizedValues.medical_history_tags,
      normalizedValues.medical_history_other
    );
    const treatmentProvidedSummary = buildTreatmentProvidedSummary(normalizedValues);
    const baseTreatmentProvided = normalizedValues.mark_as_exception
      ? "已由醫師回院病歷頁建立病歷，並勾選異常個案。"
      : "已由醫師回院病歷頁建立病歷。";
    const reminderNote = normalizedValues.reminder_note.trim();

    if (normalizedValues.chief_complaint_option === "其他" && !chiefComplaint) {
      window.alert("若主訴選擇其他，請補充主訴內容。");
      return;
    }
    if (normalizedValues.add_to_reminders && !reminderNote) {
      window.alert("若要加入通知中心，請補充提醒內容。");
      return;
    }

    const estimatedMinutes = calculateTreatmentDurationMinutes(
      normalizedValues.treatment_start_time,
      normalizedValues.treatment_end_time
    );
    const noteTitle = `回院病歷｜${chiefComplaint || "未填主訴"}${
      normalizedValues.mark_as_exception ? "｜異常個案" : ""
    }`;
    const schedule = buildScheduleFromRecord(
      selectedProfile.patient.id,
      session.activeDoctorId,
      treatmentStartTime,
      treatmentEndTime,
      matchedCompletedVisit?.detail.schedule.area ?? selectedProfile.recentSchedules[0]?.area ?? "回院病歷",
      matchedCompletedVisit?.detail.schedule.address_snapshot ?? selectedProfile.patient.address,
      matchedCompletedVisit?.detail.schedule.google_maps_link ?? selectedProfile.patient.google_maps_link,
      matchedCompletedVisit?.detail.schedule.home_latitude_snapshot ?? selectedProfile.patient.home_latitude,
      matchedCompletedVisit?.detail.schedule.home_longitude_snapshot ?? selectedProfile.patient.home_longitude,
      estimatedMinutes,
      matchedCompletedVisit
        ? `${noteTitle}｜對應 ${formatDateTimeFull(matchedCompletedVisit.detail.schedule.scheduled_start_at)} 居家訪視`
        : noteTitle,
      matchedCompletedVisit?.detail.schedule.id
    );
    const now = new Date().toISOString();
    const nextRecord: VisitRecord = {
      id: `vr-return-${Date.now()}`,
      visit_schedule_id: schedule.id,
      departure_time: null,
      arrival_time: null,
      departure_from_patient_home_time: null,
      stay_duration_minutes: estimatedMinutes,
      treatment_start_time: treatmentStartTime,
      treatment_end_time: treatmentEndTime,
      treatment_duration_minutes: estimatedMinutes,
      treatment_duration_manually_adjusted: true,
      chief_complaint: chiefComplaint,
      sleep_status: "",
      appetite_status: "",
      bowel_movement_status: "",
      pain_status: "",
      energy_status: "",
      inspection_tags: normalizedValues.inspection_tags,
      inspection_other: normalizedValues.inspection_other,
      listening_tags: normalizedValues.listening_tags,
      listening_other: normalizedValues.listening_other,
      inquiry_tags: normalizedValues.inquiry_tags,
      inquiry_other: normalizedValues.inquiry_other,
      palpation_tags: normalizedValues.palpation_tags,
      palpation_other: normalizedValues.palpation_other,
      physician_assessment: normalizedValues.generated_record_text,
      treatment_provided: treatmentProvidedSummary
        ? `${baseTreatmentProvided} 處置：${treatmentProvidedSummary}`
        : baseTreatmentProvided,
      treatment_chinese_medicine_checked: normalizedValues.treatment_chinese_medicine_checked,
      treatment_chinese_medicine_note: normalizedValues.treatment_chinese_medicine_note.trim(),
      treatment_acupuncture_checked: normalizedValues.treatment_acupuncture_checked,
      treatment_acupuncture_note: normalizedValues.treatment_acupuncture_note.trim(),
      treatment_topical_medication_checked: normalizedValues.treatment_topical_medication_checked,
      treatment_topical_medication_note: normalizedValues.treatment_topical_medication_note.trim(),
      doctor_note: normalizedValues.generated_record_text,
      caregiver_feedback: "",
      follow_up_note: medicalHistory,
      medical_history_note: medicalHistory,
      generated_record_text: normalizedValues.generated_record_text,
      next_visit_suggestion_date: null,
      visit_feedback_code: null,
      visit_feedback_at: null,
      family_followup_status: "not_needed",
      family_followup_sent_at: null,
      created_at: now,
      updated_at: now
    };

    repositories.visitRepository.upsertSchedule(schedule);
    repositories.visitRepository.upsertVisitRecord(nextRecord);
    if (normalizedValues.mark_as_exception) {
      buildAbnormalCaseReminders(
        selectedProfile.patient.name,
        chiefComplaint,
        schedule.id
      ).forEach((reminder) => {
        repositories.visitRepository.createReminder(reminder);
      });
    }
    if (normalizedValues.add_to_reminders) {
      buildReturnRecordReminders(
        selectedProfile.patient.name,
        reminderNote,
        schedule.id
      ).forEach((reminder) => {
        repositories.visitRepository.createReminder(reminder);
      });
    }
    window.alert(
      normalizedValues.mark_as_exception && normalizedValues.add_to_reminders
        ? "回院病歷已建立，異常個案與提醒內容已同步新增到醫師與行政通知中心，此個案暫存也已保留。"
        : normalizedValues.mark_as_exception
          ? "回院病歷已建立，異常個案訊息已同步新增到醫師與行政通知中心，此個案暫存也已保留。"
          : normalizedValues.add_to_reminders
            ? "回院病歷已建立，提醒內容已同步新增到醫師與行政通知中心，此個案暫存也已保留。"
            : "回院病歷已建立，此個案暫存已保留，匯出此次巡診時會一起整併。"
    );
  };

  if (!routeOptions.length) {
    return <Panel title="查無路線">目前此醫師沒有可建立回院病歷的出巡路線資料。</Panel>;
  }

  const returnRecordForm = (
    <form className="space-y-4 lg:space-y-5" onSubmit={handleSubmit(onSubmit)}>
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 lg:rounded-3xl lg:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">選擇路線</span>
                <select
                  {...register("route_key")}
                  onChange={(event) => {
                    saveCurrentFormDraftSilently();
                    setValue("route_key", event.target.value, {
                      shouldDirty: true,
                      shouldTouch: true
                    });
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  {routeOptions.map((routeOption) => (
                    <option key={routeOption.key} value={routeOption.key}>
                      {routeOption.routeName}｜{routeOption.schedules.length} 位個案
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">選擇個案</span>
                <select
                  {...register("patient_id")}
                  onChange={(event) => {
                    saveCurrentFormDraftSilently();
                    setValue("patient_id", event.target.value, {
                      shouldDirty: true,
                      shouldTouch: true
                    });
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  {routePatients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.chart_number}｜{maskPatientName(patient.name)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedProfile ? (
                <Link
                  to={`/doctor/patients/${selectedProfile.patient.id}`}
                  className="inline-flex rounded-full bg-brand-sand px-4 py-2.5 text-sm font-semibold text-brand-forest"
                >
                  查看個案完整資訊
                </Link>
              ) : null}
            </div>

            {selectedProfile ? (
              <div className="mt-4 grid gap-3 text-sm text-slate-600 lg:grid-cols-2">
                <p>路線：{selectedRoute?.routeName ?? "未指定"}</p>
                <p>本路線個案數：{routePatients.length}</p>
                <p>個案：{maskPatientName(selectedProfile.patient.name)}</p>
                <p>生日：{formatDateOnly(selectedProfile.patient.date_of_birth)}</p>
                <p className="break-words">重要病史：{selectedProfile.patient.important_medical_history}</p>
              </div>
            ) : null}
            {selectedProfile ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>系統會自動載入 Google Drive 歷史病歷檔清單；選擇日期或檔案後，可帶入目前個案的主訴、四診、病史與病歷草稿內容。</p>
                  <button
                    type="button"
                    onClick={loadDriveHistoryFiles}
                    disabled={driveHistory.status === "loading"}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-forest disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {driveHistory.status === "loading" ? "讀取中" : "重新讀取 Google Drive 檔案清單"}
                  </button>
                </div>
                {driveHistory.message ? (
                  <p className="mt-2 text-xs text-slate-500">{driveHistory.message}</p>
                ) : null}
                {driveHistory.files.length ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                    <label className="block text-xs font-semibold text-brand-ink">
                      選擇歷史病歷檔案
                      <select
                        aria-label="選擇歷史病歷檔案"
                        value={selectedDriveFileId}
                        onChange={(event) => setSelectedDriveFileId(event.target.value)}
                        className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700"
                      >
                        {driveHistory.files.map((file) => (
                          <option key={file.id} value={file.id}>
                            {formatDriveRecordFileLabel(file)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={loadSelectedDriveRecordIntoForm}
                      disabled={!selectedDriveFileId || isLoadingDriveRecord}
                      className="self-end rounded-full bg-brand-forest px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isLoadingDriveRecord ? "載入中" : "載入選定檔案"}
                    </button>
                  </div>
                ) : null}
                {previousRecord ? (
                  <button
                    type="button"
                    onClick={loadPreviousRecordIntoForm}
                    className="mt-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-forest"
                  >
                    載入本機前次
                  </button>
                ) : null}
              </div>
            ) : null}
            {selectedSavedDraft ? (
              <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                已載入此個案暫存內容。切換個案或關閉視窗後，再回到同一路線仍會保留。
              </div>
            ) : null}
            {matchedCompletedVisit ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                已對應剛完成案件：{formatDateTimeFull(matchedCompletedVisit.detail.schedule.scheduled_start_at)} ／
                {maskPatientName(matchedCompletedVisit.detail.patient.name)}
              </div>
            ) : null}
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-brand-ink">當日網頁檔名稱</p>
                <span className="break-all text-xs text-slate-500">
                  {htmlExportFileName || "尚未產生"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5">
                網頁檔會以單次巡診為單位，檔名使用日期、醫師姓名、上午或下午與「居家個案病例紀錄」。
              </p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">開始治療時間</span>
              <input
                type="datetime-local"
                {...register("treatment_start_time")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">結束治療時間</span>
              <input
                type="datetime-local"
                {...register("treatment_end_time")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">{returnRecordTimeDefaults.hint}</p>

          <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <input
              type="checkbox"
              {...register("mark_as_exception")}
              className="h-4 w-4 rounded border-amber-300"
            />
            <span>勾選為異常個案，建立病歷後同步新增醫師與行政通知中心訊息</span>
          </label>

          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <label className="flex items-start gap-3 text-sm text-sky-900">
              <input
                type="checkbox"
                {...register("add_to_reminders")}
                className="h-4 w-4 rounded border-sky-300"
              />
              <span>加入通知中心，讓醫師與行政後續追蹤</span>
            </label>
            {watchedValues?.add_to_reminders ? (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">提醒內容</span>
                <textarea
                  {...register("reminder_note")}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  placeholder="補充需要追蹤、提醒或交班的內容"
                />
              </label>
            ) : null}
          </div>

          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">主訴</span>
              <select
                {...register("chief_complaint_option")}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇主訴</option>
                {chiefComplaintOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            {watchedValues?.chief_complaint_option === "其他" ? (
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">主訴其他內容</span>
                <textarea
                  {...register("chief_complaint_other")}
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
            {fourDiagnosisSections.map((section) => (
              <fieldset key={section.field} className="rounded-[1.5rem] border border-slate-200 p-4 lg:rounded-3xl">
                <legend className="px-2 text-sm font-semibold text-brand-ink">
                  {section.label}
                </legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {section.options.map((option) => (
                    <label key={option} className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        value={option}
                        {...register(section.field)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
                {((watchedValues?.[section.field] as string[] | undefined) ?? []).includes("其他") ? (
                  <label className="mt-4 block text-sm">
                    <span className="mb-1 block font-medium text-brand-ink">
                      {section.label} 其他
                    </span>
                    <input
                      type="text"
                      {...register(section.otherField)}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      placeholder={`補充${section.label}診其他描述`}
                    />
                  </label>
                ) : null}
              </fieldset>
            ))}
          </div>

          <fieldset className="rounded-[1.5rem] border border-slate-200 p-4 lg:rounded-3xl">
            <legend className="px-2 text-sm font-semibold text-brand-ink">病史</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {medicalHistoryOptions.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    value={option}
                    {...register("medical_history_tags")}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            {((watchedValues?.medical_history_tags as string[] | undefined) ?? []).includes("其他") ? (
              <label className="mt-4 block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">病史其他內容</span>
                <textarea
                  {...register("medical_history_other")}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
            ) : null}
          </fieldset>

          <fieldset className="rounded-[1.5rem] border border-slate-200 p-4 lg:rounded-3xl">
            <legend className="px-2 text-sm font-semibold text-brand-ink">處置</legend>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] lg:items-center">
                <label className="flex items-center gap-2 text-sm font-medium text-brand-ink">
                  <input
                    type="checkbox"
                    {...register("treatment_chinese_medicine_checked")}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>中藥</span>
                </label>
                <input
                  type="text"
                  aria-label="中藥處置內容"
                  {...register("treatment_chinese_medicine_note")}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                  placeholder="輸入中藥處置內容"
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] lg:items-center">
                <label className="flex items-center gap-2 text-sm font-medium text-brand-ink">
                  <input
                    type="checkbox"
                    {...register("treatment_acupuncture_checked")}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>針灸</span>
                </label>
                <input
                  type="text"
                  aria-label="針灸處置內容"
                  {...register("treatment_acupuncture_note")}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                  placeholder="輸入針灸處置內容"
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] lg:items-center">
                <label className="flex items-center gap-2 text-sm font-medium text-brand-ink">
                  <input
                    type="checkbox"
                    {...register("treatment_topical_medication_checked")}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>外用藥</span>
                </label>
                <input
                  type="text"
                  aria-label="外用藥處置內容"
                  {...register("treatment_topical_medication_note")}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                  placeholder="輸入外用藥處置內容"
                />
              </div>
            </div>
          </fieldset>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-brand-ink">病歷文字編輯方框</span>
              <button
                type="button"
                onClick={() => setValue("generated_record_text", autoDraft, { shouldDirty: true })}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-brand-ink"
              >
                重新產生病歷草稿
              </button>
            </div>
            <textarea
              {...register("generated_record_text")}
              rows={8}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              第一行會使用當下治療日期的民國格式與開始/結束時間，例如：1150421 09001000。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleSaveCurrentDraft}
              className="w-full rounded-full border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-semibold text-sky-800 lg:w-auto"
            >
              儲存此個案暫存
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!exportRows.length}
              className="w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
            >
              匯出此次出巡 CSV
            </button>
            <button
              type="submit"
              className="w-full rounded-full bg-brand-coral px-5 py-3 text-sm font-semibold text-white lg:w-auto"
            >
              建立回院病歷
            </button>
            <button
              type="button"
              onClick={handleExportHtml}
              disabled={!exportRows.length}
              className="w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
            >
              匯出巡診網頁檔
            </button>
            <button
              type="button"
              onClick={handleSaveHtmlToGoogleDrive}
              disabled={!exportRows.length}
              className="w-full rounded-full bg-brand-forest px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
            >
              儲存到 Google Drive
            </button>
          </div>
          {draftSaveMessage ? (
            <p className="text-xs text-sky-700">{draftSaveMessage}</p>
          ) : null}
          {googleDriveStatus ? (
            <p className="text-xs text-slate-500">{googleDriveStatus}</p>
          ) : null}
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 lg:rounded-3xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-brand-ink">當日個案紀錄</p>
              <span className="text-xs text-slate-500">{exportRows.length} 筆</span>
            </div>
            <div className="mt-3 space-y-2">
              {exportRows.map((row) => (
                <div
                  key={row.linkedHomeVisitScheduleId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-brand-ink">
                      {row.routeOrder ?? ""}｜{maskPatientName(row.patientName)}｜{row.chartNumber}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {row.generatedRecordText || "尚無病歷全文"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyRecord(row)}
                    className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-brand-forest ring-1 ring-slate-200"
                  >
                    {copiedPatientId === row.linkedHomeVisitScheduleId ? "已複製" : "複製"}
                  </button>
                </div>
              ))}
            </div>
          </div>
    </form>
  );

  return (
    <div className="space-y-4">
      {embeddedWindow ? null : (
        <Panel
          title="醫師回院產生病歷"
          action={
            <button
              type="button"
              onClick={() => setIsReturnRecordModalOpen(true)}
              className="rounded-full bg-brand-coral px-5 py-2.5 text-sm font-semibold text-white"
            >
              開啟回院病歷視窗
            </button>
          }
        >
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <p className="font-semibold text-brand-ink">目前作業</p>
            <p className="mt-1">
              回院病歷登打、路線與個案選擇、CSV 匯出都會在目前頁面的內嵌視窗中進行，不會另開瀏覽器視窗。
            </p>
          </div>
        </Panel>
      )}

      {embeddedWindow ? (
        <Panel title="回院病歷登打">{returnRecordForm}</Panel>
      ) : isReturnRecordModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-2 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="回院病歷視窗"
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[1.5rem] bg-brand-sand shadow-2xl lg:max-h-[calc(100dvh-2rem)] lg:rounded-[2rem]"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-5 lg:py-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-brand-coral">醫師端視窗</p>
                <h2 className="mt-1 text-lg font-semibold text-brand-ink lg:text-xl">回院病歷</h2>
              </div>
              <button
                type="button"
                onClick={closeReturnRecordWindow}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉視窗
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 lg:p-5">
              <Panel title="回院病歷登打">{returnRecordForm}</Panel>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
