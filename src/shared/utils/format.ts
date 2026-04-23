import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import type { ContactChannel } from "../../domain/enums";

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "尚未記錄";
  }
  return format(new Date(value), "MM/dd HH:mm", { locale: zhTW });
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) {
    return "未設定";
  }
  return format(new Date(value), "yyyy/MM/dd", { locale: zhTW });
}

export function formatRocCompactDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const rocYear = date.getFullYear() - 1911;
  return `${String(rocYear).padStart(3, "0")}${format(date, "MMdd", { locale: zhTW })}`;
}

export function formatTimeOnly(value: string | null | undefined): string {
  if (!value) {
    return "尚未記錄";
  }
  return format(new Date(value), "HH:mm", { locale: zhTW });
}

export function formatDateTimeFull(value: string | null | undefined): string {
  if (!value) {
    return "尚未記錄";
  }
  return format(new Date(value), "yyyy/MM/dd HH:mm", { locale: zhTW });
}

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "待定位";
  }
  return `${value} 分鐘`;
}

export function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return format(new Date(value), "yyyy-MM-dd'T'HH:mm");
}

export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: "已排程",
    waiting_departure: "待出發確認",
    preparing: "準備中",
    on_the_way: "前往中",
    tracking: "追蹤中",
    proximity_pending: "逼近終點待確認",
    arrived: "已抵達",
    in_treatment: "治療中",
    paused: "暫停",
    followup_pending: "已離開待後續追蹤",
    issue_pending: "異常處理中",
    completed: "已完成",
    rescheduled: "已改期",
    cancelled: "已取消",
    pending: "待處理",
    sent: "已送出",
    failed: "失敗",
    awaiting_reply: "待回覆",
    replied: "已回覆",
    closed: "已結案",
    active: "服務中",
    rejected: "已駁回",
    approved: "已核准",
    off_duty: "離線中",
    done: "已完成",
    dismissed: "已忽略",
    phone: "電話",
    google_chat: "站內通知",
    web_notice: "站內通知",
    sms: "簡訊",
    in_person: "現場",
    idle: "待追蹤",
    inside_candidate: "抵達判定中",
    outside_candidate: "離開判定中",
    coordinate_missing: "座標缺失",
    permission_denied: "權限未開啟",
    low_accuracy: "定位精度不足",
    signal_lost: "定位中斷"
  };
  return labels[status] ?? status;
}

export function channelLabel(channel: ContactChannel): string {
  return {
    phone: "電話",
    google_chat: "站內通知",
    web_notice: "站內通知",
    sms: "簡訊",
    in_person: "現場"
  }[channel];
}

export function statusTone(status: string): string {
  const palette: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-800",
    closed: "bg-emerald-100 text-emerald-800",
    done: "bg-emerald-100 text-emerald-800",
    in_treatment: "bg-amber-100 text-amber-800",
    arrived: "bg-amber-100 text-amber-800",
    on_the_way: "bg-sky-100 text-sky-800",
    scheduled: "bg-slate-100 text-slate-700",
    waiting_departure: "bg-indigo-100 text-indigo-700",
    preparing: "bg-violet-100 text-violet-700",
    rescheduled: "bg-orange-100 text-orange-800",
    cancelled: "bg-rose-100 text-rose-800",
    paused: "bg-stone-200 text-stone-700",
    tracking: "bg-sky-100 text-sky-800",
    proximity_pending: "bg-fuchsia-100 text-fuchsia-800",
    followup_pending: "bg-amber-100 text-amber-800",
    issue_pending: "bg-rose-100 text-rose-800",
    pending: "bg-yellow-100 text-yellow-800",
    awaiting_reply: "bg-cyan-100 text-cyan-800",
    replied: "bg-lime-100 text-lime-800",
    failed: "bg-rose-100 text-rose-800",
    active: "bg-emerald-100 text-emerald-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-rose-100 text-rose-800",
    off_duty: "bg-stone-200 text-stone-700",
    dismissed: "bg-stone-200 text-stone-700",
    phone: "bg-slate-100 text-slate-700",
    google_chat: "bg-emerald-100 text-emerald-800",
    web_notice: "bg-emerald-100 text-emerald-800",
    sms: "bg-sky-100 text-sky-800",
    in_person: "bg-stone-200 text-stone-700",
    idle: "bg-slate-100 text-slate-700",
    inside_candidate: "bg-amber-100 text-amber-800",
    outside_candidate: "bg-orange-100 text-orange-800",
    coordinate_missing: "bg-stone-200 text-stone-700",
    permission_denied: "bg-rose-100 text-rose-800",
    low_accuracy: "bg-yellow-100 text-yellow-800",
    signal_lost: "bg-rose-100 text-rose-800"
  };
  return palette[status] ?? "bg-slate-100 text-slate-700";
}
