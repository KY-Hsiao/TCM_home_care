import type { AppDb, ContactLog } from "../../domain/models";
import type { AppRepositories } from "../../domain/repository";
import { createUnreadKey, buildMockTeamCommunicationMessage, isTeamCommunicationNotification } from "./helpers";
import type {
  TeamCommunicationConversationQuery,
  TeamCommunicationCreateInput,
  TeamCommunicationMessage,
  TeamCommunicationRepository,
  TeamCommunicationRole,
  TeamCommunicationUnreadCountQuery
} from "./types";

function createContactLogFromInput(input: TeamCommunicationCreateInput): ContactLog {
  return {
    id: input.id,
    patient_id: input.patientId,
    visit_schedule_id: input.visitScheduleId,
    caregiver_id: null,
    doctor_id: input.doctorId,
    admin_user_id: input.adminUserId,
    channel: input.channel,
    subject: input.subject,
    content: input.content,
    outcome: input.outcome,
    contacted_at: input.contactedAt,
    created_at: input.contactedAt,
    updated_at: input.contactedAt
  };
}

function buildNotificationPayload(input: TeamCommunicationCreateInput) {
  const ownerRole: TeamCommunicationRole = input.receiverRole;
  return {
    id: `nc-staff-${input.id}`,
    role: ownerRole,
    owner_user_id: input.receiverUserId,
    source_type: input.channel === "phone" ? "system_notification" : "manual_notice",
    title: input.subject,
    content:
      input.channel === "phone"
        ? `${input.content}\n請打開團隊通訊頁面立即回應。`
        : input.content,
    linked_patient_id: input.patientId,
    linked_visit_schedule_id: input.visitScheduleId,
    linked_doctor_id: input.doctorId,
    linked_leave_request_id: null,
    status: "pending",
    is_unread: true,
    reply_text: null,
    reply_updated_at: null,
    reply_updated_by_role: null,
    created_at: input.contactedAt,
    updated_at: input.contactedAt
  } as const;
}

function createMessageFromNotification(input: {
  item: AppDb["notification_center_items"][number];
  doctorId: string;
  adminUserId: string;
  doctorName: string;
}): TeamCommunicationMessage {
  const receiverRole = input.item.role as TeamCommunicationRole;
  const senderRole: TeamCommunicationRole = receiverRole === "doctor" ? "admin" : "doctor";
  const senderLabel = senderRole === "admin" ? "行政人員" : input.doctorName;
  return {
    id: input.item.id.replace(/^nc-/, "staff-log-"),
    patient_id: input.item.linked_patient_id,
    visit_schedule_id: input.item.linked_visit_schedule_id,
    caregiver_id: null,
    doctor_id: input.doctorId,
    admin_user_id: input.adminUserId,
    channel: input.item.source_type === "system_notification" ? "phone" : "web_notice",
    subject: input.item.title,
    content: input.item.content,
    outcome: `${senderLabel} 已送出站內訊息，等待查看。`,
    contacted_at: input.item.created_at,
    created_at: input.item.created_at,
    updated_at: input.item.updated_at,
    sender_role: senderRole,
    sender_user_id: senderRole === "admin" ? input.adminUserId : input.doctorId,
    receiver_role: receiverRole,
    receiver_user_id:
      receiverRole === "admin" ? input.adminUserId : input.item.owner_user_id ?? input.doctorId,
    message_type: input.item.title.startsWith("語音通話邀請｜")
      ? "voice_invite"
      : input.item.title.startsWith("語音通話已接聽｜")
        ? "voice_accept"
        : input.item.title.startsWith("語音通話已結束｜")
          ? "voice_end"
          : "text",
    call_status: input.item.title.startsWith("語音通話邀請｜")
      ? "ringing"
      : input.item.title.startsWith("語音通話已接聽｜")
        ? "connected"
        : input.item.title.startsWith("語音通話已結束｜")
          ? "ended"
          : null,
    is_read: !input.item.is_unread,
    read_at: null
  };
}

export function createMockTeamCommunicationRepository(input: {
  db: AppDb;
  repositories: AppRepositories;
}): TeamCommunicationRepository {
  const findConversationMessage = (
    viewerRole: TeamCommunicationRole,
    viewerUserId: string,
    messageId: string
  ) =>
    input.db.contact_logs
      .filter((log) => ["phone", "web_notice"].includes(log.channel))
      .map((log) =>
        buildMockTeamCommunicationMessage({
          log,
          doctorId: log.doctor_id ?? "",
          adminUserId: log.admin_user_id ?? "",
          unreadNotificationIds: new Set<string>()
        })
      )
      .find((message) => message.id === messageId);

  return {
    async listConversation(query: TeamCommunicationConversationQuery) {
      const doctorName =
        input.repositories.patientRepository.getDoctors().find((item) => item.id === query.doctorId)?.name ?? "醫師";
      const unreadKeys = new Set(
        input.db.notification_center_items
          .filter(
            (item) =>
              item.role === query.viewerRole &&
              item.owner_user_id === query.viewerUserId &&
              item.linked_doctor_id === query.doctorId &&
              isTeamCommunicationNotification(item) &&
              item.is_unread
          )
          .map((item) =>
            createUnreadKey({
              title: item.title,
              createdAt: item.created_at,
              role: item.role as TeamCommunicationRole
            })
          )
      );

      const logMessages = [...input.db.contact_logs]
        .filter(
          (log) =>
            log.doctor_id === query.doctorId &&
            log.admin_user_id === query.adminUserId &&
            ["phone", "web_notice"].includes(log.channel)
        )
        .sort((left, right) => new Date(left.contacted_at).getTime() - new Date(right.contacted_at).getTime())
        .map((log) =>
          buildMockTeamCommunicationMessage({
            log,
            doctorId: query.doctorId,
            adminUserId: query.adminUserId,
            unreadNotificationIds: unreadKeys
          })
        );
      const existingKeys = new Set(
        logMessages.map((message) =>
          createUnreadKey({
            title: message.subject,
            createdAt: message.contacted_at,
            role: message.receiver_role
          })
        )
      );
      const notificationMessages = input.db.notification_center_items
        .filter(
          (item) =>
            item.linked_doctor_id === query.doctorId &&
            item.owner_user_id &&
            isTeamCommunicationNotification(item)
        )
        .filter(
          (item) =>
            !existingKeys.has(
              createUnreadKey({
                title: item.title,
                createdAt: item.created_at,
                role: item.role as TeamCommunicationRole
              })
            )
        )
        .map((item) =>
          createMessageFromNotification({
            item,
            doctorId: query.doctorId,
            adminUserId: query.adminUserId,
            doctorName
          })
        );

      return [...logMessages, ...notificationMessages].sort(
        (left, right) => new Date(left.contacted_at).getTime() - new Date(right.contacted_at).getTime()
      );
    },
    async getUnreadCount(query: TeamCommunicationUnreadCountQuery) {
      return input.repositories.notificationRepository
        .getNotificationCenterItems(query.role, query.userId)
        .filter((item) => {
          if (!item.is_unread || item.role !== query.role || !isTeamCommunicationNotification(item)) {
            return false;
          }
          if (query.doctorId && item.linked_doctor_id !== query.doctorId) {
            return false;
          }
          return true;
        }).length;
    },
    async createMessage(payload: TeamCommunicationCreateInput) {
      const log = createContactLogFromInput(payload);
      input.repositories.contactRepository.createContactLog(log);
      input.repositories.notificationRepository.createNotificationCenterItem(
        buildNotificationPayload(payload)
      );

      return {
        ...log,
        sender_role: payload.senderRole,
        sender_user_id: payload.senderUserId,
        receiver_role: payload.receiverRole,
        receiver_user_id: payload.receiverUserId,
        message_type: payload.messageType,
        call_status: payload.callStatus,
        is_read: false,
        read_at: null
      };
    },
    async markMessageRead(messageId: string, viewerRole: TeamCommunicationRole, viewerUserId: string) {
      const message = findConversationMessage(viewerRole, viewerUserId, messageId);
      const target = input.repositories.notificationRepository
        .getNotificationCenterItems(viewerRole, viewerUserId)
        .find((item) => {
          if (item.id === `nc-staff-${messageId}` || item.id.replace(/^nc-/, "staff-log-") === messageId) {
            return true;
          }
          if (!message || !isTeamCommunicationNotification(item)) {
            return false;
          }
          return (
            createUnreadKey({
              title: item.title,
              createdAt: item.created_at,
              role: item.role as TeamCommunicationRole
            }) ===
            createUnreadKey({
              title: message.subject,
              createdAt: message.contacted_at,
              role: viewerRole
            })
          );
        });
      if (target) {
        input.repositories.notificationRepository.markNotificationCenterItemRead(target.id);
      }
    }
  };
}
