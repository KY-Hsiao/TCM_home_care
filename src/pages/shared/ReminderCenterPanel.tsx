import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { UserRole } from "../../domain/enums";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull } from "../../shared/utils/format";

type ReminderCenterPanelProps = {
  role: "doctor" | "admin";
  ownerId?: string;
  title?: string;
  detailBasePath: "/doctor/patients" | "/admin/patients";
  emptyText?: string;
};

export function ReminderCenterPanel({
  role,
  ownerId,
  title = "提醒中心",
  detailBasePath,
  emptyText = "目前沒有待處理提醒。"
}: ReminderCenterPanelProps) {
  const { repositories } = useAppContext();

  const reminderCards = useMemo(
    () =>
      repositories.visitRepository
        .getReminders(role, ownerId)
        .filter((reminder) => reminder.status === "pending")
        .map((reminder) => {
          const detail = reminder.related_visit_schedule_id
            ? repositories.visitRepository.getScheduleDetail(reminder.related_visit_schedule_id)
            : undefined;
          return {
            reminder,
            detail
          };
        }),
    [ownerId, repositories, role]
  );

  return (
    <Panel title={title}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          這裡會同步顯示醫師與行政共用的提醒內容；若有綁定案件，兩端看到的主題與內容會一致。
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {reminderCards.length > 0 ? (
            reminderCards.map(({ reminder, detail }) => (
              <div key={reminder.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{reminder.title}</p>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                    {reminder.role === "doctor" ? "醫師同步" : "行政同步"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">{reminder.detail}</p>
                {detail ? (
                  <div className="mt-3 space-y-1 text-xs text-slate-500">
                    <p>個案：{detail.patient.name}</p>
                    <p>醫師：{detail.doctor.name}</p>
                    <p>排程：{formatDateTimeFull(detail.schedule.scheduled_start_at)}</p>
                  </div>
                ) : null}
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">
                    到期：{formatDateTimeFull(reminder.due_at)}
                  </span>
                  {detail ? (
                    <Link
                      to={`${detailBasePath}/${detail.patient.id}`}
                      className="rounded-full bg-brand-sand px-3 py-2 text-xs font-semibold text-brand-forest"
                    >
                      查看個案
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">{emptyText}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
