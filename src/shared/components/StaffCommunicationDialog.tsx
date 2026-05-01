import { useEffect, useMemo, useRef, useState } from "react";
import { channelLabel, formatDateTimeFull, statusTone } from "../utils/format";
import type { TeamCommunicationMessage } from "../../services/team-communication/types";

type StaffCommunicationDialogProps = {
  counterpartLabel: string;
  currentUserLabel: string;
  contextLabel: string;
  doctorId: string;
  adminUserId: string;
  logs: TeamCommunicationMessage[];
  unreadConversationCount?: number;
  syncError?: string | null;
  lastSyncedAt?: string | null;
  onConversationViewed?: () => void;
  onCreateLog: (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => Promise<void> | void;
  onClose: () => void;
};

type StaffCommunicationPanelProps = {
  counterpartLabel: string;
  currentUserLabel: string;
  contextLabel: string;
  doctorId: string;
  adminUserId: string;
  logs: TeamCommunicationMessage[];
  unreadConversationCount?: number;
  syncError?: string | null;
  lastSyncedAt?: string | null;
  onConversationViewed?: () => void;
  onCreateLog: (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => Promise<void> | void;
  onClose?: () => void;
};

function resolveLogDirection(log: TeamCommunicationMessage, currentUserLabel: string) {
  if (log.sender_role) {
    return log.outcome.startsWith(`${currentUserLabel} `) || log.sender_role === "admin" && currentUserLabel === "行政人員"
      ? "outgoing"
      : "incoming";
  }
  return log.outcome.startsWith(`${currentUserLabel} `) ? "outgoing" : "incoming";
}

export function StaffCommunicationPanel({
  counterpartLabel,
  currentUserLabel,
  contextLabel,
  doctorId,
  adminUserId,
  logs,
  unreadConversationCount = 0,
  syncError,
  lastSyncedAt,
  onConversationViewed,
  onClose,
  onCreateLog
}: StaffCommunicationPanelProps) {
  const [draftMessage, setDraftMessage] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const openedConversationKeyRef = useRef<string | null>(null);
  const displayLogs = useMemo(() => [...logs].slice(0, 30).reverse(), [logs]);

  useEffect(() => {
    if (typeof conversationBottomRef.current?.scrollIntoView === "function") {
      conversationBottomRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end"
      });
    }
  }, [displayLogs]);

  useEffect(() => {
    const conversationKey = `${doctorId}:${adminUserId}`;
    if (openedConversationKeyRef.current === conversationKey) {
      return;
    }
    openedConversationKeyRef.current = conversationKey;
    onConversationViewed?.();
  }, [adminUserId, doctorId, onConversationViewed]);

  useEffect(() => {
    if (unreadConversationCount > 0) {
      onConversationViewed?.();
    }
  }, [onConversationViewed, unreadConversationCount]);

  const handleSendMessage = async () => {
    const trimmedMessage = draftMessage.trim();
    if (!trimmedMessage) {
      setFeedback("請先輸入要傳給對方的內容。");
      return;
    }

    try {
      await onCreateLog({
        channel: "web_notice",
        subject: `院內對話｜${contextLabel}`,
        content: trimmedMessage,
        outcome: `${currentUserLabel} 已送出站內訊息，等待 ${counterpartLabel} 查看。`
      });
      setDraftMessage("");
      setFeedback("站內訊息已送出，已同步寫入聯絡紀錄。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "站內訊息送出失敗，請稍後再試。");
    }
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.25rem] bg-[#f4f7f1] shadow-2xl lg:rounded-[1.75rem]">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="absolute right-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-xl font-semibold text-slate-600 shadow ring-1 ring-slate-200"
        >
          ×
        </button>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#eef6ef_0%,#f8faf8_100%)] px-3 py-2.5 sm:px-4 sm:py-3">
        {syncError ? (
          <div className="mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {syncError}
          </div>
        ) : null}
        {lastSyncedAt ? (
          <div className="mb-2 break-words text-right text-xs text-slate-500">
            最後同步：{formatDateTimeFull(lastSyncedAt)}
          </div>
        ) : null}
        {displayLogs.length ? (
          <div className="space-y-3">
            {displayLogs.map((log) => {
              const isOutgoing = resolveLogDirection(log, currentUserLabel) === "outgoing";
              return (
                <div
                  key={log.id}
                  className={`flex ${isOutgoing ? "justify-end" : "justify-start"}`}
                >
                  <div className={`flex max-w-[94%] min-w-0 flex-col gap-1 sm:max-w-[88%] ${isOutgoing ? "items-end" : "items-start"}`}>
                    <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${statusTone(log.channel)}`}>
                        {channelLabel(log.channel)}
                      </span>
                      <span>{isOutgoing ? currentUserLabel : counterpartLabel}</span>
                      <span>{formatDateTimeFull(log.contacted_at)}</span>
                    </div>
                    <div
                      className={`rounded-[1.15rem] px-3.5 py-2.5 text-sm shadow-sm ${
                        isOutgoing
                          ? "rounded-br-md bg-brand-forest text-white"
                          : "rounded-bl-md border border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <p className={`break-words text-xs font-semibold ${isOutgoing ? "text-white/80" : "text-slate-500"}`}>
                        {log.subject}
                      </p>
                      <p className="mt-1 break-words whitespace-pre-wrap leading-6">{log.content}</p>
                      <p className={`mt-2 break-words text-[11px] ${isOutgoing ? "text-white/75" : "text-slate-400"}`}>
                        {log.outcome}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={conversationBottomRef} />
          </div>
        ) : (
          <div className="flex h-full min-h-[220px] items-center justify-center sm:min-h-[260px]">
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white/85 px-5 py-6 text-center text-sm text-slate-500">
              目前還沒有院內對話紀錄，請直接從下方開始發送訊息。
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-4 sm:py-3">
        {feedback ? (
          <div
            role="status"
            className={`mb-2 rounded-2xl px-3 py-2 text-sm ${
              feedback.includes("已")
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {feedback}
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-brand-ink">訊息內容</span>
            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-slate-200 px-3 py-2.5"
              placeholder={`直接輸入要傳給 ${counterpartLabel} 的交辦、回報或追蹤內容`}
            />
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSendMessage}
              className="w-full rounded-full bg-brand-forest px-5 py-3 text-sm font-semibold text-white sm:w-auto"
            >
              送出站內訊息
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StaffCommunicationDialog(props: StaffCommunicationDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="團隊通訊全頁視窗"
      className="fixed inset-0 z-50 bg-slate-950/45 p-2 sm:p-3"
    >
      <div className="h-[calc(100dvh-1rem)] w-full sm:h-[calc(100dvh-1.5rem)]">
        <StaffCommunicationPanel {...props} />
      </div>
    </div>
  );
}
