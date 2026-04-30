import { useEffect, useMemo, useRef, useState } from "react";
import { channelLabel, formatDateTimeFull, statusTone } from "../utils/format";
import type { TeamCommunicationMessage } from "../../services/team-communication/types";

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
  logs: TeamCommunicationMessage[];
  unreadConversationCount?: number;
  syncError?: string | null;
  lastSyncedAt?: string | null;
  isRefreshing?: boolean;
  onRefresh?: () => void;
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
  title: string;
  counterpartLabel: string;
  counterpartPhone: string;
  currentUserLabel: string;
  contextLabel: string;
  doctorId: string;
  adminUserId: string;
  patientId: string | null;
  visitScheduleId: string | null;
  logs: TeamCommunicationMessage[];
  unreadConversationCount?: number;
  syncError?: string | null;
  lastSyncedAt?: string | null;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onConversationViewed?: () => void;
  onCreateLog: (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => Promise<void> | void;
  onClose?: () => void;
};

function formatCallDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function resolveLogDirection(log: TeamCommunicationMessage, currentUserLabel: string) {
  if (log.sender_role) {
    return log.outcome.startsWith(`${currentUserLabel} `) || log.sender_role === "admin" && currentUserLabel === "行政人員"
      ? "outgoing"
      : "incoming";
  }
  return log.outcome.startsWith(`${currentUserLabel} `) ? "outgoing" : "incoming";
}

const voiceCallInvitePrefix = "語音通話邀請｜";
const voiceCallAcceptedPrefix = "語音通話已接聽｜";
const voiceCallEndedPrefix = "語音通話已結束｜";

type CallSessionStatus = "idle" | "outgoing_ringing" | "incoming_ringing" | "connected" | "ended";

type CallSession = {
  status: CallSessionStatus;
  inviteLog: TeamCommunicationMessage | null;
  acceptedLog: TeamCommunicationMessage | null;
  endedLog: TeamCommunicationMessage | null;
};

function resolveCallEventType(subject: string) {
  if (subject.startsWith(voiceCallInvitePrefix)) {
    return "invite";
  }
  if (subject.startsWith(voiceCallAcceptedPrefix)) {
    return "accepted";
  }
  if (subject.startsWith(voiceCallEndedPrefix)) {
    return "ended";
  }
  return null;
}

function resolveCallSession(logs: TeamCommunicationMessage[], currentUserLabel: string): CallSession {
  const orderedCallLogs = [...logs]
    .filter((log) => log.channel === "phone" && resolveCallEventType(log.subject))
    .sort(
      (left, right) =>
        new Date(left.contacted_at).getTime() - new Date(right.contacted_at).getTime()
    );

  let session: CallSession = {
    status: "idle",
    inviteLog: null,
    acceptedLog: null,
    endedLog: null
  };

  orderedCallLogs.forEach((log) => {
    const eventType = resolveCallEventType(log.subject);
    if (eventType === "invite") {
      session = {
        status:
          resolveLogDirection(log, currentUserLabel) === "outgoing"
            ? "outgoing_ringing"
            : "incoming_ringing",
        inviteLog: log,
        acceptedLog: null,
        endedLog: null
      };
      return;
    }

    if (eventType === "accepted" && session.inviteLog) {
      session = {
        ...session,
        status: "connected",
        acceptedLog: log,
        endedLog: null
      };
      return;
    }

    if (eventType === "ended" && session.inviteLog) {
      session = {
        ...session,
        status: "ended",
        endedLog: log
      };
    }
  });

  return session;
}

export function StaffCommunicationPanel({
  title,
  counterpartLabel,
  counterpartPhone,
  currentUserLabel,
  contextLabel,
  doctorId,
  adminUserId,
  patientId,
  visitScheduleId,
  logs,
  unreadConversationCount = 0,
  syncError,
  lastSyncedAt,
  isRefreshing = false,
  onRefresh,
  onConversationViewed,
  onClose,
  onCreateLog
}: StaffCommunicationPanelProps) {
  const [activeTab, setActiveTab] = useState<"text" | "call">("text");
  const [draftMessage, setDraftMessage] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const conversationBottomRef = useRef<HTMLDivElement | null>(null);
  const openedConversationKeyRef = useRef<string | null>(null);
  const displayLogs = useMemo(() => [...logs].slice(0, 30).reverse(), [logs]);
  const callSession = useMemo(
    () => resolveCallSession(logs, currentUserLabel),
    [currentUserLabel, logs]
  );
  const waitingSeconds =
    callSession.status === "outgoing_ringing" || callSession.status === "incoming_ringing"
      ? Math.max(
          0,
          Math.floor((nowTick - new Date(callSession.inviteLog?.contacted_at ?? nowTick).getTime()) / 1000)
        )
      : 0;
  const callDurationSeconds =
    callSession.status === "connected"
      ? Math.max(
          0,
          Math.floor((nowTick - new Date(callSession.acceptedLog?.contacted_at ?? nowTick).getTime()) / 1000)
        )
      : callSession.status === "ended" && callSession.acceptedLog && callSession.endedLog
        ? Math.max(
            0,
            Math.floor(
              (new Date(callSession.endedLog.contacted_at).getTime() -
                new Date(callSession.acceptedLog.contacted_at).getTime()) /
                1000
            )
          )
        : 0;

  useEffect(() => {
    if (!["outgoing_ringing", "incoming_ringing", "connected"].includes(callSession.status)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [callSession.status]);

  useEffect(() => {
    if (typeof conversationBottomRef.current?.scrollIntoView === "function") {
      conversationBottomRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end"
      });
    }
  }, [displayLogs, activeTab]);

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

  const handleStartCall = async () => {
    if (callSession.status === "outgoing_ringing" || callSession.status === "incoming_ringing") {
      setFeedback("目前已有一筆語音通話邀請尚未處理。");
      return;
    }
    if (callSession.status === "connected") {
      setFeedback("目前已在通話中，請先結束目前通話。");
      return;
    }
    try {
      await onCreateLog({
        channel: "phone",
        subject: `${voiceCallInvitePrefix}${contextLabel}`,
        content: `${currentUserLabel} 在團隊通訊中發起與 ${counterpartLabel} 的語音通話。請前往團隊通訊頁面立即回應。`,
        outcome: counterpartPhone
          ? `${currentUserLabel} 已發起語音通話邀請，對象電話：${counterpartPhone}`
          : `已在團隊通訊內啟動語音通話流程，等待 ${counterpartLabel} 接聽。`
      });
      setActiveTab("call");
      setNowTick(Date.now());
      setFeedback(`已送出語音通話邀請，等待 ${counterpartLabel} 接聽。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "語音通話邀請送出失敗，請稍後再試。");
    }
  };

  const handleAcceptCall = async () => {
    if (callSession.status !== "incoming_ringing") {
      return;
    }
    try {
      await onCreateLog({
        channel: "phone",
        subject: `${voiceCallAcceptedPrefix}${contextLabel}`,
        content: `${currentUserLabel} 已接受 ${counterpartLabel} 發起的語音通話邀請，開始建立通話連線。`,
        outcome: `${currentUserLabel} 已接聽語音通話，正在與 ${counterpartLabel} 通話。`
      });
      setActiveTab("call");
      setNowTick(Date.now());
      setFeedback("已接受語音通話邀請，正在建立通話連線。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "接受語音邀請失敗，請稍後再試。");
    }
  };

  const handleEndCall = async () => {
    if (callSession.status !== "connected" && callSession.status !== "outgoing_ringing" && callSession.status !== "incoming_ringing") {
      return;
    }
    try {
      await onCreateLog({
        channel: "phone",
        subject: `${voiceCallEndedPrefix}${contextLabel}`,
        content: `${currentUserLabel} 已結束與 ${counterpartLabel} 的語音通話。`,
        outcome: `${currentUserLabel} 已結束本次語音通話。`
      });
      setFeedback(`語音通話已結束，本次通話 ${formatCallDuration(callDurationSeconds)}。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "結束語音通話失敗，請稍後再試。");
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[28px] bg-[#f4f7f1] shadow-2xl lg:rounded-[32px]">
      <div className="shrink-0 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <h2 className="break-words text-lg font-semibold text-brand-ink sm:text-2xl">{title}</h2>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 sm:w-auto"
              >
                關閉
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 sm:mt-4">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#eef6ef_0%,#f8faf8_100%)] px-4 py-3 sm:px-5 sm:py-4">
        {syncError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {syncError}
          </div>
        ) : null}
        {lastSyncedAt ? (
          <div className="mb-4 break-words text-right text-xs text-slate-500">
            最後同步：{formatDateTimeFull(lastSyncedAt)}
          </div>
        ) : null}
        {callSession.status === "incoming_ringing" ? (
          <div className="sticky top-0 z-10 mb-4 rounded-3xl border-2 border-rose-300 bg-rose-50 px-4 py-4 text-sm text-rose-800 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">有語音通話邀請</p>
                <p className="mt-1 text-xs text-rose-700">
                  {counterpartLabel} 正在邀請你接聽語音通話，已等待 {formatCallDuration(waitingSeconds)}。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAcceptCall}
                  className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  接受語音邀請
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("call")}
                  className="rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700"
                >
                  稍後處理
                </button>
              </div>
            </div>
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
                      className={`rounded-[22px] px-4 py-3 text-sm shadow-sm ${
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
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white/85 px-6 py-8 text-center text-sm text-slate-500">
              目前還沒有院內對話紀錄，請直接從下方開始發送訊息。
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-4">
        {feedback ? (
          <div
            role="status"
            className={`mb-3 rounded-2xl px-4 py-3 text-sm ${
              feedback.includes("已")
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {feedback}
          </div>
        ) : null}

        {activeTab === "text" ? (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">訊息內容</span>
              <textarea
                value={draftMessage}
                onChange={(event) => setDraftMessage(event.target.value)}
                rows={3}
                className="w-full rounded-3xl border border-slate-200 px-4 py-3"
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
        ) : (
          <div className="space-y-3">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs text-slate-500">目前狀態</p>
                    <p className="mt-1 font-semibold text-brand-ink">
                    {callSession.status === "connected"
                      ? "通話進行中"
                      : callSession.status === "outgoing_ringing"
                        ? "等待對方接聽"
                        : callSession.status === "incoming_ringing"
                          ? "有來電邀請"
                          : callSession.status === "ended"
                            ? "通話已結束"
                            : "尚未開始"}
                  </p>
                  </div>
                  <div className="sm:text-right">
                  <p className="text-xs text-slate-500">
                    {callSession.status === "connected" ? "通話時間" : "等待時間"}
                  </p>
                  <p className="mt-1 font-semibold text-brand-ink">
                    {formatCallDuration(
                      callSession.status === "connected" || callSession.status === "ended"
                        ? callDurationSeconds
                        : waitingSeconds
                    )}
                  </p>
                  </div>
                </div>
              <p className="mt-3 text-sm text-slate-600">
                語音通話會留在目前團隊通訊畫面內處理，不會另開外部介面；接受方可直接在上方邀請列接通。
              </p>
            </div>
            <div className="flex justify-end">
              {callSession.status === "connected" ? (
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="w-full rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white sm:w-auto"
                >
                  結束通話
                </button>
              ) : callSession.status === "incoming_ringing" ? (
                <button
                  type="button"
                  onClick={handleAcceptCall}
                  className="w-full rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white sm:w-auto"
                >
                  接受語音邀請
                </button>
              ) : callSession.status === "outgoing_ringing" ? (
                <button
                  type="button"
                  onClick={handleEndCall}
                  className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 sm:w-auto"
                >
                  取消邀請
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartCall}
                  className="w-full rounded-full bg-brand-coral px-5 py-3 text-sm font-semibold text-white sm:w-auto"
                >
                  開始語音通話
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function StaffCommunicationDialog(props: StaffCommunicationDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="h-[min(92dvh,860px)] w-full max-w-4xl">
        <StaffCommunicationPanel {...props} />
      </div>
    </div>
  );
}
