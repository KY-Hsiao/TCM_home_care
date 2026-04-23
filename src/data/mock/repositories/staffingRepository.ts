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
      const todayScheduleIds = new Set(todaySchedules.map((schedule) => schedule.id));
      const delayedCount = todaySchedules.filter((schedule) => {
        const record = db.visit_records.find(
          (item) => item.visit_schedule_id === schedule.id
        );
        if (!record?.departure_time) {
          return false;
        }
        return new Date(record.departure_time) > new Date(schedule.scheduled_start_at);
      }).length;

      return {
        todayVisitTotal: todaySchedules.length,
        pendingSchedulingCount: db.patients.filter(
          (patient) =>
            patient.status !== "closed" &&
            !db.visit_schedules.some(
              (schedule) =>
                schedule.patient_id === patient.id &&
                new Date(schedule.scheduled_start_at) >= new Date()
            )
        ).length,
        pendingNotificationCount: db.notification_tasks.filter(
          (task) => task.status === "pending"
        ).length,
        doctorTaskCount: db.notification_tasks.filter(
          (task) => task.recipient_role === "doctor" && task.status !== "closed"
        ).length,
        caregiverTaskCount: db.notification_tasks.filter(
          (task) => task.recipient_role === "caregiver" && task.status !== "closed"
        ).length,
        leaveAffectedCount: db.leave_requests.reduce((count, leave) => {
          if (leave.status === "rejected") {
            return count;
          }
          return count + getImpactedSchedules(leave.doctor_id, leave.start_date, leave.end_date).length;
        }, 0),
        arrivedCount: todaySchedules.filter((schedule) => schedule.status === "arrived").length,
        inTreatmentCount: todaySchedules.filter((schedule) => schedule.status === "in_treatment").length,
        completedCount: todaySchedules.filter((schedule) => schedule.status === "completed").length,
        trackingCount: todaySchedules.filter((schedule) =>
          ["tracking", "on_the_way"].includes(schedule.status)
        ).length,
        proximityPendingCount: todaySchedules.filter((schedule) => schedule.status === "proximity_pending").length,
        followupPendingCount: todaySchedules.filter((schedule) => schedule.status === "followup_pending").length,
        urgentCount: todaySchedules.filter((schedule) => schedule.last_feedback_code === "urgent").length,
        delayedCount,
        unrecordedCount: todaySchedules.filter(
          (schedule) =>
            schedule.status === "completed" &&
            !db.visit_records.some((record) => record.visit_schedule_id === schedule.id)
        ).length,
        totalPatients: db.patients.length,
        rescheduleCount: db.reschedule_actions.filter((item) =>
          ["pending", "draft"].includes(item.status)
        ).length,
        leaveRequests: db.leave_requests,
        exceptionSchedules: db.visit_schedules.filter((schedule) =>
          todayScheduleIds.has(schedule.id) &&
          [
            "rescheduled",
            "cancelled",
            "preparing",
            "on_the_way",
            "tracking",
            "proximity_pending",
            "followup_pending",
            "issue_pending"
          ].includes(schedule.status)
        )
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
