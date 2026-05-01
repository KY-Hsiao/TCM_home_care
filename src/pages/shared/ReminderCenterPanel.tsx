import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { NotificationCenterItem } from "../../domain/models";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";

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

function confirmNotificationDeletion(message: string) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  try {
    return window.confirm(message);
  } catch {
    return true;
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
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [replyingItemId, setReplyingItemId] = useState<string | null>(null);

  const items = useMemo(
    () => repositories.notificationRepository.getNotificationCenterItems(role, ownerId),
    [ownerId, repositories, role]
  );
  const unreadCount = useMemo(
    () => items.filter((item) => item.is_unread && item.role === role).length,
    [items, role]
  );

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
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const replyingCard = useMemo(
    () => cards.find(({ item }) => item.id === replyingItemId) ?? null,
    [cards, replyingItemId]
  );

  useEffect(() => {
    const availableItemIds = new Set(items.map((item) => item.id));
    setSelectedItemIds((current) => current.filter((itemId) => availableItemIds.has(itemId)));
    setExpandedItemId((current) => (current && availableItemIds.has(current) ? current : null));
    setReplyingItemId((current) => (current && availableItemIds.has(current) ? current : null));
  }, [items]);

  const toggleItemSelection = (itemId: string, checked: boolean) => {
    setSelectedItemIds((current) =>
      checked ? [...current.filter((id) => id !== itemId), itemId] : current.filter((id) => id !== itemId)
    );
  };

  const toggleSelectionMode = () => {
    setIsSelectionMode((current) => {
      if (current) {
        setSelectedItemIds([]);
      }
      return !current;
    });
  };

  const selectAllItems = () => {
    setSelectedItemIds(items.map((item) => item.id));
  };

  const invertItemSelection = () => {
    const currentSelection = new Set(selectedItemIds);
    setSelectedItemIds(
      items.filter((item) => !currentSelection.has(item.id)).map((item) => item.id)
    );
  };

  const deleteSelectedItems = () => {
    if (!selectedItemIds.length) {
      return;
    }
    const shouldDelete = confirmNotificationDeletion(
      `確定要刪除已選取的 ${selectedItemIds.length} 筆通知嗎？`
    );
    if (!shouldDelete) {
      return;
    }
    repositories.notificationRepository.deleteNotificationCenterItems(selectedItemIds);
    setSelectedItemIds([]);
    setIsSelectionMode(false);
  };

  const toggleItemExpanded = (item: NotificationCenterItem) => {
    const isExpanded = expandedItemId === item.id;
    setExpandedItemId(isExpanded ? null : item.id);
    setReplyingItemId((current) => (current === item.id || isExpanded ? null : current));
    if (!isExpanded && item.is_unread) {
      repositories.notificationRepository.markNotificationCenterItemRead(item.id);
    }
  };

  const handleReplySaved = (itemId: string) => {
    repositories.notificationRepository.replyNotificationCenterItem(
      itemId,
      replyDrafts[itemId] ?? "",
      role,
      ownerId
    );
    setReplyingItemId(null);
  };

  const handleItemClosed = (itemId: string) => {
    repositories.notificationRepository.updateNotificationCenterItemStatus(itemId, "closed");
    setReplyingItemId(null);
  };

  return (
    <>
    <Panel title={title} className="p-3 lg:p-4">
      <div className="space-y-3">
        <p className="card-clamp-2 text-xs leading-5 text-slate-600">
          這裡整合站內通知、提醒、個案異常與請假待辦；若有綁定個案，可直接在卡片內回覆與完成追蹤。
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-brand-ink">目前共有 {items.length} 筆通知</span>
            {unreadCount > 0 ? <span className="text-xs text-slate-500">未讀 {unreadCount} 筆</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleSelectionMode}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
            >
              {isSelectionMode ? "取消選擇通知" : "選擇通知"}
            </button>
            {isSelectionMode ? (
              <>
                <button
                  type="button"
                  onClick={selectAllItems}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
                >
                  全選
                </button>
                <button
                  type="button"
                  onClick={invertItemSelection}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
                >
                  反全選
                </button>
              </>
            ) : null}
            {isSelectionMode && selectedItemIds.length ? (
              <button
                type="button"
                onClick={deleteSelectedItems}
                className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-600"
              >
                刪除已選 {selectedItemIds.length} 筆通知
              </button>
            ) : null}
          </div>
        </div>
        <div className="rounded-[1.4rem] border border-dashed border-slate-200 bg-white px-4 py-2 text-[11px] leading-5 text-slate-500">
          先按「選擇通知」才會進入勾選模式；雙擊通知標題可打開內容，按「回覆通知」後
          {role === "doctor" ? "會開啟回覆視窗。" : "才會展開繕打區。"}
        </div>

        <div className="space-y-3">
          {cards.length ? (
            cards.map(({ item, detail, linkedPatient, linkedDoctor, linkedLeaveRequest }) => {
              const isExpanded = expandedItemId === item.id;
              const isReplying = replyingItemId === item.id;

              return (
                <div
                  key={item.id}
                  className={`overflow-hidden rounded-3xl border ${
                    item.is_unread ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3 px-4 py-4 lg:px-5">
                    {isSelectionMode ? (
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={selectedItemIdSet.has(item.id)}
                          onChange={(event) => toggleItemSelection(item.id, event.target.checked)}
                          aria-label={`勾選刪除 ${item.title}`}
                        />
                        選取
                      </label>
                    ) : null}
                    <button
                      type="button"
                      onDoubleClick={() => toggleItemExpanded(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleItemExpanded(item);
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl bg-white/70 px-3 py-3 text-left ring-1 ring-slate-200 transition hover:bg-white"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.status === "closed" ? (
                            <span
                              aria-label="已標記完成"
                              className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
                            >
                              ✓
                            </span>
                          ) : null}
                          <p className="truncate font-semibold text-brand-ink">{item.title}</p>
                          {item.is_unread ? (
                            <span className="rounded-full bg-brand-coral px-2.5 py-1 text-[11px] font-semibold text-white">
                              新訊息
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-600">
                            {resolveSourceLabel(item)}
                          </span>
                          <span className="rounded-full bg-white px-3 py-1 font-semibold text-brand-ink ring-1 ring-slate-200">
                            {resolveStatusLabel(item.status)}
                          </span>
                          <span className="text-slate-500">{formatDateTimeFull(item.updated_at)}</span>
                        </div>
                        {!isExpanded ? (
                          <p className="card-clamp-2 mt-2 text-sm text-slate-500">{item.content}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink">
                        {isExpanded ? "已打開" : "雙擊標題查看"}
                      </span>
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="border-t border-slate-200 bg-white px-4 py-4 lg:px-5">
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{item.content}</p>

                      <div className="mt-3 space-y-1 text-xs text-slate-500">
                        {linkedPatient ? <p>個案：{maskPatientName(linkedPatient.name)}</p> : null}
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

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyDrafts((current) => ({
                              ...current,
                              [item.id]: current[item.id] ?? item.reply_text ?? ""
                            }));
                            setReplyingItemId(item.id);
                          }}
                          className="rounded-full bg-brand-forest px-4 py-2 text-xs font-semibold text-white"
                        >
                          {item.reply_text ? "編輯回覆" : "回覆通知"}
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

                      {isReplying && role === "admin" ? (
                        <>
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
                              onClick={() => handleReplySaved(item.id)}
                              className="rounded-full bg-brand-forest px-4 py-2 text-xs font-semibold text-white"
                            >
                              儲存回覆
                            </button>
                            <button
                              type="button"
                              onClick={() => handleItemClosed(item.id)}
                              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
                            >
                              標記完成
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">{emptyText}</p>
          )}
        </div>
      </div>
    </Panel>
    {role === "doctor" && replyingCard ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="通知回覆視窗"
          className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl lg:rounded-[32px] lg:p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-brand-coral">通知中心</p>
              <h2 className="mt-1 text-xl font-semibold text-brand-ink">回覆通知</h2>
              <p className="mt-2 text-sm text-slate-600">{replyingCard.item.title}</p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingItemId(null)}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
            >
              關閉視窗
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
            {replyingCard.item.content}
          </div>

          <label className="mt-5 block text-sm">
            <span className="mb-1 block font-medium text-brand-ink">回覆內容</span>
            <textarea
              value={replyDrafts[replyingCard.item.id] ?? replyingCard.item.reply_text ?? ""}
              onChange={(event) =>
                setReplyDrafts((current) => ({
                  ...current,
                  [replyingCard.item.id]: event.target.value
                }))
              }
              rows={5}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              placeholder="輸入這筆通知的處理回覆"
            />
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleReplySaved(replyingCard.item.id)}
              className="rounded-full bg-brand-forest px-5 py-3 text-sm font-semibold text-white"
            >
              儲存回覆
            </button>
            <button
              type="button"
              onClick={() => handleItemClosed(replyingCard.item.id)}
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-brand-ink"
            >
              標記完成
            </button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}
