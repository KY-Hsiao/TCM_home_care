import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../providers";
import {
  AdminDashboardPage,
  AdminDoctorTrackingPage,
  AdminRemindersPage,
  AdminTeamCommunicationPage
} from "../../pages/admin/AdminPages";
import { DoctorLeaveRequestPage, DoctorLocationPage, DoctorTeamCommunicationPage } from "../../pages/doctor/DoctorPages";
import { RoleSelectPage } from "../../pages/role-select/RoleSelectPage";
import { AppShell } from "./AppShell";
import { SESSION_STORAGE_KEY } from "../auth-storage";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { createSeedDb } from "../../data/seed";

function renderShell(initialEntry: string, element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppProviders>
        <Routes>
          <Route path="/" element={<RoleSelectPage />} />
          <Route element={<AppShell />}>
            <Route path={initialEntry} element={element} />
            <Route path="/admin/team-communication" element={<AdminTeamCommunicationPage />} />
            <Route path="/doctor/team-communication" element={<DoctorTeamCommunicationPage />} />
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

  it("行政頁左側導覽會顯示通知中心標籤，且不再顯示教學指引", () => {
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

    renderShell("/admin/reminders", <AdminRemindersPage />);

    expect(within(screen.getByRole("navigation")).getByRole("link", { name: /通知中心/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /教學指引/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "通知中心" })).toBeInTheDocument();
  });

  it("行政頁左側導覽順序會改成通知中心，且不再顯示教學指引", () => {
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
      "通知中心",
      "待處理請假",
      "醫師追蹤",
      "團隊通訊",
      "個案管理",
      "排程管理",
      "角色設置"
    ]);
  });

  it("登入後若有未讀通知，Shell 會明確顯示未讀提示", () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        notification_center_items: [
          {
            id: "nc-unread-admin-001",
            role: "admin",
            owner_user_id: "admin-001",
            source_type: "manual_notice",
            title: "待查看站內訊息",
            content: "請先檢查剛收到的醫師回報。",
            linked_patient_id: null,
            linked_visit_schedule_id: null,
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-29T09:00:00+08:00",
            updated_at: "2026-04-29T09:00:00+08:00"
          }
        ]
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

    expect(screen.getAllByText(/通知中心（未讀 1）/).length).toBeGreaterThan(0);
    expect(screen.getByText("目前有 1 則未讀通知，請先查看通知中心。")).toBeInTheDocument();
  });

  it("Shell 內雙擊通知標題後會自動清除未讀提示", async () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        notification_center_items: [
          {
            id: "nc-unread-admin-open-001",
            role: "admin",
            owner_user_id: "admin-001",
            source_type: "manual_notice",
            title: "待查看站內訊息",
            content: "請先檢查剛收到的醫師回報。",
            linked_patient_id: null,
            linked_visit_schedule_id: null,
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-29T09:00:00+08:00",
            updated_at: "2026-04-29T09:00:00+08:00"
          }
        ]
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

    renderShell("/admin/reminders", <AdminRemindersPage />);

    expect(screen.getAllByText(/通知中心（未讀 1）/).length).toBeGreaterThan(0);
    expect(screen.getByText("目前有 1 則未讀通知，請先查看通知中心。")).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole("button", { name: /待查看站內訊息/ }));

    await waitFor(() => {
      expect(screen.queryByText(/通知中心（未讀 1）/)).not.toBeInTheDocument();
      expect(screen.queryByText("目前有 1 則未讀通知，請先查看通知中心。")).not.toBeInTheDocument();
    });
  });

  it("行政端可從左側目錄進入團隊通訊頁", () => {
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

    renderShell("/admin/team-communication", <AdminTeamCommunicationPage />);

    expect(within(screen.getByRole("navigation")).getByRole("link", { name: /團隊通訊/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "團隊通訊" })).toBeInTheDocument();
    expect(screen.getByLabelText("訊息內容")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/蕭坤元醫師/)).toBeInTheDocument();
  });

  it("醫師端團隊通訊頁會直接顯示對話區，不再另外開視窗", () => {
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

    renderShell("/doctor/team-communication", <DoctorTeamCommunicationPage />);

    expect(within(screen.getByRole("navigation")).getByRole("link", { name: /團隊通訊/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "團隊通訊" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("訊息內容")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/行政人員/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開啟團隊通訊" })).not.toBeInTheDocument();
    expect(screen.queryByText("對話對象")).not.toBeInTheDocument();
    expect(screen.queryByText("目前案件")).not.toBeInTheDocument();
    expect(screen.queryByText("最近聯絡時間")).not.toBeInTheDocument();
    expect(screen.queryByText(/對話對象：行政人員/)).not.toBeInTheDocument();
  });

  it("行政傳給醫師的未讀團隊通訊，醫師打開團隊通訊後會立刻轉成已讀並切換為綠燈", async () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        notification_center_items: [
          {
            id: "nc-team-doctor-unread-001",
            role: "doctor",
            owner_user_id: "doc-001",
            source_type: "manual_notice",
            title: "院內對話｜第 2 站 王○珠",
            content: "行政人員提醒：請完成後回報返院時間。",
            linked_patient_id: "pat-001",
            linked_visit_schedule_id: "vs-003",
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-30T09:20:00+08:00",
            updated_at: "2026-04-30T09:20:00+08:00"
          }
        ]
      })
    );
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

    renderShell("/doctor/team-communication", <DoctorTeamCommunicationPage />);

    expect(screen.getAllByText(/團隊通訊/).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "團隊通訊已讀綠燈" })).toBeInTheDocument();
      expect(within(screen.getByRole("navigation")).getByRole("link", { name: /團隊通訊/ })).not.toHaveTextContent(
        "1"
      );
      expect(screen.queryByText("行政人員有 1 則未讀團隊通訊")).not.toBeInTheDocument();
      expect(screen.queryByText("行政人員剛送來 1 則未讀團隊通訊，請立即查看。")).not.toBeInTheDocument();
      expect(screen.queryByText("全部已讀")).not.toBeInTheDocument();
    });
  });

  it("醫師看過團隊通訊後再離開頁面，左側未讀標籤不會跳回未讀", async () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        notification_center_items: [
          {
            id: "nc-team-doctor-unread-route-leave-001",
            role: "doctor",
            owner_user_id: "doc-001",
            source_type: "manual_notice",
            title: "院內對話｜第 2 站 王○珠",
            content: "行政人員提醒：請回報目前出發狀態。",
            linked_patient_id: "pat-001",
            linked_visit_schedule_id: "vs-003",
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-30T09:25:00+08:00",
            updated_at: "2026-04-30T09:25:00+08:00"
          }
        ]
      })
    );
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

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "團隊通訊未讀紅燈" })).toBeInTheDocument();
      expect(within(screen.getByRole("navigation")).getByRole("link", { name: /團隊通訊/ })).toHaveTextContent("1");
    });

    fireEvent.click(within(screen.getByRole("navigation")).getByRole("link", { name: /團隊通訊/ }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "團隊通訊已讀綠燈" })).toBeInTheDocument();
    });

    fireEvent.click(within(screen.getByRole("navigation")).getByRole("link", { name: /即時導航/ }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "團隊通訊已讀綠燈" })).toBeInTheDocument();
      expect(
        within(screen.getByRole("navigation")).getByRole("link", { name: /團隊通訊/ })
      ).not.toHaveTextContent("未讀 1 則");
    });
  });

  it("醫師端導航頁不再顯示舊的聯絡行政浮動卡，但可改用院內對話視窗", () => {
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
    expect(screen.getByRole("button", { name: "團隊通訊" })).toBeInTheDocument();
  });

  it("醫師端左側導覽會新增請假申請入口，並可送出申請", () => {
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

    renderShell("/doctor/leave-requests", <DoctorLeaveRequestPage />);

    const navLabels = within(screen.getByRole("navigation"))
      .getAllByRole("link")
      .map((link) => link.querySelector("div")?.textContent?.trim());

    expect(navLabels).toEqual(["即時導航", "回院病歷", "請假申請", "團隊通訊", "通知中心"]);

    fireEvent.change(screen.getByLabelText("請假原因"), {
      target: { value: "上午院內會議" }
    });
    fireEvent.click(screen.getByRole("button", { name: "送出請假申請" }));

    expect(screen.getByRole("status")).toHaveTextContent("請假申請已送出");
  });

  it("醫師端可刪除自己的請假申請紀錄", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        leave_requests: [
          {
            id: "leave-delete-001",
            doctor_id: "doc-001",
            start_date: "2026-05-01",
            end_date: "2026-05-01",
            reason: "上午院內會議",
            handoff_note: "請協助調整第一站排程。",
            status: "pending",
            created_at: "2026-04-30T08:00:00+08:00",
            updated_at: "2026-04-30T08:00:00+08:00"
          }
        ]
      })
    );
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

    renderShell("/doctor/leave-requests", <DoctorLeaveRequestPage />);

    expect(screen.getByText("上午院內會議")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "刪除請假單" })[0]);

    expect(screen.getByRole("status")).toHaveTextContent("請假申請已刪除");
    expect(screen.queryByText("上午院內會議")).not.toBeInTheDocument();
  });

  it("醫師端可從院內對話視窗送出給行政的站內訊息", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "團隊通訊" }));
    fireEvent.change(screen.getByLabelText("訊息內容"), {
      target: { value: "已抵達前一站，預計 10 分鐘後回院整理病歷。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "送出站內訊息" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("站內訊息已送出")
    );
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(
      (storedDb.notification_center_items ?? []).some(
        (item: { role: string; content: string; owner_user_id: string }) =>
          item.role === "admin" &&
          item.owner_user_id === "admin-001" &&
          item.content === "已抵達前一站，預計 10 分鐘後回院整理病歷。"
      )
    ).toBe(true);
  });

  it("醫師端送出站內訊息後，行政端重新打開團隊通訊頁可以看到內容", async () => {
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

    const doctorView = renderShell("/doctor/team-communication", <DoctorTeamCommunicationPage />);

    fireEvent.change(screen.getByLabelText("訊息內容"), {
      target: { value: "醫師端回報：已完成第 2 站，準備返院。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "送出站內訊息" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("站內訊息已送出")
    );
    doctorView.unmount();

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

    renderShell("/admin/team-communication", <AdminTeamCommunicationPage />);

    await waitFor(() => {
      expect(screen.getByText("醫師端回報：已完成第 2 站，準備返院。")).toBeInTheDocument();
      expect(screen.getByText(/蕭坤元醫師 已送出站內訊息/)).toBeInTheDocument();
    });
  });

  it("醫師端團隊通訊視窗只保留文字訊息", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "團隊通訊" }));

    expect(screen.getByLabelText("訊息內容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出站內訊息" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "語音通話" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開始語音通話" })).not.toBeInTheDocument();
  });

  it("醫師頁會保留快捷摘要，並以視窗顯示定位與案件摘要", () => {
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

    const quickSummaryButton = screen.getByRole("button", { name: "快捷摘要" });
    const locationSharingCard = screen.getByText("醫師手機定位共享");

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
    expect(within(summaryList).getByText("定位座標：22.88590, 120.50140")).toBeInTheDocument();
    expect(within(summaryList).getByText(/最後更新：20\d{2}\/\d{2}\/\d{2} 09:30/)).toBeInTheDocument();
    expect(
      within(summaryList).getByText((text) => text.startsWith("同步案件：第 ") && text.includes(" / "))
    ).toBeInTheDocument();
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

  it("Shell 不再顯示重置假資料按鈕，並以通知中心入口取代站內通知抽屜", () => {
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

    expect(screen.queryByRole("button", { name: "重置假資料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /站內通知/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /通知中心/ }).length).toBeGreaterThan(0);
  });
});
