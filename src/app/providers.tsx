import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { AppContext, type AppContextValue, type AppDbSyncUiState } from "./app-context";
import {
  hasLocalDbSnapshot,
  loadDb,
  normalizeAppDbForCurrentVersion,
  persistDb,
  subscribeDbStorage
} from "../data/mock/db";
import { createRepositories } from "../data/mock/repositories";
import type { AppDb } from "../domain/models";
import type { SessionState } from "../domain/repository";
import { createAppServices } from "../services";
import type { AppServices } from "../services/types";
import {
  fetchServerAppDb,
  getAppDbSyncDebounceMs,
  persistAppDbSyncMetadata,
  persistServerAppDb
} from "../services/app-db-sync";
import {
  loadStoredPasswords,
  loadStoredSession,
  persistStoredPasswords,
  persistStoredSession,
  resolvePassword,
  updateStoredPassword
} from "./auth-storage";

function hasSubstantiveAppDbRecords(db: AppDb) {
  return db.patients.length > 0 || db.visit_schedules.length > 0 || db.saved_route_plans.length > 0;
}

function serializeAppDbForChangeDetection(db: AppDb) {
  return JSON.stringify(normalizeAppDbForCurrentVersion(db));
}

export function AppProviders({ children }: PropsWithChildren) {
  const hadLocalDbSnapshotRef = useRef(hasLocalDbSnapshot());
  const [db, setDb] = useState<AppDb>(() => loadDb());
  const [dbSync, setDbSync] = useState<AppDbSyncUiState>(() => ({
    source: hadLocalDbSnapshotRef.current ? "local_cache" : "local_seed",
    status: "loading",
    message: "正在讀取線上資料庫。",
    lastSyncedAt: null
  }));
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
  const serverWritesEnabledRef = useRef(false);
  const skipNextServerPersistRef = useRef(false);
  const protectedLocalDbBaselineRef = useRef<string | null>(null);

  const persistNormalizedDbToServer = (normalizedDb: AppDb) =>
    persistServerAppDb(normalizedDb).then((success) => {
      const syncedAt = new Date().toISOString();
      if (success) {
        serverWritesEnabledRef.current = true;
        protectedLocalDbBaselineRef.current = null;
        persistAppDbSyncMetadata({
          version: 1,
          source: "server",
          syncedAt,
          serverSnapshotUpdatedAt: syncedAt
        });
        setDbSync({
          source: "server",
          status: "synced",
          message: "目前資料來源：線上資料庫。",
          lastSyncedAt: syncedAt
        });
        return true;
      }

      setDbSync({
        source: "local_cache",
        status: "error",
        message: "線上資料庫寫入失敗，目前只保存在本機快取。",
        lastSyncedAt: null
      });
      return false;
    });

  useEffect(() => {
    let isCancelled = false;

    void fetchServerAppDb()
      .then((serverSnapshot) => {
        if (isCancelled) {
          return;
        }

        if (serverSnapshot) {
          const normalizedServerDb = normalizeAppDbForCurrentVersion(serverSnapshot.db);
          const syncedAt = new Date().toISOString();
          const serverSnapshotWasMigrated =
            JSON.stringify(normalizedServerDb) !== JSON.stringify(serverSnapshot.db);
          if (
            hadLocalDbSnapshotRef.current &&
            !hasSubstantiveAppDbRecords(normalizedServerDb) &&
            hasSubstantiveAppDbRecords(latestDbRef.current)
          ) {
            serverWritesEnabledRef.current = false;
            protectedLocalDbBaselineRef.current = serializeAppDbForChangeDetection(latestDbRef.current);
            setDbSync({
              source: "local_cache",
              status: "local_only",
              message: "線上資料庫目前沒有個案或排程，已保留本機快取；修改資料後會自動上傳到線上資料庫。",
              lastSyncedAt: null
            });
            return;
          }

          serverWritesEnabledRef.current = true;
          protectedLocalDbBaselineRef.current = null;
          skipNextServerPersistRef.current = true;
          setDb(normalizedServerDb);
          persistDb(normalizedServerDb);
          if (serverSnapshotWasMigrated) {
            void persistServerAppDb(normalizedServerDb);
          }
          persistAppDbSyncMetadata({
            version: 1,
            source: "server",
            syncedAt,
            serverSnapshotUpdatedAt: serverSnapshot.updatedAt
          });
          setDbSync({
            source: "server",
            status: "synced",
            message: "目前資料來源：線上資料庫。",
            lastSyncedAt: serverSnapshot.updatedAt ?? syncedAt
          });
          return;
        }

        serverWritesEnabledRef.current = false;
        protectedLocalDbBaselineRef.current = null;
        setDbSync({
          source: hadLocalDbSnapshotRef.current ? "local_cache" : "local_seed",
          status: "local_only",
          message: hadLocalDbSnapshotRef.current
            ? "線上資料庫讀取失敗，目前顯示本機快取；此狀態不會反寫到線上資料庫。"
            : "線上資料庫讀取失敗，目前顯示初始資料；此狀態不會反寫到線上資料庫。",
          lastSyncedAt: null
        });
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
    const normalizedCurrentDb = normalizeAppDbForCurrentVersion(latestDbRef.current);
    if (persistDbTimerRef.current) {
      window.clearTimeout(persistDbTimerRef.current);
      persistDbTimerRef.current = null;
    }
    persistDb(normalizedCurrentDb);

    const protectedLocalDbBaseline = protectedLocalDbBaselineRef.current;
    const shouldPromoteProtectedLocalDb =
      serverSyncReadyRef.current &&
      !serverWritesEnabledRef.current &&
      protectedLocalDbBaseline !== null &&
      hasSubstantiveAppDbRecords(normalizedCurrentDb) &&
      serializeAppDbForChangeDetection(normalizedCurrentDb) !== protectedLocalDbBaseline;

    if (serverSyncReadyRef.current && serverWritesEnabledRef.current) {
      if (skipNextServerPersistRef.current) {
        skipNextServerPersistRef.current = false;
      } else {
        if (persistServerDbTimerRef.current) {
          window.clearTimeout(persistServerDbTimerRef.current);
        }
        persistServerDbTimerRef.current = window.setTimeout(() => {
          void persistNormalizedDbToServer(normalizeAppDbForCurrentVersion(latestDbRef.current));
          persistServerDbTimerRef.current = null;
        }, getAppDbSyncDebounceMs());
      }
    } else if (shouldPromoteProtectedLocalDb) {
      if (persistServerDbTimerRef.current) {
        window.clearTimeout(persistServerDbTimerRef.current);
      }
      setDbSync({
        source: "local_cache",
        status: "loading",
        message: "偵測到本機快取已有修改，正在上傳到線上資料庫。",
        lastSyncedAt: null
      });
      persistServerDbTimerRef.current = window.setTimeout(() => {
        void persistNormalizedDbToServer(normalizeAppDbForCurrentVersion(latestDbRef.current));
        persistServerDbTimerRef.current = null;
      }, getAppDbSyncDebounceMs());
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
      if (serverSyncReadyRef.current && serverWritesEnabledRef.current) {
        void persistServerAppDb(normalizeAppDbForCurrentVersion(latestDbRef.current));
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
    dbSync,
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
    async uploadLocalDbToServer() {
      const normalizedDb = normalizeAppDbForCurrentVersion(latestDbRef.current);
      const success = await persistNormalizedDbToServer(normalizedDb);
      if (!success) {
        return {
          success: false,
          message: "上傳本機快取到線上資料庫失敗。"
        };
      }

      persistDb(normalizedDb);
      return {
        success: true,
        message: "已上傳本機快取到線上資料庫。"
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
