import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { Badge } from "../../shared/ui/Badge";
import { formatDateTimeFull } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";

function todayInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-brand-ink">{value}</p>
    </div>
  );
}

function SectionCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-brand-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AdminDashboardPage() {
  const { repositories, db } = useAppContext();
  const [dashboardDate, setDashboardDate] = useState(() => todayInputValue());
  const dashboard = repositories.staffingRepository.getAdminDashboard({ referenceDate: dashboardDate });

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-brand-ink">行政總覽</h1>
          <label className="text-sm font-medium text-slate-600">
            日期
            <input
              type="date"
              value={dashboardDate}
              onChange={(event) => setDashboardDate(event.target.value || todayInputValue())}
              className="ml-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm"
            />
          </label>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-9">
          <MetricCard label="今日執行" value={dashboard.daily.executedVisitCount} />
          <MetricCard label="今日暫停" value={dashboard.daily.pausedCount} />
          <MetricCard label="今日緊急" value={dashboard.daily.urgentCount} />
          <MetricCard label="本月執行" value={dashboard.currentMonth.executedVisitCount} />
          <MetricCard label="本月暫停" value={dashboard.currentMonth.pausedCount} />
          <MetricCard label="本月緊急" value={dashboard.currentMonth.urgentCount} />
          <MetricCard label="待審請假" value={dashboard.pendingLeaveRequests.length} />
          <MetricCard label="待重排" value={dashboard.rescheduleCount} />
          <MetricCard label="待補紀錄" value={dashboard.unrecordedCount} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="異常案件"
          action={<Link to="/admin/patients" className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest">個案管理</Link>}
        >
          <div className="space-y-3">
            {dashboard.exceptionSchedules.slice(0, 5).map((schedule) => {
              const patient = db.patients.find((item) => item.id === schedule.patient_id);
              return (
                <Link key={schedule.id} to={`/admin/patients/${schedule.patient_id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{patient ? maskPatientName(patient.name) : schedule.patient_id}</p>
                    <Badge value={schedule.status} compact />
                  </div>
                  <p className="mt-2 text-slate-600">{formatDateTimeFull(schedule.scheduled_start_at)}</p>
                </Link>
              );
            })}
            {dashboard.exceptionSchedules.length === 0 ? <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">無異常案件</p> : null}
          </div>
        </SectionCard>

        <SectionCard
          title="待辦"
          action={<Link to="/admin/reminders" className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest">通知中心</Link>}
        >
          <div className="space-y-3">
            {dashboard.pendingLeaveRequests.slice(0, 3).map((leave) => {
              const doctor = db.doctors.find((item) => item.id === leave.doctor_id);
              return (
                <div key={leave.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{doctor?.name ?? leave.doctor_id}</p>
                    <Badge value={leave.status} compact />
                  </div>
                  <p className="mt-2 text-slate-600">{leave.start_date} ~ {leave.end_date}</p>
                </div>
              );
            })}
            {dashboard.pendingRescheduleActions.slice(0, 3).map((action) => {
              const schedule = db.visit_schedules.find((item) => item.id === action.visit_schedule_id);
              const patient = schedule ? db.patients.find((item) => item.id === schedule.patient_id) : undefined;
              return (
                <div key={action.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{patient ? maskPatientName(patient.name) : action.visit_schedule_id}</p>
                    <Badge value={action.status} compact />
                  </div>
                  <p className="mt-2 text-slate-600">{formatDateTimeFull(action.new_start_at)}</p>
                </div>
              );
            })}
            {dashboard.pendingLeaveRequests.length === 0 && dashboard.pendingRescheduleActions.length === 0 ? <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">無待辦</p> : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
