import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addMinutes } from "date-fns";
import { useForm, useWatch } from "react-hook-form";
import { useAppContext } from "../../app/use-app-context";
import type { VisitRecord, VisitSchedule } from "../../domain/models";
import {
  buildPreviousFourDiagnosisSelections,
  buildReturnRecordDraft,
  buildReturnVisitSummary,
  calculateTreatmentDurationMinutes,
  fourDiagnosisOptions,
  resolvePreviousMedicalHistory
} from "../../modules/doctor/doctor-return-record";
import { Panel } from "../../shared/ui/Panel";
import {
  formatDateOnly,
  formatDateTimeFull,
  fromDateTimeLocalValue,
  toDateTimeLocalValue
} from "../../shared/utils/format";

type ReturnRecordFormValues = {
  patient_id: string;
  chief_complaint: string;
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
  medical_history_note: string;
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

function buildInitialStartTime() {
  return toDateTimeLocalValue(new Date().toISOString());
}

function buildInitialEndTime() {
  return toDateTimeLocalValue(addMinutes(new Date(), 30).toISOString());
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
  note: string
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
    route_group_id: `return-${patientId}-${startAt.slice(0, 10)}`,
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

export function DoctorReturnRecordPage() {
  const { repositories, session } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const patients = useMemo(() => {
    const schedules = repositories.visitRepository.getSchedules({
      doctorId: session.activeDoctorId
    });
    const schedulePatientIds = new Set(schedules.map((schedule) => schedule.patient_id));
    return repositories.patientRepository
      .getPatients()
      .filter(
        (patient) =>
          patient.preferred_doctor_id === session.activeDoctorId ||
          schedulePatientIds.has(patient.id)
      );
  }, [repositories, session.activeDoctorId]);

  const defaultPatientId =
    patients.find((patient) => patient.id === searchParams.get("patientId"))?.id ??
    patients[0]?.id ??
    "";

  const { control, getValues, handleSubmit, register, reset, setValue } =
    useForm<ReturnRecordFormValues>({
      defaultValues: {
        patient_id: defaultPatientId,
        chief_complaint: "",
        treatment_start_time: buildInitialStartTime(),
        treatment_end_time: buildInitialEndTime(),
        inspection_tags: [],
        inspection_other: "",
        listening_tags: [],
        listening_other: "",
        inquiry_tags: [],
        inquiry_other: "",
        palpation_tags: [],
        palpation_other: "",
        medical_history_note: "",
        generated_record_text: ""
      }
    });

  const selectedPatientId = useWatch({ control, name: "patient_id" });
  const selectedProfile = useMemo(
    () =>
      selectedPatientId
        ? repositories.patientRepository.getPatientProfile(selectedPatientId)
        : undefined,
    [repositories, selectedPatientId]
  );
  const previousRecord = useMemo(() => selectedProfile?.visitRecords[0], [selectedProfile]);
  const previousAutoDraftRef = useRef("");
  const previousRecordUpdatedAt = previousRecord?.updated_at ?? "";
  const selectedPatientMedicalHistory = selectedProfile?.patient.important_medical_history ?? "";

  useEffect(() => {
    if (!selectedPatientId) {
      return;
    }

    const nextHistory = resolvePreviousMedicalHistory(
      previousRecord,
      selectedPatientMedicalHistory
    );
    const previousSelections = buildPreviousFourDiagnosisSelections(previousRecord);
    const nextValues: ReturnRecordFormValues = {
      patient_id: selectedPatientId,
      chief_complaint: "",
      treatment_start_time: buildInitialStartTime(),
      treatment_end_time: buildInitialEndTime(),
      ...previousSelections,
      medical_history_note: nextHistory,
      generated_record_text: ""
    };

    const initialDraft = buildReturnRecordDraft({
      chiefComplaint: nextValues.chief_complaint,
      treatmentStartTime: nextValues.treatment_start_time,
      treatmentEndTime: nextValues.treatment_end_time,
      inspection_tags: nextValues.inspection_tags,
      inspection_other: nextValues.inspection_other,
      listening_tags: nextValues.listening_tags,
      listening_other: nextValues.listening_other,
      inquiry_tags: nextValues.inquiry_tags,
      inquiry_other: nextValues.inquiry_other,
      palpation_tags: nextValues.palpation_tags,
      palpation_other: nextValues.palpation_other,
      medicalHistory: nextValues.medical_history_note
    });
    previousAutoDraftRef.current = initialDraft;
    reset({
      ...nextValues,
      generated_record_text: initialDraft
    });
    setSearchParams({ patientId: selectedPatientId }, { replace: true });
  }, [
    previousRecordUpdatedAt,
    previousRecord,
    reset,
    selectedPatientId,
    selectedPatientMedicalHistory,
    setSearchParams
  ]);

  const watchedValues = useWatch({ control });
  const autoDraft = useMemo(() => {
    const draftValues = watchedValues ?? getValues();
    if (
      !draftValues.treatment_start_time ||
      !draftValues.treatment_end_time
    ) {
      return "";
    }

    return buildReturnRecordDraft({
      chiefComplaint: draftValues.chief_complaint ?? "",
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
      medicalHistory: draftValues.medical_history_note ?? ""
    });
  }, [getValues, watchedValues]);

  useEffect(() => {
    const currentDraft = getValues("generated_record_text");
    if (!currentDraft || currentDraft === previousAutoDraftRef.current) {
      setValue("generated_record_text", autoDraft, { shouldDirty: false });
    }
    previousAutoDraftRef.current = autoDraft;
  }, [autoDraft, getValues, setValue]);

  const onSubmit = (values: ReturnRecordFormValues) => {
    if (!selectedProfile) {
      window.alert("請先選擇個案。");
      return;
    }

    const treatmentStartTime = fromDateTimeLocalValue(values.treatment_start_time);
    const treatmentEndTime = fromDateTimeLocalValue(values.treatment_end_time);
    if (!treatmentStartTime || !treatmentEndTime) {
      window.alert("請完整填寫開始與結束治療時間。");
      return;
    }

    if (new Date(treatmentEndTime) <= new Date(treatmentStartTime)) {
      window.alert("結束治療時間需晚於開始治療時間。");
      return;
    }

    const estimatedMinutes = calculateTreatmentDurationMinutes(
      values.treatment_start_time,
      values.treatment_end_time
    );
    const noteTitle = `回院病歷｜${values.chief_complaint || "未填主訴"}`;
    const schedule = buildScheduleFromRecord(
      selectedProfile.patient.id,
      session.activeDoctorId,
      treatmentStartTime,
      treatmentEndTime,
      selectedProfile.recentSchedules[0]?.area ?? "回院病歷",
      selectedProfile.patient.address,
      selectedProfile.patient.google_maps_link,
      selectedProfile.patient.home_latitude,
      selectedProfile.patient.home_longitude,
      estimatedMinutes,
      noteTitle
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
      chief_complaint: values.chief_complaint,
      sleep_status: "",
      appetite_status: "",
      bowel_movement_status: "",
      pain_status: "",
      energy_status: "",
      inspection_tags: values.inspection_tags,
      inspection_other: values.inspection_other,
      listening_tags: values.listening_tags,
      listening_other: values.listening_other,
      inquiry_tags: values.inquiry_tags,
      inquiry_other: values.inquiry_other,
      palpation_tags: values.palpation_tags,
      palpation_other: values.palpation_other,
      physician_assessment: values.generated_record_text,
      treatment_provided: "已由醫師回院病歷頁建立病歷。",
      doctor_note: values.generated_record_text,
      caregiver_feedback: "",
      follow_up_note: values.medical_history_note,
      medical_history_note: values.medical_history_note,
      generated_record_text: values.generated_record_text,
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
    window.alert("回院病歷已建立，病史與病歷內容會作為下次自動帶入基礎。");
  };

  if (!patients.length) {
    return <Panel title="查無個案">目前此醫師沒有可建立回院病歷的個案資料。</Panel>;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
      <div className="space-y-6">
        <Panel title="回院病歷設定">
          <div className="space-y-4 text-sm text-slate-600">
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">選擇個案</span>
              <select
                {...register("patient_id")}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.chart_number}｜{patient.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedProfile ? (
              <>
                <p>個案：{selectedProfile.patient.name}</p>
                <p>生日：{formatDateOnly(selectedProfile.patient.date_of_birth)}</p>
                <p>重要病史：{selectedProfile.patient.important_medical_history}</p>
                <p>上次追蹤摘要：{selectedProfile.patient.last_visit_summary}</p>
                <Link
                  to={`/doctor/patients/${selectedProfile.patient.id}`}
                  className="inline-flex rounded-full bg-brand-sand px-3 py-2 text-xs font-semibold text-brand-forest"
                >
                  查看個案完整資訊
                </Link>
              </>
            ) : null}
          </div>
        </Panel>

        <Panel title="上一筆自動帶入內容">
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              最近更新：
              {previousRecord ? formatDateTimeFull(previousRecord.updated_at) : "尚無病歷"}
            </p>
            <pre className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              {buildReturnVisitSummary(previousRecord)}
            </pre>
          </div>
        </Panel>
      </div>

      <Panel title="醫師回院產生病歷">
        <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-4 md:grid-cols-2">
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

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-brand-ink">主訴</span>
            <textarea
              {...register("chief_complaint")}
              rows={3}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            {fourDiagnosisSections.map((section) => (
              <fieldset key={section.field} className="rounded-3xl border border-slate-200 p-4">
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

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-brand-ink">病史</span>
            <textarea
              {...register("medical_history_note")}
              rows={5}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
            />
          </label>

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

          <button
            type="submit"
            className="rounded-full bg-brand-coral px-5 py-3 text-sm font-semibold text-white"
          >
            建立回院病歷
          </button>
        </form>
      </Panel>
    </div>
  );
}
