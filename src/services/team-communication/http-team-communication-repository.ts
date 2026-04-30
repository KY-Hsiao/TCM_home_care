import type {
  TeamCommunicationConversationQuery,
  TeamCommunicationCreateInput,
  TeamCommunicationMessage,
  TeamCommunicationRepository,
  TeamCommunicationRole,
  TeamCommunicationUnreadCountQuery
} from "./types";

async function readJsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload && typeof payload.error === "string" && payload.error) || "團隊通訊同步失敗。");
  }
  return payload;
}

export function createHttpTeamCommunicationRepository(): TeamCommunicationRepository {
  return {
    async listConversation(query: TeamCommunicationConversationQuery) {
      const params = new URLSearchParams({
        doctorId: query.doctorId,
        adminUserId: query.adminUserId,
        role: query.viewerRole,
        userId: query.viewerUserId
      });
      const response = await fetch(`/api/team-communications?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = (await readJsonOrThrow(response)) as { items: TeamCommunicationMessage[] };
      return payload.items;
    },
    async getUnreadCount(query: TeamCommunicationUnreadCountQuery) {
      const params = new URLSearchParams({
        role: query.role,
        userId: query.userId
      });
      if (query.doctorId) {
        params.set("doctorId", query.doctorId);
      }
      if (query.adminUserId) {
        params.set("adminUserId", query.adminUserId);
      }
      const response = await fetch(`/api/team-communications/unread-count?${params.toString()}`, {
        cache: "no-store"
      });
      const payload = (await readJsonOrThrow(response)) as { count: number };
      return payload.count;
    },
    async createMessage(input: TeamCommunicationCreateInput) {
      const response = await fetch("/api/team-communications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      });
      const payload = (await readJsonOrThrow(response)) as { item: TeamCommunicationMessage };
      return payload.item;
    },
    async markMessageRead(messageId: string, viewerRole: TeamCommunicationRole, viewerUserId: string) {
      const response = await fetch(`/api/team-communications/${messageId}/read`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          viewerRole,
          viewerUserId
        })
      });
      await readJsonOrThrow(response);
    }
  };
}
