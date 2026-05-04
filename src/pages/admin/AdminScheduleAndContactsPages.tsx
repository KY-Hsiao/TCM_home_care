import { useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import type { NotificationCenterItem, SavedRoutePlan, VisitSchedule } from "../../domain/models";
import type { RouteMapInput } from "../../services/types";
import { RouteMapPreviewCard } from "../../modules/maps/RouteMapPreviewCard";
import { ReminderCenterPanel } from "../shared/ReminderCenterPanel";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateOnly, formatDateTimeFull } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";
import { loadAdminApiTokenSettings } from "../../shared/utils/admin-api-tokens";

type RouteTimeSlot = "上午" | "下午";
type PlannerStatus = "scheduled" | "paused" | "on_the_way" | "in_treatment" | "completed";
type RouteDateMode = "preset" | "ad_hoc";

type PlannerRow = {
  patientId: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  geocodingStatus?: "idle" | "pending" | "resolved" | "failed";
  geocodedAddress?: string | null;
  checked: boolean;
  routeOrder: number | null;
  status: PlannerStatus;
  scheduleId: string | null;
};

type RouteDateOption = {
  routeDate: string;
  weekdayOptions: (typeof weekdayOptions)[number][];
  timeSlotOptionsByWeekday: Partial<Record<(typeof weekdayOptions)[number], RouteTimeSlot[]>>;
  preferredWeekday: (typeof weekdayOptions)[number];
  preferredTimeSlot: RouteTimeSlot;
  label: string;
};

type AutoScheduleCarryoverCandidate = {
  id: string;
  notificationItemId: string;
  doctorId: string;
  doctorName: string;
  routeDate: string;
  routeWeekday: (typeof weekdayOptions)[number];
  timeSlot: RouteTimeSlot;
  sourceRoutePlanId: string;
  sourceRoutePlanName: string;
  sourceRouteDate: string;
  sourceDaysBack: 7 | 14;
  checkedPatientCount: number;
};

type ManagedFamilyLineContactSnapshot = {
  id: string;
  userId?: string;
  displayName: string;
  lineUserId?: string;
  linkedPatientIds: string[];
  note?: string;
  source?: "webhook" | "official_friend";
  updatedAt?: string;
};

type LeaveLineRecipient = {
  id: string;
  displayName: string;
  lineUserId: string;
  matchedPatientIds: string[];
  matchedPatientNames: string[];
};

const weekdayOptions = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;
const routeTimeSlotOptions: RouteTimeSlot[] = ["上午", "下午"];
const routeStartLocation = {
  address: "旗山醫院",
  latitude: 22.88794,
  longitude: 120.48341
} as const;
const routeEndLocation = {
  address: "旗山醫院",
  latitude: 22.88794,
  longitude: 120.48341
} as const;
const routeDatePreviewWindowDays = 30;
const familyLineSettingsStorageKey = "tcm-family-line-settings";
const familyLineManagedContactsStorageKey = "tcm-family-line-managed-contacts";
const weekdayToIndex: Record<(typeof weekdayOptions)[number], number> = {
  星期一: 1,
  星期二: 2,
  星期三: 3,
  星期四: 4,
  星期五: 5,
  星期六: 6,
  星期日: 0
};
const calendarDayToWeekday: Record<number, (typeof weekdayOptions)[number]> = {
  0: "星期日",
  1: "星期一",
  2: "星期二",
  3: "星期三",
  4: "星期四",
  5: "星期五",
  6: "星期六"
};

function buildRoutePlanId(doctorId: string, routeDate: string, weekday: string, serviceTimeSlot: RouteTimeSlot) {
  return `route-${doctorId}-${routeDate}-${weekday}-${serviceTimeSlot}`;
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDateInput(routeDate: string, days: number) {
  const parsedDate = new Date(`${routeDate}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return routeDate;
  }
  parsedDate.setDate(parsedDate.getDate() + days);
  return formatDateInputValue(parsedDate);
}

function getUpcomingDateInputs(from = new Date(), daysAhead = 3) {
  const startDate = new Date(from);
  startDate.setHours(0, 0, 0, 0);
  return Array.from({ length: daysAhead + 1 }, (_, dayOffset) => {
    const targetDate = new Date(startDate);
    targetDate.setDate(startDate.getDate() + dayOffset);
    return formatDateInputValue(targetDate);
  });
}

function buildUpcomingRouteDatesForWeekday(
  weekday: (typeof weekdayOptions)[number],
  from = new Date(),
  days = routeDatePreviewWindowDays
) {
  const startDate = new Date(from);
  startDate.setHours(0, 0, 0, 0);
  const targetDay = weekdayToIndex[weekday];
  const matchedDates: string[] = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + dayOffset);
    if (currentDate.getDay() === targetDay) {
      matchedDates.push(formatDateInputValue(currentDate));
    }
  }

  return matchedDates;
}

function buildRouteDateOptionLabel(routeDate: string, weekdayOptions: string[], timeSlots: string[]) {
  const weekdayLabel = weekdayOptions.join(" / ");
  const timeSlotLabel = timeSlots.join("、");
  return `${formatDateOnly(routeDate)} ${weekdayLabel}${timeSlotLabel ? ` ${timeSlotLabel}` : ""}`;
}

function resolveWeekdayFromRouteDate(routeDate: string) {
  if (!routeDate) {
    return null;
  }
  const parsedDate = new Date(`${routeDate}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return calendarDayToWeekday[parsedDate.getDay()] ?? null;
}

function getDoctorServiceSlotPreferences(availableServiceSlots: string[]) {
  const preferences: Array<{
    weekday: (typeof weekdayOptions)[number];
    timeSlot: RouteTimeSlot;
  }> = [];

  availableServiceSlots.forEach((slot) => {
    const parsedSlot = parseDoctorServiceSlot(slot);
    if (!parsedSlot) {
      return;
    }
    const hasDuplicate = preferences.some(
      (preference) =>
        preference.weekday === parsedSlot.weekday && preference.timeSlot === parsedSlot.timeSlot
    );
    if (!hasDuplicate) {
      preferences.push(parsedSlot);
    }
  });

  return preferences;
}

function getDoctorTimeSlotsByWeekday(
  availableServiceSlots: string[],
  weekday: (typeof weekdayOptions)[number]
) {
  return getDoctorServiceSlotPreferences(availableServiceSlots)
    .filter((slot) => slot.weekday === weekday)
    .map((slot) => slot.timeSlot);
}

function orderTimeSlotsByDoctorPreference(input: {
  availableServiceSlots: string[];
  weekday: (typeof weekdayOptions)[number];
  candidateTimeSlots: RouteTimeSlot[];
}) {
  const orderedCandidates: RouteTimeSlot[] = [];
  const preferredTimeSlots = getDoctorTimeSlotsByWeekday(input.availableServiceSlots, input.weekday);

  preferredTimeSlots.forEach((timeSlot) => {
    if (input.candidateTimeSlots.includes(timeSlot) && !orderedCandidates.includes(timeSlot)) {
      orderedCandidates.push(timeSlot);
    }
  });

  input.candidateTimeSlots.forEach((timeSlot) => {
    if (!orderedCandidates.includes(timeSlot)) {
      orderedCandidates.push(timeSlot);
    }
  });

  return orderedCandidates;
}

function buildRouteDateOptions(input: {
  selectedDoctor?: { available_service_slots: string[] };
  savedRoutePlans: SavedRoutePlan[];
}) {
  const availableServiceSlots = input.selectedDoctor?.available_service_slots ?? [];
  const grouped = new Map<
    string,
    {
      routeDate: string;
      pairs: Array<{
        weekday: (typeof weekdayOptions)[number];
        timeSlot: RouteTimeSlot;
        source: "saved" | "availability";
      }>;
    }
  >();

  const appendPair = (
    routeDate: string,
    weekday: (typeof weekdayOptions)[number],
    timeSlot: RouteTimeSlot,
    source: "saved" | "availability"
  ) => {
    const existing = grouped.get(routeDate) ?? {
      routeDate,
      pairs: []
    };
    const hasDuplicate = existing.pairs.some(
      (pair) => pair.weekday === weekday && pair.timeSlot === timeSlot
    );
    if (!hasDuplicate) {
      existing.pairs.push({
        weekday,
        timeSlot,
        source
      });
    }
    grouped.set(routeDate, existing);
  };

  (input.selectedDoctor?.available_service_slots ?? []).forEach((slot) => {
    const parsedSlot = parseDoctorServiceSlot(slot);
    if (!parsedSlot) {
      return;
    }
    buildUpcomingRouteDatesForWeekday(parsedSlot.weekday).forEach((routeDate) => {
      appendPair(routeDate, parsedSlot.weekday, parsedSlot.timeSlot, "availability");
    });
  });

  input.savedRoutePlans.forEach((routePlan) => {
    const parsedTimeSlot = routeTimeSlotOptions.find(
      (timeSlot) => timeSlot === routePlan.service_time_slot
    );
    const parsedWeekday = weekdayOptions.find(
      (weekday) => weekday === routePlan.route_weekday
    );
    if (!parsedTimeSlot || !parsedWeekday) {
      return;
    }
    appendPair(routePlan.route_date, parsedWeekday, parsedTimeSlot, "saved");
  });

  return [...grouped.values()]
    .sort((left, right) => left.routeDate.localeCompare(right.routeDate))
    .map<RouteDateOption>((entry) => {
      const sortedPairs = entry.pairs.slice().sort((left, right) => {
        if (left.weekday !== right.weekday) {
          return weekdayToIndex[left.weekday] - weekdayToIndex[right.weekday];
        }
        if (left.timeSlot !== right.timeSlot) {
          return routeTimeSlotOptions.indexOf(left.timeSlot) - routeTimeSlotOptions.indexOf(right.timeSlot);
        }
        if (left.source !== right.source) {
          return left.source === "saved" ? -1 : 1;
        }
        return 0;
      });
      const weekdayOptions = [...new Set(sortedPairs.map((pair) => pair.weekday))];
      const timeSlotOptionsByWeekday = weekdayOptions.reduce<
        Partial<Record<(typeof weekdayOptions)[number], RouteTimeSlot[]>>
      >((result, weekday) => {
        const candidateTimeSlots = [
          ...new Set(
            sortedPairs
              .filter((pair) => pair.weekday === weekday)
              .map((pair) => pair.timeSlot)
          )
        ];
        result[weekday] = orderTimeSlotsByDoctorPreference({
          availableServiceSlots,
          weekday,
          candidateTimeSlots
        });
        return result;
      }, {});
      const allTimeSlots = [...new Set(sortedPairs.map((pair) => pair.timeSlot))];
      const inferredWeekday = resolveWeekdayFromRouteDate(entry.routeDate);
      const preferredWeekday =
        inferredWeekday && weekdayOptions.includes(inferredWeekday)
          ? inferredWeekday
          : sortedPairs[0].weekday;
      const preferredTimeSlot =
        timeSlotOptionsByWeekday[preferredWeekday]?.[0] ?? sortedPairs[0].timeSlot;

      return {
        routeDate: entry.routeDate,
        weekdayOptions,
        timeSlotOptionsByWeekday,
        preferredWeekday,
        preferredTimeSlot,
        label: buildRouteDateOptionLabel(entry.routeDate, weekdayOptions, allTimeSlots)
      };
    });
}

function reindexPlannerRows(rows: PlannerRow[]) {
  let routeOrder = 1;
  return rows.map<PlannerRow>((row) =>
    row.checked
      ? {
          ...row,
          routeOrder: routeOrder++,
          status:
            row.status === "on_the_way" ||
            row.status === "in_treatment" ||
            row.status === "completed"
              ? row.status
              : ("scheduled" as PlannerStatus)
        }
      : {
          ...row,
          routeOrder: null,
          status: "paused" as PlannerStatus
        }
  );
}

function sortPlannerRows(rows: PlannerRow[]) {
  return [...rows].sort((left, right) => {
    const leftOrder = left.routeOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.routeOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.name.localeCompare(right.name, "zh-Hant");
  });
}

function arePlannerRowsEqual(leftRows: PlannerRow[], rightRows: PlannerRow[]) {
  if (leftRows.length !== rightRows.length) {
    return false;
  }
  return leftRows.every((leftRow, index) => {
    const rightRow = rightRows[index];
    return (
      rightRow &&
      leftRow.patientId === rightRow.patientId &&
      leftRow.name === rightRow.name &&
      leftRow.address === rightRow.address &&
      leftRow.latitude === rightRow.latitude &&
      leftRow.longitude === rightRow.longitude &&
      leftRow.geocodingStatus === rightRow.geocodingStatus &&
      leftRow.geocodedAddress === rightRow.geocodedAddress &&
      leftRow.checked === rightRow.checked &&
      leftRow.routeOrder === rightRow.routeOrder &&
      leftRow.status === rightRow.status &&
      leftRow.scheduleId === rightRow.scheduleId
    );
  });
}

function reorderCheckedPlannerRows(rows: PlannerRow[], activePatientId: string, targetPatientId: string) {
  if (activePatientId === targetPatientId) {
    return rows;
  }

  const orderedRows = sortPlannerRows(rows);
  const checkedRows = orderedRows.filter((row) => row.checked);
  const uncheckedRows = orderedRows.filter((row) => !row.checked);
  const activeIndex = checkedRows.findIndex((row) => row.patientId === activePatientId);
  const targetIndex = checkedRows.findIndex((row) => row.patientId === targetPatientId);

  if (activeIndex < 0 || targetIndex < 0) {
    return rows;
  }

  const nextCheckedRows = [...checkedRows];
  const [movedRow] = nextCheckedRows.splice(activeIndex, 1);
  nextCheckedRows.splice(targetIndex, 0, movedRow);

  return reindexPlannerRows([...nextCheckedRows, ...uncheckedRows]);
}

function parseDoctorServiceSlot(slot: string) {
  const matchedWeekday = weekdayOptions.find((weekday) => slot.startsWith(weekday));
  const matchedTimeSlot = routeTimeSlotOptions.find((timeSlot) => slot.endsWith(timeSlot));
  if (!matchedWeekday || !matchedTimeSlot) {
    return null;
  }
  return {
    weekday: matchedWeekday,
    timeSlot: matchedTimeSlot
  };
}

function resolveScheduleRouteTimeSlot(schedule: Pick<VisitSchedule, "service_time_slot" | "scheduled_start_at">): RouteTimeSlot {
  if (schedule.service_time_slot.includes("上午")) {
    return "上午";
  }
  if (schedule.service_time_slot.includes("下午")) {
    return "下午";
  }
  return new Date(schedule.scheduled_start_at).getHours() < 13 ? "上午" : "下午";
}

function loadFamilyLineJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadFamilyLineArray<T>(key: string): T[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normalizeManagedFamilyLineContacts(contacts: ManagedFamilyLineContactSnapshot[]) {
  return contacts
    .map((contact) => {
      const lineUserId = String(contact.lineUserId ?? contact.userId ?? "").trim();
      return {
        ...contact,
        id: contact.id || `line-contact-${lineUserId}`,
        displayName: contact.displayName || lineUserId,
        lineUserId,
        linkedPatientIds: Array.isArray(contact.linkedPatientIds)
          ? contact.linkedPatientIds.map((patientId) => String(patientId ?? "").trim()).filter(Boolean)
          : []
      };
    })
    .filter((contact) => contact.lineUserId);
}

function loadManagedFamilyLineContacts() {
  return normalizeManagedFamilyLineContacts(
    loadFamilyLineArray<ManagedFamilyLineContactSnapshot>(familyLineManagedContactsStorageKey)
  );
}

function buildLeaveLineRecipients(input: {
  contacts: ManagedFamilyLineContactSnapshot[];
  impactedPatientIds: Set<string>;
  patientNameById: Map<string, string>;
}) {
  const recipientByLineUserId = new Map<string, LeaveLineRecipient>();
  input.contacts.forEach((contact) => {
    const lineUserId = String(contact.lineUserId ?? contact.userId ?? "").trim();
    if (!lineUserId) {
      return;
    }
    const matchedPatientIds = contact.linkedPatientIds.filter((patientId) =>
      input.impactedPatientIds.has(patientId)
    );
    if (!matchedPatientIds.length) {
      return;
    }
    const existing = recipientByLineUserId.get(lineUserId);
    const nextPatientIds = [
      ...(existing?.matchedPatientIds ?? []),
      ...matchedPatientIds
    ].filter((patientId, index, patientIds) => patientIds.indexOf(patientId) === index);
    recipientByLineUserId.set(lineUserId, {
      id: contact.id,
      displayName: contact.displayName,
      lineUserId,
      matchedPatientIds: nextPatientIds,
      matchedPatientNames: nextPatientIds.map((patientId) => input.patientNameById.get(patientId) ?? patientId)
    });
  });
  return Array.from(recipientByLineUserId.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "zh-Hant")
  );
}

function hasPlannedRouteForSlot(input: {
  doctorId: string;
  routeDate: string;
  timeSlot: RouteTimeSlot;
  savedRoutePlans: SavedRoutePlan[];
  schedules: VisitSchedule[];
}) {
  return (
    input.savedRoutePlans.some(
      (routePlan) =>
        routePlan.doctor_id === input.doctorId &&
        routePlan.route_date === input.routeDate &&
        routePlan.service_time_slot === input.timeSlot
    ) ||
    input.schedules.some(
      (schedule) =>
        schedule.assigned_doctor_id === input.doctorId &&
        schedule.scheduled_start_at.slice(0, 10) === input.routeDate &&
        resolveScheduleRouteTimeSlot(schedule) === input.timeSlot &&
        schedule.visit_type !== "回院病歷" &&
        schedule.status !== "cancelled"
    )
  );
}

function buildAutoScheduleCarryoverCandidates(input: {
  doctors: Array<{
    id: string;
    name: string;
    available_service_slots: string[];
  }>;
  savedRoutePlans: SavedRoutePlan[];
  schedules: VisitSchedule[];
  now?: Date;
}) {
  const targetDates = getUpcomingDateInputs(input.now);

  return targetDates.flatMap((routeDate) => {
    const routeWeekday = resolveWeekdayFromRouteDate(routeDate);
    if (!routeWeekday) {
      return [];
    }

    return input.doctors.flatMap<AutoScheduleCarryoverCandidate>((doctor) => {
      const targetTimeSlots = getDoctorTimeSlotsByWeekday(
        doctor.available_service_slots,
        routeWeekday
      );

      return targetTimeSlots.flatMap((timeSlot) => {
        if (
          hasPlannedRouteForSlot({
            doctorId: doctor.id,
            routeDate,
            timeSlot,
            savedRoutePlans: input.savedRoutePlans,
            schedules: input.schedules
          })
        ) {
          return [];
        }

        const sourceMatch = ([7, 14] as const)
          .map((daysBack) => ({
            daysBack,
            sourceDate: addDaysToDateInput(routeDate, -daysBack)
          }))
          .map(({ daysBack, sourceDate }) => ({
            daysBack,
            sourceDate,
            routePlan: input.savedRoutePlans.find(
              (routePlan) =>
                routePlan.doctor_id === doctor.id &&
                routePlan.route_date === sourceDate &&
                routePlan.service_time_slot === timeSlot &&
                routePlan.route_items.length > 0
            )
          }))
          .find((candidate) => Boolean(candidate.routePlan));

        if (!sourceMatch?.routePlan) {
          return [];
        }

        const id = `auto-carryover-${doctor.id}-${routeDate}-${timeSlot}`;
        return [
          {
            id,
            notificationItemId: `nc-${id}`,
            doctorId: doctor.id,
            doctorName: doctor.name,
            routeDate,
            routeWeekday,
            timeSlot,
            sourceRoutePlanId: sourceMatch.routePlan.id,
            sourceRoutePlanName: sourceMatch.routePlan.route_name,
            sourceRouteDate: sourceMatch.sourceDate,
            sourceDaysBack: sourceMatch.daysBack,
            checkedPatientCount: sourceMatch.routePlan.route_items.filter((item) => item.checked).length
          }
        ];
      });
    });
  });
}

function buildAutoScheduleNotificationItem(candidate: AutoScheduleCarryoverCandidate): NotificationCenterItem {
  const now = new Date().toISOString();
  return {
    id: candidate.notificationItemId,
    role: "admin",
    owner_user_id: null,
    source_type: "system_notification",
    title: `排程待確認｜${candidate.doctorName}`,
    content: `${formatDateOnly(candidate.routeDate)} ${candidate.routeWeekday}${candidate.timeSlot} 尚未排程。系統找到 ${candidate.sourceDaysBack} 天前同時段路線「${candidate.sourceRoutePlanName}」，請行政人員確認是否沿用排入。`,
    linked_patient_id: null,
    linked_visit_schedule_id: null,
    linked_doctor_id: candidate.doctorId,
    linked_leave_request_id: null,
    status: "pending",
    is_unread: true,
    reply_text: null,
    reply_updated_at: null,
    reply_updated_by_role: null,
    created_at: now,
    updated_at: now
  };
}

function buildCarriedOverRoutePlan(input: {
  candidate: AutoScheduleCarryoverCandidate;
  sourceRoutePlan: SavedRoutePlan;
  patientsById: Map<string, { id: string; name: string; address: string; home_address: string; status: string }>;
}) {
  const now = new Date().toISOString();
  let nextRouteOrder = 1;
  const routeItems: SavedRoutePlan["route_items"] = [];
  input.sourceRoutePlan.route_items
    .slice()
    .sort(
      (left, right) =>
        (left.route_order ?? Number.MAX_SAFE_INTEGER) -
          (right.route_order ?? Number.MAX_SAFE_INTEGER) ||
        left.patient_name.localeCompare(right.patient_name, "zh-Hant")
    )
    .forEach((item) => {
      const patient = input.patientsById.get(item.patient_id);
      if (!patient || patient.status !== "active") {
        return;
      }
      const checked = item.checked;
      const routeOrder = checked ? nextRouteOrder++ : null;
      routeItems.push({
        patient_id: item.patient_id,
        schedule_id: null,
        checked,
        route_order: routeOrder,
        status: checked ? ("scheduled" as const) : ("paused" as const),
        patient_name: patient.name,
        address: patient.home_address || patient.address || item.address
      });
    });
  const checkedCount = routeItems.filter((item) => item.checked).length;
  const routePlanId = buildRoutePlanId(
    input.candidate.doctorId,
    input.candidate.routeDate,
    input.candidate.routeWeekday,
    input.candidate.timeSlot
  );

  return {
    ...input.sourceRoutePlan,
    id: routePlanId,
    doctor_id: input.candidate.doctorId,
    route_group_id: routePlanId,
    route_name: `${formatDateOnly(input.candidate.routeDate)} ${input.candidate.doctorName} ${input.candidate.routeWeekday}${input.candidate.timeSlot}（沿用前次）`,
    route_date: input.candidate.routeDate,
    route_weekday: input.candidate.routeWeekday,
    service_time_slot: input.candidate.timeSlot,
    schedule_ids: [],
    route_items: routeItems,
    execution_status: "draft" as const,
    executed_at: null,
    total_minutes: checkedCount * 60,
    saved_at: now,
    created_at: now,
    updated_at: now
  } satisfies SavedRoutePlan;
}

function buildPlannerRowsFromSlotPatients(
  patients: Array<{
    id: string;
    name: string;
    address: string;
    home_address: string;
    home_latitude: number | null;
    home_longitude: number | null;
  }>
): PlannerRow[] {
  return patients.map((patient, index) => ({
    patientId: patient.id,
    name: patient.name,
    address: patient.home_address || patient.address,
    latitude: patient.home_latitude,
    longitude: patient.home_longitude,
    checked: true,
    routeOrder: index + 1,
    status: "scheduled",
    scheduleId: null
  }));
}

function buildPlannerRowsFromRoutePlan(
  routePlan: SavedRoutePlan,
  patientsById: Map<
    string,
    {
      id: string;
      name: string;
      address: string;
      home_address: string;
      home_latitude: number | null;
      home_longitude: number | null;
      status: string;
    }
  >
) {
  return sortPlannerRows(
    routePlan.route_items
      .map((item) => {
        const patient = patientsById.get(item.patient_id);
        if (!patient || patient.status !== "active") {
          return null;
        }
        return {
          patientId: item.patient_id,
          name: patient.name,
          address: patient.home_address || patient.address || item.address,
          latitude: patient.home_latitude,
          longitude: patient.home_longitude,
          checked: item.checked,
          routeOrder: item.route_order,
          status: item.status,
          scheduleId: item.schedule_id
        } satisfies PlannerRow;
      })
      .filter((row): row is PlannerRow => Boolean(row))
  );
}

function buildPlannerRowsForPreviousRouteDraft(
  routePlan: SavedRoutePlan,
  patientsById: Parameters<typeof buildPlannerRowsFromRoutePlan>[1]
) {
  return reindexPlannerRows(
    buildPlannerRowsFromRoutePlan(routePlan, patientsById).map((row) => ({
      ...row,
      scheduleId: null,
      status: row.checked ? ("scheduled" as PlannerStatus) : ("paused" as PlannerStatus)
    }))
  );
}

function buildRoutePreviewInput(input: {
  routeDate: string;
  doctorName?: string;
  weekday: string;
  timeSlot: RouteTimeSlot;
  checkedRows: PlannerRow[];
  startAddress: string;
  endAddress: string;
}): RouteMapInput | null {
  if (!input.routeDate || input.checkedRows.length === 0) {
    return null;
  }

  const normalizedStartAddress = input.startAddress.trim() || routeStartLocation.address;
  const normalizedEndAddress = input.endAddress.trim() || routeEndLocation.address;
  const startLocation =
    normalizedStartAddress === routeStartLocation.address
      ? routeStartLocation
      : { address: normalizedStartAddress, latitude: null, longitude: null };
  const endLocation =
    normalizedEndAddress === routeEndLocation.address
      ? routeEndLocation
      : { address: normalizedEndAddress, latitude: null, longitude: null };

  return {
    origin: {
      address: startLocation.address,
      label: "旗山醫院",
      latitude: startLocation.latitude,
      longitude: startLocation.longitude
    },
    destination: {
      address: endLocation.address,
      label: "旗山醫院",
      latitude: endLocation.latitude,
      longitude: endLocation.longitude
    },
    waypoints: input.checkedRows.map((row) => ({
      address: row.address,
      label: `第 ${row.routeOrder ?? "-"} 站 ${maskPatientName(row.name)}`,
      geocodingFailureReason:
        row.geocodingStatus === "failed" ? row.geocodedAddress ?? null : null,
      latitude: row.latitude,
      longitude: row.longitude
    })),
    travelMode: "driving",
    label: `${formatDateOnly(input.routeDate)} ${input.doctorName ?? "未指定醫師"} ${input.weekday}${input.timeSlot}`
  };
}

type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

function isValidRouteCoordinate(
  latitude: number | null,
  longitude: number | null
): boolean {
  return typeof latitude === "number" && typeof longitude === "number";
}

function calculateStraightLineDistanceKilometers(start: RouteCoordinate, end: RouteCoordinate) {
  const earthRadiusKm = 6371;
  const latitudeDelta = ((end.latitude - start.latitude) * Math.PI) / 180;
  const longitudeDelta = ((end.longitude - start.longitude) * Math.PI) / 180;
  const startLatitudeRadians = (start.latitude * Math.PI) / 180;
  const endLatitudeRadians = (end.latitude * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitudeRadians) *
      Math.cos(endLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return earthRadiusKm * arc;
}

function resolveRouteCoordinate(
  address: string,
  fallback: { address: string; latitude: number; longitude: number }
) {
  return address.trim() === fallback.address
    ? {
        latitude: fallback.latitude,
        longitude: fallback.longitude
      }
    : null;
}

function getPlannerRowCoordinate(row: PlannerRow) {
  if (!isValidRouteCoordinate(row.latitude, row.longitude)) {
    return null;
  }
  return {
    latitude: row.latitude as number,
    longitude: row.longitude as number
  };
}

function calculateRouteDistance(input: {
  rows: PlannerRow[];
  startCoordinate: RouteCoordinate;
  endCoordinate: RouteCoordinate | null;
}) {
  if (input.rows.length === 0) {
    return 0;
  }

  const routeCoordinates = input.rows
    .map((row) => getPlannerRowCoordinate(row))
    .filter((coordinate): coordinate is RouteCoordinate => Boolean(coordinate));

  if (routeCoordinates.length === 0) {
    return 0;
  }

  let totalDistance = calculateStraightLineDistanceKilometers(
    input.startCoordinate,
    routeCoordinates[0]
  );

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    totalDistance += calculateStraightLineDistanceKilometers(
      routeCoordinates[index],
      routeCoordinates[index + 1]
    );
  }

  if (input.endCoordinate) {
    totalDistance += calculateStraightLineDistanceKilometers(
      routeCoordinates[routeCoordinates.length - 1],
      input.endCoordinate
    );
  }

  return totalDistance;
}

type RouteOptimizationStrategy = "nearest_neighbor" | "unchanged";

function findNearestNeighborPlannerRows(input: {
  rows: PlannerRow[];
  startCoordinate: RouteCoordinate;
  endCoordinate: RouteCoordinate | null;
}) {
  const remainingRows = [...input.rows];
  const nearestNeighborRows: PlannerRow[] = [];
  let currentCoordinate = input.startCoordinate;

  while (remainingRows.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    remainingRows.forEach((row, index) => {
      const coordinate = getPlannerRowCoordinate(row);
      if (!coordinate) {
        return;
      }
      const distance = calculateStraightLineDistanceKilometers(currentCoordinate, coordinate);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    const [nearestRow] = remainingRows.splice(nearestIndex, 1);
    nearestNeighborRows.push(nearestRow);
    currentCoordinate = getPlannerRowCoordinate(nearestRow) ?? currentCoordinate;
  }

  return {
    rows: nearestNeighborRows,
    totalDistanceKilometers: calculateRouteDistance({
      rows: nearestNeighborRows,
      startCoordinate: input.startCoordinate,
      endCoordinate: input.endCoordinate
    })
  };
}

// 依「目前點到下一站距離最短」逐站排序；這是最近鄰原則，
// 重點是每一步都選最近的下一個停留點，而不是枚舉全路線總距離最佳解。
function optimizePlannerRowsByDistance(input: {
  checkedRows: PlannerRow[];
  startAddress: string;
  endAddress: string;
}) {
  if (input.checkedRows.length < 2) {
    return {
      reorderedRows: input.checkedRows,
      unresolvedCoordinateCount: 0,
      strategy: "unchanged" as RouteOptimizationStrategy
    };
  }

  const coordinateRows = input.checkedRows.filter((row) => Boolean(getPlannerRowCoordinate(row)));
  const unresolvedCoordinateRows = input.checkedRows.filter((row) => !getPlannerRowCoordinate(row));

  if (coordinateRows.length < 2) {
    return {
      reorderedRows: input.checkedRows,
      unresolvedCoordinateCount: unresolvedCoordinateRows.length,
      strategy: "unchanged" as RouteOptimizationStrategy
    };
  }

  const startCoordinate =
    resolveRouteCoordinate(input.startAddress, routeStartLocation) ?? getPlannerRowCoordinate(coordinateRows[0]);
  if (!startCoordinate) {
    return {
      reorderedRows: input.checkedRows,
      unresolvedCoordinateCount: unresolvedCoordinateRows.length,
      strategy: "unchanged" as RouteOptimizationStrategy
    };
  }

  const endCoordinate =
    resolveRouteCoordinate(input.endAddress, routeEndLocation) ?? startCoordinate;

  const strategy: RouteOptimizationStrategy = "nearest_neighbor";
  const optimizationResult = findNearestNeighborPlannerRows({
    rows: coordinateRows,
    startCoordinate,
    endCoordinate
  });

  return {
    reorderedRows: [...optimizationResult.rows, ...unresolvedCoordinateRows],
    unresolvedCoordinateCount: unresolvedCoordinateRows.length,
    strategy,
    totalDistanceKilometers: optimizationResult.totalDistanceKilometers
  };
}

export function AdminSchedulesPage() {
  const { repositories, services, db } = useAppContext();
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [routeDateMode, setRouteDateMode] = useState<RouteDateMode>("preset");
  const [selectedWeekday, setSelectedWeekday] = useState<string>("");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<RouteTimeSlot | "">("");
  const [routeDate, setRouteDate] = useState<string>("");
  const [routeStartAddress, setRouteStartAddress] = useState<string>(routeStartLocation.address);
  const [routeEndAddress, setRouteEndAddress] = useState<string>(routeEndLocation.address);
  const [isRouteEndpointsDialogOpen, setIsRouteEndpointsDialogOpen] = useState(false);
  const [selectedSavedRoutePlanId, setSelectedSavedRoutePlanId] = useState<string>("");
  const [selectedSavedRoutePlanIds, setSelectedSavedRoutePlanIds] = useState<string[]>([]);
  const [isBatchDeleteDialogOpen, setIsBatchDeleteDialogOpen] = useState(false);
  const [isSlotPatientDialogOpen, setIsSlotPatientDialogOpen] = useState(false);
  const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
  const [isGeocodingPlannerRows, setIsGeocodingPlannerRows] = useState(false);
  const [geocodingMessage, setGeocodingMessage] = useState<string | null>(null);
  const [draggingPlannerPatientId, setDraggingPlannerPatientId] = useState<string | null>(null);
  const [dragTargetPlannerPatientId, setDragTargetPlannerPatientId] = useState<string | null>(null);
  const [dismissedAutoScheduleCandidateIds, setDismissedAutoScheduleCandidateIds] = useState<string[]>([]);
  const [recentAction, setRecentAction] = useState<string | null>(null);
  const autoGeocodingRequestKeyRef = useRef<string | null>(null);

  const doctors = useMemo(
    () => [...db.doctors],
    [db.doctors]
  );
  const selectedDoctor = doctors.find((doctor) => doctor.id === selectedDoctorId);
  const patientsById = useMemo(
    () => new Map(db.patients.map((patient) => [patient.id, patient])),
    [db.patients]
  );
  const doctorsById = useMemo(
    () => new Map(doctors.map((doctor) => [doctor.id, doctor])),
    [doctors]
  );
  const savedRoutePlans = useMemo(
    () => [...db.saved_route_plans],
    [db.saved_route_plans]
  );
  const allSchedules = useMemo(
    () => [...db.visit_schedules],
    [db.visit_schedules]
  );
  const allScheduleRows = useMemo(
    () =>
      allSchedules
        .slice()
        .sort(
          (left, right) =>
            new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime() ||
            left.assigned_doctor_id.localeCompare(right.assigned_doctor_id) ||
            left.route_order - right.route_order
        ),
    [allSchedules]
  );
  const autoScheduleCarryoverCandidates = useMemo(
    () =>
      buildAutoScheduleCarryoverCandidates({
        doctors,
        savedRoutePlans,
        schedules: allSchedules
      }),
    [allSchedules, doctors, savedRoutePlans]
  );
  const visibleAutoScheduleCarryoverCandidates = useMemo(
    () =>
      autoScheduleCarryoverCandidates.filter(
        (candidate) => !dismissedAutoScheduleCandidateIds.includes(candidate.id)
      ),
    [autoScheduleCarryoverCandidates, dismissedAutoScheduleCandidateIds]
  );
  const selectedSavedRoutePlan = selectedSavedRoutePlanId
    ? savedRoutePlans.find((routePlan) => routePlan.id === selectedSavedRoutePlanId)
    : undefined;
  const previousRoutePlan = useMemo(() => {
    if (!selectedDoctorId) {
      return undefined;
    }
    const doctorRoutePlans = savedRoutePlans.filter(
      (routePlan) => routePlan.doctor_id === selectedDoctorId && routePlan.route_items.length > 0
    );
    if (doctorRoutePlans.length === 0) {
      return undefined;
    }
    const olderThanCurrentRouteDate = routeDate
      ? doctorRoutePlans.filter((routePlan) => routePlan.route_date < routeDate)
      : [];
    const candidates = olderThanCurrentRouteDate.length > 0 ? olderThanCurrentRouteDate : doctorRoutePlans;
    return candidates
      .slice()
      .sort(
        (left, right) =>
          right.route_date.localeCompare(left.route_date) ||
          new Date(right.saved_at || right.updated_at).getTime() -
            new Date(left.saved_at || left.updated_at).getTime()
      )[0];
  }, [routeDate, savedRoutePlans, selectedDoctorId]);
  const derivedRouteWeekday = useMemo(
    () => resolveWeekdayFromRouteDate(routeDate),
    [routeDate]
  );
  const effectiveSelectedWeekday =
    routeDateMode === "ad_hoc" ? derivedRouteWeekday ?? selectedWeekday : selectedWeekday;
  const slotPatients = useMemo(
    () =>
      selectedDoctorId && effectiveSelectedWeekday && selectedTimeSlot
        ? [...db.patients]
            .filter(
              (patient) =>
                patient.status === "active" &&
                patient.preferred_doctor_id === selectedDoctorId &&
                patient.preferred_service_slot ===
                  `${effectiveSelectedWeekday}${selectedTimeSlot}`
            )
            .sort((left, right) => left.chart_number.localeCompare(right.chart_number, "zh-Hant"))
        : [],
    [db.patients, effectiveSelectedWeekday, selectedDoctorId, selectedTimeSlot]
  );
  const sortedPlannerRows = useMemo(() => sortPlannerRows(plannerRows), [plannerRows]);
  const checkedRows = useMemo(
    () => sortedPlannerRows.filter((row) => row.checked),
    [sortedPlannerRows]
  );
  const missingCheckedCoordinateCount = useMemo(
    () => checkedRows.filter((row) => !getPlannerRowCoordinate(row)).length,
    [checkedRows]
  );
  const routePreview = useMemo(
    () =>
      effectiveSelectedWeekday && selectedTimeSlot
        ? buildRoutePreviewInput({
            routeDate,
            doctorName: selectedDoctor?.name,
            weekday: effectiveSelectedWeekday,
            timeSlot: selectedTimeSlot,
            checkedRows,
            startAddress: routeStartAddress,
            endAddress: routeEndAddress
          })
        : null,
    [
      checkedRows,
      effectiveSelectedWeekday,
      routeDate,
      routeEndAddress,
      routeStartAddress,
      selectedDoctor?.name,
      selectedTimeSlot
    ]
  );
  const availableWeekdays = useMemo(() => {
    if (routeDateMode === "ad_hoc") {
      return derivedRouteWeekday ? [derivedRouteWeekday] : [];
    }
    const serviceSlots = selectedDoctor?.available_service_slots ?? [];
    const matchedWeekdays = new Set(
      serviceSlots
        .map((slot) => parseDoctorServiceSlot(slot)?.weekday)
        .filter((weekday): weekday is (typeof weekdayOptions)[number] => Boolean(weekday))
    );
    return weekdayOptions.filter((weekday) => matchedWeekdays.has(weekday));
  }, [derivedRouteWeekday, routeDateMode, selectedDoctor]);
  const availableRouteDateOptions = useMemo(
    () =>
      selectedDoctorId
        ? buildRouteDateOptions({
            selectedDoctor,
            savedRoutePlans: savedRoutePlans.filter((routePlan) => routePlan.doctor_id === selectedDoctorId)
          })
        : [],
    [savedRoutePlans, selectedDoctor, selectedDoctorId]
  );
  const selectedRouteDateOption = useMemo(
    () => availableRouteDateOptions.find((option) => option.routeDate === routeDate),
    [availableRouteDateOptions, routeDate]
  );
  const availableTimeSlots = useMemo(() => {
    if (!effectiveSelectedWeekday) {
      return [];
    }
    const serviceSlots = selectedDoctor?.available_service_slots ?? [];
    const matchedOptions = getDoctorTimeSlotsByWeekday(
      serviceSlots,
      effectiveSelectedWeekday as (typeof weekdayOptions)[number]
    );
    if (routeDateMode === "ad_hoc") {
      return matchedOptions.length ? matchedOptions : routeTimeSlotOptions;
    }
    if (selectedRouteDateOption) {
      return selectedRouteDateOption.timeSlotOptionsByWeekday[
        effectiveSelectedWeekday as (typeof weekdayOptions)[number]
      ] ?? [];
    }
    return matchedOptions;
  }, [effectiveSelectedWeekday, routeDateMode, selectedDoctor, selectedRouteDateOption]);

  useEffect(() => {
    if (selectedSavedRoutePlanId || routeDateMode !== "preset" || !selectedDoctorId || routeDate) {
      return;
    }
    const defaultRouteDateOption = availableRouteDateOptions[0];
    if (!defaultRouteDateOption) {
      return;
    }
    setRouteDate(defaultRouteDateOption.routeDate);
    setSelectedWeekday(defaultRouteDateOption.preferredWeekday);
    setSelectedTimeSlot(defaultRouteDateOption.preferredTimeSlot);
  }, [
    availableRouteDateOptions,
    routeDate,
    routeDateMode,
    selectedDoctorId,
    selectedSavedRoutePlanId
  ]);

  useEffect(() => {
    const existingNotificationItemIds = new Set(
      db.notification_center_items.map((item) => item.id)
    );
    autoScheduleCarryoverCandidates.forEach((candidate) => {
      if (existingNotificationItemIds.has(candidate.notificationItemId)) {
        return;
      }
      repositories.notificationRepository.createNotificationCenterItem(
        buildAutoScheduleNotificationItem(candidate)
      );
    });
  }, [autoScheduleCarryoverCandidates, db.notification_center_items, repositories.notificationRepository]);

  useEffect(() => {
    if (routeDateMode === "ad_hoc") {
      return;
    }
    const validWeekdays =
      selectedRouteDateOption?.weekdayOptions.length
        ? selectedRouteDateOption.weekdayOptions
        : availableWeekdays;
    if (selectedWeekday && !validWeekdays.includes(selectedWeekday as (typeof weekdayOptions)[number])) {
      setSelectedWeekday("");
      setSelectedTimeSlot("");
    }
  }, [availableWeekdays, routeDateMode, selectedRouteDateOption, selectedWeekday]);

  useEffect(() => {
    if (selectedSavedRoutePlanId) {
      return;
    }
    if (routeDateMode === "ad_hoc") {
      return;
    }
    if (!routeDate) {
      return;
    }
    if (selectedRouteDateOption) {
      return;
    }
    setRouteDate("");
    setSelectedWeekday("");
    setSelectedTimeSlot("");
  }, [routeDate, routeDateMode, selectedRouteDateOption, selectedSavedRoutePlanId]);

  useEffect(() => {
    if (selectedTimeSlot && !availableTimeSlots.includes(selectedTimeSlot)) {
      setSelectedTimeSlot("");
    }
  }, [availableTimeSlots, selectedTimeSlot]);

  useEffect(() => {
    if (selectedSavedRoutePlanId || !routeDate || !selectedRouteDateOption) {
      return;
    }
    if (routeDateMode === "ad_hoc") {
      return;
    }
    if (!selectedWeekday || !selectedRouteDateOption.weekdayOptions.includes(selectedWeekday as (typeof weekdayOptions)[number])) {
      setSelectedWeekday(selectedRouteDateOption.preferredWeekday);
      setSelectedTimeSlot(selectedRouteDateOption.preferredTimeSlot);
      return;
    }
    const weekdayTimeSlots =
      selectedRouteDateOption.timeSlotOptionsByWeekday[
        selectedWeekday as (typeof weekdayOptions)[number]
      ] ?? [];
    if (!selectedTimeSlot || !weekdayTimeSlots.includes(selectedTimeSlot)) {
      setSelectedTimeSlot(weekdayTimeSlots[0] ?? "");
    }
  }, [routeDate, routeDateMode, selectedRouteDateOption, selectedSavedRoutePlanId, selectedTimeSlot, selectedWeekday]);

  useEffect(() => {
    if (routeDateMode !== "ad_hoc" || !routeDate) {
      return;
    }
    if (derivedRouteWeekday && selectedWeekday !== derivedRouteWeekday) {
      setSelectedWeekday(derivedRouteWeekday);
      return;
    }
    if (!selectedTimeSlot || !availableTimeSlots.includes(selectedTimeSlot)) {
      setSelectedTimeSlot(availableTimeSlots[0] ?? "");
    }
  }, [availableTimeSlots, derivedRouteWeekday, routeDate, routeDateMode, selectedTimeSlot, selectedWeekday]);

  useEffect(() => {
    if (!selectedDoctorId || !effectiveSelectedWeekday || !selectedTimeSlot) {
      if (plannerRows.length > 0) {
        setPlannerRows([]);
      }
      return;
    }
    if (selectedSavedRoutePlanId) {
      return;
    }
    setPlannerRows((current) => {
      const nextRows = buildPlannerRowsFromSlotPatients(slotPatients);
      return arePlannerRowsEqual(current, nextRows) ? current : nextRows;
    });
  }, [
    effectiveSelectedWeekday,
    plannerRows.length,
    selectedDoctorId,
    selectedSavedRoutePlanId,
    selectedTimeSlot,
    slotPatients
  ]);

  useEffect(() => {
    if (!selectedSavedRoutePlanId) {
      return;
    }
    if (!selectedSavedRoutePlan) {
      setSelectedSavedRoutePlanId("");
      return;
    }
    setPlannerRows((current) => {
      const nextRows = buildPlannerRowsFromRoutePlan(selectedSavedRoutePlan, patientsById);
      return arePlannerRowsEqual(current, nextRows) ? current : nextRows;
    });
  }, [patientsById, selectedSavedRoutePlan, selectedSavedRoutePlanId]);

  useEffect(() => {
    const savedRoutePlanIdSet = new Set(savedRoutePlans.map((routePlan) => routePlan.id));
    const nextSelectedRoutePlanIds = selectedSavedRoutePlanIds.filter((routePlanId) =>
      savedRoutePlanIdSet.has(routePlanId)
    );
    if (
      nextSelectedRoutePlanIds.length !== selectedSavedRoutePlanIds.length ||
      nextSelectedRoutePlanIds.some(
        (routePlanId, index) => routePlanId !== selectedSavedRoutePlanIds[index]
      )
    ) {
      setSelectedSavedRoutePlanIds(nextSelectedRoutePlanIds);
    }
    if (selectedSavedRoutePlanId && !savedRoutePlanIdSet.has(selectedSavedRoutePlanId)) {
      setSelectedSavedRoutePlanId("");
    }
  }, [savedRoutePlans, selectedSavedRoutePlanId, selectedSavedRoutePlanIds]);

  const resetPlanner = () => {
    setSelectedDoctorId("");
    setRouteDateMode("preset");
    setSelectedWeekday("");
    setSelectedTimeSlot("");
    setRouteDate("");
    setRouteStartAddress(routeStartLocation.address);
    setRouteEndAddress(routeEndLocation.address);
    setIsRouteEndpointsDialogOpen(false);
    setSelectedSavedRoutePlanId("");
    setSelectedSavedRoutePlanIds([]);
    setIsBatchDeleteDialogOpen(false);
    setIsSlotPatientDialogOpen(false);
    setDismissedAutoScheduleCandidateIds([]);
    setDraggingPlannerPatientId(null);
    setDragTargetPlannerPatientId(null);
    setPlannerRows([]);
    setGeocodingMessage(null);
    autoGeocodingRequestKeyRef.current = null;
    setRecentAction("已清除排程管理頁面內容。");
  };

  const togglePlannerRow = (patientId: string, checked: boolean) => {
    setPlannerRows((current) =>
      reindexPlannerRows(
        current.map((row) =>
          row.patientId === patientId
            ? {
                ...row,
                checked
              }
            : row
        )
      )
    );
  };

  const selectAllPlannerRows = () => {
    setPlannerRows((current) =>
      reindexPlannerRows(
        current.map((row) => ({
          ...row,
          checked: true
        }))
      )
    );
  };

  const invertPlannerRowSelection = () => {
    setPlannerRows((current) =>
      reindexPlannerRows(
        current.map((row) => ({
          ...row,
          checked: !row.checked
        }))
      )
    );
  };

  const movePlannerRow = (patientId: string, direction: "up" | "down") => {
    setPlannerRows((current) => {
      const orderedCheckedRows = sortPlannerRows(current).filter((row) => row.checked);
      const currentIndex = orderedCheckedRows.findIndex((row) => row.patientId === patientId);
      if (currentIndex < 0) {
        return current;
      }
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= orderedCheckedRows.length) {
        return current;
      }
      return reorderCheckedPlannerRows(
        current,
        patientId,
        orderedCheckedRows[targetIndex].patientId
      );
    });
  };

  const resolveMissingPlannerCoordinates = async (sourceRows: PlannerRow[]) => {
    const targetRows = sortPlannerRows(sourceRows).filter(
      (row) => row.checked && !getPlannerRowCoordinate(row)
    );
    if (targetRows.length === 0) {
      return {
        rows: sourceRows,
        resolvedCount: 0,
        failedCount: 0,
        failureReasons: []
      };
    }

    setIsGeocodingPlannerRows(true);
    setGeocodingMessage(`正在向 Google 查詢座標（${targetRows.length} 站）。`);
    setPlannerRows((current) =>
      current.map((row) =>
        targetRows.some((targetRow) => targetRow.patientId === row.patientId)
          ? { ...row, geocodingStatus: "pending" }
          : row
      )
    );

    const resolvedRows = new Map<
      string,
      {
        latitude: number;
        longitude: number;
        formattedAddress: string;
        googleMapsLink: string;
      }
    >();
    const failedRows = new Map<string, string>();

    try {
      for (const row of targetRows) {
        const result = await services.maps.geocodeAddress({ address: row.address });
        if (!result) {
          failedRows.set(row.patientId, services.maps.getLastGeocodeError() ?? "Google 未回傳可用座標。");
          repositories.patientRepository.updatePatientCoordinates(row.patientId, {
            homeLatitude: null,
            homeLongitude: null,
            geocodingStatus: "failed"
          });
          continue;
        }

        const googleMapsLink = services.maps.buildPatientMapUrl({
          address: result.formattedAddress,
          latitude: result.latitude,
          longitude: result.longitude
        });
        repositories.patientRepository.updatePatientCoordinates(row.patientId, {
          homeLatitude: result.latitude,
          homeLongitude: result.longitude,
          geocodingStatus: "resolved",
          googleMapsLink
        });
        resolvedRows.set(row.patientId, {
          latitude: result.latitude,
          longitude: result.longitude,
          formattedAddress: result.formattedAddress,
          googleMapsLink
        });
      }
    } finally {
      setIsGeocodingPlannerRows(false);
    }

    const nextRows = sourceRows.map((row) => {
      const resolvedRow = resolvedRows.get(row.patientId);
      if (resolvedRow) {
        return {
          ...row,
          latitude: resolvedRow.latitude,
          longitude: resolvedRow.longitude,
          geocodingStatus: "resolved" as const,
          geocodedAddress: resolvedRow.formattedAddress
        };
      }
      const failedReason = failedRows.get(row.patientId);
      if (failedReason) {
        return {
          ...row,
          latitude: null,
          longitude: null,
          geocodingStatus: "failed" as const,
          geocodedAddress: failedReason
        };
      }
      return row;
    });

    setPlannerRows((current) =>
      current.map((row) => {
        const resolvedRow = resolvedRows.get(row.patientId);
        if (resolvedRow) {
          return {
            ...row,
            latitude: resolvedRow.latitude,
            longitude: resolvedRow.longitude,
            geocodingStatus: "resolved",
            geocodedAddress: resolvedRow.formattedAddress
          };
        }
        const failedReason = failedRows.get(row.patientId);
        if (failedReason) {
          return {
            ...row,
            latitude: null,
            longitude: null,
            geocodingStatus: "failed",
            geocodedAddress: failedReason
          };
        }
        return row;
      })
    );

    return {
      rows: nextRows,
      resolvedCount: resolvedRows.size,
      failedCount: failedRows.size,
      failureReasons: [...new Set(failedRows.values())]
    };
  };

  const geocodePlannerRows = async () => {
    const result = await resolveMissingPlannerCoordinates(plannerRows);
    if (result.resolvedCount === 0 && result.failedCount === 0) {
      setGeocodingMessage("目前已勾選個案都有可用座標。");
      return result.rows;
    }

    const failureReasonText = result.failureReasons.length > 0 ? ` 原因：${result.failureReasons[0]}` : "";
    const failedText =
      result.failedCount > 0
        ? `仍有 ${result.failedCount} 位找不到座標，已保留在最後順位；需補座標後重新排程。${failureReasonText}`
        : "全部已可納入地圖預覽與自動排序。";
    setGeocodingMessage(`已由 Google Map 補上 ${result.resolvedCount} 位個案座標。${failedText}`);
    return result.rows;
  };

  const autoGeocodingRequestKey = useMemo(() => {
    if (!selectedDoctorId || !routeDate || !effectiveSelectedWeekday || !selectedTimeSlot) {
      return null;
    }

    const missingRows = checkedRows.filter((row) => !getPlannerRowCoordinate(row));
    if (missingRows.length === 0) {
      return null;
    }

    return [
      selectedDoctorId,
      routeDate,
      effectiveSelectedWeekday,
      selectedTimeSlot,
      missingRows
        .map((row) => `${row.patientId}:${row.address}:${row.checked ? "checked" : "unchecked"}`)
        .join("|")
    ].join("::");
  }, [checkedRows, effectiveSelectedWeekday, routeDate, selectedDoctorId, selectedTimeSlot]);

  useEffect(() => {
    if (!autoGeocodingRequestKey || isGeocodingPlannerRows) {
      return;
    }
    if (autoGeocodingRequestKeyRef.current === autoGeocodingRequestKey) {
      return;
    }

    autoGeocodingRequestKeyRef.current = autoGeocodingRequestKey;
    void geocodePlannerRows();
  }, [autoGeocodingRequestKey, isGeocodingPlannerRows]);

  const autoSortPlannerRows = async () => {
    if (checkedRows.length < 2) {
      setRecentAction("至少要保留兩站以上，才需要自動排序。");
      return;
    }

    const geocodingResult = await resolveMissingPlannerCoordinates(plannerRows);
    const nextCheckedRows = sortPlannerRows(geocodingResult.rows).filter((row) => row.checked);
    const { reorderedRows, unresolvedCoordinateCount, strategy, totalDistanceKilometers } =
      optimizePlannerRowsByDistance({
      checkedRows: nextCheckedRows,
      startAddress: routeStartAddress,
      endAddress: routeEndAddress
    });
    const uncheckedRows = sortPlannerRows(geocodingResult.rows).filter((row) => !row.checked);
    setPlannerRows(reindexPlannerRows([...reorderedRows, ...uncheckedRows]));
    const distanceText =
      typeof totalDistanceKilometers === "number" && Number.isFinite(totalDistanceKilometers)
        ? `目前直線總距離約 ${totalDistanceKilometers.toFixed(1)} 公里。`
        : "";
    const strategyText =
      strategy === "nearest_neighbor"
        ? "已依目前點到下一個停留點距離最短的原則完成自動排序。"
        : "目前路線未重新排序。";
    const unresolvedText =
      unresolvedCoordinateCount > 0
        ? `另有 ${unresolvedCoordinateCount} 站缺少座標，已排到最後順位；請補座標後重新排程。`
        : "可再拖曳微調。";
    const geocodingText =
      geocodingResult.resolvedCount > 0 || geocodingResult.failedCount > 0
        ? `Google Map 已補上 ${geocodingResult.resolvedCount} 站座標，${geocodingResult.failedCount} 站仍找不到座標${
            geocodingResult.failureReasons.length > 0 ? `，原因：${geocodingResult.failureReasons[0]}` : ""
          }。`
        : "";
    setRecentAction(
      [geocodingText, strategyText, distanceText, unresolvedText].filter(Boolean).join(" ")
    );
  };

  const handlePlannerRowDragStart = (patientId: string) => {
    setDraggingPlannerPatientId(patientId);
    setDragTargetPlannerPatientId(patientId);
  };

  const handlePlannerRowDrop = (targetPatientId: string) => {
    if (!draggingPlannerPatientId) {
      return;
    }
    setPlannerRows((current) =>
      reorderCheckedPlannerRows(current, draggingPlannerPatientId, targetPatientId)
    );
    setDraggingPlannerPatientId(null);
    setDragTargetPlannerPatientId(null);
  };

  const resetPlannerRowDragging = () => {
    setDraggingPlannerPatientId(null);
    setDragTargetPlannerPatientId(null);
  };

  const closePatient = (patientId: string) => {
    const result = repositories.patientRepository.closePatient(patientId, "排程管理頁結案");
    setPlannerRows((current) => current.filter((row) => row.patientId !== patientId));
    setRecentAction(result.message);
  };

  const buildRoutePlanDraft = (sourcePlannerRows = plannerRows) => {
    if (!selectedDoctorId || !effectiveSelectedWeekday || !selectedTimeSlot) {
      setRecentAction("請先選擇醫師、星期與上午/下午。");
      return null;
    }
    if (!routeDate) {
      setRecentAction("請先輸入此次路線日期。");
      return null;
    }
    if (sourcePlannerRows.length === 0) {
      setRecentAction("目前沒有可加入路線的個案。");
      return null;
    }

    const doctor = doctors.find((item) => item.id === selectedDoctorId);
    const routePlanId = buildRoutePlanId(
      selectedDoctorId,
      routeDate,
      effectiveSelectedWeekday,
      selectedTimeSlot
    );
    const normalizedStartAddress = routeStartAddress.trim() || routeStartLocation.address;
    const normalizedEndAddress = routeEndAddress.trim() || routeEndLocation.address;
    const startLatitude =
      normalizedStartAddress === routeStartLocation.address ? routeStartLocation.latitude : null;
    const startLongitude =
      normalizedStartAddress === routeStartLocation.address ? routeStartLocation.longitude : null;
    const endLatitude =
      normalizedEndAddress === routeEndLocation.address ? routeEndLocation.latitude : null;
    const endLongitude =
      normalizedEndAddress === routeEndLocation.address ? routeEndLocation.longitude : null;
    const activePlannerRows = sortPlannerRows(sourcePlannerRows).filter((row) => {
      const patient = patientsById.get(row.patientId);
      return patient?.status === "active";
    });
    if (activePlannerRows.length === 0) {
      setRecentAction("目前沒有可加入路線的服務中個案。");
      return null;
    }
    const routeItems: SavedRoutePlan["route_items"] = activePlannerRows.map((row) => ({
      patient_id: row.patientId,
      schedule_id: row.scheduleId,
      checked: row.checked,
      route_order: row.checked ? row.routeOrder : null,
      status: row.status,
      patient_name: row.name,
      address: row.address
    }));
    const checkedRouteItems = routeItems.filter((item) => item.checked);

    return {
      id: routePlanId,
      doctor_id: selectedDoctorId,
      route_group_id: routePlanId,
      route_name: `${formatDateOnly(routeDate)} ${doctor?.name ?? selectedDoctorId} ${effectiveSelectedWeekday}${selectedTimeSlot}`,
      route_date: routeDate,
      route_weekday: effectiveSelectedWeekday,
      service_time_slot: selectedTimeSlot,
      optimize_by: "time",
      schedule_ids: routeItems
        .map((item) => item.schedule_id)
        .filter((scheduleId): scheduleId is string => Boolean(scheduleId)),
      route_items: routeItems,
      execution_status: selectedSavedRoutePlan?.execution_status ?? "draft",
      executed_at: selectedSavedRoutePlan?.executed_at ?? null,
      start_address: normalizedStartAddress,
      start_latitude: startLatitude,
      start_longitude: startLongitude,
      end_address: normalizedEndAddress,
      end_latitude: endLatitude,
      end_longitude: endLongitude,
      total_minutes: checkedRouteItems.length * 60,
      total_distance_kilometers: checkedRouteItems.length * 2,
      saved_at: new Date().toISOString(),
      created_at: selectedSavedRoutePlan?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString()
    } satisfies SavedRoutePlan;
  };

  const preparePlannerRowsForRoutePlan = async () => {
    const geocodingResult = await resolveMissingPlannerCoordinates(plannerRows);
    const geocodingText =
      geocodingResult.resolvedCount > 0 || geocodingResult.failedCount > 0
        ? `Google Map 已補上 ${geocodingResult.resolvedCount} 站座標${
            geocodingResult.failedCount > 0 ? `，${geocodingResult.failedCount} 站仍找不到座標` : ""
          }${geocodingResult.failureReasons.length > 0 ? `，原因：${geocodingResult.failureReasons[0]}` : ""}。`
        : "";

    return {
      rows: geocodingResult.rows,
      geocodingText
    };
  };

  const savePreparedRoutePlan = (sourceRows: PlannerRow[], geocodingText = "") => {
    const routePlanDraft = buildRoutePlanDraft(sourceRows);
    if (!routePlanDraft) {
      return null;
    }
    repositories.visitRepository.upsertSavedRoutePlan(routePlanDraft);
    setSelectedSavedRoutePlanId(routePlanDraft.id);
    setRecentAction(`${geocodingText}已儲存路線，之後可從已儲存的路線完整還原。`);
    return routePlanDraft.id;
  };

  const saveRoutePlan = () => {
    if (missingCheckedCoordinateCount === 0) {
      return savePreparedRoutePlan(plannerRows);
    }

    void (async () => {
      const prepared = await preparePlannerRowsForRoutePlan();
      savePreparedRoutePlan(prepared.rows, prepared.geocodingText);
    })();
    return null;
  };

  const executePreparedRoutePlan = (sourceRows: PlannerRow[], geocodingText = "") => {
    const routePlanDraft = buildRoutePlanDraft(sourceRows);
    if (!routePlanDraft) {
      return;
    }
    const executed = repositories.visitRepository.upsertSavedRoutePlanAndExecute(routePlanDraft);
    if (!executed) {
      setRecentAction("找不到可實行的路線。");
      return;
    }
    setSelectedSavedRoutePlanId(executed.id);
    setPlannerRows(buildPlannerRowsFromRoutePlan(executed, patientsById));
    setRecentAction(
      `${geocodingText}已實行 ${executed.route_name}，醫師端會以這條路線作為本次執行清單。`
    );
  };

  const executeRoutePlan = () => {
    if (missingCheckedCoordinateCount === 0) {
      executePreparedRoutePlan(plannerRows);
      return;
    }

    void (async () => {
      const prepared = await preparePlannerRowsForRoutePlan();
      executePreparedRoutePlan(prepared.rows, prepared.geocodingText);
    })();
  };

  const deleteRoutePlan = () => {
    if (!selectedSavedRoutePlanId) {
      setRecentAction("目前沒有可刪除的已儲存路線。");
      return;
    }
    repositories.visitRepository.deleteSavedRoutePlan(selectedSavedRoutePlanId);
    setSelectedSavedRoutePlanId("");
    setRecentAction("已刪除已儲存路線。");
  };

  const toggleSavedRoutePlanSelection = (routePlanId: string, checked: boolean) => {
    setSelectedSavedRoutePlanIds((current) =>
      checked ? [...new Set([...current, routePlanId])] : current.filter((item) => item !== routePlanId)
    );
  };

  const deleteSelectedRoutePlans = () => {
    if (selectedSavedRoutePlanIds.length === 0) {
      setRecentAction("請先勾選要批次刪除的已儲存路線。");
      return;
    }
    selectedSavedRoutePlanIds.forEach((routePlanId) => {
      repositories.visitRepository.deleteSavedRoutePlan(routePlanId);
    });
    if (selectedSavedRoutePlanId && selectedSavedRoutePlanIds.includes(selectedSavedRoutePlanId)) {
      setSelectedSavedRoutePlanId("");
    }
    setSelectedSavedRoutePlanIds([]);
    setIsBatchDeleteDialogOpen(false);
    setRecentAction(`已批次刪除 ${selectedSavedRoutePlanIds.length} 條已儲存路線。`);
  };

  const invertSavedRoutePlanSelection = () => {
    const currentSelection = new Set(selectedSavedRoutePlanIds);
    setSelectedSavedRoutePlanIds(
      savedRoutePlans
        .filter((routePlan) => !currentSelection.has(routePlan.id))
        .map((routePlan) => routePlan.id)
    );
  };

  const restoreRoutePlan = (routePlanId: string) => {
    const routePlan = savedRoutePlans.find((item) => item.id === routePlanId);
    if (!routePlan) {
      setRecentAction("找不到指定的已儲存路線。");
      setSelectedSavedRoutePlanId("");
      return;
    }
    setSelectedSavedRoutePlanId(routePlan.id);
    setRouteDateMode("preset");
    setSelectedDoctorId(routePlan.doctor_id);
    setSelectedWeekday(routePlan.route_weekday);
    setSelectedTimeSlot(routePlan.service_time_slot);
    setRouteDate(routePlan.route_date);
    setRouteStartAddress(routePlan.start_address || routeStartLocation.address);
    setRouteEndAddress(routePlan.end_address || routeEndLocation.address);
    setPlannerRows(buildPlannerRowsFromRoutePlan(routePlan, patientsById));
    setRecentAction(`已還原 ${routePlan.route_name}。`);
  };

  const applyPreviousRoutePlan = () => {
    if (!selectedDoctorId) {
      setRecentAction("請先選擇醫師，才能套用前次路線。");
      return;
    }
    if (!previousRoutePlan) {
      setRecentAction("目前找不到這位醫師可套用的前次路線。");
      return;
    }
    const nextRows = buildPlannerRowsForPreviousRouteDraft(previousRoutePlan, patientsById);
    if (nextRows.length === 0) {
      setRecentAction("前次路線中的個案已暫停、結案或不存在，無法套用。");
      return;
    }
    setSelectedSavedRoutePlanId("");
    setRouteStartAddress(previousRoutePlan.start_address || routeStartLocation.address);
    setRouteEndAddress(previousRoutePlan.end_address || routeEndLocation.address);
    setPlannerRows(nextRows);
    setRecentAction(
      `已套用前次路線 ${previousRoutePlan.route_name} 的個案、勾選狀態與排序；本次日期與時段維持目前設定。`
    );
  };

  const dismissAutoScheduleCarryoverCandidate = (candidateId: string) => {
    setDismissedAutoScheduleCandidateIds((current) => [...new Set([...current, candidateId])]);
  };

  const applyAutoScheduleCarryoverCandidate = (candidate: AutoScheduleCarryoverCandidate) => {
    const sourceRoutePlan = savedRoutePlans.find(
      (routePlan) => routePlan.id === candidate.sourceRoutePlanId
    );
    if (!sourceRoutePlan) {
      setRecentAction("找不到可沿用的前次路線，請改用手動排程。");
      dismissAutoScheduleCarryoverCandidate(candidate.id);
      return;
    }

    const routePlanDraft = buildCarriedOverRoutePlan({
      candidate,
      sourceRoutePlan,
      patientsById
    });
    if (routePlanDraft.route_items.length === 0) {
      setRecentAction("前次路線中的個案已結案或不存在，無法自動沿用。");
      dismissAutoScheduleCarryoverCandidate(candidate.id);
      return;
    }

    repositories.visitRepository.upsertSavedRoutePlan(routePlanDraft);
    repositories.notificationRepository.updateNotificationCenterItemStatus(
      candidate.notificationItemId,
      "completed"
    );
    setSelectedSavedRoutePlanId(routePlanDraft.id);
    setSelectedDoctorId(routePlanDraft.doctor_id);
    setRouteDateMode("preset");
    setRouteDate(routePlanDraft.route_date);
    setSelectedWeekday(routePlanDraft.route_weekday);
    setSelectedTimeSlot(routePlanDraft.service_time_slot);
    setRouteStartAddress(routePlanDraft.start_address || routeStartLocation.address);
    setRouteEndAddress(routePlanDraft.end_address || routeEndLocation.address);
    setPlannerRows(buildPlannerRowsFromRoutePlan(routePlanDraft, patientsById));
    dismissAutoScheduleCarryoverCandidate(candidate.id);
    setRecentAction(
      `已沿用 ${candidate.sourceDaysBack} 天前同時段路線，建立 ${routePlanDraft.route_name}；請確認後再實行路線。`
    );
  };

  return (
    <div className="space-y-6">
      <Panel title="排程管理頁">
        <div className="space-y-4">
          {visibleAutoScheduleCarryoverCandidates.length > 0 ? (
            <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-brand-ink">排程待確認</p>
                  <p className="mt-1 text-xs text-amber-800">
                    系統偵測到未來 3 天內有醫師可出巡時段尚未排程，已同步新增通知中心提醒；請行政確認後才會排入。
                  </p>
                </div>
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold">
                  {visibleAutoScheduleCarryoverCandidates.length} 筆
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {visibleAutoScheduleCarryoverCandidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-ink">
                        {candidate.doctorName}｜{formatDateOnly(candidate.routeDate)} {candidate.routeWeekday}
                        {candidate.timeSlot}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        尚未排程，可沿用 {candidate.sourceDaysBack} 天前「{candidate.sourceRoutePlanName}」，
                        共 {candidate.checkedPatientCount} 位已勾選個案。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyAutoScheduleCarryoverCandidate(candidate)}
                        className="rounded-full bg-brand-forest px-4 py-2 text-xs font-semibold text-white"
                      >
                        同意排入
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissAutoScheduleCarryoverCandidate(candidate.id)}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
                      >
                        暫不處理
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedSavedRoutePlanId("");
                setRouteDateMode("preset");
                setRouteDate("");
                setSelectedWeekday("");
                setSelectedTimeSlot("");
              }}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                routeDateMode === "preset"
                  ? "bg-brand-forest text-white"
                  : "border border-slate-200 bg-white text-brand-ink"
              }`}
            >
              快捷可用日期
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedSavedRoutePlanId("");
                setRouteDateMode("ad_hoc");
                setRouteDate("");
                setSelectedWeekday("");
                setSelectedTimeSlot("");
              }}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                routeDateMode === "ad_hoc"
                  ? "bg-brand-coral text-white"
                  : "border border-slate-200 bg-white text-brand-ink"
              }`}
            >
              突發出巡事件
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[220px_220px_180px_140px_auto]">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">先選醫師</span>
              <select
                aria-label="篩選醫師"
                value={selectedDoctorId}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId("");
                  setSelectedDoctorId(event.target.value);
                  setRouteDate("");
                  setSelectedWeekday("");
                  setSelectedTimeSlot("");
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇醫師</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">
                {routeDateMode === "ad_hoc" ? "突發出巡日期" : "再選可用日期"}
              </span>
              {routeDateMode === "ad_hoc" ? (
                <input
                  type="date"
                  aria-label="路線日期"
                  value={routeDate}
                  onChange={(event) => {
                    setSelectedSavedRoutePlanId("");
                    const nextRouteDate = event.target.value;
                    const nextWeekday = resolveWeekdayFromRouteDate(nextRouteDate);
                    setRouteDate(nextRouteDate);
                    setSelectedWeekday(nextWeekday ?? "");
                    const matchedTimeSlots = nextWeekday
                      ? getDoctorTimeSlotsByWeekday(
                          selectedDoctor?.available_service_slots ?? [],
                          nextWeekday
                        )
                      : [];
                    setSelectedTimeSlot(
                      matchedTimeSlots.includes(selectedTimeSlot as RouteTimeSlot)
                        ? selectedTimeSlot
                        : matchedTimeSlots[0] ?? routeTimeSlotOptions[0]
                    );
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              ) : (
                <select
                  aria-label="路線日期"
                  value={routeDate}
                  onChange={(event) => {
                    setSelectedSavedRoutePlanId("");
                    const nextRouteDate = event.target.value;
                    setRouteDate(nextRouteDate);
                    const matchedRouteDateOption = availableRouteDateOptions.find(
                      (option) => option.routeDate === nextRouteDate
                    );
                    if (!matchedRouteDateOption) {
                      setSelectedWeekday("");
                      setSelectedTimeSlot("");
                      return;
                    }
                    setSelectedWeekday(matchedRouteDateOption.preferredWeekday);
                    setSelectedTimeSlot(matchedRouteDateOption.preferredTimeSlot);
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <option value="">請選擇日期</option>
                  {availableRouteDateOptions.map((option) => (
                    <option key={option.routeDate} value={option.routeDate}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">自動帶入星期幾</span>
              <select
                disabled={!routeDate}
                aria-disabled={!routeDate}
                title={!routeDate ? "請先選擇路線日期" : undefined}
                aria-label="篩選星期"
                value={effectiveSelectedWeekday}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId("");
                  if (routeDateMode === "ad_hoc") {
                    return;
                  }
                  setSelectedWeekday(event.target.value);
                  const matchedTimeSlots = selectedRouteDateOption?.timeSlotOptionsByWeekday[
                    event.target.value as (typeof weekdayOptions)[number]
                  ];
                  if (!matchedTimeSlots?.includes(selectedTimeSlot as RouteTimeSlot)) {
                    setSelectedTimeSlot(matchedTimeSlots?.[0] ?? "");
                  }
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇星期</option>
                {(selectedRouteDateOption?.weekdayOptions ?? availableWeekdays).map((weekday) => (
                  <option key={weekday} value={weekday}>
                    {weekday}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">自動帶入上午 / 下午</span>
              <select
                disabled={!routeDate}
                aria-disabled={!routeDate}
                title={!routeDate ? "請先選擇路線日期" : undefined}
                aria-label="篩選時段"
                value={selectedTimeSlot}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId("");
                  setSelectedTimeSlot(event.target.value as RouteTimeSlot | "");
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇時段</option>
                {availableTimeSlots.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end" />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-brand-ink">路線操作</p>
                <p className="mt-1 text-xs text-slate-500">
                  起點：{routeStartAddress}｜終點：{routeEndAddress}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIsRouteEndpointsDialogOpen(true)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-ink"
                >
                  設定起終點
                </button>
                <button
                  type="button"
                  onClick={resetPlanner}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-ink"
                >
                  清除
                </button>
                <button
                  type="button"
                  onClick={applyPreviousRoutePlan}
                  disabled={!selectedDoctorId || !previousRoutePlan}
                  className="rounded-full border border-brand-forest/30 bg-white px-4 py-2 text-sm font-semibold text-brand-forest disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  title={
                    previousRoutePlan
                      ? `套用 ${previousRoutePlan.route_name}`
                      : "請先選擇醫師，或確認已有前次路線"
                  }
                >
                  套用前次路線
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(260px,1fr)_auto] xl:items-end">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">已儲存的路線</span>
                <select
                  aria-label="已儲存的路線"
                  value={selectedSavedRoutePlanId}
                  onChange={(event) => {
                    const routePlanId = event.target.value;
                    setSelectedSavedRoutePlanId(routePlanId);
                    if (!routePlanId) {
                      return;
                    }
                    restoreRoutePlan(routePlanId);
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <option value="">請選擇已儲存路線</option>
                  {savedRoutePlans.map((routePlan) => (
                    <option key={routePlan.id} value={routePlan.id}>
                      {routePlan.route_name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                <button
                  type="button"
                  onClick={saveRoutePlan}
                  disabled={isGeocodingPlannerRows}
                  className="rounded-full bg-brand-forest px-4 py-3 text-sm font-semibold text-white"
                >
                  {isGeocodingPlannerRows ? "座標查詢中" : "儲存路線"}
                </button>
                <button
                  type="button"
                  onClick={executeRoutePlan}
                  disabled={isGeocodingPlannerRows}
                  className="rounded-full bg-brand-coral px-4 py-3 text-sm font-semibold text-white"
                >
                  {isGeocodingPlannerRows ? "座標查詢中" : "實行路線"}
                </button>
                <button
                  type="button"
                  onClick={deleteRoutePlan}
                  disabled={!selectedSavedRoutePlanId}
                  className="rounded-full border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  刪除這條路線
                </button>
                {savedRoutePlans.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setIsBatchDeleteDialogOpen(true)}
                    className="rounded-full border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600"
                  >
                    批次刪除路線
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {recentAction ? (
            <div
              role="status"
              className="rounded-2xl border border-brand-sand bg-brand-sand/50 px-4 py-3 text-sm text-brand-ink"
            >
              最近操作：{recentAction}
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            選完醫師、星期與上午/下午後，系統會自動列出符合該時段的個案。取消勾選者會保留在名單中，但本次路線狀態會設為「暫停」，不會進入路線排序。
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div>
              <RouteMapPreviewCard
                route={routePreview}
                emptyText="請先選擇醫師、星期、上午/下午，並保留至少一位已勾選個案，才會產生路線預覽。"
                compact
                headerActions={
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void geocodePlannerRows();
                      }}
                      disabled={missingCheckedCoordinateCount === 0 || isGeocodingPlannerRows}
                      className="rounded-full border border-brand-forest/20 bg-white px-4 py-2 text-sm font-semibold text-brand-forest disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      {isGeocodingPlannerRows ? "座標查詢中" : "用 Google 補座標"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSlotPatientDialogOpen(true)}
                      disabled={sortedPlannerRows.length === 0}
                      className="rounded-full border border-brand-forest/20 bg-white px-4 py-2 text-sm font-semibold text-brand-forest disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      選擇符合時段個案
                    </button>
                  </>
                }
              />
              {geocodingMessage ? (
                <div
                  aria-live="polite"
                  className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
                >
                  {geocodingMessage}
                </div>
              ) : null}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-brand-ink">本次路線排序</p>
                  <p className="mt-1 text-xs text-slate-500">
                    自動排序會從起點開始，每一步都選距離目前點最近的下一個停留點；仍可拖曳微調站序。
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <p className="text-xs text-slate-500">可執行 {checkedRows.length} 站</p>
                  <button
                    type="button"
                    onClick={() => {
                      void autoSortPlannerRows();
                    }}
                    disabled={checkedRows.length < 2 || isGeocodingPlannerRows}
                    className="rounded-full border border-brand-forest/20 bg-white px-3 py-1.5 text-xs font-semibold text-brand-forest disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  >
                    {isGeocodingPlannerRows ? "座標查詢中" : "自動排序"}
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {checkedRows.map((row, index) => (
                  <div
                    key={row.patientId}
                    draggable
                    onDragStart={(event) => {
                      if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", row.patientId);
                      }
                      handlePlannerRowDragStart(row.patientId);
                    }}
                    onDragEnter={() => {
                      if (!draggingPlannerPatientId || draggingPlannerPatientId === row.patientId) {
                        return;
                      }
                      setDragTargetPlannerPatientId(row.patientId);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!draggingPlannerPatientId || draggingPlannerPatientId === row.patientId) {
                        return;
                      }
                      if (dragTargetPlannerPatientId !== row.patientId) {
                        setDragTargetPlannerPatientId(row.patientId);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handlePlannerRowDrop(row.patientId);
                    }}
                    onDragEnd={resetPlannerRowDragging}
                    className={`rounded-2xl border px-4 py-3 transition ${
                      dragTargetPlannerPatientId === row.patientId && draggingPlannerPatientId !== row.patientId
                        ? "border-brand-forest bg-brand-sand/70 shadow-sm"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-brand-coral">
                          拖曳排序
                        </p>
                        <p className="font-semibold text-brand-ink">
                          第 {row.routeOrder} 站 {maskPatientName(row.name)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{row.address}</p>
                        {row.geocodingStatus === "pending" ? (
                          <p className="mt-1 text-xs font-semibold text-amber-700">Google Map 座標查詢中</p>
                        ) : row.geocodingStatus === "resolved" ? (
                          <p className="mt-1 text-xs font-semibold text-emerald-700">
                            已補座標：{row.geocodedAddress ?? services.maps.buildCoordinateLabel(row.latitude, row.longitude)}
                          </p>
                        ) : row.geocodingStatus === "failed" || !getPlannerRowCoordinate(row) ? (
                          <p className="mt-1 text-xs font-semibold text-amber-700">
                            {row.geocodingStatus === "failed" && row.geocodedAddress
                              ? `缺少座標：${row.geocodedAddress}`
                              : "缺少座標，若 Google 仍找不到，會排到最後；需補座標後重新排程。"}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span
                          aria-hidden="true"
                          className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-500"
                        >
                          拖曳
                        </span>
                        <button
                          type="button"
                          onClick={() => movePlannerRow(row.patientId, "up")}
                          disabled={index === 0}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          上移
                        </button>
                        <button
                          type="button"
                          onClick={() => movePlannerRow(row.patientId, "down")}
                          disabled={index === checkedRows.length - 1}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          下移
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {checkedRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    目前沒有已勾選的個案，因此不會產生路線排序。
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="全部排程清單">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-brand-ink">目前系統內共有 {allScheduleRows.length} 筆排程</p>
              <p className="mt-1 text-xs text-slate-500">
                這裡直接列出所有排程，不受上方醫師、日期、已儲存路線篩選影響；若醫師已被移除，也會顯示原本的醫師代碼。
              </p>
            </div>
          </div>

          <div className="grid max-h-[520px] gap-2 overflow-y-auto pr-1">
            {allScheduleRows.map((schedule) => {
              const doctor = doctorsById.get(schedule.assigned_doctor_id);
              const patient = patientsById.get(schedule.patient_id);
              return (
                <div
                  key={schedule.id}
                  data-schedule-id={schedule.id}
                  className="grid gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                >
                  <div>
                    <p className="text-xs font-semibold text-brand-coral">排程 {schedule.id}</p>
                    <p className="mt-1 font-semibold text-brand-ink">
                      {formatDateTimeFull(schedule.scheduled_start_at)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      路線：{schedule.route_group_id}｜第 {schedule.route_order} 站
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">醫師</p>
                    <p className="mt-1 font-semibold text-brand-ink">
                      {doctor?.name ?? `已移除醫師 ${schedule.assigned_doctor_id}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">個案</p>
                    <p className="mt-1 font-semibold text-brand-ink">
                      {patient ? maskPatientName(patient.name) : schedule.patient_id}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{schedule.address_snapshot}</p>
                  </div>
                  <div className="flex items-start justify-start lg:justify-end">
                    <Badge value={schedule.status} compact />
                  </div>
                </div>
              );
            })}
            {allScheduleRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                目前沒有任何排程。
              </div>
            ) : null}
          </div>
        </div>
      </Panel>

      {isBatchDeleteDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="批次刪除路線視窗"
            className="w-full max-w-2xl rounded-[32px] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">批次刪除</p>
                <h2 className="mt-1 text-2xl font-semibold text-brand-ink">選擇要刪除的已儲存路線</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchDeleteDialogOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <div>
                  <p className="font-semibold text-brand-ink">目前共有 {savedRoutePlans.length} 條已儲存路線</p>
                  <p className="mt-1 text-xs text-slate-500">請勾選要刪除的路線，再按下確定刪除。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedSavedRoutePlanIds(savedRoutePlans.map((routePlan) => routePlan.id))}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink"
                  >
                    全選
                  </button>
                  <button
                    type="button"
                    onClick={invertSavedRoutePlanSelection}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink"
                  >
                    反全選
                  </button>
                </div>
              </div>

              <div className="grid max-h-[50vh] gap-2 overflow-y-auto pr-1">
                {savedRoutePlans.map((routePlan) => (
                  <label
                    key={routePlan.id}
                    className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-brand-ink"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSavedRoutePlanIds.includes(routePlan.id)}
                      onChange={(event) => toggleSavedRoutePlanSelection(routePlan.id, event.target.checked)}
                      aria-label={`${routePlan.route_name} ${routePlan.id} 批次刪除勾選`}
                    />
                    <span>{routePlan.route_name}</span>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsBatchDeleteDialogOpen(false)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-ink"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedRoutePlans}
                  disabled={selectedSavedRoutePlanIds.length === 0}
                  className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  確定刪除
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isRouteEndpointsDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="起終點設定視窗"
            className="w-full max-w-2xl rounded-[32px] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">路線設定</p>
                <h2 className="mt-1 text-2xl font-semibold text-brand-ink">設定起點與終點</h2>
                <p className="mt-2 text-sm text-slate-500">預設為旗山醫院，若本次出巡起訖不同可在此覆寫。</p>
              </div>
              <button
                type="button"
                onClick={() => setIsRouteEndpointsDialogOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">起點</span>
                <input
                  type="text"
                  aria-label="路線起點"
                  list="route-start-address-options"
                  value={routeStartAddress}
                  onChange={(event) => setRouteStartAddress(event.target.value)}
                  placeholder="請輸入起點"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
                <datalist id="route-start-address-options">
                  <option value="旗山醫院" />
                </datalist>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">終點</span>
                <input
                  type="text"
                  aria-label="路線終點"
                  list="route-end-address-options"
                  value={routeEndAddress}
                  onChange={(event) => setRouteEndAddress(event.target.value)}
                  placeholder="請輸入終點"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
                <datalist id="route-end-address-options">
                  <option value="旗山醫院" />
                </datalist>
              </label>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setIsRouteEndpointsDialogOpen(false)}
                className="rounded-full bg-brand-forest px-5 py-3 text-sm font-semibold text-white"
              >
                完成設定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isSlotPatientDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="符合時段的個案清單視窗"
            className="flex max-h-[min(80vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-sm font-medium text-brand-coral">符合時段的個案清單</p>
                <h2 className="mt-1 text-2xl font-semibold text-brand-ink">選擇要保留在本次路線的個案</h2>
                <p className="mt-2 text-sm text-slate-500">
                  每位個案預設已勾選；取消勾選後會標記為暫停，不會進入右側路線排序。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSlotPatientDialogOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <div>
                  <p className="font-semibold text-brand-ink">目前共有 {sortedPlannerRows.length} 位個案</p>
                  <p className="mt-1 text-xs text-slate-500">已勾選 {checkedRows.length} 位，可直接結案或取消勾選。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={selectAllPlannerRows}
                    disabled={sortedPlannerRows.length === 0}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    全選
                  </button>
                  <button
                    type="button"
                    onClick={invertPlannerRowSelection}
                    disabled={sortedPlannerRows.length === 0}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    反全選
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {sortedPlannerRows.map((row) => (
                  <div
                    key={row.patientId}
                    className="grid gap-3 rounded-2xl border border-slate-200 px-4 py-3 lg:grid-cols-[auto_minmax(0,180px)_minmax(0,1fr)_auto_auto]"
                  >
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-brand-ink">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={(event) => togglePlannerRow(row.patientId, event.target.checked)}
                        aria-label={`${maskPatientName(row.name)} 勾選`}
                      />
                      勾選
                    </label>
                    <p className="text-sm font-semibold text-brand-ink">{maskPatientName(row.name)}</p>
                    <p className="text-sm text-slate-600">{row.address}</p>
                    <Badge value={row.status} compact />
                    <button
                      type="button"
                      onClick={() => closePatient(row.patientId)}
                      className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      結案
                    </button>
                  </div>
                ))}
                {sortedPlannerRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    目前沒有符合這個時段的個案。
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminContactsPage() {
  return (
    <div className="space-y-6">
      <Panel title="聯絡方式設定已整合">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
          <p className="font-semibold text-brand-ink">這個頁面已不再維護任何家屬聯絡或綁定流程。</p>
          <p className="mt-2">1. 個案管理目前只處理個案本身的診斷、地址、定位關鍵字、醫師與服務時段。</p>
          <p className="mt-1">2. 如需追蹤流程，請改看排程管理、醫師追蹤與 ContactLog。</p>
          <p className="mt-1">3. 外部通訊與家屬入口已移除，不需要另外建立綁定資料。</p>
        </div>
      </Panel>
    </div>
  );
}

export function AdminRemindersPage() {
  const { repositories, db, session } = useAppContext();
  const [isNoticeDialogOpen, setIsNoticeDialogOpen] = useState(false);
  const [noticeAudience, setNoticeAudience] = useState<"admin" | "doctor">("admin");
  const [doctorId, setDoctorId] = useState<string>(db.doctors[0]?.id ?? "");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeContent, setNoticeContent] = useState("");
  const [statusFeedback, setStatusFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const handleCreateNotice = () => {
    const normalizedTitle = noticeTitle.trim();
    const normalizedContent = noticeContent.trim();
    if (!normalizedTitle || !normalizedContent) {
      setStatusFeedback({
        tone: "error",
        message: "請先輸入通知標題與內容。"
      });
      return;
    }

    const now = new Date().toISOString();
    const baseId = `nc-manual-${Date.now()}`;
    const buildManualNoticeItem = (
      id: string,
      role: NotificationCenterItem["role"],
      ownerUserId: string | null,
      linkedDoctorId: string | null
    ): NotificationCenterItem => ({
      id,
      role,
      owner_user_id: ownerUserId,
      source_type: "manual_notice",
      title: normalizedTitle,
      content: normalizedContent,
      linked_patient_id: null,
      linked_visit_schedule_id: null,
      linked_doctor_id: linkedDoctorId,
      linked_leave_request_id: null,
      status: "pending",
      is_unread: true,
      reply_text: null,
      reply_updated_at: null,
      reply_updated_by_role: null,
      created_at: now,
      updated_at: now
    });

    if (noticeAudience === "admin") {
      repositories.notificationRepository.createNotificationCenterItem(
        buildManualNoticeItem(`${baseId}-admin`, "admin", null, null)
      );
      db.doctors.forEach((doctor) => {
        repositories.notificationRepository.createNotificationCenterItem(
          buildManualNoticeItem(`${baseId}-doctor-${doctor.id}`, "doctor", doctor.id, null)
        );
      });
    } else {
      const targetDoctor = db.doctors.find((doctor) => doctor.id === doctorId);
      if (!targetDoctor) {
        setStatusFeedback({
          tone: "error",
          message: "請先選擇要通知的醫師。"
        });
        return;
      }
      repositories.notificationRepository.createNotificationCenterItem(
        buildManualNoticeItem(`${baseId}-doctor-${targetDoctor.id}`, "doctor", targetDoctor.id, targetDoctor.id)
      );
      repositories.notificationRepository.createNotificationCenterItem(
        buildManualNoticeItem(`${baseId}-admin-copy`, "admin", null, targetDoctor.id)
      );
    }
    setNoticeTitle("");
    setNoticeContent("");
    setIsNoticeDialogOpen(false);
    setStatusFeedback({
      tone: "success",
      message: noticeAudience === "admin" ? "行政公告已建立並送給全部角色。" : "指定醫師通知已建立，行政端已保留副本。"
    });
  };

  return (
    <div className="space-y-6">
      <Panel title="站內通知操作" className="p-3 lg:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div>
            <p className="font-semibold text-brand-ink">手動建立站內通知</p>
            <p className="mt-0.5 text-xs">以獨立視窗輸入通知類型、標題與內容，再送進通知中心。</p>
          </div>
          <button
            type="button"
            onClick={() => setIsNoticeDialogOpen(true)}
            className="rounded-full bg-brand-forest px-4 py-2.5 text-sm font-semibold text-white"
          >
            建立站內通知
          </button>
        </div>
      </Panel>

      {statusFeedback ? (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-sm ${
            statusFeedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {statusFeedback.message}
        </div>
      ) : null}

      <ReminderCenterPanel
        role="admin"
        ownerId={session.activeAdminId}
        title="通知中心"
        detailBasePath="/admin/patients"
        emptyText="目前行政端沒有待處理通知。"
      />

      {isNoticeDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-label="建立站內通知視窗"
            className="w-full max-w-2xl rounded-[32px] bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">通知建立</p>
                <h2 className="mt-1 text-2xl font-semibold text-brand-ink">建立站內通知</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsNoticeDialogOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉
              </button>
            </div>

            <div className="mt-6 space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                <label className="block">
                  <span className="mb-1 block font-medium text-brand-ink">通知類型</span>
                  <select
                    value={noticeAudience}
                    onChange={(event) => setNoticeAudience(event.target.value as "admin" | "doctor")}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  >
                    <option value="admin">行政公告</option>
                    <option value="doctor">指定醫師通知</option>
                  </select>
                </label>
                {noticeAudience === "doctor" ? (
                  <label className="block">
                    <span className="mb-1 block font-medium text-brand-ink">指定醫師</span>
                    <select
                      value={doctorId}
                      onChange={(event) => setDoctorId(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    >
                      {db.doctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600">
                    行政公告會顯示在行政端與所有醫師的通知中心。
                  </div>
                )}
              </div>

              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">標題</span>
                <input
                  type="text"
                  value={noticeTitle}
                  onChange={(event) => setNoticeTitle(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">內容</span>
                <textarea
                  value={noticeContent}
                  onChange={(event) => setNoticeContent(event.target.value)}
                  rows={5}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <button
                type="button"
                onClick={handleCreateNotice}
                className="rounded-full bg-brand-forest px-5 py-3 font-semibold text-white"
              >
                送出站內通知
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminLeaveRequestsPage() {
  const { repositories, db } = useAppContext();
  const [selectedLeaveRequestId, setSelectedLeaveRequestId] = useState<string>("");
  const [selectedLeaveLineRecipientIds, setSelectedLeaveLineRecipientIds] = useState<string[]>([]);
  const [managedLineContacts, setManagedLineContacts] = useState<ManagedFamilyLineContactSnapshot[]>(() =>
    loadManagedFamilyLineContacts()
  );
  const [statusFeedback, setStatusFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [rejectionReasonDraft, setRejectionReasonDraft] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [createDoctorId, setCreateDoctorId] = useState(db.doctors[0]?.id ?? "");
  const [createStartDate, setCreateStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [createEndDate, setCreateEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [createReason, setCreateReason] = useState("行政代填請假");
  const [createHandoffNote, setCreateHandoffNote] = useState("請協助檢查受影響個案");
  const [deleteConfirmLeaveRequestId, setDeleteConfirmLeaveRequestId] = useState<string | null>(null);

  const leaveRequests = useMemo(
    () =>
      repositories.staffingRepository
        .getLeaveRequests()
        .slice()
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        ),
    [repositories]
  );
  const pendingLeaveRequests = leaveRequests.filter((leaveRequest) => leaveRequest.status === "pending");

  useEffect(() => {
    if (!db.doctors.length) {
      setCreateDoctorId("");
      return;
    }
    if (!db.doctors.some((doctor) => doctor.id === createDoctorId)) {
      setCreateDoctorId(db.doctors[0].id);
    }
  }, [createDoctorId, db.doctors]);

  useEffect(() => {
    if (!leaveRequests.length) {
      setSelectedLeaveRequestId("");
      return;
    }
    if (!leaveRequests.some((leaveRequest) => leaveRequest.id === selectedLeaveRequestId)) {
      setSelectedLeaveRequestId((pendingLeaveRequests[0] ?? leaveRequests[0]).id);
    }
  }, [leaveRequests, pendingLeaveRequests, selectedLeaveRequestId]);

  const selectedLeaveRequest =
    leaveRequests.find((leaveRequest) => leaveRequest.id === selectedLeaveRequestId) ??
    pendingLeaveRequests[0] ??
    leaveRequests[0];
  const deleteConfirmLeaveRequest =
    leaveRequests.find((leaveRequest) => leaveRequest.id === deleteConfirmLeaveRequestId) ?? null;
  const impactedSchedules = selectedLeaveRequest
    ? repositories.staffingRepository.getImpactedSchedules(
        selectedLeaveRequest.doctor_id,
        selectedLeaveRequest.start_date,
        selectedLeaveRequest.end_date
      )
    : [];
  const impactedPatientIds = useMemo(
    () => new Set(impactedSchedules.map((schedule) => schedule.patient_id)),
    [impactedSchedules]
  );
  const patientNameById = useMemo(
    () => new Map(db.patients.map((patient) => [patient.id, maskPatientName(patient.name)])),
    [db.patients]
  );
  const leaveLineRecipients = useMemo(
    () =>
      buildLeaveLineRecipients({
        contacts: managedLineContacts,
        impactedPatientIds,
        patientNameById
      }),
    [impactedPatientIds, managedLineContacts, patientNameById]
  );
  const leaveLineRecipientIdsKey = leaveLineRecipients.map((recipient) => recipient.id).join("|");
  const selectedLeaveLineRecipients = leaveLineRecipients.filter((recipient) =>
    selectedLeaveLineRecipientIds.includes(recipient.id)
  );

  useEffect(() => {
    setRejectionReasonDraft(selectedLeaveRequest?.rejection_reason ?? "");
    setIsRejecting(false);
    setDeleteConfirmLeaveRequestId(null);
  }, [selectedLeaveRequest?.id, selectedLeaveRequest?.rejection_reason]);

  useEffect(() => {
    setSelectedLeaveLineRecipientIds(leaveLineRecipients.map((recipient) => recipient.id));
  }, [selectedLeaveRequest?.id, leaveLineRecipientIdsKey]);

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      return;
    }
    let cancelled = false;
    void fetch("/api/admin/family-line/contacts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const payload = (await response.json().catch(() => ({}))) as {
          contacts?: ManagedFamilyLineContactSnapshot[];
          friends?: ManagedFamilyLineContactSnapshot[];
        };
        const contacts = Array.isArray(payload.contacts)
          ? payload.contacts
          : Array.isArray(payload.friends)
            ? payload.friends
            : [];
        const normalizedContacts = normalizeManagedFamilyLineContacts(contacts);
        if (!cancelled) {
          setManagedLineContacts(normalizedContacts);
          window.localStorage.setItem(
            familyLineManagedContactsStorageKey,
            JSON.stringify(normalizedContacts)
          );
        }
      })
      .catch(() => {
        // 後端名單暫時無法讀取時，保留本機已保存的 webhook 名單供請假通知使用。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const createAdminLeaveRequest = () => {
    if (!createDoctorId) {
      setStatusFeedback({
        tone: "error",
        message: "請先選擇請假醫師。"
      });
      return;
    }
    if (!createStartDate || !createEndDate || !createReason.trim()) {
      setStatusFeedback({
        tone: "error",
        message: "請完整填寫請假期間與原因。"
      });
      return;
    }
    if (createStartDate > createEndDate) {
      setStatusFeedback({
        tone: "error",
        message: "開始日期不可晚於結束日期。"
      });
      return;
    }
    repositories.staffingRepository.createLeaveRequest({
      doctorId: createDoctorId,
      startDate: createStartDate,
      endDate: createEndDate,
      reason: createReason.trim(),
      handoffNote: createHandoffNote.trim(),
      status: "pending"
    });
    setStatusFeedback({
      tone: "success",
      message: "行政端已建立請假申請，並同步加入通知中心。"
    });
  };

  const updateLeaveStatus = async (status: "pending" | "approved" | "rejected") => {
    if (!selectedLeaveRequest) {
      return;
    }
    if (status === "rejected" && !rejectionReasonDraft.trim()) {
      setStatusFeedback({
        tone: "error",
        message: "請先填寫駁回理由。"
      });
      return;
    }
    repositories.staffingRepository.updateLeaveRequestStatus(selectedLeaveRequest.id, status, {
      rejectionReason: status === "rejected" ? rejectionReasonDraft : null
    });
    let lineSendMessage = "";
    let lineSendTone: "success" | "error" = "success";
    if (status === "approved" && typeof fetch === "function" && selectedLeaveLineRecipients.length > 0) {
      const settings = loadFamilyLineJson(familyLineSettingsStorageKey, {
        doctorLeaveAutoBroadcast: false
      });
      const doctorName =
        db.doctors.find((item) => item.id === selectedLeaveRequest.doctor_id)?.name ??
        selectedLeaveRequest.doctor_id;
      if (settings.doctorLeaveAutoBroadcast || selectedLeaveLineRecipients.length > 0) {
        try {
          const lineResponse = await fetch("/api/admin/family-line/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              lineChannelAccessToken: loadAdminApiTokenSettings().lineChannelAccessToken.trim(),
              subject: "醫師請假公告",
              content: `您好，${doctorName} ${selectedLeaveRequest.start_date} 至 ${selectedLeaveRequest.end_date} 請假，原訂居家訪視可能需改派或改期。行政人員會再與您確認後續安排。`,
              recipients: selectedLeaveLineRecipients.map((recipient) => ({
                caregiverId: recipient.id,
                caregiverName: recipient.displayName,
                patientId: recipient.matchedPatientIds[0] ?? "",
                patientName: recipient.matchedPatientNames.join("、"),
                doctorId: selectedLeaveRequest.doctor_id,
                doctorName,
                lineUserId: recipient.lineUserId
              }))
            })
          });
          const payload = (await lineResponse.json().catch(() => ({}))) as {
            error?: string;
            sentCount?: number;
            failedCount?: number;
            attemptedCount?: number;
          };
          if (lineResponse.ok) {
            lineSendMessage = ` 已發送 LINE 請假公告 ${payload.sentCount ?? selectedLeaveLineRecipients.length} 位。`;
          } else {
            lineSendTone = "error";
            lineSendMessage = ` 但 LINE 請假公告發送失敗：${payload.error ?? `HTTP ${lineResponse.status}`}。`;
          }
        } catch {
          lineSendTone = "error";
          lineSendMessage = " 但無法連線到 LINE 發送端點。";
        }
      }
    }
    setStatusFeedback(
      {
        tone: lineSendTone,
        message:
          status === "approved"
            ? `請假申請已核准。${lineSendMessage}`
            : status === "rejected"
              ? "請假申請已駁回，並已記錄駁回理由。"
              : "已取消駁回，請假申請已恢復待處理。"
      }
    );
  };

  const deleteSelectedLeaveRequest = () => {
    if (!selectedLeaveRequest) {
      return;
    }
    setDeleteConfirmLeaveRequestId(selectedLeaveRequest.id);
  };

  const confirmDeleteLeaveRequest = () => {
    if (!deleteConfirmLeaveRequestId) {
      return;
    }
    repositories.staffingRepository.deleteLeaveRequest(deleteConfirmLeaveRequestId);
    setDeleteConfirmLeaveRequestId(null);
    setStatusFeedback({
      tone: "success",
      message: "請假案件已刪除。"
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-xs text-slate-500">待處理請假</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">{pendingLeaveRequests.length}</p>
          <p className="mt-1 text-xs text-slate-500">等待行政核准或駁回的請假申請。</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-xs text-slate-500">全部請假單</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">{leaveRequests.length}</p>
          <p className="mt-1 text-xs text-slate-500">包含待處理、已核准與已駁回紀錄。</p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <p className="text-xs text-slate-500">受影響案件</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">{impactedSchedules.length}</p>
          <p className="mt-1 text-xs text-slate-500">依目前選取的請假單即時計算。</p>
        </div>
      </div>

      {statusFeedback ? (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-sm ${
            statusFeedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {statusFeedback.message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="行政建立請假">
          <div className="space-y-4 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">請假醫師</span>
              <select
                aria-label="請假醫師"
                value={createDoctorId}
                onChange={(event) => setCreateDoctorId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                {db.doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">開始日期</span>
                <input
                  type="date"
                  aria-label="行政請假開始日期"
                  value={createStartDate}
                  onChange={(event) => setCreateStartDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">結束日期</span>
                <input
                  type="date"
                  aria-label="行政請假結束日期"
                  value={createEndDate}
                  onChange={(event) => setCreateEndDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">請假原因</span>
              <input
                type="text"
                aria-label="行政請假原因"
                value={createReason}
                onChange={(event) => setCreateReason(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">交班備註</span>
              <textarea
                aria-label="行政請假交班備註"
                value={createHandoffNote}
                onChange={(event) => setCreateHandoffNote(event.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
            <button
              type="button"
              onClick={createAdminLeaveRequest}
              className="rounded-full bg-brand-forest px-5 py-3 font-semibold text-white"
            >
              建立請假申請
            </button>
          </div>
        </Panel>

        <Panel title="待處理請假">
          <div className="space-y-3">
            {leaveRequests.length ? (
              leaveRequests.map((leaveRequest) => {
                const doctor = db.doctors.find((item) => item.id === leaveRequest.doctor_id);
                const isSelected = selectedLeaveRequest?.id === leaveRequest.id;
                return (
                  <button
                    key={leaveRequest.id}
                    type="button"
                    onClick={() => setSelectedLeaveRequestId(leaveRequest.id)}
                    className={`w-full rounded-2xl border p-4 text-left ${
                      isSelected ? "border-brand-forest bg-brand-sand/50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">{doctor?.name ?? leaveRequest.doctor_id}</p>
                      <Badge value={leaveRequest.status} compact />
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {leaveRequest.start_date} 至 {leaveRequest.end_date}
                    </p>
                    <p className="card-clamp-2 mt-1 text-xs text-slate-500">{leaveRequest.reason}</p>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                目前沒有請假申請。
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr]">
        <Panel title="請假案件與處理摘要">
          {selectedLeaveRequest ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-brand-ink">
                  {db.doctors.find((item) => item.id === selectedLeaveRequest.doctor_id)?.name ??
                    selectedLeaveRequest.doctor_id}
                </p>
                <p className="mt-1">
                  請假期間：{selectedLeaveRequest.start_date} 至 {selectedLeaveRequest.end_date}
                </p>
                <p className="card-clamp-2 mt-1">原因：{selectedLeaveRequest.reason}</p>
                <p className="card-clamp-2 mt-1 text-xs text-slate-500">{selectedLeaveRequest.handoff_note}</p>
                {selectedLeaveRequest.rejection_reason ? (
                  <p className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    駁回理由：{selectedLeaveRequest.rejection_reason}
                  </p>
                ) : null}
              </div>

              {selectedLeaveRequest.status === "pending" ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-brand-ink">LINE 請假通知對象</p>
                        <p className="mt-1 text-xs text-slate-600">
                          依受影響個案比對「LINE 家屬聯繫」已關聯患者名單；核准請假時只會傳送給已勾選對象。
                        </p>
                      </div>
                      {leaveLineRecipients.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedLeaveLineRecipientIds(leaveLineRecipients.map((recipient) => recipient.id))
                            }
                            className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700"
                          >
                            全選通知
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedLeaveLineRecipientIds([])}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                          >
                            清除通知
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {leaveLineRecipients.length > 0 ? (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {leaveLineRecipients.map((recipient) => (
                          <label
                            key={recipient.id}
                            className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-white px-3 py-2"
                          >
                            <input
                              type="checkbox"
                              aria-label={`${recipient.displayName} LINE 請假通知勾選`}
                              checked={selectedLeaveLineRecipientIds.includes(recipient.id)}
                              onChange={(event) =>
                                setSelectedLeaveLineRecipientIds((current) =>
                                  event.target.checked
                                    ? [...current, recipient.id]
                                    : current.filter((recipientId) => recipientId !== recipient.id)
                                )
                              }
                              className="mt-1 h-4 w-4"
                            />
                            <span className="min-w-0">
                              <span className="block font-semibold text-brand-ink">{recipient.displayName}</span>
                              <span className="mt-1 block text-xs text-slate-600">
                                關聯個案：{recipient.matchedPatientNames.join("、")}
                              </span>
                              <span className="mt-1 block break-all text-xs text-slate-500">{recipient.lineUserId}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-dashed border-emerald-200 bg-white px-4 py-3 text-xs text-slate-600">
                        受影響個案尚未關聯任何 LINE 好友。請先到 LINE 家屬聯繫重新整理 webhook 名單，並把好友關聯到患者。
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void updateLeaveStatus("approved")}
                      className="rounded-full bg-brand-forest px-4 py-2 text-xs font-semibold text-white"
                    >
                      核准請假
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRejecting(true)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
                    >
                      駁回申請
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelectedLeaveRequest}
                      className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-600"
                    >
                      刪除請假案件
                    </button>
                  </div>
                  {isRejecting ? (
                    <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/50 p-4">
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-brand-ink">駁回理由</span>
                        <textarea
                          value={rejectionReasonDraft}
                          onChange={(event) => setRejectionReasonDraft(event.target.value)}
                          rows={3}
                          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                          placeholder="若要駁回，請補充駁回理由"
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void updateLeaveStatus("rejected")}
                          className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white"
                        >
                          確認駁回
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsRejecting(false);
                            setRejectionReasonDraft("");
                          }}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
                        >
                          取消駁回
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : selectedLeaveRequest.status === "rejected" ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void updateLeaveStatus("pending")}
                    className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700"
                  >
                    取消駁回
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedLeaveRequest}
                    className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-600"
                  >
                    刪除請假案件
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={deleteSelectedLeaveRequest}
                    className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-600"
                  >
                    刪除請假案件
                  </button>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">受影響案件</p>
                  <span className="text-xs text-slate-500">{impactedSchedules.length} 筆</span>
                </div>
                <div className="mt-3 space-y-3">
                  {impactedSchedules.length ? (
                    impactedSchedules.map((schedule) => {
                      const patient = db.patients.find((item) => item.id === schedule.patient_id);
                      return (
                        <div key={schedule.id} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="card-clamp-1 font-medium text-brand-ink">
                              {patient?.name ? maskPatientName(patient.name) : schedule.patient_id}
                            </p>
                            <Badge value={schedule.status} compact />
                          </div>
                          <p className="mt-1 text-slate-600">{formatDateTimeFull(schedule.scheduled_start_at)}</p>
                          <p className="card-clamp-2 mt-1 text-xs text-slate-500">{schedule.note || "無額外說明"}</p>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      這張請假單目前沒有對應到受影響案件。
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              目前沒有可查看的請假單。
            </div>
          )}
        </Panel>
      </div>

      {deleteConfirmLeaveRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-leave-request-title"
            className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl"
          >
            <p className="text-sm font-medium text-rose-600">刪除請假案件</p>
            <h2 id="delete-leave-request-title" className="mt-2 text-xl font-semibold text-brand-ink">
              確定刪除這筆請假案件？
            </h2>
            <p className="mt-3 text-sm text-slate-600">
              {deleteConfirmLeaveRequest.start_date} 至 {deleteConfirmLeaveRequest.end_date}
              ，原因：{deleteConfirmLeaveRequest.reason}。刪除後會同步移除對應通知中心項目。
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmLeaveRequestId(null)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-ink"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDeleteLeaveRequest}
                className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600"
              >
                確定刪除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
