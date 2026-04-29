import type {
  DoctorLocationLog,
  LeaveRequest,
  Reminder,
  RescheduleAction,
  VisitRecord,
  VisitSchedule
} from "../../domain/models";
import { applyVisitRecordRules } from "../../domain/rules";
import { caregiversSeed } from "./caregivers";
import { patientsSeed } from "./patients";
import { after, at, mapsLink, stamp } from "./helpers";

const patientAddressMap = new Map(
  patientsSeed.map((patient) => [patient.id, patient.address])
);
const patientLocationKeywordMap = new Map(
  patientsSeed.map((patient) => [patient.id, patient.location_keyword])
);
const patientCoordinateMap = new Map(
  patientsSeed.map((patient) => [
    patient.id,
    {
      latitude: patient.home_latitude,
      longitude: patient.home_longitude
    }
  ])
);
const caregiverMap = new Map(caregiversSeed.map((caregiver) => [caregiver.id, caregiver]));
const weekdayLabels = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

function extractArea(address: string): string {
  const cityMatch = address.match(/(台北市|新北市|高雄市)([^0-9\s]+?[區鎮鄉市])/);
  if (!cityMatch) {
    return "未分類";
  }
  return `${cityMatch[1]}${cityMatch[2]}`;
}

function defaultReminderTags(status: VisitSchedule["status"], note: string): string[] {
  const tags = [status === "rescheduled" ? "需重排" : "例行追蹤"];
  if (note.includes("通知")) {
    tags.push("需通知家屬");
  }
  if (note.includes("輪椅")) {
    tags.push("輪椅協助");
  }
  if (note.includes("上午")) {
    tags.push("上午安排");
  }
  return tags;
}

function deriveServiceTimeSlot(dateTime: string): string {
  const date = new Date(dateTime);
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  const weekdayLabel = weekdayLabels[date.getDay()] ?? "星期?";
  if (totalMinutes < 13 * 60) {
    return `${weekdayLabel}上午`;
  }
  return `${weekdayLabel}下午`;
}

function parsePreferredServiceSlot(slot: string) {
  const match = slot.match(/^(星期[日一二三四五六天])(上午|下午)$/);
  if (!match) {
    return null;
  }
  const weekdayMap: Record<string, number> = {
    星期日: 0,
    星期天: 0,
    星期一: 1,
    星期二: 2,
    星期三: 3,
    星期四: 4,
    星期五: 5,
    星期六: 6
  };
  return {
    dayOfWeek: weekdayMap[match[1]] ?? null,
    part: match[2] as "上午" | "下午"
  };
}

function buildPreferredSlotStart(slot: string) {
  const parsed = parsePreferredServiceSlot(slot);
  if (!parsed || parsed.dayOfWeek === null) {
    return null;
  }

  const today = new Date();
  const dayOffset = parsed.dayOfWeek - today.getDay();
  const hour = parsed.part === "上午" ? 9 : 14;
  return at(dayOffset, hour, 0);
}

function matchesPreferredServiceSlot(schedule: VisitSchedule, preferredServiceSlot: string) {
  return schedule.service_time_slot === preferredServiceSlot;
}

function getNextRouteOrder(schedules: VisitSchedule[], doctorId: string, scheduleDate: string) {
  return (
    schedules.filter(
      (schedule) =>
        schedule.assigned_doctor_id === doctorId &&
        schedule.scheduled_start_at.slice(0, 10) === scheduleDate
    ).length + 1
  );
}

function buildSeedSchedule(
  id: string,
  patientId: string,
  doctorId: string,
  caregiverId: string,
  scheduledStart: string,
  scheduledEnd: string,
  status: VisitSchedule["status"],
  visitType: string,
  note: string,
  routeOrder: number
): VisitSchedule {
  const address = patientAddressMap.get(patientId) ?? "地址待補";
  const locationKeyword = patientLocationKeywordMap.get(patientId) ?? "同住址";
  const coordinates = patientCoordinateMap.get(patientId) ?? {
    latitude: null,
    longitude: null
  };
  return {
    id,
    patient_id: patientId,
    assigned_doctor_id: doctorId,
    primary_caregiver_id: caregiverId,
    scheduled_start_at: scheduledStart,
    scheduled_end_at: scheduledEnd,
    estimated_treatment_minutes: 30,
    address_snapshot: address,
    location_keyword_snapshot: locationKeyword,
    home_latitude_snapshot: coordinates.latitude,
    home_longitude_snapshot: coordinates.longitude,
    arrival_radius_meters: patientId === "pat-003" ? 80 : 100,
    geofence_status:
      coordinates.latitude === null || coordinates.longitude === null
        ? "coordinate_missing"
        : status === "completed"
          ? "completed"
          : status === "proximity_pending"
            ? "proximity_pending"
          : status === "arrived" || status === "in_treatment"
            ? "arrived"
            : status === "tracking"
              ? "tracking"
              : "idle",
    google_maps_link: mapsLink(address, locationKeyword),
    area: extractArea(address),
    service_time_slot: deriveServiceTimeSlot(scheduledStart),
    route_order: routeOrder,
    route_group_id: `${doctorId}-${scheduledStart.slice(0, 10)}`,
    tracking_mode: "hybrid",
    tracking_started_at:
      status === "tracking" || status === "proximity_pending" || status === "arrived" || status === "in_treatment" || status === "completed"
        ? after(scheduledStart, -20)
        : null,
    tracking_stopped_at: status === "completed" ? after(scheduledEnd, 15) : null,
    arrival_confirmed_by:
      status === "arrived" || status === "in_treatment" || status === "completed"
        ? "system"
        : null,
    departure_confirmed_by: status === "completed" ? "doctor" : null,
    last_feedback_code:
      id === "vs-004"
        ? "admin_followup"
        : id === "vs-006" || id === "vs-007"
          ? "normal"
          : null,
    reminder_tags: defaultReminderTags(status, note),
    status,
    visit_type: visitType,
    note,
    ...stamp(0)
  };
}

const scheduleBlueprints = [
  ["vs-001", "pat-001", "doc-001", "cg-001", -1, 9, 0, "completed", "例行居家訪視", "昨日例行追蹤"],
  ["vs-002", "pat-002", "doc-001", "cg-002", 0, 8, 30, "waiting_departure", "例行居家訪視", "今日第一站"],
  ["vs-003", "pat-003", "doc-001", "cg-004", 0, 10, 0, "tracking", "睡眠與情緒追蹤", "需訪後通知家屬"],
  ["vs-004", "pat-004", "doc-001", "cg-005", 0, 9, 30, "proximity_pending", "疼痛照護追蹤", "行政已確認地址"],
  ["vs-005", "pat-005", "doc-001", "cg-006", 0, 11, 0, "arrived", "動作遲緩評估", "留意跌倒風險"],
  ["vs-006", "pat-006", "doc-001", "cg-008", 0, 14, 0, "in_treatment", "呼吸照護追蹤", "家屬希望同步衛教"],
  ["vs-007", "pat-007", "doc-001", "cg-009", 0, 9, 0, "completed", "便祕與食慾追蹤", "已完成"],
  ["vs-025", "pat-013", "doc-002", "cg-016", 0, 8, 45, "tracking", "關節活動追蹤", "需同步上午進度"],
  ["vs-026", "pat-014", "doc-002", "cg-017", 0, 10, 15, "scheduled", "慢性腰背痛追蹤", "同時段第二位醫師"],
  ["vs-008", "pat-008", "doc-001", "cg-011", 1, 10, 30, "rescheduled", "肩頸僵硬追蹤", "病家要求改期"],
  ["vs-009", "pat-009", "doc-001", "cg-012", 1, 15, 0, "cancelled", "胃食道逆流追蹤", "個案臨時外出"],
  ["vs-010", "pat-010", "doc-001", "cg-013", 1, 8, 30, "scheduled", "虛弱調理", "固定上午"],
  ["vs-011", "pat-001", "doc-001", "cg-001", 1, 13, 30, "scheduled", "加開關懷訪視", "評估近況"],
  ["vs-012", "pat-003", "doc-001", "cg-004", 2, 10, 0, "scheduled", "睡眠追蹤", "Google Chat 需同步摘要"],
  ["vs-013", "pat-004", "doc-001", "cg-005", 2, 14, 30, "scheduled", "疼痛照護", "需輪椅協助"],
  ["vs-014", "pat-005", "doc-001", "cg-006", 2, 16, 0, "scheduled", "帕金森居家追蹤", "記錄起身狀況"],
  ["vs-015", "pat-006", "doc-001", "cg-008", 3, 9, 30, "scheduled", "呼吸功能追蹤", "留意喘"],
  ["vs-016", "pat-007", "doc-001", "cg-009", 3, 11, 0, "scheduled", "便祕與睡眠追蹤", "家屬需電話提醒"],
  ["vs-017", "pat-009", "doc-001", "cg-012", 3, 14, 0, "scheduled", "胃食道逆流衛教", "追蹤飲食"],
  ["vs-018", "pat-010", "doc-001", "cg-013", 4, 8, 30, "scheduled", "虛弱調理", "安排上午"],
  ["vs-019", "pat-002", "doc-001", "cg-002", 4, 10, 30, "scheduled", "復能後追蹤", "查看家屬訓練紀錄"],
  ["vs-020", "pat-011", "doc-001", "cg-014", 5, 13, 0, "scheduled", "月訪追蹤", "失智症照護摘要"],
  ["vs-021", "pat-012", "doc-001", "cg-015", 5, 15, 30, "scheduled", "住院後復原關懷", "確認是否恢復訪視"],
  ["vs-022", "pat-004", "doc-001", "cg-005", 6, 9, 30, "scheduled", "疼痛照護", "需樓管協助電梯"],
  ["vs-023", "pat-005", "doc-001", "cg-006", 6, 14, 30, "scheduled", "帕金森追蹤", "回覆家屬提問"],
  ["vs-024", "pat-001", "doc-001", "cg-001", 7, 9, 0, "scheduled", "例行居家訪視", "固定週追蹤"]
] as const;

const seededSchedules = scheduleBlueprints.reduce<VisitSchedule[]>(
  (schedules, [id, patientId, doctorId, caregiverId, dayOffset, hour, minute, status, visitType, note]) => {
    const scheduledStart = at(dayOffset, hour, minute);
    const scheduledEnd = after(scheduledStart, 60);
    const routeOrder = getNextRouteOrder(schedules, doctorId, scheduledStart.slice(0, 10));
    schedules.push(
      buildSeedSchedule(
        id,
        patientId,
        doctorId,
        caregiverId,
        scheduledStart,
        scheduledEnd,
        status,
        visitType,
        note,
        routeOrder
      )
    );
    return schedules;
  },
  []
);

const supplementalSchedules = patientsSeed.reduce<VisitSchedule[]>((schedules, patient) => {
  if (patient.status !== "active") {
    return schedules;
  }

  const hasMatchingSchedule = [...seededSchedules, ...schedules].some(
    (schedule) =>
      schedule.patient_id === patient.id &&
      schedule.status !== "cancelled" &&
      matchesPreferredServiceSlot(schedule, patient.preferred_service_slot)
  );

  if (hasMatchingSchedule) {
    return schedules;
  }

  const scheduledStart = buildPreferredSlotStart(patient.preferred_service_slot);
  if (!scheduledStart) {
    return schedules;
  }

  const caregiverId =
    caregiversSeed.find((caregiver) => caregiver.patient_id === patient.id && caregiver.is_primary)?.id ??
    caregiversSeed.find((caregiver) => caregiver.patient_id === patient.id)?.id ??
    "";
  const routeOrder = getNextRouteOrder(
    [...seededSchedules, ...schedules],
    patient.preferred_doctor_id,
    scheduledStart.slice(0, 10)
  );

  schedules.push(
    buildSeedSchedule(
      `vs-slot-${patient.id}`,
      patient.id,
      patient.preferred_doctor_id,
      caregiverId,
      scheduledStart,
      after(scheduledStart, 60),
      "scheduled",
      patient.service_needs.length > 0
        ? `${patient.service_needs.join(" / ")} / ${patient.primary_diagnosis}`
        : patient.primary_diagnosis,
      "依個案服務時段補齊排程",
      routeOrder
    )
  );

  return schedules;
}, []);

export const visitSchedulesSeed: VisitSchedule[] = [...seededSchedules, ...supplementalSchedules];

const recordBlueprints = [
  ["vr-001", "vs-001", -1, 8, 28, 9, 2, 9, 41, undefined, "腰痛回報改善，維持每週一次。", "家屬表示夜間翻身痛感下降。", "下次持續觀察睡眠與疼痛程度。", "2026-04-22"],
  ["vr-002", "vs-002", 0, 8, 5, null, null, null, null, undefined, "尚未出發，待確認交通。", "家屬已知今日到訪。", "若延誤超過 20 分鐘需行政協助通知。", "2026-04-27"],
  ["vr-003", "vs-003", 0, 9, 40, null, null, null, null, undefined, "醫師已整理今日追蹤重點。", "家屬希望睡眠建議寫成簡表。", "到場後補記錄。", "2026-04-28"],
  ["vr-004", "vs-004", 0, 8, 55, 9, 32, null, null, undefined, "已出發，路況正常。", "行政已回覆病家醫師在路上。", "預計準時到達。", "2026-04-29"],
  ["vr-005", "vs-005", 0, 10, 22, 11, 3, null, null, undefined, "醫師已抵達，準備開始治療。", "家屬陪同中。", "訪後整理動作訓練建議。", "2026-04-29"],
  ["vr-006", "vs-006", 0, 13, 35, 14, 4, null, null, 35, "治療中，呼吸較穩定。", "家屬想了解後續照護節奏。", "需補一則衛教提醒。", "2026-04-30"],
  ["vr-007", "vs-007", 0, 8, 22, 9, 1, 9, 46, 32, "治療後排便情形改善。", "家屬反映昨晚睡得較好。", "維持每週追蹤。", "2026-04-30"],
  ["vr-008", "vs-008", 1, 10, 0, null, null, null, null, undefined, "病家要求改為明日下午。", "家屬有事外出。", "待行政重新安排。", "2026-05-01"],
  ["vr-009", "vs-009", 1, 14, 10, null, null, null, null, undefined, "個案臨時不在家。", "家屬請行政改約。", "改由行政追蹤。", "2026-05-02"],
  ["vr-010", "vs-010", 1, 8, 8, null, null, null, null, undefined, "明日訪視已排定。", "家屬確認上午可陪同。", "維持原時段。", "2026-05-01"],
  ["vr-011", "vs-011", 1, 13, 2, null, null, null, null, undefined, "加開追蹤待確認。", "家屬已讀未回。", "若中午前未回改由電話聯繫。", "2026-05-01"],
  ["vr-012", "vs-012", 2, 9, 35, null, null, null, null, undefined, "預排睡眠追蹤訪視。", "家屬要求訪後摘要。", "通知模板可直接帶入。", "2026-05-02"],
  ["vr-013", "vs-013", 2, 14, 0, null, null, null, null, undefined, "疼痛程度待實地評估。", "家屬會協助上下輪椅。", "提前 30 分通知。", "2026-05-02"],
  ["vr-014", "vs-014", 2, 15, 20, null, null, null, null, undefined, "需補充步態與起身觀察。", "家屬有記錄近三日狀況。", "可帶入衛教單。", "2026-05-03"],
  ["vr-015", "vs-015", 3, 8, 40, null, null, null, null, undefined, "呼吸狀況待現場評估。", "家屬希望同步用藥提醒。", "完成後建議設 reminder。", "2026-05-03"],
  ["vr-016", "vs-016", 3, 10, 20, null, null, null, null, undefined, "便祕與睡眠持續追蹤。", "家屬需電話提醒。", "前一晚行政先致電。", "2026-05-04"],
  ["vr-017", "vs-017", 3, 13, 10, null, null, null, null, undefined, "飲食紀錄待確認。", "家屬希望降低胃悶。", "訪後寄送飲食提醒。", "2026-05-04"],
  ["vr-018", "vs-018", 4, 8, 0, null, null, null, null, undefined, "固定上午照護。", "家屬可全程陪同。", "若醫師請假需優先改派。", "2026-05-05"],
  ["vr-019", "vs-019", 4, 10, 0, null, null, null, null, undefined, "追蹤家屬訓練執行情況。", "復能練習持續中。", "需留意肩關節僵硬。", "2026-05-05"],
  ["vr-020", "vs-020", 5, 12, 25, null, null, null, null, undefined, "月訪前彙整家屬回饋。", "家屬希望簡短摘要。", "若異常則追加聯絡。", "2026-05-06"]
] as const;

export const visitRecordsSeed: VisitRecord[] = recordBlueprints.map(
  ([
    id,
    scheduleId,
    departureDay,
    departureHour,
    departureMinute,
    arrivalHour,
    arrivalMinute,
    leaveHour,
    leaveMinute,
    treatmentDuration,
    doctorNote,
    caregiverFeedback,
    followUpNote,
    nextVisitSuggestionDate
  ]) => {
    const departureTime = at(departureDay, departureHour, departureMinute);
    const arrivalTime =
      arrivalHour === null || arrivalMinute === null
        ? null
        : at(departureDay, arrivalHour, arrivalMinute);
    const departureFromPatientHomeTime =
      leaveHour === null || leaveMinute === null
        ? null
        : at(departureDay, leaveHour, leaveMinute);
    const schedule = visitSchedulesSeed.find((item) => item.id === scheduleId)!;

    return applyVisitRecordRules(
      {
        id,
        visit_schedule_id: scheduleId,
        departure_time: departureTime,
        arrival_time: arrivalTime,
        departure_from_patient_home_time: departureFromPatientHomeTime,
        chief_complaint: schedule.visit_type,
        sleep_status: caregiverFeedback.includes("睡") ? "睡眠待追蹤" : "大致穩定",
        appetite_status: doctorNote.includes("食") ? "需持續觀察" : "食慾普通",
        bowel_movement_status:
          schedule.visit_type.includes("便祕") || caregiverFeedback.includes("排便")
            ? "排便為追蹤重點"
            : "目前無明顯異常",
        pain_status:
          schedule.visit_type.includes("疼痛") || doctorNote.includes("痛")
            ? "疼痛需持續記錄"
            : "疼痛可接受",
        energy_status: doctorNote.includes("虛弱") ? "精神體力偏弱" : "可完成日常活動",
        inspection_tags: [],
        inspection_other: "",
        listening_tags: [],
        listening_other: "",
        inquiry_tags: [],
        inquiry_other: "",
        palpation_tags: [],
        palpation_other: "",
        physician_assessment: doctorNote,
        treatment_provided: arrivalTime ? "依個案狀況完成到宅治療與衛教。" : "待到場後填寫本次處置。",
        doctor_note: doctorNote,
        caregiver_feedback: caregiverFeedback,
        follow_up_note: followUpNote,
        medical_history_note: followUpNote,
        generated_record_text: "",
        next_visit_suggestion_date: nextVisitSuggestionDate ?? null,
        visit_feedback_code:
          schedule.id === "vs-009"
            ? "absent"
            : schedule.id === "vs-006" || schedule.id === "vs-007"
              ? "normal"
              : schedule.id === "vs-004"
                ? "admin_followup"
                : null,
        visit_feedback_at: arrivalTime ?? null,
        family_followup_status:
          schedule.id === "vs-009" || schedule.id === "vs-004" ? "draft_ready" : "not_needed",
        family_followup_sent_at: schedule.id === "vs-001" ? after(schedule.scheduled_end_at, 30) : null,
        created_at: schedule.created_at,
        updated_at: schedule.updated_at,
        treatment_duration_minutes: treatmentDuration,
        treatment_duration_manually_adjusted: treatmentDuration !== undefined
      },
      schedule.estimated_treatment_minutes
    );
  }
);

export const leaveRequestsSeed: LeaveRequest[] = [];

export const rescheduleActionsSeed: RescheduleAction[] = [
  {
    id: "rs-001",
    visit_schedule_id: "vs-008",
    requested_by_role: "caregiver",
    action_type: "reschedule",
    original_start_at: at(1, 10, 30),
    original_end_at: at(1, 11, 30),
    new_start_at: at(2, 15, 30),
    new_end_at: at(2, 16, 30),
    new_doctor_id: null,
    reason: "家屬臨時外出，希望改為隔日下午。",
    change_summary: "保留原醫師，改為隔日下午時段。",
    status: "approved",
    ...stamp(0)
  },
  {
    id: "rs-002",
    visit_schedule_id: "vs-009",
    requested_by_role: "admin",
    action_type: "reschedule",
    original_start_at: at(1, 15, 0),
    original_end_at: at(1, 16, 0),
    new_start_at: at(3, 14, 0),
    new_end_at: at(3, 15, 0),
    new_doctor_id: null,
    reason: "病家當日外出，改為兩天後。",
    change_summary: "待行政再次確認改期後通知家屬。",
    status: "pending",
    ...stamp(1)
  },
  {
    id: "rs-003",
    visit_schedule_id: "vs-010",
    requested_by_role: "doctor",
    action_type: "reschedule",
    original_start_at: at(1, 8, 30),
    original_end_at: at(1, 9, 30),
    new_start_at: at(1, 9, 30),
    new_end_at: at(1, 10, 30),
    new_doctor_id: null,
    reason: "前一站延誤一小時。",
    change_summary: "同醫師延後 1 小時到訪。",
    status: "approved",
    ...stamp(1)
  },
  {
    id: "rs-004",
    visit_schedule_id: "vs-016",
    requested_by_role: "admin",
    action_type: "reschedule",
    original_start_at: at(3, 11, 0),
    original_end_at: at(3, 12, 0),
    new_start_at: at(3, 11, 30),
    new_end_at: at(3, 12, 30),
    new_doctor_id: null,
    reason: "需避開家屬交班時間。",
    change_summary: "保留同醫師，延後 30 分鐘。",
    status: "approved",
    ...stamp(2)
  },
  {
    id: "rs-005",
    visit_schedule_id: "vs-019",
    requested_by_role: "caregiver",
    action_type: "reschedule",
    original_start_at: at(4, 10, 30),
    original_end_at: at(4, 11, 30),
    new_start_at: at(4, 15, 0),
    new_end_at: at(4, 16, 0),
    new_doctor_id: null,
    reason: "上午復健課程衝突。",
    change_summary: "待確認下午時段是否可改排。",
    status: "pending",
    ...stamp(2)
  },
  {
    id: "rs-006",
    visit_schedule_id: "vs-021",
    requested_by_role: "doctor",
    action_type: "reschedule",
    original_start_at: at(5, 15, 30),
    original_end_at: at(5, 16, 30),
    new_start_at: at(6, 10, 0),
    new_end_at: at(6, 11, 0),
    new_doctor_id: null,
    reason: "需配合出院後追蹤時點。",
    change_summary: "草稿中，待行政確認後通知家屬。",
    status: "draft",
    ...stamp(3)
  }
];

export const remindersSeed: Reminder[] = [];

const locationBlueprints: Array<
  [string, string, number, number, number, number, string | null]
> = [
  ["loc-001", "doc-001", 0, 25.0025, 121.5431, 12, "vs-002"],
  ["loc-002", "doc-001", 10, 25.0012, 121.5444, 11, "vs-002"],
  ["loc-003", "doc-001", 20, 25.0003, 121.5458, 10, "vs-002"],
  ["loc-004", "doc-001", 30, 24.9996, 121.5471, 9, "vs-002"],
  ["loc-005", "doc-001", 40, 24.9989, 121.5485, 9, "vs-002"],
  ["loc-006", "doc-001", 50, 24.9982, 121.5499, 8, "vs-003"],
  ["loc-007", "doc-001", 60, 24.9974, 121.5510, 8, "vs-003"],
  ["loc-008", "doc-001", 70, 24.9968, 121.5522, 8, "vs-003"],
  ["loc-009", "doc-001", 80, 24.9961, 121.5538, 7, "vs-003"],
  ["loc-010", "doc-001", 90, 24.9954, 121.5550, 7, "vs-003"],
  ["loc-011", "doc-001", 0, 25.0121, 121.4622, 15, "vs-004"],
  ["loc-012", "doc-001", 10, 25.0114, 121.4631, 14, "vs-004"],
  ["loc-013", "doc-001", 20, 25.0108, 121.4640, 14, "vs-004"],
  ["loc-014", "doc-001", 30, 25.0102, 121.4648, 13, "vs-005"],
  ["loc-015", "doc-001", 40, 25.0098, 121.4655, 13, "vs-005"],
  ["loc-016", "doc-001", 50, 25.0091, 121.4663, 12, "vs-005"],
  ["loc-017", "doc-001", 60, 25.0086, 121.4670, 12, "vs-006"],
  ["loc-018", "doc-001", 70, 25.0080, 121.4678, 11, "vs-006"],
  ["loc-019", "doc-001", 80, 25.0074, 121.4687, 11, "vs-006"],
  ["loc-020", "doc-001", 90, 25.0069, 121.4693, 10, "vs-006"],
  ["loc-021", "doc-001", 0, 25.0931, 121.5250, 16, "vs-007"],
  ["loc-022", "doc-001", 10, 25.0922, 121.5260, 15, "vs-007"],
  ["loc-023", "doc-001", 20, 25.0914, 121.5272, 14, "vs-007"],
  ["loc-024", "doc-001", 30, 25.0906, 121.5280, 14, "vs-007"],
  ["loc-025", "doc-001", 40, 25.0898, 121.5292, 13, "vs-008"],
  ["loc-026", "doc-001", 50, 25.0890, 121.5301, 13, "vs-008"],
  ["loc-027", "doc-001", 60, 25.0883, 121.5314, 12, "vs-008"],
  ["loc-028", "doc-001", 70, 25.0877, 121.5325, 12, null],
  ["loc-029", "doc-001", 80, 25.0870, 121.5333, 11, null],
  ["loc-030", "doc-001", 90, 25.0864, 121.5342, 11, null],
  ["loc-031", "doc-002", 0, 25.0582, 121.5410, 13, "vs-025"],
  ["loc-032", "doc-002", 10, 25.0574, 121.5419, 12, "vs-025"],
  ["loc-033", "doc-002", 20, 25.0568, 121.5431, 12, "vs-026"],
  ["loc-034", "doc-002", 30, 25.0561, 121.5442, 11, "vs-026"]
];

export const doctorLocationLogsSeed: DoctorLocationLog[] = locationBlueprints.map(
  ([id, doctorId, minuteOffset, latitude, longitude, accuracy, linkedVisitScheduleId]) => ({
    id,
    doctor_id: doctorId,
    recorded_at: at(0, 8, minuteOffset),
    latitude,
    longitude,
    accuracy,
    source: "manual_seed",
    linked_visit_schedule_id: linkedVisitScheduleId ?? null
  })
);

export const caregiverLookupById = caregiverMap;
