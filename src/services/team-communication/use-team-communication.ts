import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const TEAM_COMMUNICATION_READ_WATERMARK_PREFIX = "tcm-team-communication-read-watermark";

type TeamCommunicationSyncEventDetail =
  | {
      type: "conversation_read";
      role: TeamCommunicationRole;
      userId: string;
      doctorId: string;
      adminUserId: string;
    }
  | {
      type: "changed";
    };

function buildReadWatermarkKey(input: {
  role: TeamCommunicationRole;
  userId: string;
  doctorId?: string;
  adminUserId?: string;
}) {
  if (!input.userId || !input.doctorId || !input.adminUserId) {
    return null;
  }
  return [
    TEAM_COMMUNICATION_READ_WATERMARK_PREFIX,
    input.role,
    input.userId,
    input.doctorId,
    input.adminUserId
  ].join(":");
}

function readConversationWatermark(input: {
  role: TeamCommunicationRole;
  userId: string;
  doctorId?: string;
  adminUserId?: string;
}) {
  if (typeof window === "undefined") {
    return null;
  }
  const key = buildReadWatermarkKey(input);
  if (!key) {
    return null;
  }
  const value = window.localStorage.getItem(key);
  return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function storeConversationWatermark(input: {
  role: TeamCommunicationRole;
  userId: string;
  doctorId: string;
  adminUserId: string;
  readAt: string;
}) {
  if (typeof window === "undefined") {
    return;
  }
  const key = buildReadWatermarkKey(input);
  if (key) {
    window.localStorage.setItem(key, input.readAt);
  }
}

function emitTeamCommunicationSync(detail: TeamCommunicationSyncEventDetail = { type: "changed" }) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<TeamCommunicationSyncEventDetail>(TEAM_COMMUNICATION_SYNC_EVENT, { detail }));
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
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const conversationQuery = useMemo(
    () => ({
      doctorId: input.doctorId,
      adminUserId: input.adminUserId,
      viewerRole: input.viewerRole,
      viewerUserId: input.viewerUserId
    }),
    [input.adminUserId, input.doctorId, input.viewerRole, input.viewerUserId]
  );

  const resolveUnreadMessages = useCallback(
    (sourceMessages: TeamCommunicationMessage[]) =>
      sourceMessages.filter((message) => {
        const readAfter = readConversationWatermark({
          role: input.viewerRole,
          userId: input.viewerUserId,
          doctorId: input.doctorId,
          adminUserId: input.adminUserId
        });
        return (
          !message.is_read &&
          message.receiver_role === input.viewerRole &&
          message.receiver_user_id === input.viewerUserId &&
          (!readAfter || new Date(message.contacted_at).getTime() > new Date(readAfter).getTime())
        );
      }),
    [input.adminUserId, input.doctorId, input.viewerRole, input.viewerUserId]
  );

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
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
  }, [conversationQuery, enabled, resolveUnreadMessages]);

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
  }, [enabled, refresh]);

  const markConversationRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    storeConversationWatermark({
      role: input.viewerRole,
      userId: input.viewerUserId,
      doctorId: input.doctorId,
      adminUserId: input.adminUserId,
      readAt
    });
    await repositoryRef.current.markConversationRead(conversationQuery);
    const currentMessages = messagesRef.current;
    const latestMessages =
      currentMessages.length > 0
        ? currentMessages
        : await repositoryRef.current.listConversation(conversationQuery);
    const unreadMessages = resolveUnreadMessages(latestMessages);
    if (!unreadMessages.length) {
      setMessages(latestMessages);
      setUnreadCount(0);
      await refresh({ silent: true });
      emitTeamCommunicationSync({
        type: "conversation_read",
        role: input.viewerRole,
        userId: input.viewerUserId,
        doctorId: input.doctorId,
        adminUserId: input.adminUserId
      });
      return;
    }
    setMessages(
      latestMessages.map((message) =>
        unreadMessages.some((item) => item.id === message.id)
          ? { ...message, is_read: true, read_at: readAt }
          : message
      )
    );
    setUnreadCount(0);
    await refresh({ silent: true });
    emitTeamCommunicationSync({
      type: "conversation_read",
      role: input.viewerRole,
      userId: input.viewerUserId,
      doctorId: input.doctorId,
      adminUserId: input.adminUserId
    });
  }, [
    conversationQuery,
    input.adminUserId,
    input.doctorId,
    input.viewerRole,
    input.viewerUserId,
    refresh,
    resolveUnreadMessages
  ]);

  const createMessage = useCallback(async (payload: TeamCommunicationCreateInput) => {
    await repositoryRef.current.createMessage(payload);
    await refresh();
    emitTeamCommunicationSync();
  }, [refresh]);

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
  const countRef = useRef(count);
  countRef.current = count;

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const requestId = ++refreshRequestIdRef.current;
    try {
      const nextCount = await repositoryRef.current.getUnreadCount({
        role: input.role,
        userId: input.userId,
        doctorId: input.doctorId,
        adminUserId: input.adminUserId,
        readAfter: readConversationWatermark({
          role: input.role,
          userId: input.userId,
          doctorId: input.doctorId,
          adminUserId: input.adminUserId
        }) ?? undefined
      });
      if (requestId !== refreshRequestIdRef.current) {
        return;
      }
      if (countRef.current !== nextCount) {
        countRef.current = nextCount;
        setCount(nextCount);
      }
    } catch {
      // 保留舊值，避免未讀燈在短暫網路失敗時閃爍歸零。
    }
  }, [enabled, input.adminUserId, input.doctorId, input.role, input.userId]);

  useEffect(() => {
    void refresh();
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<TeamCommunicationSyncEventDetail>).detail;
      if (
        detail?.type === "conversation_read" &&
        detail.role === input.role &&
        detail.userId === input.userId &&
        (!input.doctorId || detail.doctorId === input.doctorId) &&
        (!input.adminUserId || detail.adminUserId === input.adminUserId)
      ) {
        setCount((current) => {
          const nextCount = input.doctorId ? 0 : Math.max(0, current - 1);
          countRef.current = nextCount;
          return nextCount;
        });
      }
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
  }, [enabled, input.adminUserId, input.doctorId, input.role, input.userId, refresh]);

  return {
    count,
    refresh
  };
}
