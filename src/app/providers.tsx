import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { AppContext, type AppContextValue } from "./app-context";
import { hasLocalDbSnapshot, loadDb, persistDb, subscribeDbStorage } from "../data/mock/db";
import { createRepositories } from "../data/mock/repositories";
import type { AppDb } from "../domain/models";
import type { SessionState } from "../domain/repository";
import { createAppServices } from "../services";
import type { AppServices } from "../services/types";
import {
  fetchServerAppDb,
  getAppDbSyncDebounceMs,
  persistServerAppDb,
  shouldPreferLocalAppDb
} from "../services/app-db-sync";
import {
  loadStoredPasswords,
  loadStoredSession,
  persistStoredPasswords,
  persistStoredSession,
  resolvePassword,
  updateStoredPassword
} from "./auth-storage";

export function AppProviders({ children }: PropsWithChildren) {
  const hadLocalDbSnapshotRef = useRef(hasLocalDbSnapshot());
  const [db, setDb] = useState<AppDb>(() => loadDb());
  const [, setServicesRevision] = useState(0);
  const [storedPasswords, setStoredPasswords] = useState(() => loadStoredPasswords());
  const defaultDoctorId = db.doctors[0]?.id ?? "doc-001";
  const defaultAdminId = db.admin_users[0]?.id ?? "admin-001";
  const [session, setSession] = useState<SessionState>(() => {
    const storedSession = loadStoredSession();
    const authenticatedDoctorId =
      typeof storedSession.authenticatedDoctorId === "string"
        ? storedSession.authenticatedDoctorId
        : null;
    const storedAuthenticatedAdminId =
      typeof storedSession.authenticatedAdminId === "string"
        ? storedSession.authenticatedAdminId
        : null;
    const authenticatedAdminId = storedAuthenticatedAdminId ? defaultAdminId : null;

    return {
      role: storedSession.role === "admin" ? "admin" : "doctor",
      activeDoctorId:
        typeof storedSession.activeDoctorId === "string"
          ? storedSession.activeDoctorId
          : authenticatedDoctorId ?? defaultDoctorId,
      activeAdminId: authenticatedAdminId ?? defaultAdminId,
      activeRoutePlanId:
        typeof storedSession.activeRoutePlanId === "string"
          ? storedSession.activeRoutePlanId
          : null,
      authenticatedDoctorId,
      authenticatedAdminId
    };
  });
  const persistDbTimerRef = useRef<number | null>(null);
  const persistServerDbTimerRef = useRef<number | null>(null);
  const latestDbRef = useRef(db);
  const serverSyncReadyRef = useRef(false);
  const skipNextServerPersistRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;

    void fetchServerAppDb()
      .then((serverDb) => {
        if (isCancelled) {
          return;
        }

        if (
          serverDb &&
          hadLocalDbSnapshotRef.current &&
          shouldPreferLocalAppDb(latestDbRef.current, serverDb)
        ) {
          void persistServerAppDb(latestDbRef.current);
          return;
        }

        if (serverDb) {
          skipNextServerPersistRef.current = true;
          setDb(serverDb);
          persistDb(serverDb);
          return;
        }

        if (hadLocalDbSnapshotRef.current) {
          void persistServerAppDb(latestDbRef.current);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          serverSyncReadyRef.current = true;
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    latestDbRef.current = db;
    if (persistDbTimerRef.current) {
      window.clearTimeout(persistDbTimerRef.current);
    }
    persistDbTimerRef.current = window.setTimeout(() => {
      persistDb(latestDbRef.current);
      persistDbTimerRef.current = null;
    }, 0);

    if (serverSyncReadyRef.current) {
      if (skipNextServerPersistRef.current) {
        skipNextServerPersistRef.current = false;
      } else {
        if (persistServerDbTimerRef.current) {
          window.clearTimeout(persistServerDbTimerRef.current);
        }
        persistServerDbTimerRef.current = window.setTimeout(() => {
          void persistServerAppDb(latestDbRef.current);
          persistServerDbTimerRef.current = null;
        }, getAppDbSyncDebounceMs());
      }
    }

    return () => {
      if (persistDbTimerRef.current) {
        window.clearTimeout(persistDbTimerRef.current);
        persistDbTimerRef.current = null;
      }
    };
  }, [db]);

  useEffect(() => {
    return () => {
      if (persistDbTimerRef.current) {
        window.clearTimeout(persistDbTimerRef.current);
        persistDbTimerRef.current = null;
      }
      if (persistServerDbTimerRef.current) {
        window.clearTimeout(persistServerDbTimerRef.current);
        persistServerDbTimerRef.current = null;
      }
      persistDb(latestDbRef.current);
      if (serverSyncReadyRef.current) {
        void persistServerAppDb(latestDbRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return subscribeDbStorage((nextDb) => {
      setDb(nextDb);
    });
  }, []);

  useEffect(() => {
    persistStoredSession(session);
  }, [session]);

  useEffect(() => {
    persistStoredPasswords(storedPasswords);
  }, [storedPasswords]);

  const repositories = useMemo(
    () =>
      createRepositories(
        () => db,
        (updater) => setDb((current) => updater(current))
      ),
    [db]
  );
  const repositoriesRef = useRef(repositories);
  const sessionRef = useRef(session);

  repositoriesRef.current = repositories;
  sessionRef.current = session;

  const [services] = useState<AppServices>(() =>
    createAppServices({
      getRepositories: () => repositoriesRef.current,
      getSession: () => sessionRef.current
    })
  );

  useEffect(() => {
    return services.visitAutomation.subscribe(() => {
      setServicesRevision((current) => current + 1);
    });
  }, [services]);

  useEffect(() => {
    return () => {
      services.visitAutomation.resetAll();
    };
  }, [services]);

  const value: AppContextValue = {
    db,
    repositories,
    services,
    session,
    login({ role, userId, password }) {
      const normalizedUserId = role === "admin" ? defaultAdminId : userId || defaultDoctorId;
      const expectedPassword = resolvePassword(storedPasswords, role, normalizedUserId);
      if (password !== expectedPassword) {
        return {
          success: false,
          message: "密碼錯誤，請重新輸入。"
        };
      }

      setSession((current) => ({
        ...current,
        role,
        activeDoctorId: role === "doctor" ? normalizedUserId : current.activeDoctorId,
        activeAdminId: role === "admin" ? normalizedUserId : current.activeAdminId,
        activeRoutePlanId: role === "doctor" ? null : current.activeRoutePlanId,
        authenticatedDoctorId:
          role === "doctor" ? normalizedUserId : current.authenticatedDoctorId,
        authenticatedAdminId:
          role === "admin" ? normalizedUserId : current.authenticatedAdminId
      }));

      return {
        success: true,
        message: "登入成功。"
      };
    },
    logout(role) {
      setSession((current) => ({
        ...current,
        role: role === "admin" ? "doctor" : current.role,
        activeRoutePlanId: role === "doctor" ? null : current.activeRoutePlanId,
        authenticatedDoctorId:
          role === "doctor" ? null : current.authenticatedDoctorId,
        authenticatedAdminId:
          role === "admin" ? null : current.authenticatedAdminId,
        activeDoctorId:
          role === "doctor" ? db.doctors[0]?.id ?? current.activeDoctorId : current.activeDoctorId,
        activeAdminId:
          role === "admin" ? defaultAdminId : current.activeAdminId
      }));
    },
    changePassword({ role, userId, currentPassword, nextPassword }) {
      const expectedPassword = resolvePassword(storedPasswords, role, userId);
      if (currentPassword !== expectedPassword) {
        return {
          success: false,
          message: "目前密碼不正確。"
        };
      }
      if (!nextPassword.trim()) {
        return {
          success: false,
          message: "新密碼不可空白。"
        };
      }

      setStoredPasswords((current) =>
        updateStoredPassword(current, role, userId, nextPassword.trim())
      );
      return {
        success: true,
        message: "密碼已更新。"
      };
    },
    isAuthenticatedForRole(role) {
      return role === "doctor"
        ? Boolean(session.authenticatedDoctorId)
        : Boolean(session.authenticatedAdminId);
    },
    setRole(role) {
      setSession((current) => ({ ...current, role }));
    },
    setActiveDoctorId(doctorId) {
      setSession((current) => ({ ...current, activeDoctorId: doctorId, activeRoutePlanId: null }));
    },
    setActiveAdminId(adminId) {
      setSession((current) => ({ ...current, activeAdminId: defaultAdminId || adminId }));
    },
    setActiveRoutePlanId(routePlanId) {
      setSession((current) => ({ ...current, activeRoutePlanId: routePlanId }));
    }
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
