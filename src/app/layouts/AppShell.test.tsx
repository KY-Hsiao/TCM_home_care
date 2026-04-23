import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../providers";
import { useAppContext } from "../use-app-context";
import { AdminDashboardPage, AdminDoctorTrackingPage, AdminGuidePage } from "../../pages/admin/AdminPages";
import { DoctorLocationPage } from "../../pages/doctor/DoctorPages";
import { RoleSelectPage } from "../../pages/role-select/RoleSelectPage";
import { AppShell } from "./AppShell";
import { SESSION_STORAGE_KEY } from "../auth-storage";
import { createSeedDb } from "../../data/seed";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { DESKTOP_LINE_SETTINGS_STORAGE_KEY } from "../../services/line/desktop-line-settings";
import { sameAddressLocationKeyword } from "../../shared/utils/location-keyword";
import { isVisitFinished, isVisitUnlocked } from "../../modules/doctor/doctor-page-helpers";

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

function StartDoctorTrackingOnMount({ doctorId }: { doctorId: string }) {
  const { repositories, services } = useAppContext();

  useEffect(() => {
    const orderedSchedules = repositories.visitRepository.getDoctorDashboard(doctorId).todaySchedules;
    const targetSchedule = orderedSchedules.find((schedule) => {
      const record = repositories.visitRepository.getVisitRecordByScheduleId(schedule.id);
      return isVisitUnlocked(orderedSchedules, schedule.id, record) && !isVisitFinished(schedule.status);
    });

    if (!targetSchedule) {
      return;
    }

    const detail = repositories.visitRepository.getScheduleDetail(targetSchedule.id);
    if (!detail) {
      return;
    }

    if (services.visitAutomation.getTrackingState(targetSchedule.id)?.watchStatus === "running") {
      return;
    }

    const nextRecord =
      detail.record?.departure_time
        ? detail.record
        : repositories.visitRepository.startVisitTravel(targetSchedule.id) ?? detail.record;

    services.visitAutomation.startTracking({
      ...detail,
      record: nextRecord ?? detail.record,
      schedule: {
        ...detail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });
  }, [doctorId, repositories, services]);

  return null;
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

  it("行政頁只在醫師追蹤頁提供快捷聯絡醫師功能，且不提供切換到醫師端的入口", () => {
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

    renderShell("/admin/doctor-tracking", <AdminDoctorTrackingPage />);

    expect(screen.getByLabelText("快捷聯絡醫師")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "聯絡目前醫師" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看醫師位置" })).not.toBeInTheDocument();
    expect(
      screen.getByText("醫師定位追蹤固定留在行政端頁面內查看；除非先登出，否則不會切換到醫師端操作介面。")
    ).toBeInTheDocument();
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

  it("行政頁左側導覽順序會將教學指引放在最後，且不再顯示流程紀錄", () => {
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
      "提醒中心",
      "醫師追蹤",
      "個案管理",
      "排程管理",
      "角色設置",
      "教學指引"
    ]);
  });

  it("醫師頁未設定 LINE 入口時會回退到電話聯絡行政", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);
    const db = createSeedDb();
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

    renderShell(
      "/doctor/navigation",
      <>
        <StartDoctorTrackingOnMount doctorId="doc-001" />
        <DoctorLocationPage />
      </>
    );

    await waitFor(() => {
      expect(screen.getByText("聯絡行政 / 緊急求救")).toBeInTheDocument();
      expect(screen.getByText(/目前導航：/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "聯絡行政端" }));

    expect(openSpy).toHaveBeenCalledWith("tel:02-2765-2101", "_self", undefined);
    expect(screen.getByText("尚未設定 LINE 聯絡入口，已改用電話聯絡行政端。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "緊急求救" })).toBeInTheDocument();
  });

  it("醫師頁已設定 LINE 入口時會優先開啟 LINE", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);
    const db = createSeedDb();
    const activeSchedule = db.visit_schedules.find((schedule) => schedule.assigned_doctor_id === "doc-001");
    if (activeSchedule) {
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

    renderShell(
      "/doctor/navigation",
      <>
        <StartDoctorTrackingOnMount doctorId="doc-001" />
        <DoctorLocationPage />
      </>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "聯絡行政端" })).toBeInTheDocument();
    });
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

    renderShell("/doctor/navigation", <DoctorLocationPage />);

    expect(screen.queryByText("聯絡行政 / 緊急求救")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "聯絡行政端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "緊急求救" })).not.toBeInTheDocument();
  });

  it("醫師頁會將快捷摘要放在重置假資料下方，並以視窗顯示定位與案件摘要", () => {
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

    renderShell("/doctor/navigation", <DoctorLocationPage />);

    const resetButton = screen.getByRole("button", { name: "重置假資料" });
    const quickSummaryButton = screen.getByRole("button", { name: "快捷摘要" });
    const locationSharingCard = screen.getByText("醫師手機定位共享");

    expect(resetButton.compareDocumentPosition(quickSummaryButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      quickSummaryButton.compareDocumentPosition(locationSharingCard) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    fireEvent.click(quickSummaryButton);

    const summaryHeading = screen.getByRole("heading", { name: "導航同步摘要" });
    const summaryList = summaryHeading.parentElement?.parentElement?.nextElementSibling as HTMLElement | null;

    if (!summaryList) {
      throw new Error("找不到導航同步摘要內容區。");
    }

    expect(within(summaryList).getByText("目前帳號：蕭坤元醫師")).toBeInTheDocument();
    expect(within(summaryList).getByText("定位座標：24.99540, 121.55500")).toBeInTheDocument();
    expect(within(summaryList).getByText("最後更新：2026/04/24 09:30")).toBeInTheDocument();
    expect(within(summaryList).getByText("同步案件：第 2 站 / 蕭瑞芬")).toBeInTheDocument();
  });

  it("醫師頁左側導覽不再顯示排程清單", () => {
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

    renderShell("/doctor/navigation", <DoctorLocationPage />);

    expect(screen.getByRole("link", { name: /即時導航/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /排程清單/ })).not.toBeInTheDocument();
    expect(screen.getByText("這是醫師端介面。")).toBeInTheDocument();
    expect(screen.queryByText("模組入口")).not.toBeInTheDocument();
    expect(screen.queryByText("先以假資料跑通排程、訪視、通知與行政協作流程。")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "登出" }).length).toBeGreaterThan(0);
  });

  it("醫師登入後若未取得定位分享會明確顯示提醒", () => {
    Object.defineProperty(window.navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: (_success: unknown, error: (input: { code: number }) => void) => {
          error({ code: 1 });
          return 1;
        },
        clearWatch: vi.fn()
      }
    });
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

    renderShell("/doctor/navigation", <DoctorLocationPage />);

    expect(screen.getByText("醫師手機定位共享")).toBeInTheDocument();
    expect(
      screen.getByText("目前未取得定位分享：醫師端尚未允許定位，行政端目前無法看到即時位置。")
    ).toBeInTheDocument();
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

    renderShell("/admin/doctor-tracking", <AdminDoctorTrackingPage />);

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
