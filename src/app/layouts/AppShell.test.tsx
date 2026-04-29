import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../providers";
import { AdminDashboardPage, AdminDoctorTrackingPage, AdminGuidePage } from "../../pages/admin/AdminPages";
import { DoctorLocationPage } from "../../pages/doctor/DoctorPages";
import { RoleSelectPage } from "../../pages/role-select/RoleSelectPage";
import { AppShell } from "./AppShell";
import { SESSION_STORAGE_KEY } from "../auth-storage";

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

  it("行政頁醫師追蹤頁不再顯示快捷聯絡醫師區塊", () => {
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

    expect(screen.queryByLabelText("快捷聯絡醫師")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "聯絡目前醫師" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看醫師位置" })).not.toBeInTheDocument();
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

  it("醫師端導航頁不再顯示聯絡行政浮動卡", () => {
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
    expect(within(summaryList).getByText("最後更新：2026/04/29 09:30")).toBeInTheDocument();
    expect(within(summaryList).getByText("同步案件：第 2 站 / 李美蘭")).toBeInTheDocument();
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

  it("行政頁醫師追蹤頁不再呼叫外部 LINE helper", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "聯絡目前醫師" })).not.toBeInTheDocument();
  });
});
