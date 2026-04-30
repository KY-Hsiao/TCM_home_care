export type TeamCommunicationSyncMode = "mock_local_storage" | "http";

declare global {
  interface Window {
    __TCM_TEAM_COMM_MODE__?: TeamCommunicationSyncMode;
  }
}

export function resolveTeamCommunicationSyncMode(): TeamCommunicationSyncMode {
  if (typeof window !== "undefined" && window.__TCM_TEAM_COMM_MODE__) {
    return window.__TCM_TEAM_COMM_MODE__;
  }

  const envMode = import.meta.env.VITE_TEAM_COMM_SYNC_MODE;
  if (envMode === "http" || envMode === "mock_local_storage") {
    return envMode;
  }

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return "http";
    }
  }

  return "mock_local_storage";
}
