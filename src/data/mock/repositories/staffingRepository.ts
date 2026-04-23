import { isSameDay } from "date-fns";
import type { AppDb } from "../../../domain/models";
import type { StaffingRepository } from "../../../domain/repository";

export function createStaffingRepository(
  getDb: () => AppDb,
  updateDb: (updater: (db: AppDb) => AppDb) => void
): StaffingRepository {
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
      const todaySchedules = db.visit_schedules.filter((schedule) =>
        isSameDay(new Date(schedule.scheduled_start_at), new Date())
      );
      const pendingLeaveRequests = db.leave_requests.filter((leave) => leave.status === "pending");
      const pendingRescheduleActions = db.reschedule_actions.filter((item) =>
        ["pending", "draft"].includes(item.status)
      );
      const draftRoutePlans = db.saved_route_plans.filter(
        (routePlan) => routePlan.execution_status === "draft"
      );
      const exceptionSchedules = todaySchedules.filter((schedule) =>
        ["paused", "issue_pending", "followup_pending", "rescheduled", "cancelled"].includes(
          schedule.status
        )
      );

      return {
        todayVisitTotal: todaySchedules.length,
        draftRouteCount: draftRoutePlans.length,
        trackingCount: todaySchedules.filter((schedule) =>
          ["tracking", "on_the_way"].includes(schedule.status)
        ).length,
        pausedCount: todaySchedules.filter((schedule) => schedule.status === "paused").length,
        urgentCount: todaySchedules.filter((schedule) => schedule.last_feedback_code === "urgent").length,
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
        return {
          ...db,
          leave_requests: [
            {
              id: `leave-${Date.now()}`,
              doctor_id: input.doctorId,
              start_date: input.startDate,
              end_date: input.endDate,
              reason: input.reason,
              status: input.status ?? "pending",
              handoff_note: input.handoffNote,
              created_at: now,
              updated_at: now
            },
            ...db.leave_requests
          ]
        };
      });
    },
    getImpactedSchedules(doctorId, startDate, endDate) {
      return getImpactedSchedules(doctorId, startDate, endDate);
    }
  };
}
