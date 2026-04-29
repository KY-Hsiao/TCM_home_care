import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { AppContext, type AppContextValue } from "./app-context";
import { loadDb, persistDb, resetDb, subscribeDbStorage } from "../data/mock/db";
import { createRepositories } from "../data/mock/repositories";
import type { AppDb } from "../domain/models";
import type { SessionState } from "../domain/repository";
import { createAppServices } from "../services";
import type { AppServices } from "../services/types";
import {
  clearStoredPasswords,
  clearStoredSession,
  loadStoredPasswords,
  loadStoredSession,
  persistStoredPasswords,
  persistStoredSession,
  resolvePassword,
  updateStoredPassword
} from "./auth-storage";
export { useAppContext } from "./use-app-context";

export function AppProviders({ children }: PropsWithChildren) {
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
    const authenticatedAdminId =
      typeof storedSession.authenticatedAdminId === "string"
        ? defaultAdminId
        : null;

    return {
      role: storedSession.role === "admin" ? "admin" : "doctor",
      activeDoctorId:
        typeof storedSession.activeDoctorId === "string"
          ? storedSession.activeDoctorId
          : authenticatedDoctorId ?? defaultDoctorId,
      activeAdminId:
        authenticatedAdminId ?? defaultAdminId,
      activeRoutePlanId:
        typeof storedSession.activeRoutePlanId === "string"
          ? storedSession.activeRoutePlanId
          : null,
      authenticatedDoctorId,
      authenticatedAdminId
    };
  });

  useEffect(() => {
    persistDb(db);
  }, [db]);

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
      const normalizedUserId = role === "admin" ? defaultAdminId : userId;
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
        activeAdminId: role === "admin" ? defaultAdminId : current.activeAdminId,
        activeRoutePlanId: role === "doctor" ? null : current.activeRoutePlanId,
        authenticatedDoctorId:
          role === "doctor" ? normalizedUserId : current.authenticatedDoctorId,
        authenticatedAdminId:
          role === "admin" ? defaultAdminId : current.authenticatedAdminId
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
      setSession((current) => ({ ...current, activeAdminId: adminId }));
    },
    setActiveRoutePlanId(routePlanId) {
      setSession((current) => ({ ...current, activeRoutePlanId: routePlanId }));
    },
    resetMockData() {
      services.visitAutomation.resetAll();
      clearStoredSession();
      clearStoredPasswords();
      setDb(resetDb());
      setStoredPasswords({});
      setSession({
        role: "doctor",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        activeRoutePlanId: null,
        authenticatedDoctorId: null,
        authenticatedAdminId: null
      });
    }
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
