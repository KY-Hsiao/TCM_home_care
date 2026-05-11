import type { AppDb } from "../../../domain/models";
import type { StaffingRepository } from "../../../domain/repository";
import {
  buildNotificationCenterItemFromLeaveRequest,
  upsertNotificationCenterItem
} from "./notificationCenter";

export function createStaffingRepository(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): StaffingRepository {
  const formatDateInputValue = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const normalizeReferenceDate = (value?: string) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : formatDateInputValue();

  const buildMonthRange = (referenceDate: string, monthOffset: number) => {
    const date = new Date(`${referenceDate}T00:00:00`);
    const year = date.getFullYear();
    const month = date.getMonth() + monthOffset;
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    return {
      start,
      end,
      label: `${start.getFullYear()}年${start.getMonth() + 1}月`
    };
  };

  const resolveUrgentScheduleIds = (
    schedules: AppDb["visit_schedules"],
    pendingPatientExceptionItems: AppDb["notification_center_items"]
  ) => {
    const scheduleIdsInScope = new Set(schedules.map((schedule) => schedule.id));
    const urgentScheduleIds = new Set(
      schedules
        .filter((schedule) => schedule.last_feedback_code === "urgent")
        .map((schedule) => schedule.id)
    );
    pendingPatientExceptionItems.forEach((item) => {
      if (
        item.linked_visit_schedule_id &&
        scheduleIdsInScope.has(item.linked_visit_schedule_id) &&
        (item.title.includes("urgent") || item.content.includes("urgent") || item.title.includes("緊急"))
      ) {
        urgentScheduleIds.add(item.linked_visit_schedule_id);
      }
    });
    return urgentScheduleIds;
  };

  const getImpactedSchedules = (doctorId: string, startDate: string, endDate: string) => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    return getDb().visit_schedules.filter((schedule) => {
      const scheduleStart = new Date(schedule.scheduled_start_at);
      return (
        schedule.assigned_doctor_id === doctorId &&
        scheduleStart >= start &&
        scheduleStart <= end &&
        !["completed", "cancelled"].includes(schedule.status)
      );
    });
  };

  const isCompletedRoutePlan = (routePlan: AppDb["saved_route_plans"][number]) =>
    routePlan.execution_status === "completed" && routePlan.route_items.length > 0;

  const countExecutedRouteItems = (routePlans: AppDb["saved_route_plans"]) =>
    routePlans.reduce(
      (count, routePlan) =>
        count + routePlan.route_items.filter((item) => item.checked && item.status !== "paused").length,
      0
    );

  const countPausedRouteItems = (routePlans: AppDb["saved_route_plans"]) =>
    routePlans.reduce(
      (count, routePlan) =>
        count + routePlan.route_items.filter((item) => !item.checked || item.status === "paused").length,
      0
    );

  const getSchedulesFromRoutePlans = (db: AppDb, routePlans: AppDb["saved_route_plans"]) => {
    const scheduleIds = new Set(
      routePlans.flatMap((routePlan) => [
        ...routePlan.schedule_ids,
        ...routePlan.route_items
          .map((item) => item.schedule_id)
          .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
      ])
    );

    return db.visit_schedules.filter((schedule) => scheduleIds.has(schedule.id));
  };

  const buildRoutePlanStats = (
    db: AppDb,
    routePlans: AppDb["saved_route_plans"],
    patientExceptionItems: AppDb["notification_center_items"],
    label: string
  ) => {
    const routeSchedules = getSchedulesFromRoutePlans(db, routePlans);
    const urgentScheduleIds = resolveUrgentScheduleIds(routeSchedules, patientExceptionItems);

    return {
      label,
      executedVisitCount: countExecutedRouteItems(routePlans),
      pausedCount: countPausedRouteItems(routePlans),
      urgentCount: urgentScheduleIds.size
    };
  };

  return {
    getAdminDashboard(options) {
      const db = getDb();
      const referenceDate = normalizeReferenceDate(options?.referenceDate);
      const pendingLeaveRequests = db.leave_requests.filter((leave) => leave.status === "pending");
      const pendingRescheduleActions = db.reschedule_actions.filter((item) =>
        ["pending", "draft"].includes(item.status)
      );
      const draftRoutePlans = db.saved_route_plans.filter(
        (routePlan) => routePlan.execution_status === "draft"
      );
      const completedRoutePlans = db.saved_route_plans.filter(isCompletedRoutePlan);
      const dailyRoutePlans = completedRoutePlans.filter((routePlan) => routePlan.route_date === referenceDate);
      const dailyRouteSchedules = getSchedulesFromRoutePlans(db, dailyRoutePlans);
      const patientExceptionItems = db.notification_center_items.filter(
        (item) => item.role === "admin" && item.source_type === "patient_exception"
      );
      const pendingPatientExceptionItems = patientExceptionItems.filter(
        (item) => item.role === "admin" && item.status === "pending" && item.source_type === "patient_exception"
      );
      const exceptionScheduleIds = new Set(
        pendingPatientExceptionItems
          .map((item) => item.linked_visit_schedule_id)
          .filter((scheduleId): scheduleId is string => Boolean(scheduleId))
      );
      const exceptionSchedulesByStatus = dailyRouteSchedules.filter(
        (schedule) =>
          ["paused", "issue_pending", "followup_pending", "rescheduled", "cancelled"].includes(schedule.status) ||
          exceptionScheduleIds.has(schedule.id)
      );
      const dailyRouteScheduleIds = new Set(dailyRouteSchedules.map((schedule) => schedule.id));
      const exceptionSchedulesFromNotifications = pendingPatientExceptionItems
        .map((item) =>
          item.linked_visit_schedule_id
            ? db.visit_schedules.find((schedule) => schedule.id === item.linked_visit_schedule_id)
            : undefined
        )
        .filter(
          (schedule): schedule is AppDb["visit_schedules"][number] =>
            schedule !== undefined && dailyRouteScheduleIds.has(schedule.id)
        );
      const exceptionSchedules = [
        ...exceptionSchedulesByStatus,
        ...exceptionSchedulesFromNotifications.filter(
          (schedule) => !exceptionSchedulesByStatus.some((item) => item.id === schedule.id)
        )
      ];
      const currentMonthRange = buildMonthRange(referenceDate, 0);
      const currentMonthRoutePlans = completedRoutePlans.filter((routePlan) => {
        const routeDate = new Date(`${routePlan.route_date}T00:00:00`);
        return routeDate >= currentMonthRange.start && routeDate < currentMonthRange.end;
      });
      const previousMonthRange = buildMonthRange(referenceDate, -1);
      const previousMonthRoutePlans = completedRoutePlans.filter((routePlan) => {
        const routeDate = new Date(`${routePlan.route_date}T00:00:00`);
        return routeDate >= previousMonthRange.start && routeDate < previousMonthRange.end;
      });

      return {
        referenceDate,
        daily: {
          ...buildRoutePlanStats(db, dailyRoutePlans, patientExceptionItems, referenceDate),
          date: referenceDate
        },
        currentMonth: buildRoutePlanStats(
          db,
          currentMonthRoutePlans,
          patientExceptionItems,
          currentMonthRange.label
        ),
        previousMonth: buildRoutePlanStats(
          db,
          previousMonthRoutePlans,
          patientExceptionItems,
          previousMonthRange.label
        ),
        draftRouteCount: draftRoutePlans.length,
        unrecordedCount: dailyRouteSchedules.filter(
          (schedule) =>
            schedule.status === "completed" &&
            !db.visit_records.some((record) => record.visit_schedule_id === schedule.id)
        ).length,
        rescheduleCount: pendingRescheduleActions.length,
        pendingLeaveRequests,
        pendingRescheduleActions,
        draftRoutePlans,
        exceptionSchedules
      };
    },
    getLeaveRequests() {
      return [...getDb().leave_requests];
    },
    getRescheduleActions() {
      return [...getDb().reschedule_actions];
    },
    createLeaveRequest(input) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextLeaveRequest = {
          id: `leave-${Date.now()}`,
          doctor_id: input.doctorId,
          start_date: input.startDate,
          end_date: input.endDate,
          reason: input.reason,
          status: input.status ?? "pending",
          handoff_note: input.handoffNote,
          rejection_reason: null,
          created_at: now,
          updated_at: now
        } as const;
        return {
          ...db,
          leave_requests: [nextLeaveRequest, ...db.leave_requests],
          notification_center_items: upsertNotificationCenterItem(
            db,
            buildNotificationCenterItemFromLeaveRequest(
              {
                ...db,
                leave_requests: [nextLeaveRequest, ...db.leave_requests]
              },
              nextLeaveRequest
            )
          )
        };
      });
    },
    updateLeaveRequestStatus(leaveRequestId, status, options) {
      updateDb((db) => {
        const now = new Date().toISOString();
        const nextLeaveRequests = db.leave_requests.map((leaveRequest) =>
          leaveRequest.id === leaveRequestId
            ? {
                ...leaveRequest,
                status,
                rejection_reason:
                  status === "rejected"
                    ? options?.rejectionReason?.trim() || null
                    : null,
                updated_at: now
              }
            : leaveRequest
        );
        const targetLeaveRequest = nextLeaveRequests.find((leaveRequest) => leaveRequest.id === leaveRequestId);

        return {
          ...db,
          leave_requests: nextLeaveRequests,
          notification_center_items: targetLeaveRequest
            ? upsertNotificationCenterItem(
                {
                  ...db,
                  leave_requests: nextLeaveRequests
                },
                {
                  ...buildNotificationCenterItemFromLeaveRequest(
                    {
                      ...db,
                      leave_requests: nextLeaveRequests
                    },
                    targetLeaveRequest
                  ),
                  is_unread: false,
                  updated_at: now
                }
              )
            : db.notification_center_items
          };
      });
    },
    deleteLeaveRequest(leaveRequestId) {
      updateDb((db) => ({
        ...db,
        leave_requests: db.leave_requests.filter((leaveRequest) => leaveRequest.id !== leaveRequestId),
        notification_center_items: db.notification_center_items.filter(
          (item) =>
            item.linked_leave_request_id !== leaveRequestId &&
            item.id !== `nc-leave-${leaveRequestId}`
        )
      }));
    },
    getImpactedSchedules(doctorId, startDate, endDate) {
      return getImpactedSchedules(doctorId, startDate, endDate);
    }
  };
}
