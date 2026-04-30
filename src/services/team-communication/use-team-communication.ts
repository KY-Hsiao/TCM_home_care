import { useEffect, useMemo, useRef, useState } from "react";
import type { AppDb } from "../../domain/models";
import type { AppRepositories } from "../../domain/repository";
import { createHttpTeamCommunicationRepository } from "./http-team-communication-repository";
import { resolveTeamCommunicationSyncMode } from "./mode";
import { createMockTeamCommunicationRepository } from "./mock-team-communication-repository";
import type {
  TeamCommunicationCreateInput,
  TeamCommunicationMessage,
  TeamCommunicationRepository,
  TeamCommunicationRole
} from "./types";

const POLLING_INTERVAL_MS = 8000;
const TEAM_COMMUNICATION_SYNC_EVENT = "tcm:team-communication-sync";

function emitTeamCommunicationSync() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TEAM_COMMUNICATION_SYNC_EVENT));
  }
}

function createRepository(input: {
  db: AppDb;
  repositories: AppRepositories;
}): TeamCommunicationRepository {
  return resolveTeamCommunicationSyncMode() === "http"
    ? createHttpTeamCommunicationRepository()
    : createMockTeamCommunicationRepository(input);
}

export function useTeamCommunicationConversation(input: {
  db: AppDb;
  repositories: AppRepositories;
  doctorId: string;
  adminUserId: string;
  viewerRole: TeamCommunicationRole;
  viewerUserId: string;
  enabled?: boolean;
}) {
  const enabled = input.enabled ?? true;
  const repository = useMemo(
    () =>
      createRepository({
        db: input.db,
        repositories: input.repositories
      }),
    [input.db, input.repositories]
  );
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
  const refreshRequestIdRef = useRef(0);
  const [messages, setMessages] = useState<TeamCommunicationMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const conversationQuery = useMemo(
    () => ({
      doctorId: input.doctorId,
      adminUserId: input.adminUserId,
      viewerRole: input.viewerRole,
      viewerUserId: input.viewerUserId
    }),
    [input.adminUserId, input.doctorId, input.viewerRole, input.viewerUserId]
  );

  const resolveUnreadMessages = (sourceMessages: TeamCommunicationMessage[]) =>
    sourceMessages.filter(
      (message) =>
        !message.is_read &&
        message.receiver_role === input.viewerRole &&
        message.receiver_user_id === input.viewerUserId
    );

  const refresh = async (options?: { silent?: boolean }) => {
    if (!enabled) {
      return;
    }
    const requestId = ++refreshRequestIdRef.current;
    if (!options?.silent) {
      setIsRefreshing(true);
    }
    try {
      const nextMessages = await repositoryRef.current.listConversation(conversationQuery);
      if (requestId !== refreshRequestIdRef.current) {
        return;
      }
      setMessages(nextMessages);
      setUnreadCount(resolveUnreadMessages(nextMessages).length);
      setLastSyncedAt(new Date().toISOString());
      setSyncError(null);
    } catch (error) {
      if (requestId !== refreshRequestIdRef.current) {
        return;
      }
      setSyncError(error instanceof Error ? error.message : "團隊通訊同步失敗。");
    } finally {
      if (requestId === refreshRequestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    void refresh();
    const handleSync = () => {
      void refresh({ silent: true });
    };
    window.addEventListener(TEAM_COMMUNICATION_SYNC_EVENT, handleSync);
    if (!enabled || resolveTeamCommunicationSyncMode() !== "http") {
      return () => window.removeEventListener(TEAM_COMMUNICATION_SYNC_EVENT, handleSync);
    }
    const intervalId = window.setInterval(() => {
      void refresh({ silent: true });
    }, POLLING_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(TEAM_COMMUNICATION_SYNC_EVENT, handleSync);
    };
  }, [conversationQuery, enabled, input.db, input.repositories]);

  const markConversationRead = async () => {
    const latestMessages =
      messages.length > 0
        ? messages
        : await repositoryRef.current.listConversation(conversationQuery);
    const unreadMessages = resolveUnreadMessages(latestMessages);
    if (!unreadMessages.length) {
      setMessages(latestMessages);
      setUnreadCount(0);
      await refresh({ silent: true });
      emitTeamCommunicationSync();
      return;
    }
    await Promise.all(
      unreadMessages.map((message) =>
        repositoryRef.current.markMessageRead(message.id, input.viewerRole, input.viewerUserId)
      )
    );
    const readAt = new Date().toISOString();
    setMessages(
      latestMessages.map((message) =>
        unreadMessages.some((item) => item.id === message.id)
          ? { ...message, is_read: true, read_at: readAt }
          : message
      )
    );
    setUnreadCount(0);
    await refresh({ silent: true });
    emitTeamCommunicationSync();
  };

  const createMessage = async (payload: TeamCommunicationCreateInput) => {
    await repositoryRef.current.createMessage(payload);
    await refresh();
    emitTeamCommunicationSync();
  };

  return {
    messages,
    unreadCount,
    isLoading,
    isRefreshing,
    lastSyncedAt,
    syncError,
    refresh,
    markConversationRead,
    createMessage
  };
}

export function useTeamCommunicationUnreadCount(input: {
  db: AppDb;
  repositories: AppRepositories;
  role: TeamCommunicationRole;
  userId: string;
  doctorId?: string;
  adminUserId?: string;
  enabled?: boolean;
}) {
  const enabled = input.enabled ?? true;
  const repository = useMemo(
    () =>
      createRepository({
        db: input.db,
        repositories: input.repositories
      }),
    [input.db, input.repositories]
  );
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;
  const refreshRequestIdRef = useRef(0);
  const [count, setCount] = useState(0);

  const refresh = async () => {
    if (!enabled) {
      return;
    }
    const requestId = ++refreshRequestIdRef.current;
    try {
      const nextCount = await repositoryRef.current.getUnreadCount({
        role: input.role,
        userId: input.userId,
        doctorId: input.doctorId,
        adminUserId: input.adminUserId
      });
      if (requestId !== refreshRequestIdRef.current) {
        return;
      }
      setCount(nextCount);
    } catch {
      // 保留舊值，避免未讀燈在短暫網路失敗時閃爍歸零。
    }
  };

  useEffect(() => {
    void refresh();
    const handleSync = () => {
      void refresh();
    };
    window.addEventListener(TEAM_COMMUNICATION_SYNC_EVENT, handleSync);
    if (!enabled || resolveTeamCommunicationSyncMode() !== "http") {
      return () => window.removeEventListener(TEAM_COMMUNICATION_SYNC_EVENT, handleSync);
    }
    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLLING_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(TEAM_COMMUNICATION_SYNC_EVENT, handleSync);
    };
  }, [enabled, input.adminUserId, input.db, input.doctorId, input.repositories, input.role, input.userId]);

  return {
    count,
    refresh
  };
}
