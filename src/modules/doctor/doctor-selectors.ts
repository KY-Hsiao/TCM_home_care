import { isSameDay } from "date-fns";
import type { DoctorDashboard } from "../../domain/repository";

export function summarizeDoctorDashboard(dashboard: DoctorDashboard) {
  const upcomingToday = dashboard.todaySchedules.filter(
    (schedule) =>
      !["completed", "cancelled"].includes(schedule.status) &&
      isSameDay(new Date(schedule.scheduled_start_at), new Date())
  );

  return {
    scheduleCount: dashboard.todaySchedules.length,
    activeCount: dashboard.activeSchedules.length,
    upcomingCount: upcomingToday.length,
    reminderCount: dashboard.reminders.length
  };
}
