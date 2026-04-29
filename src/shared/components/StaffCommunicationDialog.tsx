import { useState } from "react";
import type { ContactLog } from "../../domain/models";
import { channelLabel, formatDateTimeFull, statusTone } from "../utils/format";

type StaffCommunicationDialogProps = {
  title: string;
  counterpartLabel: string;
  counterpartPhone: string;
  currentUserLabel: string;
  contextLabel: string;
  doctorId: string;
  adminUserId: string;
  patientId: string | null;
  visitScheduleId: string | null;
  logs: ContactLog[];
  onClose: () => void;
  onCreateLog: (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => void;
};

function openPhoneDialer(phone: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.location.href = `tel:${phone}`;
}

export function StaffCommunicationDialog({
  title,
  counterpartLabel,
  counterpartPhone,
  currentUserLabel,
  contextLabel,
  patientId,
  visitScheduleId,
  logs,
  onClose,
  onCreateLog
}: StaffCommunicationDialogProps) {
  const [activeTab, setActiveTab] = useState<"text" | "call">("text");
  const [draftMessage, setDraftMessage] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSendMessage = () => {
    const trimmedMessage = draftMessage.trim();
    if (!trimmedMessage) {
      setFeedback("請先輸入要傳給對方的內容。");
      return;
    }

    onCreateLog({
      channel: "web_notice",
      subject: `院內對話｜${contextLabel}`,
      content: trimmedMessage,
      outcome: `${currentUserLabel} 已送出站內訊息，等待 ${counterpartLabel} 查看。`
    });
    setDraftMessage("");
    setFeedback("站內訊息已送出，已同步寫入聯絡紀錄。");
  };

  const handleStartCall = () => {
    onCreateLog({
      channel: "phone",
      subject: `語音通話｜${contextLabel}`,
      content: `${currentUserLabel} 發起與 ${counterpartLabel} 的語音通話。`,
      outcome: counterpartPhone
        ? `已記錄撥號：${counterpartPhone}`
        : `已記錄準備聯絡 ${counterpartLabel}。`
    });
    setFeedback("已建立語音通話紀錄。");
    if (counterpartPhone) {
      openPhoneDialer(counterpartPhone);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="w-full max-w-3xl rounded-[32px] bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-brand-coral">院內聯絡</p>
            <h2 className="mt-1 text-2xl font-semibold text-brand-ink">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
          >
            關閉
          </button>
        </div>

        <div className="mt-5 grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-2">
          <p>對話對象：{counterpartLabel}</p>
          <p>聯絡電話：{counterpartPhone || "未設定"}</p>
          <p>當前發話者：{currentUserLabel}</p>
          <p>對應案件：{contextLabel}</p>
          <p>綁定個案：{patientId ?? "未指定"}</p>
          <p>綁定排程：{visitScheduleId ?? "未指定"}</p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("text")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              activeTab === "text"
                ? "bg-brand-forest text-white"
                : "bg-white text-brand-ink ring-1 ring-slate-200"
            }`}
          >
            打字訊息
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("call")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              activeTab === "call"
                ? "bg-brand-coral text-white"
                : "bg-white text-brand-ink ring-1 ring-slate-200"
            }`}
          >
            語音通話
          </button>
        </div>

        {activeTab === "text" ? (
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">訊息內容</span>
              <textarea
                value={draftMessage}
                onChange={(event) => setDraftMessage(event.target.value)}
                rows={5}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                placeholder={`直接輸入要傳給 ${counterpartLabel} 的交辦、回報或追蹤內容`}
              />
            </label>
            <button
              type="button"
              onClick={handleSendMessage}
              className="rounded-full bg-brand-forest px-5 py-3 text-sm font-semibold text-white"
            >
              送出站內訊息
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-brand-ink">語音通話</p>
            <p className="mt-2">
              若目前在手機網頁操作，按下後會直接撥號；若在桌機操作，系統仍會先建立院內通話紀錄。
            </p>
            <button
              type="button"
              onClick={handleStartCall}
              className="mt-4 rounded-full bg-brand-coral px-5 py-3 text-sm font-semibold text-white"
            >
              撥打 {counterpartPhone || counterpartLabel}
            </button>
          </div>
        )}

        {feedback ? (
          <div
            role="status"
            className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
              feedback.includes("已")
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {feedback}
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-brand-ink">最近院內聯絡紀錄</p>
            <p className="text-xs text-slate-500">顯示最近 6 筆</p>
          </div>
          <div className="mt-3 space-y-3">
            {logs.slice(0, 6).map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(log.channel)}`}>
                      {channelLabel(log.channel)}
                    </span>
                    <p className="font-semibold text-brand-ink">{log.subject}</p>
                  </div>
                  <p className="text-xs text-slate-500">{formatDateTimeFull(log.contacted_at)}</p>
                </div>
                <p className="mt-2 text-slate-600">{log.content}</p>
                <p className="mt-1 text-xs text-slate-500">{log.outcome}</p>
              </div>
            ))}
            {logs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                目前還沒有院內對話紀錄。
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
