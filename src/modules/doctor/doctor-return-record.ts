import { differenceInMinutes, format } from "date-fns";
import type { VisitRecord } from "../../domain/models";
import {
  formatDateOnly,
  formatDateTimeFull,
  formatRocCompactDate
} from "../../shared/utils/format";

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

export const medicalHistoryOptions = [
  "相關外傷",
  "中風",
  "糖尿病",
  "高血壓",
  "高血脂",
  "心臟病",
  "退化性關節炎",
  "下背痛",
  "帕金森氏症",
  "失智症",
  "其他"
] as const;

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
  reminderNote?: string;
  treatmentProvidedSummary?: string;
  treatmentStartTime: string;
  treatmentEndTime: string;
};

export type ReturnRecordCsvRow = {
  routeDate: string;
  routeName: string;
  doctorName: string;
  serviceTimeSlot: string;
  routeOrder: number | null;
  patientName: string;
  chartNumber: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  departureFromPatientHomeTime: string | null;
  returnRecordStartTime: string | null;
  returnRecordEndTime: string | null;
  chiefComplaint: string;
  fourDiagnosisSummary: string;
  medicalHistory: string;
  isException: boolean;
  reminderNote: string;
  generatedRecordText: string;
  linkedHomeVisitScheduleId: string;
  returnRecordScheduleId: string;
};

export type TreatmentProvidedSelections = {
  treatment_chinese_medicine_checked: boolean;
  treatment_chinese_medicine_note: string;
  treatment_acupuncture_checked: boolean;
  treatment_acupuncture_note: string;
  treatment_topical_medication_checked: boolean;
  treatment_topical_medication_note: string;
};

export type ReturnRecordHtmlRow = ReturnRecordCsvRow;

function escapeHtml(value: string | number | boolean | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeFileToken(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "")
    .trim();
}

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

export function joinMedicalHistory(tags: string[], otherValue: string) {
  return joinTags(tags, otherValue, medicalHistoryOptions);
}

function buildTreatmentTimeSummary(startValue: string, endValue: string) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  return [
    `治療日期：${formatRocCompactDate(start)}`,
    `開始治療時間：${format(start, "HHmm")}`,
    `結束治療時間：${format(end, "HHmm")}`
  ].join("\n");
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
    buildTreatmentTimeSummary(input.treatmentStartTime, input.treatmentEndTime),
    buildFourDiagnosisSummary(input),
    `主訴：${input.chiefComplaint || "未填寫"}`,
    `病史：${input.medicalHistory || "未填寫"}`,
    input.treatmentProvidedSummary?.trim()
      ? `處置：${input.treatmentProvidedSummary.trim()}`
      : "",
    input.reminderNote?.trim() ? `提醒：${input.reminderNote.trim()}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTreatmentProvidedSummary(input: TreatmentProvidedSelections) {
  const items = [
    {
      checked: input.treatment_chinese_medicine_checked,
      label: "中藥",
      note: input.treatment_chinese_medicine_note
    },
    {
      checked: input.treatment_acupuncture_checked,
      label: "針灸",
      note: input.treatment_acupuncture_note
    },
    {
      checked: input.treatment_topical_medication_checked,
      label: "外用藥",
      note: input.treatment_topical_medication_note
    }
  ];

  return items
    .filter((item) => item.checked)
    .map((item) => {
      const note = item.note.trim();
      return note ? `${item.label}：${note}` : item.label;
    })
    .join("；");
}

export function buildPreviousTreatmentProvidedSelections(
  record: VisitRecord | undefined
): TreatmentProvidedSelections {
  return {
    treatment_chinese_medicine_checked: record?.treatment_chinese_medicine_checked ?? false,
    treatment_chinese_medicine_note: record?.treatment_chinese_medicine_note ?? "",
    treatment_acupuncture_checked: record?.treatment_acupuncture_checked ?? false,
    treatment_acupuncture_note: record?.treatment_acupuncture_note ?? "",
    treatment_topical_medication_checked: record?.treatment_topical_medication_checked ?? false,
    treatment_topical_medication_note: record?.treatment_topical_medication_note ?? ""
  };
}

function escapeCsvCell(value: string | number | boolean | null | undefined) {
  const stringValue = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function buildFourDiagnosisSummaryFromRecord(record: VisitRecord | undefined) {
  if (!record) {
    return "";
  }

  return buildFourDiagnosisSummary({
    inspection_tags: record.inspection_tags ?? [],
    inspection_other: record.inspection_other ?? "",
    listening_tags: record.listening_tags ?? [],
    listening_other: record.listening_other ?? "",
    inquiry_tags: record.inquiry_tags ?? [],
    inquiry_other: record.inquiry_other ?? "",
    palpation_tags: record.palpation_tags ?? [],
    palpation_other: record.palpation_other ?? ""
  });
}

export function extractReminderNoteFromRecord(record: VisitRecord | undefined) {
  const matchedNote = record?.generated_record_text.match(/提醒：(.+)/)?.[1];
  return matchedNote?.trim() ?? "";
}

export function isExceptionReturnRecord(record: VisitRecord | undefined) {
  return record?.treatment_provided.includes("異常個案") ?? false;
}

export function buildReturnRecordCsv(rows: ReturnRecordCsvRow[]) {
  const header = [
    "出巡日期",
    "路線名稱",
    "醫師",
    "服務時段",
    "站序",
    "個案姓名",
    "病歷號",
    "居家訪視開始",
    "居家訪視結束",
    "離開個案時間",
    "回院病歷開始",
    "回院病歷結束",
    "主訴",
    "四診摘要",
    "病史",
    "異常個案",
    "提醒內容",
    "病歷全文",
    "居家訪視排程ID",
    "回院病歷排程ID"
  ];

  const csvRows = rows.map((row) => [
    formatDateOnly(row.routeDate),
    row.routeName,
    row.doctorName,
    row.serviceTimeSlot,
    row.routeOrder ?? "",
    row.patientName,
    row.chartNumber,
    formatDateTimeFull(row.scheduledStartAt),
    formatDateTimeFull(row.scheduledEndAt),
    formatDateTimeFull(row.departureFromPatientHomeTime),
    formatDateTimeFull(row.returnRecordStartTime),
    formatDateTimeFull(row.returnRecordEndTime),
    row.chiefComplaint,
    row.fourDiagnosisSummary,
    row.medicalHistory,
    row.isException ? "是" : "否",
    row.reminderNote,
    row.generatedRecordText,
    row.linkedHomeVisitScheduleId,
    row.returnRecordScheduleId
  ]);

  return [header, ...csvRows]
    .map((columns) => columns.map((value) => escapeCsvCell(value)).join(","))
    .join("\n");
}

export function buildReturnRecordHtmlFileName(input: {
  routeDate: string;
  doctorName: string;
  serviceTimeSlot: string;
}) {
  const dateToken = input.routeDate.replace(/-/g, "");
  const doctorToken = normalizeFileToken(input.doctorName || "未指定醫師");
  const slotToken = normalizeFileToken(input.serviceTimeSlot || "未指定時段");
  return `${dateToken}_${doctorToken}_${slotToken}_居家個案病例紀錄.html`;
}

export function buildReturnRecordCopyText(row: ReturnRecordHtmlRow) {
  return [
    `個案：${row.patientName}（${row.chartNumber}）`,
    `醫師：${row.doctorName}`,
    `出巡：${formatDateOnly(row.routeDate)} ${row.serviceTimeSlot}`,
    `站序：${row.routeOrder ?? ""}`,
    `回院病歷時間：${formatDateTimeFull(row.returnRecordStartTime)} 至 ${formatDateTimeFull(row.returnRecordEndTime)}`,
    `主訴：${row.chiefComplaint || "未填寫"}`,
    row.fourDiagnosisSummary,
    `病史：${row.medicalHistory || "未填寫"}`,
    row.reminderNote ? `提醒：${row.reminderNote}` : "",
    "",
    row.generatedRecordText
  ]
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .trim();
}

export function buildReturnRecordHtml(rows: ReturnRecordHtmlRow[]) {
  const firstRow = rows[0];
  const title = firstRow
    ? `${formatDateOnly(firstRow.routeDate)} ${firstRow.doctorName} ${firstRow.serviceTimeSlot} 居家個案病例紀錄`
    : "居家個案病例紀錄";
  const generatedAt = formatDateTimeFull(new Date().toISOString());
  const recordCards = rows
    .map((row, index) => {
      const copyText = buildReturnRecordCopyText(row);
      return `
        <article class="record-card" id="record-${index + 1}">
          <div class="record-header">
            <div>
              <p class="eyebrow">第 ${escapeHtml(row.routeOrder ?? index + 1)} 站</p>
              <h2>${escapeHtml(row.patientName)} <span>${escapeHtml(row.chartNumber)}</span></h2>
            </div>
            <button type="button" class="copy-button" data-copy-target="record-copy-${index + 1}">複製</button>
          </div>
          <dl class="meta-grid">
            <div><dt>回院病歷時間</dt><dd>${escapeHtml(formatDateTimeFull(row.returnRecordStartTime))} 至 ${escapeHtml(formatDateTimeFull(row.returnRecordEndTime))}</dd></div>
            <div><dt>居家訪視時間</dt><dd>${escapeHtml(formatDateTimeFull(row.scheduledStartAt))} 至 ${escapeHtml(formatDateTimeFull(row.scheduledEndAt))}</dd></div>
            <div><dt>主訴</dt><dd>${escapeHtml(row.chiefComplaint || "未填寫")}</dd></div>
            <div><dt>異常個案</dt><dd>${row.isException ? "是" : "否"}</dd></div>
          </dl>
          <section>
            <h3>四診摘要</h3>
            <p>${escapeHtml(row.fourDiagnosisSummary || "未填寫")}</p>
          </section>
          <section>
            <h3>病史</h3>
            <p>${escapeHtml(row.medicalHistory || "未填寫")}</p>
          </section>
          ${row.reminderNote ? `<section><h3>提醒內容</h3><p>${escapeHtml(row.reminderNote)}</p></section>` : ""}
          <section>
            <h3>病歷全文</h3>
            <pre>${escapeHtml(row.generatedRecordText || "未填寫")}</pre>
          </section>
          <textarea id="record-copy-${index + 1}" class="copy-source" aria-hidden="true">${escapeHtml(copyText)}</textarea>
        </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f8fafc; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(1100px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 40px; }
    header { margin-bottom: 18px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.3; }
    .summary { margin: 8px 0 0; color: #64748b; }
    .record-card { margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; padding: 18px; }
    .record-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
    .eyebrow { margin: 0 0 4px; color: #0f766e; font-size: 13px; font-weight: 700; }
    h2 { margin: 0; font-size: 22px; }
    h2 span { color: #64748b; font-size: 16px; font-weight: 600; }
    h3 { margin: 16px 0 6px; font-size: 15px; }
    p { margin: 0; line-height: 1.7; white-space: pre-wrap; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; line-height: 1.7; font: 14px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0 0; }
    dt { color: #64748b; font-size: 12px; font-weight: 700; }
    dd { margin: 3px 0 0; line-height: 1.6; }
    .copy-button { border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; color: #172033; padding: 8px 14px; font-weight: 700; cursor: pointer; }
    .copy-button.copied { background: #0f766e; color: #fff; border-color: #0f766e; }
    .copy-source { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
    @media (max-width: 720px) { .meta-grid { grid-template-columns: 1fr; } h1 { font-size: 22px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p class="summary">路線：${escapeHtml(firstRow?.routeName ?? "未指定")}｜共 ${rows.length} 位個案｜產生時間：${escapeHtml(generatedAt)}</p>
    </header>
    ${recordCards || "<p>尚無病歷資料。</p>"}
  </main>
  <script>
    document.querySelectorAll(".copy-button").forEach(function(button) {
      button.addEventListener("click", async function() {
        var target = document.getElementById(button.getAttribute("data-copy-target"));
        var text = target ? target.value : "";
        try {
          await navigator.clipboard.writeText(text);
        } catch (error) {
          target.focus();
          target.select();
          document.execCommand("copy");
        }
        button.textContent = "已複製";
        button.classList.add("copied");
        window.setTimeout(function() {
          button.textContent = "複製";
          button.classList.remove("copied");
        }, 1600);
      });
    });
  </script>
</body>
</html>`;
}

export function resolvePreviousMedicalHistory(record: VisitRecord | undefined, fallback = "") {
  return (
    record?.medical_history_note ||
    record?.follow_up_note ||
    record?.generated_record_text.match(/病史：(.+)/)?.[1] ||
    fallback
  );
}

export function buildPreviousMedicalHistorySelections(record: VisitRecord | undefined, fallback = "") {
  const history = resolvePreviousMedicalHistory(record, fallback)
    .split(/[、,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const selectedTags = medicalHistoryOptions.filter(
    (option) =>
      option !== "其他" &&
      history.some((item) => item.includes(option))
  );
  const otherItem = history.find((item) => item.startsWith("其他："));
  const hasGenericOther = history.includes("其他");
  const unmatchedItems = history.filter(
    (item) =>
      !selectedTags.some((tag) => item.includes(tag)) &&
      item !== "其他" &&
      !item.startsWith("其他：")
  );
  const otherValue = otherItem?.replace(/^其他：/, "").trim() ?? unmatchedItems.join("、");
  const tags =
    hasGenericOther || Boolean(otherItem) || unmatchedItems.length > 0
      ? [...selectedTags, "其他"]
      : [...selectedTags];

  return {
    medical_history_tags: tags,
    medical_history_other: otherValue
  };
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
