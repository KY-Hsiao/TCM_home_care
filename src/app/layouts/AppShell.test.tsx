import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../providers";
import { AdminDashboardPage, AdminGuidePage } from "../../pages/admin/AdminPages";
import { DoctorDashboardPage } from "../../pages/doctor/DoctorPages";
import { RoleSelectPage } from "../../pages/role-select/RoleSelectPage";
import { AppShell } from "./AppShell";
import { SESSION_STORAGE_KEY } from "../auth-storage";
import { createSeedDb } from "../../data/seed";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { DESKTOP_LINE_SETTINGS_STORAGE_KEY } from "../../services/line/desktop-line-settings";
import { sameAddressLocationKeyword } from "../../shared/utils/location-keyword";

function renderShell(initialEntry: string, element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppProviders>
        <Routes>
          <Route path="/" element={<RoleSelectPage />} />
          <Route element={<AppShell />}>
            <Route path={initialEntry} element={element} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("行政頁可登出回到首頁，且不再顯示角色切換", () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderShell("/admin/dashboard", <AdminDashboardPage />);

    expect(screen.queryByText("角色切換")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "登出" }));

    expect(screen.getByText("居家醫師")).toBeInTheDocument();
    expect(screen.getByText("行政管理")).toBeInTheDocument();
  });

  it("行政頁會提供快捷聯絡醫師按鈕", () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderShell("/admin/dashboard", <AdminDashboardPage />);

    expect(screen.getByLabelText("快捷聯絡醫師")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "聯絡目前醫師" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看醫師位置" })).toBeInTheDocument();
  });

  it("行政頁左側導覽會顯示教學指引標籤", () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderShell("/admin/guide", <AdminGuidePage />);

    expect(screen.getByRole("link", { name: /教學指引/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "教學指引" })).toBeInTheDocument();
  });

  it("行政頁左側導覽順序會將教學指引放在最後，且角色設置排在流程紀錄前", () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderShell("/admin/dashboard", <AdminDashboardPage />);

    const navLabels = within(screen.getByRole("navigation"))
      .getAllByRole("link")
      .map((link) => link.querySelector("div")?.textContent?.trim());

    expect(navLabels).toEqual([
      "行政總覽",
      "醫師追蹤",
      "個案管理",
      "排程管理",
      "角色設置",
      "流程紀錄",
      "教學指引"
    ]);
  });

  it("醫師頁未設定 LINE 入口時會回退到電話聯絡行政", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);
    const db = createSeedDb();
    const activeSchedule = db.visit_schedules.find((schedule) => schedule.assigned_doctor_id === "doc-001");
    const activeRecord = activeSchedule
      ? db.visit_records.find((record) => record.visit_schedule_id === activeSchedule.id)
      : null;
    if (activeSchedule && activeRecord) {
      activeSchedule.status = "tracking";
      activeRecord.departure_time = activeSchedule.scheduled_start_at;
      activeRecord.arrival_time = null;
      activeRecord.departure_from_patient_home_time = null;
    }
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(db));
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "doctor",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: "doc-001",
        authenticatedAdminId: null
      })
    );

    renderShell("/doctor/dashboard", <DoctorDashboardPage />);

    expect(screen.getByText("聯絡行政 / 緊急求救")).toBeInTheDocument();
    expect(screen.getByText(/目前導航：/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "聯絡行政端" }));

    expect(openSpy).toHaveBeenCalledWith("tel:02-2765-2101", "_self", undefined);
    expect(screen.getByText("尚未設定 LINE 聯絡入口，已改用電話聯絡行政端。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "緊急求救" })).toBeInTheDocument();
  });

  it("醫師頁已設定 LINE 入口時會優先開啟 LINE", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);
    const db = createSeedDb();
    const activeSchedule = db.visit_schedules.find((schedule) => schedule.assigned_doctor_id === "doc-001");
    const activeRecord = activeSchedule
      ? db.visit_records.find((record) => record.visit_schedule_id === activeSchedule.id)
      : null;
    if (activeSchedule && activeRecord) {
      activeSchedule.status = "tracking";
      activeRecord.departure_time = activeSchedule.scheduled_start_at;
      activeRecord.arrival_time = null;
      activeRecord.departure_from_patient_home_time = null;
      activeSchedule.location_keyword_snapshot = sameAddressLocationKeyword;
    }
    db.communication_settings.doctor_contact_line_url = "line://msg/text/admin";
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(db));
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "doctor",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: "doc-001",
        authenticatedAdminId: null
      })
    );

    renderShell("/doctor/dashboard", <DoctorDashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "聯絡行政端" }));

    expect(openSpy).toHaveBeenCalledWith("line://msg/text/admin", "_blank", "noopener,noreferrer");
    expect(screen.getByText("已嘗試開啟行政 LINE 對話；若未跳轉，請改用電話聯絡。")).toBeInTheDocument();
  });

  it("醫師未在導航期間時不顯示聯絡行政浮動卡", () => {
    const db = createSeedDb();
    db.visit_schedules
      .filter((schedule) => schedule.assigned_doctor_id === "doc-001")
      .forEach((schedule) => {
        if (["on_the_way", "tracking", "proximity_pending"].includes(schedule.status)) {
          schedule.status = "waiting_departure";
        }
      });
    db.visit_records
      .filter((record) =>
        db.visit_schedules.some(
          (schedule) => schedule.id === record.visit_schedule_id && schedule.assigned_doctor_id === "doc-001"
        )
      )
      .forEach((record) => {
        record.departure_time = null;
        record.arrival_time = null;
      });
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(db));
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "doctor",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: "doc-001",
        authenticatedAdminId: null
      })
    );

    renderShell("/doctor/dashboard", <DoctorDashboardPage />);

    expect(screen.queryByText("聯絡行政 / 緊急求救")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "聯絡行政端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "緊急求救" })).not.toBeInTheDocument();
  });

  it("行政頁聯絡目前醫師時會呼叫桌面 LINE helper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        stage: "open_chat",
        message: "已切換到蕭坤元醫師的 LINE 對話。",
        fallbackRecommended: false
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "open").mockReturnValue(window);
    window.localStorage.setItem(
      DESKTOP_LINE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        helper_base_url: "http://127.0.0.1:8765",
        launch_line_if_needed: true,
        line_window_hint: "LINE"
      })
    );
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderShell("/admin/dashboard", <AdminDashboardPage />);

    fireEvent.click(screen.getByRole("button", { name: "聯絡目前醫師" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:8765/line/open-chat",
        expect.objectContaining({
          method: "POST"
        })
      )
    );
    expect(screen.getByText("已切換到蕭坤元醫師的 LINE 對話。")).toBeInTheDocument();
  });
});
