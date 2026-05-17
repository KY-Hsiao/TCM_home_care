import type { AppDb, SavedRoutePlan, VisitSchedule } from "./models";

export type ScheduleRiskKind =
  | "possible_delay"
  | "route_too_long"
  | "missing_line_binding"
  | "missing_coordinates"
  | "doctor_leave";

export type ScheduleRiskSeverity = "high" | "medium" | "low";

export type ScheduleRiskItem = {
  id: string;
  kind: ScheduleRiskKind;
  severity: ScheduleRiskSeverity;
  title: string;
  summary: string;
  scheduleId?: string;
  routePlanId?: string;
  doctorId?: string;
  patientId?: string;
};

const activeScheduleStatuses = new Set<VisitSchedule["status"]>([
  "waiting_departure",
  "scheduled",
  "tracking",
  "on_the_way",
  "proximity_pending",
  "arrived",
  "in_treatment",
  "issue_pending",
  "followup_pending",
  "rescheduled"
]);

const unfinishedScheduleStatuses = new Set<VisitSchedule["status"]>([
  "waiting_departure",
  "scheduled",
  "tracking",
  "on_the_way",
  "proximity_pending",
  "issue_pending",
  "followup_pending",
  "rescheduled"
]);

const routeExecutionStatuses = new Set<SavedRoutePlan["execution_status"]>([
  "draft",
  "executing",
  "completed",
  "archived"
]);

function formatDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(11, 16);
  }
  return date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getPatientName(db: AppDb, patientId: string) {
  return db.patients.find((patient) => patient.id === patientId)?.name ?? patientId;
}

function getDoctorName(db: AppDb, doctorId: string) {
  return db.doctors.find((doctor) => doctor.id === doctorId)?.name ?? doctorId;
}

function uniqueById(risks: ScheduleRiskItem[]) {
  const seen = new Set<string>();
  return risks.filter((risk) => {
    if (seen.has(risk.id)) {
      return false;
    }
    seen.add(risk.id);
    return true;
  });
}

function getReferenceNow(referenceDate: string, now = new Date()) {
  return formatDateInputValue(now) === referenceDate
    ? now
    : new Date(`${referenceDate}T12:00:00`);
}

function hasCaregiverMessageBinding(db: AppDb, schedule: VisitSchedule) {
  const caregiver = db.caregivers.find((item) => item.id === schedule.primary_caregiver_id);
  if (!caregiver?.receives_notifications) {
    return false;
  }
  return db.caregiver_chat_bindings.some(
    (binding) => binding.caregiver_id === caregiver.id && binding.is_active
  );
}

function isLeaveOverlappingDate(leave: AppDb["leave_requests"][number], routeDate: string) {
  return leave.start_date <= routeDate && leave.end_date >= routeDate;
}

function getTodaySchedules(db: AppDb, referenceDate: string) {
  return db.visit_schedules
    .filter(
      (schedule) =>
        schedule.scheduled_start_at.slice(0, 10) === referenceDate &&
        activeScheduleStatuses.has(schedule.status) &&
        schedule.visit_type !== "回院病歷"
    )
    .sort(
      (left, right) =>
        (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER) ||
        left.scheduled_start_at.localeCompare(right.scheduled_start_at)
    );
}

function getTodayRoutePlans(db: AppDb, referenceDate: string) {
  return db.saved_route_plans
    .filter(
      (routePlan) =>
        routePlan.route_date === referenceDate &&
        routeExecutionStatuses.has(routePlan.execution_status) &&
        routePlan.route_items.some((item) => item.checked)
    )
    .sort(
      (left, right) =>
        right.total_minutes - left.total_minutes ||
        right.total_distance_kilometers - left.total_distance_kilometers
    );
}

export function buildTodayScheduleRisks(input: {
  db: AppDb;
  referenceDate?: string;
  now?: Date;
  limit?: number;
}) {
  const referenceDate = input.referenceDate ?? formatDateInputValue(input.now);
  const referenceNow = getReferenceNow(referenceDate, input.now);
  const schedules = getTodaySchedules(input.db, referenceDate);
  const routePlans = getTodayRoutePlans(input.db, referenceDate);
  const risks: ScheduleRiskItem[] = [];

  schedules.forEach((schedule) => {
    const scheduledStart = new Date(schedule.scheduled_start_at);
    const delayMinutes = Math.floor((referenceNow.getTime() - scheduledStart.getTime()) / 60000);
    if (
      delayMinutes >= 20 &&
      unfinishedScheduleStatuses.has(schedule.status)
    ) {
      risks.push({
        id: `possible-delay-${schedule.id}`,
        kind: "possible_delay",
        severity: delayMinutes >= 45 ? "high" : "medium",
        title: "可能延誤",
        summary: `${formatTime(schedule.scheduled_start_at)} ${getPatientName(input.db, schedule.patient_id)} 尚未完成，已超過預定時間約 ${delayMinutes} 分鐘。`,
        scheduleId: schedule.id,
        doctorId: schedule.assigned_doctor_id,
        patientId: schedule.patient_id
      });
    }

    if (schedule.home_latitude_snapshot === null || schedule.home_longitude_snapshot === null) {
      risks.push({
        id: `missing-coordinates-${schedule.id}`,
        kind: "missing_coordinates",
        severity: "medium",
        title: "缺地址座標",
        summary: `${getPatientName(input.db, schedule.patient_id)} 缺少可用座標，地圖預覽與排序只能先用地址文字。`,
        scheduleId: schedule.id,
        doctorId: schedule.assigned_doctor_id,
        patientId: schedule.patient_id
      });
    }

    if (!hasCaregiverMessageBinding(input.db, schedule)) {
      risks.push({
        id: `missing-line-binding-${schedule.id}`,
        kind: "missing_line_binding",
        severity: "low",
        title: "缺 LINE 綁定",
        summary: `${getPatientName(input.db, schedule.patient_id)} 的主要家屬尚未有可用訊息綁定，出發或異動通知需改人工確認。`,
        scheduleId: schedule.id,
        doctorId: schedule.assigned_doctor_id,
        patientId: schedule.patient_id
      });
    }

    const leave = input.db.leave_requests.find(
      (item) =>
        item.doctor_id === schedule.assigned_doctor_id &&
        item.status !== "rejected" &&
        isLeaveOverlappingDate(item, referenceDate)
    );
    if (leave || schedule.note.includes("醫師請假")) {
      risks.push({
        id: `doctor-leave-${schedule.id}`,
        kind: "doctor_leave",
        severity: "high",
        title: "醫師請假影響",
        summary: `${getDoctorName(input.db, schedule.assigned_doctor_id)} ${referenceDate} 有請假或取消註記，需確認是否改派或通知家屬。`,
        scheduleId: schedule.id,
        doctorId: schedule.assigned_doctor_id,
        patientId: schedule.patient_id
      });
    }
  });

  routePlans.forEach((routePlan) => {
    const checkedCount = routePlan.route_items.filter((item) => item.checked).length;
    if (
      routePlan.total_minutes >= 150 ||
      routePlan.total_distance_kilometers >= 45 ||
      checkedCount >= 5
    ) {
      risks.push({
        id: `route-too-long-${routePlan.id}`,
        kind: "route_too_long",
        severity: routePlan.total_minutes >= 210 || routePlan.total_distance_kilometers >= 65 ? "high" : "medium",
        title: "路線過長",
        summary: `${routePlan.route_name} 估計 ${routePlan.total_minutes} 分鐘、${routePlan.total_distance_kilometers} 公里，共 ${checkedCount} 站；建議拆線或確認支援醫師。`,
        routePlanId: routePlan.id,
        doctorId: routePlan.doctor_id
      });
    }
  });

  const severityOrder: Record<ScheduleRiskSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2
  };
  const kindOrder: Record<ScheduleRiskKind, number> = {
    doctor_leave: 0,
    possible_delay: 1,
    route_too_long: 2,
    missing_coordinates: 3,
    missing_line_binding: 4
  };

  return uniqueById(risks)
    .sort(
      (left, right) =>
        severityOrder[left.severity] - severityOrder[right.severity] ||
        kindOrder[left.kind] - kindOrder[right.kind] ||
        left.id.localeCompare(right.id)
    )
    .slice(0, input.limit ?? 8);
}
