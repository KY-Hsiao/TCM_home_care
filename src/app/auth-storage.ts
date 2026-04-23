import type { SessionState } from "../domain/repository";

export const SESSION_STORAGE_KEY = "tcm-home-care-mvp-session";
export const PASSWORD_STORAGE_KEY = "tcm-home-care-mvp-passwords";
const DEFAULT_PASSWORD = "0000";

type StoredPasswords = Record<string, string>;

function canUseStorage() {
  return typeof window !== "undefined";
}

function buildPasswordMapKey(role: "doctor" | "admin", userId: string) {
  return `${role}:${userId}`;
}

export function getDefaultPassword() {
  return DEFAULT_PASSWORD;
}

export function loadStoredSession(): Partial<SessionState> {
  if (!canUseStorage()) {
    return {};
  }

  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function persistStoredSession(session: SessionState) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function loadStoredPasswords(): StoredPasswords {
  if (!canUseStorage()) {
    return {};
  }

  const raw = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as StoredPasswords;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function persistStoredPasswords(passwords: StoredPasswords) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(passwords));
}

export function clearStoredPasswords() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
}

export function resolvePassword(
  passwords: StoredPasswords,
  role: "doctor" | "admin",
  userId: string
) {
  return passwords[buildPasswordMapKey(role, userId)] ?? DEFAULT_PASSWORD;
}

export function updateStoredPassword(
  passwords: StoredPasswords,
  role: "doctor" | "admin",
  userId: string,
  password: string
) {
  return {
    ...passwords,
    [buildPasswordMapKey(role, userId)]: password
  };
}
