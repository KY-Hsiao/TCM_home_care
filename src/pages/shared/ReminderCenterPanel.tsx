import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { NotificationCenterItem } from "../../domain/models";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull } from "../../shared/utils/format";

type ReminderCenterPanelProps = {
  role: "doctor" | "admin";
  ownerId?: string;
  title?: string;
  detailBasePath: "/doctor/patients" | "/admin/patients";
  emptyText?: string;
};

function resolveSourceLabel(item: NotificationCenterItem) {
  switch (item.source_type) {
    case "manual_notice":
      return "站內通知";
    case "system_notification":
      return "系統通知";
    case "patient_exception":
      return "個案異常";
    case "leave_request":
      return "請假待辦";
    default:
      return "提醒";
  }
}

function resolveStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "待處理";
    case "replied":
      return "已回覆";
    case "closed":
      return "已完成";
    case "approved":
      return "已核准";
    case "rejected":
      return "已駁回";
    default:
      return status;
  }
}

export function ReminderCenterPanel({
  role,
  ownerId,
  title = "通知中心",
  detailBasePath,
  emptyText = "目前沒有待處理通知。"
}: ReminderCenterPanelProps) {
  const { repositories } = useAppContext();
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const items = useMemo(
    () => repositories.notificationRepository.getNotificationCenterItems(role, ownerId),
    [ownerId, repositories, role]
  );

  useEffect(() => {
    items
      .filter((item) => item.is_unread && item.role === role)
      .forEach((item) => {
        repositories.notificationRepository.markNotificationCenterItemRead(item.id);
      });
  }, [items, repositories, role]);

  const cards = useMemo(
    () =>
      items.map((item) => {
        const detail = item.linked_visit_schedule_id
          ? repositories.visitRepository.getScheduleDetail(item.linked_visit_schedule_id)
          : undefined;
        const linkedPatient = item.linked_patient_id
          ? repositories.patientRepository.getPatientById(item.linked_patient_id)
          : undefined;
        const linkedDoctor = item.linked_doctor_id
          ? repositories.patientRepository.getDoctors().find((doctor) => doctor.id === item.linked_doctor_id)
          : undefined;
        const linkedLeaveRequest = item.linked_leave_request_id
          ? repositories.staffingRepository
              .getLeaveRequests()
              .find((leaveRequest) => leaveRequest.id === item.linked_leave_request_id)
          : undefined;

        return {
          item,
          detail,
          linkedPatient,
          linkedDoctor,
          linkedLeaveRequest
        };
      }),
    [items, repositories]
  );

  return (
    <Panel title={title}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          這裡整合站內通知、提醒、個案異常與請假待辦；若有綁定個案，可直接在卡片內回覆與完成追蹤。
        </p>

        <div className="grid gap-4 xl:grid-cols-2">
          {cards.length ? (
            cards.map(({ item, detail, linkedPatient, linkedDoctor, linkedLeaveRequest }) => (
              <div
                key={item.id}
                className={`rounded-3xl border p-5 ${
                  item.is_unread ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-brand-ink">{item.title}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">
                        {resolveSourceLabel(item)}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 font-semibold text-brand-ink ring-1 ring-slate-200">
                        {resolveStatusLabel(item.status)}
                      </span>
                      {item.is_unread ? (
                        <span className="rounded-full bg-brand-coral px-3 py-1 font-semibold text-white">
                          新訊息
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">{formatDateTimeFull(item.updated_at)}</p>
                </div>

                <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{item.content}</p>

                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  {linkedPatient ? <p>個案：{linkedPatient.name}</p> : null}
                  {linkedDoctor ? <p>醫師：{linkedDoctor.name}</p> : null}
                  {detail ? <p>排程：{formatDateTimeFull(detail.schedule.scheduled_start_at)}</p> : null}
                  {linkedLeaveRequest ? (
                    <p>
                      請假期間：{linkedLeaveRequest.start_date} 至 {linkedLeaveRequest.end_date}
                    </p>
                  ) : null}
                </div>

                {item.reply_text ? (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <p className="font-medium text-brand-ink">目前回覆</p>
                    <p className="mt-1 text-slate-600 whitespace-pre-wrap">{item.reply_text}</p>
                  </div>
                ) : null}

                <label className="mt-4 block text-sm">
                  <span className="mb-1 block font-medium text-brand-ink">回覆內容</span>
                  <textarea
                    value={replyDrafts[item.id] ?? item.reply_text ?? ""}
                    onChange={(event) =>
                      setReplyDrafts((current) => ({
                        ...current,
                        [item.id]: event.target.value
                      }))
                    }
                    rows={3}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    placeholder="輸入這筆通知的處理回覆"
                  />
                </label>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      repositories.notificationRepository.replyNotificationCenterItem(
                        item.id,
                        replyDrafts[item.id] ?? "",
                        role,
                        ownerId
                      )
                    }
                    className="rounded-full bg-brand-forest px-4 py-2 text-xs font-semibold text-white"
                  >
                    儲存回覆
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      repositories.notificationRepository.updateNotificationCenterItemStatus(item.id, "closed")
                    }
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
                  >
                    標記完成
                  </button>
                  {detail ? (
                    <Link
                      to={`${detailBasePath}/${detail.patient.id}`}
                      className="rounded-full bg-brand-sand px-4 py-2 text-xs font-semibold text-brand-forest"
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
