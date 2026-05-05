import type { SavedRoutePlan, VisitSchedule } from "../../domain/models";
import { patientsSeed } from "./patients";
import { visitSchedulesSeed } from "./visits";

const defaultHospitalDestination = {
  address: "旗山醫院",
  latitude: 22.880693,
  longitude: 120.483276
};

const patientNameMap = new Map(patientsSeed.map((patient) => [patient.id, patient.name]));
const todayRouteDate = new Date().toISOString().slice(0, 10);

function resolveScheduleServiceTimeSlot(schedule: VisitSchedule): "上午" | "下午" {
  if (schedule.service_time_slot.includes("上午")) {
    return "上午";
  }
  if (schedule.service_time_slot.includes("下午")) {
    return "下午";
  }
  return new Date(schedule.scheduled_start_at).getHours() < 13 ? "上午" : "下午";
}

function estimateDistanceKilometers(
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

function estimateTravelMinutes(
  originLatitude: number | null | undefined,
  originLongitude: number | null | undefined,
  destinationLatitude: number | null | undefined,
  destinationLongitude: number | null | undefined
) {
  const distanceKilometers = estimateDistanceKilometers(
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

function calculateRouteMetrics(route: VisitSchedule[]) {
  let previousLatitude: number | null = defaultHospitalDestination.latitude;
  let previousLongitude: number | null = defaultHospitalDestination.longitude;
  let totalMinutes = 0;
  let totalDistanceKilometers = 0;

  route.forEach((schedule) => {
    totalMinutes += estimateTravelMinutes(
      previousLatitude,
      previousLongitude,
      schedule.home_latitude_snapshot,
      schedule.home_longitude_snapshot
    );
    totalDistanceKilometers += estimateDistanceKilometers(
      previousLatitude,
      previousLongitude,
      schedule.home_latitude_snapshot,
      schedule.home_longitude_snapshot
    );
    previousLatitude = schedule.home_latitude_snapshot ?? previousLatitude;
    previousLongitude = schedule.home_longitude_snapshot ?? previousLongitude;
  });

  if (route.length > 0) {
    totalMinutes += estimateTravelMinutes(
      previousLatitude,
      previousLongitude,
      defaultHospitalDestination.latitude,
      defaultHospitalDestination.longitude
    );
    totalDistanceKilometers += estimateDistanceKilometers(
      previousLatitude,
      previousLongitude,
      defaultHospitalDestination.latitude,
      defaultHospitalDestination.longitude
    );
  }

  return {
    totalMinutes,
    totalDistanceKilometers
  };
}

export const savedRoutePlansSeed: SavedRoutePlan[] = Array.from(
  visitSchedulesSeed.reduce((groups, schedule) => {
    const serviceTimeSlot = resolveScheduleServiceTimeSlot(schedule);
    const routeDate = schedule.scheduled_start_at.slice(0, 10);
    const key = `${schedule.assigned_doctor_id}-${routeDate}-${serviceTimeSlot}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(schedule);
    return groups;
  }, new Map<string, VisitSchedule[]>())
)
  .map(([groupId, schedules]) => {
    const orderedSchedules = schedules
      .slice()
      .sort(
        (left, right) =>
          (left.route_order ?? Number.MAX_SAFE_INTEGER) -
            (right.route_order ?? Number.MAX_SAFE_INTEGER) ||
          new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime()
      );
    const firstSchedule = orderedSchedules[0];
    const metrics = calculateRouteMetrics(orderedSchedules);
    const isExecutingRoute = firstSchedule.scheduled_start_at.slice(0, 10) === todayRouteDate;
    return {
      id: `route-${groupId}`,
      doctor_id: firstSchedule.assigned_doctor_id,
      route_group_id: groupId,
      route_name: `${routeDateLabel(firstSchedule.scheduled_start_at)}${resolveScheduleServiceTimeSlot(firstSchedule)}路線`,
      route_date: firstSchedule.scheduled_start_at.slice(0, 10),
      route_weekday: resolveWeekdayLabel(firstSchedule.scheduled_start_at),
      service_time_slot: resolveScheduleServiceTimeSlot(firstSchedule),
      optimize_by: "time" as const,
      schedule_ids: orderedSchedules.map((schedule) => schedule.id),
      route_items: orderedSchedules.map((schedule, index) => ({
        patient_id: schedule.patient_id,
        schedule_id: schedule.id,
        checked: schedule.status !== "paused",
        route_order: index + 1,
        status:
          schedule.status === "completed"
            ? ("completed" as const)
            : schedule.status === "in_treatment" || schedule.status === "arrived"
              ? ("in_treatment" as const)
              : ["on_the_way", "tracking", "proximity_pending"].includes(schedule.status)
                ? ("on_the_way" as const)
                : schedule.status === "paused"
                  ? ("paused" as const)
                  : ("scheduled" as const),
        patient_name: patientNameMap.get(schedule.patient_id) ?? schedule.patient_id,
        address: schedule.address_snapshot
      })),
      execution_status: isExecutingRoute ? ("executing" as const) : ("archived" as const),
      executed_at: isExecutingRoute ? firstSchedule.updated_at : null,
      start_address: defaultHospitalDestination.address,
      start_latitude: defaultHospitalDestination.latitude,
      start_longitude: defaultHospitalDestination.longitude,
      end_address: defaultHospitalDestination.address,
      end_latitude: defaultHospitalDestination.latitude,
      end_longitude: defaultHospitalDestination.longitude,
      total_minutes: metrics.totalMinutes,
      total_distance_kilometers: Number(metrics.totalDistanceKilometers.toFixed(1)),
      saved_at: firstSchedule.updated_at,
      created_at: firstSchedule.created_at,
      updated_at: firstSchedule.updated_at
    };
  })
  .sort(
    (left, right) =>
      new Date(left.route_date).getTime() - new Date(right.route_date).getTime() ||
      (left.service_time_slot === right.service_time_slot
        ? left.doctor_id.localeCompare(right.doctor_id)
        : left.service_time_slot === "上午"
          ? -1
          : 1)
  );

function routeDateLabel(dateValue: string) {
  return dateValue.slice(5, 10).replace("-", "/");
}

function resolveWeekdayLabel(dateValue: string) {
  const weekdayLabels = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;
  return weekdayLabels[new Date(dateValue).getDay()] ?? "星期?";
}
