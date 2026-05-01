import type { ContactLog } from "../../domain/models";

export type TeamCommunicationRole = "doctor" | "admin";

export type TeamCommunicationMessageType = "text";

export type TeamCommunicationCallStatus = null;

export type TeamCommunicationMessage = ContactLog & {
  sender_role: TeamCommunicationRole;
  sender_user_id: string;
  receiver_role: TeamCommunicationRole;
  receiver_user_id: string;
  message_type: TeamCommunicationMessageType;
  call_status: TeamCommunicationCallStatus;
  is_read: boolean;
  read_at: string | null;
};

export type TeamCommunicationCreateInput = {
  id: string;
  doctorId: string;
  adminUserId: string;
  senderRole: TeamCommunicationRole;
  senderUserId: string;
  receiverRole: TeamCommunicationRole;
  receiverUserId: string;
  patientId: string | null;
  visitScheduleId: string | null;
  channel: "phone" | "web_notice";
  subject: string;
  content: string;
  outcome: string;
  messageType: TeamCommunicationMessageType;
  callStatus: TeamCommunicationCallStatus;
  contactedAt: string;
};

export type TeamCommunicationConversationQuery = {
  doctorId: string;
  adminUserId: string;
  viewerRole: TeamCommunicationRole;
  viewerUserId: string;
};

export type TeamCommunicationUnreadCountQuery = {
  role: TeamCommunicationRole;
  userId: string;
  doctorId?: string;
  adminUserId?: string;
  readAfter?: string;
};

export interface TeamCommunicationRepository {
  listConversation(query: TeamCommunicationConversationQuery): Promise<TeamCommunicationMessage[]>;
  getUnreadCount(query: TeamCommunicationUnreadCountQuery): Promise<number>;
  createMessage(input: TeamCommunicationCreateInput): Promise<TeamCommunicationMessage>;
  markConversationRead(query: TeamCommunicationConversationQuery): Promise<void>;
  markMessageRead(messageId: string, viewerRole: TeamCommunicationRole, viewerUserId: string): Promise<void>;
}
