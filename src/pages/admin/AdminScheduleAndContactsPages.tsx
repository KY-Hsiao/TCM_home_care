import { addDays, compareAsc, format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { NotificationTask, SavedRoutePlan, VisitSchedule } from "../../domain/models";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateOnly, formatDateTime, formatMinutes, formatTimeOnly } from "../../shared/utils/format";
import {
  resolveLocationKeyword,
  sameAddressLocationKeyword
} from "../../shared/utils/location-keyword";

type ScheduleRouteGroup = {
  id: string;
  doctorId: string;
  doctorName: string;
  date: string;
  serviceTimeSlot: "上午" | "下午";
  slotLabel: string;
  schedules: VisitSchedule[];
  patientCount: number;
  areaSummary: string;
  routePreview: string;
};

type RouteOptimizationTarget = "time" | "distance";

type RouteEndpointDraft = {
  address: string;
  latitude: string;
  longitude: string;
};

type RoutePlannerDraft = {
  optimizeBy: RouteOptimizationTarget;
  start: RouteEndpointDraft;
  end: RouteEndpointDraft;
};

type RoutePoint = {
  address: string;
  latitude: number | null;
  longitude: number | null;
};

type RouteMetrics = {
  totalMinutes: number;
  totalDistanceKilometers: number;
  score: number;
};

const scheduleWeekdayOptions = [
  { value: "all", label: "全部星期" },
  { value: "0", label: "星期日" },
  { value: "1", label: "星期一" },
  { value: "2", label: "星期二" },
  { value: "3", label: "星期三" },
  { value: "4", label: "星期四" },
  { value: "5", label: "星期五" },
  { value: "6", label: "星期六" }
] as const;

const defaultHospitalDestination = {
  address: "旗山醫院",
  latitude: 22.88794,
  longitude: 120.48341
};

function buildDefaultEndpointDraft(): RouteEndpointDraft {
  return {
    address: defaultHospitalDestination.address,
    latitude: defaultHospitalDestination.latitude.toFixed(5),
    longitude: defaultHospitalDestination.longitude.toFixed(5)
  };
}

function buildDefaultRoutePlannerDraft(): RoutePlannerDraft {
  return {
    optimizeBy: "time",
    start: buildDefaultEndpointDraft(),
    end: buildDefaultEndpointDraft()
  };
}

function parseCoordinateValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveRoutePoint(draft: RouteEndpointDraft): RoutePoint {
  return {
    address: draft.address.trim() || "未設定",
    latitude: parseCoordinateValue(draft.latitude),
    longitude: parseCoordinateValue(draft.longitude)
  };
}

function resolveScheduleServiceTimeSlot(schedule: VisitSchedule): "上午" | "下午" {
  if (schedule.service_time_slot.includes("上午")) {
    return "上午";
  }
  if (schedule.service_time_slot.includes("下午")) {
    return "下午";
  }
  return new Date(schedule.scheduled_start_at).getHours() < 13 ? "上午" : "下午";
}

function buildRouteGroupLabel(schedule: VisitSchedule) {
  const date = new Date(schedule.scheduled_start_at);
  return `${format(date, "EEEE", { locale: zhTW })}${resolveScheduleServiceTimeSlot(schedule)}`;
}

function resolveScheduleWeekday(schedule: VisitSchedule) {
  return String(new Date(schedule.scheduled_start_at).getDay());
}

function sortSchedulesForRoute(left: VisitSchedule, right: VisitSchedule) {
  const orderDiff = (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER);
  if (orderDiff !== 0) {
    return orderDiff;
  }
  return compareAsc(new Date(left.scheduled_start_at), new Date(right.scheduled_start_at));
}

function renumberRoute(route: VisitSchedule[]) {
  return route.map((schedule, index) => ({
    ...schedule,
    route_order: index + 1
  }));
}

function buildRouteFromSavedPlan(group: ScheduleRouteGroup, routePlan: SavedRoutePlan | undefined) {
  if (!routePlan) {
    return renumberRoute(group.schedules);
  }
  const schedulesById = new Map(group.schedules.map((schedule) => [schedule.id, schedule]));
  const orderedSchedules = routePlan.schedule_ids
    .map((scheduleId) => schedulesById.get(scheduleId))
    .filter((schedule): schedule is VisitSchedule => Boolean(schedule));
  if (orderedSchedules.length !== group.schedules.length) {
    return renumberRoute(group.schedules);
  }
  return renumberRoute(orderedSchedules);
}

function buildRoutePlannerDraftFromSavedPlan(routePlan: SavedRoutePlan): RoutePlannerDraft {
  return {
    optimizeBy: routePlan.optimize_by,
    start: {
      address: routePlan.start_address,
      latitude: routePlan.start_latitude?.toFixed(5) ?? "",
      longitude: routePlan.start_longitude?.toFixed(5) ?? ""
    },
    end: {
      address: routePlan.end_address,
      latitude: routePlan.end_latitude?.toFixed(5) ?? "",
      longitude: routePlan.end_longitude?.toFixed(5) ?? ""
    }
  };
}

function buildScheduleRouteGroups(
  schedules: VisitSchedule[],
  doctors: { id: string; name: string }[],
  patientsById: Map<string, { name: string }>
) {
  return Array.from(
    schedules.reduce((groups, schedule) => {
      const serviceTimeSlot = resolveScheduleServiceTimeSlot(schedule);
      const date = schedule.scheduled_start_at.slice(0, 10);
      const key = `${schedule.assigned_doctor_id}-${date}-${serviceTimeSlot}`;
      const doctorName =
        doctors.find((doctor) => doctor.id === schedule.assigned_doctor_id)?.name ??
        schedule.assigned_doctor_id;

      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          doctorId: schedule.assigned_doctor_id,
          doctorName,
          date,
          serviceTimeSlot,
          slotLabel: buildRouteGroupLabel(schedule),
          schedules: [],
          patientCount: 0,
          areaSummary: "",
          routePreview: ""
        });
      }

      const group = groups.get(key)!;
      group.schedules.push(schedule);
      group.patientCount = group.schedules.length;
      group.areaSummary = Array.from(new Set(group.schedules.map((item) => item.area))).join("、");
      group.routePreview = group.schedules
        .slice()
        .sort(sortSchedulesForRoute)
        .map((item) => patientsById.get(item.patient_id)?.name ?? item.patient_id)
        .slice(0, 3)
        .join("、");

      return groups;
    }, new Map<string, ScheduleRouteGroup>())
  )
    .map(([, group]) => ({
      ...group,
      schedules: group.schedules.slice().sort(sortSchedulesForRoute)
    }))
    .sort((left, right) => {
      const dateDiff = compareAsc(new Date(left.date), new Date(right.date));
      if (dateDiff !== 0) {
        return dateDiff;
      }
      if (left.serviceTimeSlot !== right.serviceTimeSlot) {
        return left.serviceTimeSlot === "上午" ? -1 : 1;
      }
      return left.doctorName.localeCompare(right.doctorName, "zh-Hant");
    });
}

function estimateDistanceKilometersBetween(
  originLatitude: number | null | undefined,
  originLongitude: number | null | undefined,
  destinationLatitude: number | null | undefined,
  destinationLongitude: number | null | undefined
) {
  if (
    originLatitude === null ||
    originLatitude === undefined ||
    originLongitude === null ||
    originLongitude === undefined ||
    destinationLatitude === null ||
    destinationLatitude === undefined ||
    destinationLongitude === null ||
    destinationLongitude === undefined
  ) {
    return 0;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destinationLatitude - originLatitude);
  const deltaLongitude = toRadians(destinationLongitude - originLongitude);
  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(toRadians(originLatitude)) *
      Math.cos(toRadians(destinationLatitude)) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function estimateTravelMinutesBetween(
  originLatitude: number | null | undefined,
  originLongitude: number | null | undefined,
  destinationLatitude: number | null | undefined,
  destinationLongitude: number | null | undefined
) {
  const distanceKilometers = estimateDistanceKilometersBetween(
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude
  );
  if (distanceKilometers === 0) {
    return 20;
  }
  return Math.max(5, Math.round((distanceKilometers / 28) * 60));
}

function buildShortestTravelRoute(route: VisitSchedule[]) {
  if (route.length <= 1) {
    return route;
  }

  const remaining = [...route];
  const ordered: VisitSchedule[] = [];
  let currentLatitude: number | null = defaultHospitalDestination.latitude;
  let currentLongitude: number | null = defaultHospitalDestination.longitude;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestTravelMinutes = Number.POSITIVE_INFINITY;

    remaining.forEach((schedule, index) => {
      const travelMinutes = estimateTravelMinutesBetween(
        currentLatitude,
        currentLongitude,
        schedule.home_latitude_snapshot,
        schedule.home_longitude_snapshot
      );
      if (travelMinutes < bestTravelMinutes) {
        bestTravelMinutes = travelMinutes;
        bestIndex = index;
      }
    });

    const [nextSchedule] = remaining.splice(bestIndex, 1);
    ordered.push(nextSchedule);
    currentLatitude = nextSchedule.home_latitude_snapshot ?? currentLatitude;
    currentLongitude = nextSchedule.home_longitude_snapshot ?? currentLongitude;
  }

  return ordered;
}

function calculateRouteMetrics(
  route: VisitSchedule[],
  plannerDraft: RoutePlannerDraft,
  optimizeBy = plannerDraft.optimizeBy
): RouteMetrics {
  const start = resolveRoutePoint(plannerDraft.start);
  const end = resolveRoutePoint(plannerDraft.end);
  let previousLatitude = start.latitude;
  let previousLongitude = start.longitude;
  let totalMinutes = 0;
  let totalDistanceKilometers = 0;

  route.forEach((schedule) => {
    totalMinutes += estimateTravelMinutesBetween(
      previousLatitude,
      previousLongitude,
      schedule.home_latitude_snapshot,
      schedule.home_longitude_snapshot
    );
    totalDistanceKilometers += estimateDistanceKilometersBetween(
      previousLatitude,
      previousLongitude,
      schedule.home_latitude_snapshot,
      schedule.home_longitude_snapshot
    );
    previousLatitude = schedule.home_latitude_snapshot ?? previousLatitude;
    previousLongitude = schedule.home_longitude_snapshot ?? previousLongitude;
  });

  if (route.length > 0) {
    totalMinutes += estimateTravelMinutesBetween(
      previousLatitude,
      previousLongitude,
      end.latitude,
      end.longitude
    );
    totalDistanceKilometers += estimateDistanceKilometersBetween(
      previousLatitude,
      previousLongitude,
      end.latitude,
      end.longitude
    );
  }

  return {
    totalMinutes,
    totalDistanceKilometers,
    score: optimizeBy === "distance" ? totalDistanceKilometers : totalMinutes
  };
}

function buildAutoSortedRoute(route: VisitSchedule[], plannerDraft: RoutePlannerDraft) {
  if (route.length <= 1) {
    return route;
  }

  const start = resolveRoutePoint(plannerDraft.start);
  const end = resolveRoutePoint(plannerDraft.end);
  const target = plannerDraft.optimizeBy;
  const baseRoute = route.slice();
  const openingCandidates = route
    .slice()
    .sort((left, right) => {
      const leftMetrics = calculateRouteMetrics([left], plannerDraft, target);
      const rightMetrics = calculateRouteMetrics([right], plannerDraft, target);
      return leftMetrics.score - rightMetrics.score;
    })
    .slice(0, Math.min(4, route.length));
  const candidateRoutes: VisitSchedule[][] = [baseRoute];

  const legScore = (origin: RoutePoint, destination: VisitSchedule) => {
    const minutes = estimateTravelMinutesBetween(
      origin.latitude,
      origin.longitude,
      destination.home_latitude_snapshot,
      destination.home_longitude_snapshot
    );
    const distance = estimateDistanceKilometersBetween(
      origin.latitude,
      origin.longitude,
      destination.home_latitude_snapshot,
      destination.home_longitude_snapshot
    );
    const returnMinutes = estimateTravelMinutesBetween(
      destination.home_latitude_snapshot,
      destination.home_longitude_snapshot,
      end.latitude,
      end.longitude
    );
    const returnDistance = estimateDistanceKilometersBetween(
      destination.home_latitude_snapshot,
      destination.home_longitude_snapshot,
      end.latitude,
      end.longitude
    );
    const primary = target === "distance" ? distance : minutes;
    const secondary = target === "distance" ? returnDistance : returnMinutes;
    return primary + secondary * 0.18;
  };

  openingCandidates.forEach((firstSchedule) => {
    const remaining = route.filter((schedule) => schedule.id !== firstSchedule.id);
    const candidateRoute = [firstSchedule];
    let currentPoint: RoutePoint = {
      address: firstSchedule.address_snapshot,
      latitude: firstSchedule.home_latitude_snapshot,
      longitude: firstSchedule.home_longitude_snapshot
    };

    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;

      remaining.forEach((schedule, index) => {
        const score = legScore(currentPoint, schedule);
        if (score < bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });

      const [nextSchedule] = remaining.splice(bestIndex, 1);
      candidateRoute.push(nextSchedule);
      currentPoint = {
        address: nextSchedule.address_snapshot,
        latitude: nextSchedule.home_latitude_snapshot,
        longitude: nextSchedule.home_longitude_snapshot
      };
    }

    candidateRoutes.push(candidateRoute);
  });

  let bestRoute = candidateRoutes[0];
  let bestMetrics = calculateRouteMetrics(bestRoute, plannerDraft, target);

  candidateRoutes.forEach((candidate) => {
    let improvedRoute = candidate.slice();
    let improved = true;

    while (improved) {
      improved = false;

      for (let leftIndex = 0; leftIndex < improvedRoute.length - 1; leftIndex += 1) {
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < improvedRoute.length;
          rightIndex += 1
        ) {
          const nextRoute = [
            ...improvedRoute.slice(0, leftIndex),
            ...improvedRoute.slice(leftIndex, rightIndex + 1).reverse(),
            ...improvedRoute.slice(rightIndex + 1)
          ];
          const nextMetrics = calculateRouteMetrics(nextRoute, plannerDraft, target);

          if (nextMetrics.score + 0.001 < calculateRouteMetrics(improvedRoute, plannerDraft, target).score) {
            improvedRoute = nextRoute;
            improved = true;
          }
        }
      }
    }

    const candidateMetrics = calculateRouteMetrics(improvedRoute, plannerDraft, target);
    if (candidateMetrics.score + 0.001 < bestMetrics.score) {
      bestRoute = improvedRoute;
      bestMetrics = candidateMetrics;
    }
  });

  return bestRoute;
}

function buildRouteNotificationTask(
  schedule: VisitSchedule,
  doctorName: string,
  doctorTarget: string,
  patientName: string,
  navigationUrl: string,
  templateId: string,
  body: string,
  triggerType: string
): NotificationTask {
  return {
    id: schedule.id,
    template_id: templateId,
    patient_id: schedule.patient_id,
    caregiver_id: null,
    visit_schedule_id: schedule.id,
    status: "closed",
    channel: "web_notice",
    scheduled_send_at: schedule.scheduled_start_at,
    sent_at: null,
    recipient_name: doctorName,
    recipient_role: "doctor",
    recipient_target: doctorTarget,
    trigger_type: triggerType,
    preview_payload: {
      patient_name: patientName,
      navigation_url: navigationUrl,
      body
    },
    reply_excerpt: null,
    reply_code: null,
    failure_reason: "通知任務功能已停用",
    linked_tracking_session_id: schedule.id,
    created_at: schedule.created_at,
    updated_at: schedule.updated_at
  };
}

export function AdminSchedulesPage() {
  const { repositories, db, services } = useAppContext();
  const [doctorId, setDoctorId] = useState<string>("all");
  const [weekdayFilter, setWeekdayFilter] = useState<string>(String(new Date().getDay()));
  const [timeSlotFilter, setTimeSlotFilter] = useState<"all" | "上午" | "下午">("all");
  const [recentAction, setRecentAction] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedSavedRoutePlanId, setSelectedSavedRoutePlanId] = useState<string>("");
  const [routeDrafts, setRouteDrafts] = useState<Record<string, VisitSchedule[]>>({});
  const [routeDraftDirtyByGroup, setRouteDraftDirtyByGroup] = useState<Record<string, boolean>>({});
  const [routePlannerDrafts, setRoutePlannerDrafts] = useState<Record<string, RoutePlannerDraft>>({});
  const [draggingScheduleId, setDraggingScheduleId] = useState<string | null>(null);

  const allRawSchedules = repositories.visitRepository.getSchedules();
  const rawSchedules = repositories.visitRepository.getSchedules({
    doctorId: doctorId === "all" ? undefined : doctorId
  });
  const schedules = useMemo(
    () =>
      rawSchedules.filter(
        (schedule) =>
          (weekdayFilter === "all" || resolveScheduleWeekday(schedule) === weekdayFilter) &&
          (timeSlotFilter === "all" || resolveScheduleServiceTimeSlot(schedule) === timeSlotFilter)
      ),
    [rawSchedules, timeSlotFilter, weekdayFilter]
  );
  const doctors = repositories.patientRepository.getDoctors();

  const getCoverDoctorId = useMemo(
    () => (scheduleId: string) => {
      const schedule = schedules.find((item) => item.id === scheduleId);
      if (!schedule) {
        return undefined;
      }
      return doctors.find((doctor) => doctor.id !== schedule.assigned_doctor_id)?.id;
    },
    [doctors, schedules]
  );

  const patientsById = useMemo(
    () => new Map(db.patients.map((patient) => [patient.id, patient])),
    [db.patients]
  );
  const allSavedRoutePlans = useMemo(
    () => repositories.visitRepository.getSavedRoutePlans(),
    [repositories.visitRepository]
  );
  const savedRoutePlans = useMemo(
    () =>
      allSavedRoutePlans.filter((routePlan) =>
        doctorId === "all" ? true : routePlan.doctor_id === doctorId
      ),
    [allSavedRoutePlans, doctorId]
  );

  const allGroupedSchedules = useMemo<ScheduleRouteGroup[]>(
    () => buildScheduleRouteGroups(allRawSchedules, doctors, patientsById),
    [allRawSchedules, doctors, patientsById]
  );
  const groupedSchedules = useMemo<ScheduleRouteGroup[]>(
    () => buildScheduleRouteGroups(schedules, doctors, patientsById),
    [doctors, patientsById, schedules]
  );

  useEffect(() => {
    if (groupedSchedules.length === 0) {
      setSelectedGroupId(null);
      return;
    }
    if (!selectedGroupId || !groupedSchedules.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groupedSchedules[0].id);
    }
  }, [groupedSchedules, selectedGroupId]);

  useEffect(() => {
    if (!selectedSavedRoutePlanId) {
      return;
    }
    if (!allSavedRoutePlans.some((routePlan) => routePlan.id === selectedSavedRoutePlanId)) {
      setSelectedSavedRoutePlanId("");
    }
  }, [allSavedRoutePlans, selectedSavedRoutePlanId]);

  useEffect(() => {
    setRouteDrafts((current) => {
      const next = { ...current };
      let changed = false;

      groupedSchedules.forEach((group) => {
        if (routeDraftDirtyByGroup[group.id]) {
          return;
        }
        const existingDraft = current[group.id];
        const savedRoutePlan = allSavedRoutePlans.find((routePlan) => routePlan.route_group_id === group.id);
        const preferredDraft = buildRouteFromSavedPlan(group, savedRoutePlan);
        const nextScheduleIds = preferredDraft.map((schedule) => schedule.id).join("|");
        const existingScheduleIds = existingDraft?.map((schedule) => schedule.id).join("|");

        if (!existingDraft || existingScheduleIds !== nextScheduleIds) {
          next[group.id] = preferredDraft;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [allSavedRoutePlans, groupedSchedules, routeDraftDirtyByGroup]);

  useEffect(() => {
    setRoutePlannerDrafts((current) => {
      const next = { ...current };
      let changed = false;

      groupedSchedules.forEach((group) => {
        if (!next[group.id]) {
          const savedRoutePlan = allSavedRoutePlans.find((routePlan) => routePlan.route_group_id === group.id);
          next[group.id] = savedRoutePlan
            ? buildRoutePlannerDraftFromSavedPlan(savedRoutePlan)
            : buildDefaultRoutePlannerDraft();
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [allSavedRoutePlans, groupedSchedules]);

  const selectedGroup =
    groupedSchedules.find((group) => group.id === selectedGroupId) ?? groupedSchedules[0] ?? null;
  const selectedGroupSavedPlan = selectedGroup
    ? allSavedRoutePlans.find((routePlan) => routePlan.route_group_id === selectedGroup.id)
    : undefined;
  const selectedDoctor = selectedGroup
    ? doctors.find((doctor) => doctor.id === selectedGroup.doctorId)
    : undefined;
  const routeDraft = selectedGroup
    ? routeDrafts[selectedGroup.id] ?? renumberRoute(selectedGroup.schedules)
    : [];
  const routeDraftDirty = selectedGroup ? Boolean(routeDraftDirtyByGroup[selectedGroup.id]) : false;
  const routePlannerDraft = selectedGroup
    ? routePlannerDrafts[selectedGroup.id] ?? buildDefaultRoutePlannerDraft()
    : buildDefaultRoutePlannerDraft();
  const optimizedRoute = selectedGroup
    ? renumberRoute(buildAutoSortedRoute(selectedGroup.schedules, routePlannerDraft))
    : [];
  const routeDraftMetrics = calculateRouteMetrics(routeDraft, routePlannerDraft);
  const optimizedRouteMetrics = calculateRouteMetrics(optimizedRoute, routePlannerDraft);

  const updateSelectedGroupRoute = (updater: (current: VisitSchedule[]) => VisitSchedule[]) => {
    if (!selectedGroup) {
      return;
    }
    setRouteDrafts((current) => ({
      ...current,
      [selectedGroup.id]: updater(current[selectedGroup.id] ?? renumberRoute(selectedGroup.schedules))
    }));
    setRouteDraftDirtyByGroup((current) => ({
      ...current,
      [selectedGroup.id]: true
    }));
  };

  const updateSelectedRoutePlanner = (updater: (current: RoutePlannerDraft) => RoutePlannerDraft) => {
    if (!selectedGroup) {
      return;
    }
    setRoutePlannerDrafts((current) => ({
      ...current,
      [selectedGroup.id]: updater(current[selectedGroup.id] ?? buildDefaultRoutePlannerDraft())
    }));
  };

  const handleReschedule = (schedule: VisitSchedule) => {
    const newStart = addDays(new Date(schedule.scheduled_start_at), 1).toISOString();
    const newEnd = addDays(new Date(schedule.scheduled_end_at), 1).toISOString();
    repositories.visitRepository.rescheduleVisit({
      visitScheduleId: schedule.id,
      requestedByRole: "admin",
      newStartAt: newStart,
      newEndAt: newEnd,
      reason: "管理端試跑改期",
      changeSummary: "由路線明細快速試跑"
    });
    setRecentAction(`${schedule.patient_id} 已模擬改期至 ${formatDateTime(newStart)}`);
  };

  const handleCover = (schedule: VisitSchedule) => {
    const newDoctorId = getCoverDoctorId(schedule.id);
    if (!newDoctorId) {
      return;
    }
    const nextDoctorName =
      doctors.find((doctor) => doctor.id === newDoctorId)?.name ?? newDoctorId;
    repositories.visitRepository.coverVisit({
      visitScheduleId: schedule.id,
      requestedByRole: "admin",
      newDoctorId,
      reason: "管理端試跑改派",
      changeSummary: "由路線明細快速試跑"
    });
    setRecentAction(`${schedule.patient_id} 已模擬改派給 ${nextDoctorName}`);
  };

  const handleCancel = (schedule: VisitSchedule) => {
    repositories.visitRepository.cancelVisit(schedule.id, "管理端試跑取消", "由路線明細快速試跑");
    setRecentAction(`${schedule.patient_id} 已模擬取消本次排程`);
  };

  const saveRouteDraft = () => {
    if (!selectedGroup || routeDraft.length === 0) {
      setRecentAction("目前沒有可儲存的路線草稿。");
      return;
    }

    routeDraft.forEach((schedule, index) => {
      repositories.visitRepository.updateRouteOrder(schedule.id, index + 1);
    });
    const now = new Date().toISOString();
    repositories.visitRepository.upsertSavedRoutePlan({
      id: selectedGroupSavedPlan?.id ?? `route-${selectedGroup.id}`,
      doctor_id: selectedGroup.doctorId,
      route_group_id: selectedGroup.id,
      route_name: `${formatDateOnly(selectedGroup.date)} ${selectedGroup.serviceTimeSlot}路線`,
      route_date: selectedGroup.date,
      service_time_slot: selectedGroup.serviceTimeSlot,
      optimize_by: routePlannerDraft.optimizeBy,
      schedule_ids: routeDraft.map((schedule) => schedule.id),
      start_address: routePlannerDraft.start.address.trim() || defaultHospitalDestination.address,
      start_latitude: resolveRoutePoint(routePlannerDraft.start).latitude,
      start_longitude: resolveRoutePoint(routePlannerDraft.start).longitude,
      end_address: routePlannerDraft.end.address.trim() || defaultHospitalDestination.address,
      end_latitude: resolveRoutePoint(routePlannerDraft.end).latitude,
      end_longitude: resolveRoutePoint(routePlannerDraft.end).longitude,
      total_minutes: routeDraftMetrics.totalMinutes,
      total_distance_kilometers: Number(routeDraftMetrics.totalDistanceKilometers.toFixed(1)),
      saved_at: now,
      created_at: selectedGroupSavedPlan?.created_at ?? now,
      updated_at: now
    });
    setRouteDraftDirtyByGroup((current) => ({
      ...current,
      [selectedGroup.id]: false
    }));
    setRecentAction(`已儲存 ${selectedGroup.doctorName} ${selectedGroup.slotLabel} 的路線，醫師端可直接選擇這條路線導航。`);
  };

  const applySavedRoutePlan = (group: ScheduleRouteGroup, routePlan: SavedRoutePlan) => {
    setRouteDrafts((current) => ({
      ...current,
      [group.id]: buildRouteFromSavedPlan(group, routePlan)
    }));
    setRoutePlannerDrafts((current) => ({
      ...current,
      [group.id]: buildRoutePlannerDraftFromSavedPlan(routePlan)
    }));
    setRouteDraftDirtyByGroup((current) => ({
      ...current,
      [group.id]: false
    }));
  };

  const openSavedRoutePlan = (routePlan: SavedRoutePlan) => {
    const targetGroup = allGroupedSchedules.find((group) => group.id === routePlan.route_group_id);
    if (!targetGroup) {
      setRecentAction(`找不到 ${routePlan.route_name} 對應的排程時段。`);
      setSelectedSavedRoutePlanId("");
      return;
    }

    setSelectedSavedRoutePlanId(routePlan.id);
    setDoctorId(routePlan.doctor_id);
    setWeekdayFilter(String(new Date(routePlan.route_date).getDay()));
    setTimeSlotFilter(routePlan.service_time_slot);
    setSelectedGroupId(targetGroup.id);
    applySavedRoutePlan(targetGroup, routePlan);
    setRecentAction(`已開啟 ${routePlan.route_name}。`);
  };

  const handleDeleteSavedRoutePlan = () => {
    if (!selectedGroup || !selectedGroupSavedPlan) {
      setRecentAction("目前沒有可刪除的已儲存路線。");
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(`確定刪除 ${selectedGroupSavedPlan.route_name}？刪除後醫師端將無法直接選用這條路線。`)
    ) {
      return;
    }

    setRouteDraftDirtyByGroup((current) => ({
      ...current,
      [selectedGroup.id]: true
    }));
    setSelectedSavedRoutePlanId("");
    repositories.visitRepository.deleteSavedRoutePlan(selectedGroupSavedPlan.id);
    setRecentAction(`已刪除 ${selectedGroupSavedPlan.route_name}，如需保留目前站序請重新儲存。`);
  };

  const moveRouteItem = (scheduleId: string, direction: "up" | "down") => {
    updateSelectedGroupRoute((current) => {
      const currentIndex = current.findIndex((item) => item.id === scheduleId);
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [movedItem] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, movedItem);
      const patientName = patientsById.get(movedItem.patient_id)?.name ?? movedItem.patient_id;
      setRecentAction(`草稿中將 ${patientName} 調整為第 ${targetIndex + 1} 站。`);
      return renumberRoute(next);
    });
  };

  const moveRouteItemByDrag = (sourceScheduleId: string, targetScheduleId: string) => {
    if (sourceScheduleId === targetScheduleId) {
      return;
    }

    updateSelectedGroupRoute((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceScheduleId);
      const targetIndex = current.findIndex((item) => item.id === targetScheduleId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const next = [...current];
      const [movedItem] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, movedItem);
      const patientName = patientsById.get(movedItem.patient_id)?.name ?? movedItem.patient_id;
      setRecentAction(`已拖曳調整 ${patientName} 的路線順序。`);
      return renumberRoute(next);
    });
  };

  const sendNavigationTask = (
    schedule: VisitSchedule,
    triggerType: string,
    templateId: string,
    body: string,
    navigationUrl: string
  ) => {
    if (!selectedDoctor) {
      return;
    }
    const patientName = patientsById.get(schedule.patient_id)?.name ?? schedule.patient_id;
    const preview = buildRouteNotificationTask(
      schedule,
      selectedDoctor.name,
      `WEB_NOTICE:${selectedDoctor.id}`,
      patientName,
      navigationUrl,
      templateId,
      body,
      triggerType
    );
    setRecentAction(`${preview.preview_payload.body} 導航連結：${preview.preview_payload.navigation_url}`);
  };

  const handleSendFirstStop = () => {
    const firstStop = routeDraft[0];
    if (!firstStop) {
      setRecentAction("這個時段目前沒有可送出的第一站導航。");
      return;
    }
    const patientName = patientsById.get(firstStop.patient_id)?.name ?? firstStop.patient_id;
    sendNavigationTask(
      firstStop,
      "doctor_departure",
      "tpl-007",
      `已傳送 ${selectedGroup?.doctorName ?? "醫師"} 第一站導航：${patientName}。`,
      services.maps.buildNavigationUrl({
        destinationAddress: firstStop.address_snapshot,
        destinationKeyword: firstStop.location_keyword_snapshot,
        destinationLatitude: firstStop.home_latitude_snapshot,
        destinationLongitude: firstStop.home_longitude_snapshot,
        originLatitude: resolveRoutePoint(routePlannerDraft.start).latitude,
        originLongitude: resolveRoutePoint(routePlannerDraft.start).longitude
      })
    );
  };

  const handleSendNextStop = (schedule: VisitSchedule) => {
    const currentIndex = routeDraft.findIndex((item) => item.id === schedule.id);
    const nextSchedule = currentIndex >= 0 ? routeDraft[currentIndex + 1] : undefined;
    if (!nextSchedule) {
      setRecentAction("這一站已經是本時段最後一站。");
      return;
    }

    const patientName = patientsById.get(nextSchedule.patient_id)?.name ?? nextSchedule.patient_id;
    sendNavigationTask(
      nextSchedule,
      "doctor_next_stop",
      "tpl-008",
      `已傳送 ${selectedGroup?.doctorName ?? "醫師"} 下一站導航：${patientName}。`,
      services.maps.buildNavigationUrl({
        destinationAddress: nextSchedule.address_snapshot,
        destinationKeyword: nextSchedule.location_keyword_snapshot,
        destinationLatitude: nextSchedule.home_latitude_snapshot,
        destinationLongitude: nextSchedule.home_longitude_snapshot,
        originLatitude: schedule.home_latitude_snapshot,
        originLongitude: schedule.home_longitude_snapshot
      })
    );
  };

  const handleReturnHospital = (schedule: VisitSchedule) => {
    const endPoint = resolveRoutePoint(routePlannerDraft.end);
    sendNavigationTask(
      schedule,
      "doctor_return_hospital",
      "tpl-009",
      `已傳送 ${selectedGroup?.doctorName ?? "醫師"} 終點導航：${endPoint.address}。`,
      services.maps.buildNavigationUrl({
        destinationAddress: endPoint.address,
        destinationLatitude: endPoint.latitude,
        destinationLongitude: endPoint.longitude,
        originLatitude: schedule.home_latitude_snapshot,
        originLongitude: schedule.home_longitude_snapshot
      })
    );
  };

  return (
    <div className="space-y-6">
      <Panel title="排程總表">
        <div className="mb-4 grid gap-3 lg:grid-cols-[220px_180px_180px_1fr]">
          <select
            aria-label="篩選醫師"
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
          >
            <option value="all">全部醫師</option>
            {db.doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
          <select
            aria-label="篩選星期"
            value={weekdayFilter}
            onChange={(event) => setWeekdayFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
          >
            {scheduleWeekdayOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="篩選時段"
            value={timeSlotFilter}
            onChange={(event) => setTimeSlotFilter(event.target.value as "all" | "上午" | "下午")}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm"
          >
            <option value="all">全部時段</option>
            <option value="上午">上午</option>
            <option value="下午">下午</option>
          </select>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
            先選醫師，再選星期幾，最後再選上午或下午。排程管理已直接整合自動排序、拖曳手動排序、導航接力與起終點設定，不再另外放在總覽頁。
          </div>
        </div>
        {recentAction ? (
          <div
            role="status"
            className="mb-4 rounded-2xl border border-brand-sand bg-brand-sand/50 px-4 py-3 text-sm text-brand-ink"
          >
            最近操作：{recentAction}
          </div>
        ) : null}
        <div className="mb-4 rounded-3xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">已儲存的路線</span>
              <select
                aria-label="已儲存的路線"
                value={selectedSavedRoutePlanId}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId(event.target.value);
                  const routePlan = allSavedRoutePlans.find((item) => item.id === event.target.value);
                  if (!routePlan) {
                    return;
                  }
                  openSavedRoutePlan(routePlan);
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              >
                <option value="">請選擇已儲存路線</option>
                {allSavedRoutePlans.map((routePlan) => (
                  <option key={routePlan.id} value={routePlan.id}>
                    {routePlan.route_name}｜{routePlan.route_date}｜{routePlan.service_time_slot}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={handleDeleteSavedRoutePlan}
              disabled={!selectedGroupSavedPlan}
              className="rounded-full border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              刪除這條路線
            </button>
          </div>
          {allSavedRoutePlans.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              目前還沒有已儲存路線，請先在右側路線明細儲存。
            </div>
          ) : null}
        </div>
        {groupedSchedules.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
            目前沒有符合條件的時段排程。
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <div className="space-y-3">
              {groupedSchedules.map((group) => {
                const isSelected = group.id === selectedGroup?.id;
                const hasSavedRoute = savedRoutePlans.some((routePlan) => routePlan.route_group_id === group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => setSelectedGroupId(group.id)}
                    className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                      isSelected
                        ? "border-brand-forest bg-brand-sand/50 shadow-card"
                        : "border-slate-200 bg-white hover:border-brand-moss"
                    }`}
                    aria-label={`查看 ${group.doctorName} ${group.slotLabel} 路線`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-brand-forest">{group.slotLabel}</p>
                        <p className="mt-1 text-base font-semibold text-brand-ink">
                          {formatDateOnly(group.date)} · {group.doctorName}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {group.patientCount} 位
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-slate-600">
                      <p>服務區域：{group.areaSummary || "未設定"}</p>
                      <p>路線預覽：{group.routePreview || "待補個案"}</p>
                      <p>已儲存路線：{hasSavedRoute ? "有" : "尚未儲存"}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedGroup ? (
              <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-brand-forest">路線明細與導航接力</p>
                    <h3 className="text-xl font-semibold text-brand-ink">
                      {selectedGroup.doctorName}｜{selectedGroup.slotLabel}
                    </h3>
                    <p className="text-sm text-slate-500">
                      {formatDateOnly(selectedGroup.date)}，共 {selectedGroup.patientCount} 位個案，請以這個半天時段為單位查看、調整路線並接力導航。
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-600">
                    <p>服務區域：{selectedGroup.areaSummary || "未設定"}</p>
                    <p>草稿狀態：{routeDraftDirty ? "尚未儲存" : "已同步最新站序"}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
                  <div className="grid gap-4 xl:grid-cols-[1.1fr_1.1fr_0.8fr]">
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-brand-ink">起點設定</p>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-brand-ink">起點名稱 / 地址</span>
                        <input
                          aria-label="起點名稱"
                          value={routePlannerDraft.start.address}
                          onChange={(event) =>
                            updateSelectedRoutePlanner((current) => ({
                              ...current,
                              start: { ...current.start, address: event.target.value }
                            }))
                          }
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm">
                          <span className="mb-1 block font-medium text-brand-ink">起點緯度</span>
                          <input
                            aria-label="起點緯度"
                            value={routePlannerDraft.start.latitude}
                            onChange={(event) =>
                              updateSelectedRoutePlanner((current) => ({
                                ...current,
                                start: { ...current.start, latitude: event.target.value }
                              }))
                            }
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block font-medium text-brand-ink">起點經度</span>
                          <input
                            aria-label="起點經度"
                            value={routePlannerDraft.start.longitude}
                            onChange={(event) =>
                              updateSelectedRoutePlanner((current) => ({
                                ...current,
                                start: { ...current.start, longitude: event.target.value }
                              }))
                            }
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-brand-ink">終點設定</p>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-brand-ink">終點名稱 / 地址</span>
                        <input
                          aria-label="終點名稱"
                          value={routePlannerDraft.end.address}
                          onChange={(event) =>
                            updateSelectedRoutePlanner((current) => ({
                              ...current,
                              end: { ...current.end, address: event.target.value }
                            }))
                          }
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-sm">
                          <span className="mb-1 block font-medium text-brand-ink">終點緯度</span>
                          <input
                            aria-label="終點緯度"
                            value={routePlannerDraft.end.latitude}
                            onChange={(event) =>
                              updateSelectedRoutePlanner((current) => ({
                                ...current,
                                end: { ...current.end, latitude: event.target.value }
                              }))
                            }
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block font-medium text-brand-ink">終點經度</span>
                          <input
                            aria-label="終點經度"
                            value={routePlannerDraft.end.longitude}
                            onChange={(event) =>
                              updateSelectedRoutePlanner((current) => ({
                                ...current,
                                end: { ...current.end, longitude: event.target.value }
                              }))
                            }
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-sm font-semibold text-brand-ink">自動排序設定</p>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-brand-ink">最佳化依據</span>
                        <select
                          aria-label="自動排序依據"
                          value={routePlannerDraft.optimizeBy}
                          onChange={(event) =>
                            updateSelectedRoutePlanner((current) => ({
                              ...current,
                              optimizeBy: event.target.value as RouteOptimizationTarget
                            }))
                          }
                          className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                        >
                          <option value="time">最少時間</option>
                          <option value="distance">最少距離</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (optimizedRoute.length === 0) {
                            setRecentAction("這個時段目前沒有可重排的路線。");
                            return;
                          }
                          updateSelectedGroupRoute(() => optimizedRoute);
                          setRecentAction(
                            `已依${routePlannerDraft.optimizeBy === "distance" ? "最少距離" : "最少時間"}產生 ${selectedGroup.doctorName} ${selectedGroup.slotLabel} 的最佳路線草稿。`
                          );
                        }}
                        className="w-full rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
                      >
                        套用自動排序
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateSelectedRoutePlanner(() => buildDefaultRoutePlannerDraft())
                        }
                        className="w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
                      >
                        重設起終點為旗山醫院
                      </button>
                      <button
                        type="button"
                        onClick={saveRouteDraft}
                        className="w-full rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
                      >
                        儲存此時段路線
                      </button>
                      <button
                        type="button"
                        onClick={handleSendFirstStop}
                        className="w-full rounded-full bg-brand-coral px-4 py-2 text-sm font-semibold text-white"
                      >
                        醫師出發，傳送第一站導航
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <p className="font-semibold text-brand-ink">目前草稿路線</p>
                      <p className="mt-2">
                        行車總時間 {routeDraftMetrics.totalMinutes} 分鐘 / 行車總距離{" "}
                        {routeDraftMetrics.totalDistanceKilometers.toFixed(1)} 公里
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <p className="font-semibold text-brand-ink">自動排序建議</p>
                      <p className="mt-2">
                        {routePlannerDraft.optimizeBy === "distance" ? "最少距離" : "最少時間"}約{" "}
                        {routePlannerDraft.optimizeBy === "distance"
                          ? `${optimizedRouteMetrics.totalDistanceKilometers.toFixed(1)} 公里`
                          : `${optimizedRouteMetrics.totalMinutes} 分鐘`}
                        ，完整路線約 {optimizedRouteMetrics.totalMinutes} 分鐘 /{" "}
                        {optimizedRouteMetrics.totalDistanceKilometers.toFixed(1)} 公里
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    系統目前以座標做近似最佳化，採「鄰近優先 + 局部交換」方式估算，會盡量讓近點相鄰，並把太遠的點往較後段排序；若要精修，請直接拖曳下方卡片手動調整。
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {routeDraft.map((schedule) => (
                      <span
                        key={schedule.id}
                        className="rounded-full bg-brand-sand px-3 py-1 text-xs font-semibold text-brand-forest"
                      >
                        第 {schedule.route_order} 站 {patientsById.get(schedule.patient_id)?.name ?? schedule.patient_id}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {routeDraft.map((schedule, index) => {
                    const patient = patientsById.get(schedule.patient_id);
                    const isLocked = ["completed", "cancelled"].includes(schedule.status);
                    const isLast = index === routeDraft.length - 1;
                    const coverDoctorId = getCoverDoctorId(schedule.id);
                    const navigationUrl = services.maps.buildNavigationUrl({
                      destinationAddress: schedule.address_snapshot,
                      destinationKeyword: schedule.location_keyword_snapshot,
                      destinationLatitude: schedule.home_latitude_snapshot,
                      destinationLongitude: schedule.home_longitude_snapshot
                    });
                    return (
                      <article
                        key={schedule.id}
                        draggable
                        onDragStart={() => setDraggingScheduleId(schedule.id)}
                        onDragEnd={() => setDraggingScheduleId(null)}
                        onDragOver={(event: DragEvent<HTMLElement>) => {
                          event.preventDefault();
                        }}
                        onDrop={(event: DragEvent<HTMLElement>) => {
                          event.preventDefault();
                          if (draggingScheduleId) {
                            moveRouteItemByDrag(draggingScheduleId, schedule.id);
                          }
                          setDraggingScheduleId(null);
                        }}
                        className="rounded-3xl border border-white bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-brand-sand px-3 py-1 text-xs font-semibold text-brand-ink">
                                第 {index + 1} 站
                              </span>
                              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                                拖曳排序
                              </span>
                              <Badge value={schedule.status} compact />
                            </div>
                            <div>
                              <p className="text-lg font-semibold text-brand-ink">
                                {patient?.name ?? schedule.patient_id}
                              </p>
                              <p className="text-sm text-slate-500">個案 ID：{schedule.patient_id}</p>
                            </div>
                          </div>
                          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                            <p>預定時間：{formatDateTime(schedule.scheduled_start_at)}</p>
                            <p>預估治療：{formatMinutes(schedule.estimated_treatment_minutes)}</p>
                            <p>區域：{schedule.area}</p>
                            <p>建議到站：{formatTimeOnly(schedule.scheduled_start_at)}</p>
                          </div>
                        </div>

                        <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                          地址：{schedule.address_snapshot}
                          <p className="mt-1 text-xs text-slate-500">
                            定位關鍵字：
                            {schedule.location_keyword_snapshot === sameAddressLocationKeyword
                              ? ` 同住址（${resolveLocationKeyword(
                                  schedule.location_keyword_snapshot,
                                  schedule.address_snapshot
                                )}）`
                              : ` ${schedule.location_keyword_snapshot}`}
                          </p>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            to={`/admin/patients/${schedule.patient_id}`}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest"
                          >
                            查看個案
                          </Link>
                          <a
                            href={navigationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest"
                          >
                            開啟本站導航
                          </a>
                          <button
                            type="button"
                            onClick={() => moveRouteItem(schedule.id, "up")}
                            disabled={index === 0}
                            aria-label={`將 ${patient?.name ?? schedule.patient_id} 上移`}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            上移
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRouteItem(schedule.id, "down")}
                            disabled={isLast}
                            aria-label={`將 ${patient?.name ?? schedule.patient_id} 下移`}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            下移
                          </button>
                          {!isLast ? (
                            <button
                              type="button"
                              onClick={() => handleSendNextStop(schedule)}
                              className="inline-flex items-center justify-center rounded-full bg-brand-sand px-3 py-1.5 text-xs font-semibold text-brand-forest"
                            >
                              完成本站後，傳送下一站導航
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleReturnHospital(schedule)}
                              className="inline-flex items-center justify-center rounded-full bg-brand-sand px-3 py-1.5 text-xs font-semibold text-brand-forest"
                            >
                              全部完成，傳送終點導航
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleReschedule(schedule)}
                            disabled={isLocked}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            模擬改期
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCover(schedule)}
                            disabled={isLocked || !coverDoctorId}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            模擬改派
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCancel(schedule)}
                            disabled={isLocked}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            模擬取消
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {routeDraft.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                      這個時段目前沒有可安排的患者路線。
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Panel>
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
