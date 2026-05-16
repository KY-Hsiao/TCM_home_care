import type { AppDb, RouteCompletionRecord, SavedRoutePlan } from "../../domain/models";

const statisticalStatuses = ["executing", "archived", "completed"] as const;

function buildRouteCompletionRecordId(routePlan: Pick<SavedRoutePlan, "id" | "route_date" | "service_time_slot">) {
  return `route-completion-${routePlan.id}-${routePlan.route_date}-${routePlan.service_time_slot}`;
}

function resolveUrgentCount(db: Pick<AppDb, "notification_center_items" | "visit_schedules">, routePlan: SavedRoutePlan) {
  const scheduleIds = new Set(
    routePlan.route_items
      .map((item) => item.schedule_id)
      .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
  );
  const urgentScheduleIds = new Set(
    db.visit_schedules
      .filter((schedule) => scheduleIds.has(schedule.id) && schedule.last_feedback_code === "urgent")
      .map((schedule) => schedule.id)
  );

  db.notification_center_items.forEach((item) => {
    if (
      item.linked_visit_schedule_id &&
      scheduleIds.has(item.linked_visit_schedule_id) &&
      item.status === "pending" &&
      item.source_type === "patient_exception" &&
      (item.title.includes("urgent") || item.content.includes("urgent") || item.title.includes("緊急"))
    ) {
      urgentScheduleIds.add(item.linked_visit_schedule_id);
    }
  });

  return urgentScheduleIds.size;
}

export function isRoutePlanStatistical(routePlan: SavedRoutePlan) {
  return statisticalStatuses.some((status) => status === routePlan.execution_status) && routePlan.route_items.length > 0;
}

export function buildRouteCompletionRecord(
  db: Pick<AppDb, "notification_center_items" | "visit_schedules">,
  routePlan: SavedRoutePlan,
  recordedAt = new Date().toISOString()
): RouteCompletionRecord {
  const scheduleIds = routePlan.route_items
    .map((item) => item.schedule_id)
    .filter((scheduleId): scheduleId is string => Boolean(scheduleId));
  const executedVisitCount = routePlan.route_items.filter((item) => item.checked && item.status !== "paused").length;
  const pausedCount = routePlan.route_items.filter((item) => !item.checked || item.status === "paused").length;
  const existingRecordedAt = routePlan.created_at || recordedAt;
  const completedAt =
    routePlan.execution_status === "completed" || routePlan.execution_status === "archived" ? recordedAt : null;

  return {
    id: buildRouteCompletionRecordId(routePlan),
    route_plan_id: routePlan.id,
    doctor_id: routePlan.doctor_id,
    route_date: routePlan.route_date,
    route_weekday: routePlan.route_weekday,
    service_time_slot: routePlan.service_time_slot,
    route_name: routePlan.route_name,
    executed_visit_count: executedVisitCount,
    paused_count: pausedCount,
    urgent_count: resolveUrgentCount(db, routePlan),
    schedule_ids: scheduleIds,
    route_item_keys: routePlan.route_items.map((item, index) => item.schedule_id ?? `${item.patient_id}:${index + 1}`),
    source_execution_status: routePlan.execution_status,
    recorded_at: routePlan.executed_at ?? routePlan.updated_at ?? existingRecordedAt,
    completed_at: completedAt,
    created_at: existingRecordedAt,
    updated_at: recordedAt
  };
}

export function upsertRouteCompletionRecord(db: AppDb, routePlan: SavedRoutePlan, recordedAt = new Date().toISOString()) {
  if (!isRoutePlanStatistical(routePlan)) {
    return db.route_completion_records;
  }

  const nextRecord = buildRouteCompletionRecord(db, routePlan, recordedAt);
  const index = db.route_completion_records.findIndex((record) => record.id === nextRecord.id);
  if (index < 0) {
    return [nextRecord, ...db.route_completion_records];
  }

  return db.route_completion_records.map((record, recordIndex) =>
    recordIndex === index
      ? {
          ...nextRecord,
          created_at: record.created_at,
          recorded_at: record.recorded_at,
          completed_at: nextRecord.completed_at ?? record.completed_at
        }
      : record
  );
}

export function backfillRouteCompletionRecords(db: AppDb): AppDb {
  return db.saved_route_plans
    .filter(isRoutePlanStatistical)
    .reduce(
      (nextDb, routePlan) => ({
        ...nextDb,
        route_completion_records: upsertRouteCompletionRecord(nextDb, routePlan, routePlan.updated_at)
      }),
      {
        ...db,
        route_completion_records: db.route_completion_records ?? []
      }
    );
}
