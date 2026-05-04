import { AppProviders } from "../../app/providers";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { RoleSelectPage } from "./RoleSelectPage";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { createSeedDb } from "../../data/seed";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";

describe("RoleSelectPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  function renderRoleSelect() {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppProviders>
          <Routes>
            <Route path="/" element={<RoleSelectPage />} />
            <Route path="/doctor/navigation" element={<div>醫師首頁</div>} />
            <Route path="/admin/dashboard" element={<div>行政首頁</div>} />
          </Routes>
        </AppProviders>
      </MemoryRouter>
    );
  }

  it("會顯示單一帳號下拉與單一密碼欄位，且預設密碼提示為 0000", () => {
    renderRoleSelect();

    expect(screen.getByText("登入系統")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "選擇帳號" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("登入密碼")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "醫師 - 蕭坤元醫師" })).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "行政人員" })).toHaveLength(1);
    expect(
      screen.getByText(/醫師登入後會立即要求手機瀏覽器定位分享/)
    ).toBeInTheDocument();
    expect(screen.getByText(/預設密碼為 `0000`/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "登入並進入" })).toHaveLength(1);
  });

  it("密碼錯誤時會顯示錯誤訊息", () => {
    renderRoleSelect();

    fireEvent.change(screen.getByLabelText("登入密碼"), {
      target: { value: "1111" }
    });
    fireEvent.click(screen.getByRole("button", { name: "登入並進入" }));

    expect(screen.getByRole("status")).toHaveTextContent("密碼錯誤");
  });

  it("選醫師帳號並輸入正確密碼後會進入醫師頁", () => {
    renderRoleSelect();

    fireEvent.change(screen.getByRole("combobox", { name: "選擇帳號" }), {
      target: { value: "doctor:doc-001" }
    });
    fireEvent.change(screen.getByLabelText("登入密碼"), {
      target: { value: "0000" }
    });
    fireEvent.click(screen.getByRole("button", { name: "登入並進入" }));

    expect(screen.getByText("醫師首頁")).toBeInTheDocument();
  });

  it("選行政人員並輸入正確密碼後會用單一行政角色進入行政頁", async () => {
    renderRoleSelect();

    fireEvent.change(screen.getByRole("combobox", { name: "選擇帳號" }), {
      target: { value: "admin:admin-001" }
    });
    fireEvent.change(screen.getByLabelText("登入密碼"), {
      target: { value: "0000" }
    });
    fireEvent.click(screen.getByRole("button", { name: "登入並進入" }));

    expect(screen.getByText("行政首頁")).toBeInTheDocument();
    await waitFor(() => {
      const session = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "{}");
      expect(session.activeAdminId).toBe("admin-001");
      expect(session.authenticatedAdminId).toBe("admin-001");
    });
  });

  it("既有瀏覽器若存到其他行政帳號，也會收斂成單一行政角色", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-002",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-002"
      })
    );
    renderRoleSelect();

    const accountSelect = screen.getByRole("combobox", { name: "選擇帳號" });

    expect(accountSelect).toHaveValue("admin:admin-001");
    expect(screen.getAllByRole("option", { name: "行政人員" })).toHaveLength(1);
    await waitFor(() => {
      const session = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "{}");
      expect(session.activeAdminId).toBe("admin-001");
      expect(session.authenticatedAdminId).toBe("admin-001");
    });
  });

  it("若帳號有未讀通知，登入頁會依目前選取帳號顯示未讀提醒", () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        notification_center_items: [
          {
            id: "nc-unread-doc-001",
            role: "doctor",
            owner_user_id: "doc-001",
            source_type: "manual_notice",
            title: "醫師未讀通知",
            content: "請回院後補上病歷。",
            linked_patient_id: null,
            linked_visit_schedule_id: "vs-003",
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-29T09:00:00+08:00",
            updated_at: "2026-04-29T09:00:00+08:00"
          },
          {
            id: "nc-unread-admin-001",
            role: "admin",
            owner_user_id: "admin-001",
            source_type: "manual_notice",
            title: "行政未讀通知",
            content: "請查看新的回報。",
            linked_patient_id: null,
            linked_visit_schedule_id: null,
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-29T09:01:00+08:00",
            updated_at: "2026-04-29T09:01:00+08:00"
          }
        ]
      })
    );

    renderRoleSelect();

    expect(screen.getByText("醫師 - 蕭坤元醫師 目前有 1 則未讀通知，登入後請先查看通知中心。")).toBeInTheDocument();
    expect(screen.queryByText("行政人員 目前有 1 則未讀通知，登入後請先查看通知中心。")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "選擇帳號" }), {
      target: { value: "admin:admin-001" }
    });

    expect(screen.getByText("行政人員 目前有 1 則未讀通知，登入後請先查看通知中心。")).toBeInTheDocument();
  });
});
