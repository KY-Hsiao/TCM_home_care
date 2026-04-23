import type { VisitRecord, VisitSchedule } from "../../domain/models";
import type { TrackingRuntime } from "../../services/types";
import { differenceInMinutes } from "date-fns";
import {
  formatDateTime,
  formatDateTimeFull,
  formatMinutes,
  formatTimeOnly
} from "../../shared/utils/format";

export function doctorActionButtonClass(tone: "default" | "primary" = "default") {
  return tone === "primary"
    ? "inline-flex items-center justify-center rounded-full bg-brand-coral px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
    : "inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest";
}

export function buildReadonlySummary(record: VisitRecord | undefined) {
  const travelDurationMinutes =
    record?.departure_time && record?.arrival_time
      ? Math.max(
          0,
          differenceInMinutes(new Date(record.arrival_time), new Date(record.departure_time))
        )
      : null;

  return [
    { label: "出發時間", value: formatDateTimeFull(record?.departure_time) },
    { label: "抵達時間", value: formatDateTimeFull(record?.arrival_time) },
    { label: "車程時間", value: formatMinutes(travelDurationMinutes) },
    {
      label: "離開患者時間",
      value: formatDateTimeFull(record?.departure_from_patient_home_time)
    },
    { label: "停留時間", value: formatMinutes(record?.stay_duration_minutes) },
    { label: "治療開始時間", value: formatDateTimeFull(record?.treatment_start_time) },
    { label: "治療結束時間", value: formatDateTimeFull(record?.treatment_end_time) },
    { label: "治療時長", value: formatMinutes(record?.treatment_duration_minutes) },
    {
      label: "是否手動調整治療時長",
      value: record?.treatment_duration_manually_adjusted ? "是" : "否"
    }
  ];
}

export function getScheduleDisplayRange(
  schedule: VisitSchedule,
  record: VisitRecord | undefined
) {
  const start = record?.arrival_time ?? schedule.scheduled_start_at;
  const end = record?.treatment_end_time ?? schedule.scheduled_end_at;
  return `${formatDateTime(start)} - ${formatTimeOnly(end)}`;
}

export function isVisitFinished(status: VisitSchedule["status"]) {
  return ["completed", "followup_pending", "cancelled"].includes(status);
}

export function isVisitUnlocked(
  orderedSchedules: VisitSchedule[],
  scheduleId: string,
  record: VisitRecord | undefined
) {
  const currentIndex = orderedSchedules.findIndex((schedule) => schedule.id === scheduleId);
  if (currentIndex <= 0) {
    return true;
  }
  if (record?.departure_time || record?.arrival_time || record?.departure_from_patient_home_time) {
    return true;
  }
  return orderedSchedules
    .slice(0, currentIndex)
    .every((schedule) => isVisitFinished(schedule.status));
}

export function shouldPromptArrival(
  schedule: VisitSchedule,
  runtime: TrackingRuntime | undefined
) {
  if (!runtime) {
    return schedule.status === "proximity_pending";
  }
  return (
    schedule.status === "proximity_pending" ||
    runtime.arrivalConfirmationPending ||
    runtime.geofenceStatus === "proximity_pending" ||
    (runtime.latestDistanceMeters !== null &&
      runtime.latestDistanceMeters <= schedule.arrival_radius_meters)
  );
}
