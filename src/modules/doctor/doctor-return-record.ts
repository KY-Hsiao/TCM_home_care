import { differenceInMinutes, format } from "date-fns";
import type { VisitRecord } from "../../domain/models";
import { formatRocCompactDate } from "../../shared/utils/format";

export const fourDiagnosisOptions = {
  inspection: [
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
  ],
  listening: [
    "語音低弱",
    "少氣懶言",
    "呼吸短促",
    "喘息",
    "痰鳴",
    "咳聲無力",
    "咳聲重濁",
    "乾咳少痰",
    "口氣重",
    "口氣酸臭",
    "鼻氣濁",
    "痰味臭",
    "其他"
  ],
  inquiry: [
    "疲倦乏力",
    "胃口差",
    "食少",
    "吞嚥不利",
    "口乾",
    "腹脹",
    "便祕",
    "腹瀉",
    "尿少",
    "頻尿",
    "夜尿多",
    "失眠",
    "多夢",
    "疼痛固定",
    "肢體麻木",
    "其他"
  ],
  palpation: [
    "脈沉",
    "脈遲",
    "脈數",
    "脈細",
    "脈弱",
    "脈弦",
    "脈滑",
    "脈澀",
    "按之無力",
    "腹部脹滿",
    "腹部壓痛",
    "四肢冰冷",
    "手足溫",
    "下肢水腫",
    "肌肉萎縮",
    "其他"
  ]
} as const;

export type FourDiagnosisSelections = {
  inspection_tags: string[];
  inspection_other: string;
  listening_tags: string[];
  listening_other: string;
  inquiry_tags: string[];
  inquiry_other: string;
  palpation_tags: string[];
  palpation_other: string;
};

export type ReturnRecordDraftInput = FourDiagnosisSelections & {
  chiefComplaint: string;
  medicalHistory: string;
  treatmentStartTime: string;
  treatmentEndTime: string;
};

function normalizeTagsWithOther(
  tags: string[],
  otherValue: string,
  orderedOptions: readonly string[]
) {
  const hasOther = tags.includes("其他");
  const visibleTags = orderedOptions.filter((option) => option !== "其他" && tags.includes(option));
  if (!hasOther) {
    return visibleTags;
  }

  const trimmedOther = otherValue.trim();
  return [...visibleTags, trimmedOther ? `其他：${trimmedOther}` : "其他"];
}

function joinTags(tags: string[], otherValue: string, orderedOptions: readonly string[]) {
  const normalized = normalizeTagsWithOther(tags, otherValue, orderedOptions);
  return normalized.length ? normalized.join("、") : "未勾選";
}

function formatTimeRange(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  return `${formatRocCompactDate(start)} ${format(start, "HHmm")}${format(end, "HHmm")}`;
}

export function buildFourDiagnosisSummary(input: FourDiagnosisSelections) {
  return `四診：望 ${joinTags(
    input.inspection_tags,
    input.inspection_other,
    fourDiagnosisOptions.inspection
  )}；聞 ${joinTags(
    input.listening_tags,
    input.listening_other,
    fourDiagnosisOptions.listening
  )}；問 ${joinTags(
    input.inquiry_tags,
    input.inquiry_other,
    fourDiagnosisOptions.inquiry
  )}；切 ${joinTags(
    input.palpation_tags,
    input.palpation_other,
    fourDiagnosisOptions.palpation
  )}`;
}

export function buildReturnRecordDraft(input: ReturnRecordDraftInput) {
  return [
    formatTimeRange(input.treatmentStartTime, input.treatmentEndTime),
    buildFourDiagnosisSummary(input),
    `主訴：${input.chiefComplaint || "未填寫"}`,
    `病史：${input.medicalHistory || "未填寫"}`
  ].join("\n");
}

export function resolvePreviousMedicalHistory(record: VisitRecord | undefined, fallback = "") {
  return (
    record?.medical_history_note ||
    record?.follow_up_note ||
    record?.generated_record_text.match(/病史：(.+)/)?.[1] ||
    fallback
  );
}

export function buildReturnVisitSummary(record: VisitRecord | undefined) {
  if (!record?.generated_record_text) {
    return "尚無上一筆回院病歷。";
  }
  return record.generated_record_text;
}

export function buildPreviousFourDiagnosisSelections(
  record: VisitRecord | undefined
): FourDiagnosisSelections {
  return {
    inspection_tags: record?.inspection_tags ?? [],
    inspection_other: record?.inspection_other ?? "",
    listening_tags: record?.listening_tags ?? [],
    listening_other: record?.listening_other ?? "",
    inquiry_tags: record?.inquiry_tags ?? [],
    inquiry_other: record?.inquiry_other ?? "",
    palpation_tags: record?.palpation_tags ?? [],
    palpation_other: record?.palpation_other ?? ""
  };
}

export function calculateTreatmentDurationMinutes(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  return Math.max(1, differenceInMinutes(end, start));
}
