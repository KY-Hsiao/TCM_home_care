import { isSameDay } from "date-fns";
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
  const executedStatuses = [
    "on_the_way",
    "tracking",
    "proximity_pending",
    "arrived",
    "in_treatment",
    "completed",
    "followup_pending",
    "issue_pending"
  ];
  const trackingStatuses = ["on_the_way", "tracking", "proximity_pending", "arrived", "in_treatment"];

  const buildMonthRange = (date = new Date()) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    return {
      start,
      end,
      label: `${start.getFullYear()}年${start.getMonth() + 1}月`
    };
  };

  const resolveDashboardDate = (db: AppDb) => {
    const today = new Date();
    const todaySchedules = db.visit_schedules.filter((schedule) =>
      isSameDay(new Date(schedule.scheduled_start_at), today)
    );
    if (todaySchedules.length) {
      return todaySchedules[0].scheduled_start_at.slice(0, 10);
    }

    const nearestSchedule = [...db.visit_schedules].sort((left, right) => {
      const leftDistance = Math.abs(new Date(left.scheduled_start_at).getTime() - today.getTime());
      const rightDistance = Math.abs(new Date(right.scheduled_start_at).getTime() - today.getTime());
      return leftDistance - rightDistance;
    })[0];

    return nearestSchedule?.scheduled_start_at.slice(0, 10) ?? null;
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

  return {
    getAdminDashboard() {
      const db = getDb();
      const dashboardDate = resolveDashboardDate(db);
      const todaySchedules = dashboardDate
        ? db.visit_schedules.filter((schedule) => schedule.scheduled_start_at.slice(0, 10) === dashboardDate)
        : [];
      const pendingLeaveRequests = db.leave_requests.filter((leave) => leave.status === "pending");
      const pendingRescheduleActions = db.reschedule_actions.filter((item) =>
        ["pending", "draft"].includes(item.status)
      );
      const draftRoutePlans = db.saved_route_plans.filter(
        (routePlan) => routePlan.execution_status === "draft"
      );
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
      const exceptionSchedules = todaySchedules.filter(
        (schedule) =>
          ["paused", "issue_pending", "followup_pending", "rescheduled", "cancelled"].includes(schedule.status) ||
          exceptionScheduleIds.has(schedule.id)
      );
      const urgentScheduleIds = resolveUrgentScheduleIds(todaySchedules, patientExceptionItems);
      const previousMonthRange = buildMonthRange();
      const previousMonthSchedules = db.visit_schedules.filter((schedule) => {
        const scheduleStart = new Date(schedule.scheduled_start_at);
        return scheduleStart >= previousMonthRange.start && scheduleStart < previousMonthRange.end;
      });
      const previousMonthUrgentScheduleIds = resolveUrgentScheduleIds(
        previousMonthSchedules,
        patientExceptionItems
      );

      return {
        todayVisitTotal: todaySchedules.length,
        draftRouteCount: draftRoutePlans.length,
        executedVisitCount: todaySchedules.filter((schedule) => executedStatuses.includes(schedule.status)).length,
        trackingCount: todaySchedules.filter((schedule) => trackingStatuses.includes(schedule.status)).length,
        pausedCount: todaySchedules.filter((schedule) => schedule.status === "paused").length,
        urgentCount: urgentScheduleIds.size,
        previousMonth: {
          label: previousMonthRange.label,
          executedVisitCount: previousMonthSchedules.filter((schedule) => executedStatuses.includes(schedule.status)).length,
          pausedCount: previousMonthSchedules.filter((schedule) => schedule.status === "paused").length,
          urgentCount: previousMonthUrgentScheduleIds.size
        },
        unrecordedCount: todaySchedules.filter(
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
