import { useForm } from "react-hook-form";
import { useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { VisitRecord } from "../../domain/models";
import { applyVisitRecordRules } from "../../domain/rules";
import {
  buildReadonlySummary,
  getScheduleDisplayRange
} from "../../modules/doctor/doctor-page-helpers";
import { Panel } from "../../shared/ui/Panel";
import { maskPatientName } from "../../shared/utils/patient-name";
import {
  formatDateTimeFull,
  fromDateTimeLocalValue,
  toDateTimeLocalValue
} from "../../shared/utils/format";

type RecordFormValues = {
  departure_time: string;
  treatment_duration_minutes: number;
  chief_complaint: string;
  sleep_status: string;
  appetite_status: string;
  bowel_movement_status: string;
  pain_status: string;
  energy_status: string;
  caregiver_feedback: string;
  physician_assessment: string;
  treatment_provided: string;
  follow_up_note: string;
  next_visit_suggestion_date: string;
};

export function DoctorRecordPage() {
  const { visitScheduleId } = useParams();
  const { repositories } = useAppContext();
  const detail = visitScheduleId
    ? repositories.visitRepository.getScheduleDetail(visitScheduleId)
    : undefined;
  const existing = detail?.record;

  const { register, handleSubmit } = useForm<RecordFormValues>({
    defaultValues: {
      departure_time: toDateTimeLocalValue(existing?.departure_time),
      treatment_duration_minutes:
        existing?.treatment_duration_minutes ?? detail?.schedule.estimated_treatment_minutes ?? 30,
      chief_complaint: existing?.chief_complaint ?? detail?.schedule.visit_type ?? "",
      sleep_status: existing?.sleep_status ?? "",
      appetite_status: existing?.appetite_status ?? "",
      bowel_movement_status: existing?.bowel_movement_status ?? "",
      pain_status: existing?.pain_status ?? "",
      energy_status: existing?.energy_status ?? "",
      caregiver_feedback: existing?.caregiver_feedback ?? "",
      physician_assessment: existing?.physician_assessment ?? existing?.doctor_note ?? "",
      treatment_provided: existing?.treatment_provided ?? "",
      follow_up_note: existing?.follow_up_note ?? "",
      next_visit_suggestion_date: existing?.next_visit_suggestion_date ?? ""
    }
  });

  if (!detail) {
    return <Panel title="查無排程">找不到指定訪視排程。</Panel>;
  }

  const timeSummary = buildReadonlySummary(existing);

  const onSubmit = (values: RecordFormValues) => {
    const nextRecord: VisitRecord = applyVisitRecordRules(
      {
        id: existing?.id ?? `vr-${detail.schedule.id}`,
        visit_schedule_id: detail.schedule.id,
        departure_time: fromDateTimeLocalValue(values.departure_time),
        arrival_time: existing?.arrival_time ?? null,
        departure_from_patient_home_time: existing?.departure_from_patient_home_time ?? null,
        chief_complaint: values.chief_complaint,
        sleep_status: values.sleep_status,
        appetite_status: values.appetite_status,
        bowel_movement_status: values.bowel_movement_status,
        pain_status: values.pain_status,
        energy_status: values.energy_status,
        inspection_tags: existing?.inspection_tags ?? [],
        inspection_other: existing?.inspection_other ?? "",
        listening_tags: existing?.listening_tags ?? [],
        listening_other: existing?.listening_other ?? "",
        inquiry_tags: existing?.inquiry_tags ?? [],
        inquiry_other: existing?.inquiry_other ?? "",
        palpation_tags: existing?.palpation_tags ?? [],
        palpation_other: existing?.palpation_other ?? "",
        caregiver_feedback: values.caregiver_feedback,
        physician_assessment: values.physician_assessment,
        treatment_provided: values.treatment_provided,
        doctor_note: values.physician_assessment,
        follow_up_note: values.follow_up_note,
        medical_history_note: existing?.medical_history_note ?? values.follow_up_note,
        generated_record_text: existing?.generated_record_text ?? "",
        next_visit_suggestion_date: values.next_visit_suggestion_date || null,
        visit_feedback_code: existing?.visit_feedback_code ?? null,
        visit_feedback_at: existing?.visit_feedback_at ?? null,
        family_followup_status: existing?.family_followup_status ?? "not_needed",
        family_followup_sent_at: existing?.family_followup_sent_at ?? null,
        created_at: existing?.created_at ?? detail.schedule.created_at,
        updated_at: new Date().toISOString(),
        treatment_duration_minutes: values.treatment_duration_minutes,
        treatment_duration_manually_adjusted:
          values.treatment_duration_minutes !== detail.schedule.estimated_treatment_minutes
      },
      detail.schedule.estimated_treatment_minutes
    );

    repositories.visitRepository.upsertVisitRecord(nextRecord);
    window.alert("訪視紀錄已更新，時間摘要與行政端狀態會同步反映。");
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
      <div className="space-y-6">
        <Panel title="時間摘要區塊">
          <div className="space-y-3">
            {timeSummary.map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className="mt-2 text-sm font-semibold text-brand-ink">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            出發、抵達、離開患者時間會由首頁流程與定位判定自動寫入；車程時間會依出發到抵達自動計算。
          </p>
        </Panel>

        <Panel title="本次訪視摘要">
          <div className="space-y-3 text-sm text-slate-600">
            <p>個案：{maskPatientName(detail.patient.name)}</p>
            <p>預約時間：{formatDateTimeFull(detail.schedule.scheduled_start_at)}</p>
            <p>預估治療時段：{getScheduleDisplayRange(detail.schedule, existing)}</p>
            <p>出發時間可由首頁的「出發」快速記錄，這裡以摘要與紀錄內容為主。</p>
          </div>
        </Panel>
      </div>

      <Panel title="快速訪視紀錄頁">
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-brand-ink">出發時間</span>
            <input
              type="datetime-local"
              {...register("departure_time")}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
            />
          </label>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">主訴</span>
              <textarea {...register("chief_complaint")} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">睡眠</span>
              <textarea {...register("sleep_status")} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">食慾</span>
              <textarea {...register("appetite_status")} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">排便</span>
              <textarea {...register("bowel_movement_status")} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">疼痛</span>
              <textarea {...register("pain_status")} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">精神體力</span>
              <textarea {...register("energy_status")} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-brand-ink">醫師評估摘要</span>
            <textarea {...register("physician_assessment")} rows={4} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-brand-ink">本次處置</span>
            <textarea {...register("treatment_provided")} rows={4} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
          </label>

          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">下次追蹤事項</span>
              <textarea {...register("follow_up_note")} rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">下次建議訪視日期</span>
                <input type="date" {...register("next_visit_suggestion_date")} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">治療時長（分鐘）</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  {...register("treatment_duration_minutes", { valueAsNumber: true })}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
            </div>
          </div>

          <button type="submit" className="rounded-full bg-brand-coral px-5 py-3 text-sm font-semibold text-white">
            儲存 mock 訪視紀錄
          </button>
        </form>
      </Panel>
    </div>
  );
}
