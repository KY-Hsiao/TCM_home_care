import type { NotificationCenterItem } from "../../domain/models";
import type { ContactLog } from "../../domain/models";
import type { TeamCommunicationMessage, TeamCommunicationMessageType, TeamCommunicationRole } from "./types";

const voiceCallInvitePrefix = "語音通話邀請｜";
const voiceCallAcceptedPrefix = "語音通話已接聽｜";
const voiceCallEndedPrefix = "語音通話已結束｜";

export function resolveMessageTypeFromSubject(subject: string): TeamCommunicationMessageType {
  if (subject.startsWith(voiceCallInvitePrefix)) {
    return "voice_invite";
  }
  if (subject.startsWith(voiceCallAcceptedPrefix)) {
    return "voice_accept";
  }
  if (subject.startsWith(voiceCallEndedPrefix)) {
    return "voice_end";
  }
  return "text";
}

export function resolveCallStatusFromMessageType(messageType: TeamCommunicationMessageType) {
  if (messageType === "voice_invite") {
    return "ringing" as const;
  }
  if (messageType === "voice_accept") {
    return "connected" as const;
  }
  if (messageType === "voice_end") {
    return "ended" as const;
  }
  return null;
}

export function isTeamCommunicationNotification(item: NotificationCenterItem) {
  return (
    ["manual_notice", "system_notification"].includes(item.source_type) &&
    (item.title.startsWith("院內對話｜") ||
      item.title.startsWith("語音通話邀請｜") ||
      item.content.includes("團隊通訊"))
  );
}

export function buildMockTeamCommunicationMessage(input: {
  log: ContactLog;
  doctorId: string;
  adminUserId: string;
  unreadNotificationIds: Set<string>;
}): TeamCommunicationMessage {
  const messageType = resolveMessageTypeFromSubject(input.log.subject);
  const senderRole: TeamCommunicationRole = input.log.outcome.startsWith("行政人員 ")
    ? "admin"
    : "doctor";
  const senderUserId = senderRole === "admin" ? input.adminUserId : input.doctorId;
  const receiverRole: TeamCommunicationRole = senderRole === "admin" ? "doctor" : "admin";
  const receiverUserId = receiverRole === "admin" ? input.adminUserId : input.doctorId;

  return {
    ...input.log,
    sender_role: senderRole,
    sender_user_id: senderUserId,
    receiver_role: receiverRole,
    receiver_user_id: receiverUserId,
    message_type: messageType,
    call_status: resolveCallStatusFromMessageType(messageType),
    is_read: !input.unreadNotificationIds.has(input.log.subject + input.log.contacted_at + receiverRole),
    read_at: null
  };
}

export function createUnreadKey(item: {
  title: string;
  createdAt: string;
  role: TeamCommunicationRole;
}) {
  return `${item.title}${item.createdAt}${item.role}`;
}
