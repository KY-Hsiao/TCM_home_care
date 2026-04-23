import { createContext } from "react";
import type { AppDb } from "../domain/models";
import type { AppRepositories, SessionState } from "../domain/repository";
import type { AppServices } from "../services/types";

export type AppContextValue = {
  db: AppDb;
  repositories: AppRepositories;
  services: AppServices;
  session: SessionState;
  login: (input: {
    role: "doctor" | "admin";
    userId: string;
    password: string;
  }) => { success: boolean; message: string };
  logout: (role: "doctor" | "admin") => void;
  changePassword: (input: {
    role: "doctor" | "admin";
    userId: string;
    currentPassword: string;
    nextPassword: string;
  }) => { success: boolean; message: string };
  isAuthenticatedForRole: (role: "doctor" | "admin") => boolean;
  setRole: (role: SessionState["role"]) => void;
  setActiveDoctorId: (doctorId: string) => void;
  setActiveAdminId: (adminId: string) => void;
  setActiveRoutePlanId: (routePlanId: string | null) => void;
  resetMockData: () => void;
};

export const AppContext = createContext<AppContextValue | undefined>(undefined);
