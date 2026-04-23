import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addMinutes } from "date-fns";
import { useForm, useWatch } from "react-hook-form";
import { useAppContext } from "../../app/use-app-context";
import type { Reminder, VisitRecord, VisitSchedule } from "../../domain/models";
import {
  buildPreviousMedicalHistorySelections,
  buildPreviousFourDiagnosisSelections,
  buildReturnRecordDraft,
  calculateTreatmentDurationMinutes,
  fourDiagnosisOptions,
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

type ReturnRecordFormValues = {
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
    hint: "尚無可沿用的居家治療時間，先帶入目前時間。"
  };
}

function resolveReturnRecordTimeDefaults(
  patientId: string | undefined,
  doctorId: string,
  repositories: ReturnType<typeof useAppContext>["repositories"]
): ReturnRecordTimeDefaults {
  if (!patientId) {
    return buildFallbackTimeDefaults();
  }

  const schedules = repositories.visitRepository
    .getSchedules({ patientId, doctorId })
    .filter(
      (schedule) =>
        schedule.visit_type !== "回院病歷" && schedule.service_time_slot !== "回院病歷"
    );

  const latestHomeVisit = schedules
    .map((schedule) => ({
      schedule,
      record: repositories.visitRepository.getVisitRecordByScheduleId(schedule.id)
    }))
    .filter(
      (item) =>
        Boolean(item.record?.treatment_start_time) && Boolean(item.record?.treatment_end_time)
    )
    .sort((left, right) => {
      const leftTime =
        left.record?.departure_from_patient_home_time ??
        left.record?.treatment_end_time ??
        left.record?.updated_at ??
        left.schedule.updated_at;
      const rightTime =
        right.record?.departure_from_patient_home_time ??
        right.record?.treatment_end_time ??
        right.record?.updated_at ??
        right.schedule.updated_at;
      return new Date(rightTime).getTime() - new Date(leftTime).getTime();
    })[0];

  if (
    !latestHomeVisit?.record?.treatment_start_time ||
    !latestHomeVisit.record.treatment_end_time
  ) {
    return buildFallbackTimeDefaults();
  }

  return {
    treatmentStartTime: toDateTimeLocalValue(latestHomeVisit.record.treatment_start_time),
    treatmentEndTime: toDateTimeLocalValue(latestHomeVisit.record.treatment_end_time),
    hint: `已自動帶入最近一筆居家治療時間：${formatDateTimeFull(
      latestHomeVisit.record.treatment_start_time
    )} 至 ${formatDateTimeFull(latestHomeVisit.record.treatment_end_time)}`
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

function buildAbnormalCaseReminders(
  patientName: string,
  chiefComplaint: string,
  relatedVisitScheduleId: string
): Reminder[] {
  const now = new Date().toISOString();
  const title = `異常個案｜${patientName}`;
  const detail = chiefComplaint
    ? `${patientName} 已於回院病歷勾選為異常個案，主訴：${chiefComplaint}`
    : `${patientName} 已於回院病歷勾選為異常個案，請查看回院病歷內容。`;

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
  const title = `回院病歷提醒｜${patientName}`;
  const detail = reminderNote.trim()
    ? `${patientName} 回院病歷提醒：${reminderNote.trim()}`
    : `${patientName} 已新增回院病歷提醒，請查看病歷內容。`;

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
  const initialTimeDefaults = resolveReturnRecordTimeDefaults(
    defaultPatientId,
    session.activeDoctorId,
    repositories
  );

  const { control, getValues, handleSubmit, register, reset, setValue } =
    useForm<ReturnRecordFormValues>({
      defaultValues: {
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
  const returnRecordTimeDefaults = useMemo(
    () =>
      resolveReturnRecordTimeDefaults(
        selectedPatientId,
        session.activeDoctorId,
        repositories
      ),
    [repositories, selectedPatientId, session.activeDoctorId]
  );
  const previousRecord = useMemo(() => selectedProfile?.visitRecords[0], [selectedProfile]);
  const previousAutoDraftRef = useRef("");
  const previousRecordUpdatedAt = previousRecord?.updated_at ?? "";
  const selectedPatientMedicalHistory = selectedProfile?.patient.important_medical_history ?? "";

  useEffect(() => {
    if (!selectedPatientId) {
      return;
    }

    const previousSelections = buildPreviousFourDiagnosisSelections(previousRecord);
    const previousMedicalHistorySelections = buildPreviousMedicalHistorySelections(
      previousRecord,
      selectedPatientMedicalHistory
    );
    const nextValues: ReturnRecordFormValues = {
      patient_id: selectedPatientId,
      mark_as_exception: false,
      add_to_reminders: false,
      reminder_note: "",
      chief_complaint_option: "",
      chief_complaint_other: "",
      treatment_start_time: returnRecordTimeDefaults.treatmentStartTime,
      treatment_end_time: returnRecordTimeDefaults.treatmentEndTime,
      ...previousSelections,
      ...previousMedicalHistorySelections,
      generated_record_text: ""
    };

    const initialDraft = buildReturnRecordDraft({
      chiefComplaint: "",
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
      medicalHistory: joinMedicalHistory(
        nextValues.medical_history_tags,
        nextValues.medical_history_other
      )
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
    returnRecordTimeDefaults.treatmentEndTime,
    returnRecordTimeDefaults.treatmentStartTime,
    selectedPatientId,
    selectedPatientMedicalHistory,
    setSearchParams
  ]);

  const watchedValues = useWatch({ control });
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

    const chiefComplaint =
      values.chief_complaint_option === "其他"
        ? values.chief_complaint_other.trim()
        : values.chief_complaint_option;
    const medicalHistory = joinMedicalHistory(
      values.medical_history_tags,
      values.medical_history_other
    );
    const reminderNote = values.reminder_note.trim();

    if (values.chief_complaint_option === "其他" && !chiefComplaint) {
      window.alert("若主訴選擇其他，請補充主訴內容。");
      return;
    }
    if (values.add_to_reminders && !reminderNote) {
      window.alert("若要加入提醒中心，請補充提醒內容。");
      return;
    }

    const estimatedMinutes = calculateTreatmentDurationMinutes(
      values.treatment_start_time,
      values.treatment_end_time
    );
    const noteTitle = `回院病歷｜${chiefComplaint || "未填主訴"}${
      values.mark_as_exception ? "｜異常個案" : ""
    }`;
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
      chief_complaint: chiefComplaint,
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
      treatment_provided: values.mark_as_exception
        ? "已由醫師回院病歷頁建立病歷，並勾選異常個案。"
        : "已由醫師回院病歷頁建立病歷。",
      doctor_note: values.generated_record_text,
      caregiver_feedback: "",
      follow_up_note: medicalHistory,
      medical_history_note: medicalHistory,
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
    if (values.mark_as_exception) {
      buildAbnormalCaseReminders(
        selectedProfile.patient.name,
        chiefComplaint,
        schedule.id
      ).forEach((reminder) => {
        repositories.visitRepository.createReminder(reminder);
      });
    }
    if (values.add_to_reminders) {
      buildReturnRecordReminders(
        selectedProfile.patient.name,
        reminderNote,
        schedule.id
      ).forEach((reminder) => {
        repositories.visitRepository.createReminder(reminder);
      });
    }
    window.alert(
      values.mark_as_exception && values.add_to_reminders
        ? "回院病歷已建立，異常個案與提醒內容已同步到醫師與行政提醒中心。"
        : values.mark_as_exception
          ? "回院病歷已建立，異常個案提醒已同步到醫師與行政提醒中心。"
          : values.add_to_reminders
            ? "回院病歷已建立，提醒內容已同步到醫師與行政提醒中心。"
            : "回院病歷已建立，病史與病歷內容會作為下次自動帶入基礎。"
    );
  };

  if (!patients.length) {
    return <Panel title="查無個案">目前此醫師沒有可建立回院病歷的個案資料。</Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel title="醫師回院產生病歷">
        <form className="space-y-4 lg:space-y-5" onSubmit={handleSubmit(onSubmit)}>
          <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 lg:rounded-3xl lg:p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="block text-sm">
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
                <Link
                  to={`/doctor/patients/${selectedProfile.patient.id}`}
                  className="inline-flex rounded-full bg-brand-sand px-4 py-2.5 text-sm font-semibold text-brand-forest"
                >
                  查看個案完整資訊
                </Link>
              ) : null}
            </div>

            {selectedProfile ? (
              <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                <p>個案：{selectedProfile.patient.name}</p>
                <p>生日：{formatDateOnly(selectedProfile.patient.date_of_birth)}</p>
                <p>重要病史：{selectedProfile.patient.important_medical_history}</p>
                <p>上次追蹤摘要：{selectedProfile.patient.last_visit_summary}</p>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:gap-4">
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
            <span>勾選為異常個案，建立病歷後同步提醒醫師與行政追蹤</span>
          </label>

          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <label className="flex items-start gap-3 text-sm text-sky-900">
              <input
                type="checkbox"
                {...register("add_to_reminders")}
                className="h-4 w-4 rounded border-sky-300"
              />
              <span>加入提醒中心，讓醫師與行政後續追蹤</span>
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

          <div className="grid gap-3 md:grid-cols-2 lg:gap-4">
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
            className="w-full rounded-full bg-brand-coral px-5 py-3 text-sm font-semibold text-white lg:w-auto"
          >
            建立回院病歷
          </button>
        </form>
      </Panel>
    </div>
  );
}
