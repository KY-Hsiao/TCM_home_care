import { AppProviders } from "../../app/providers";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { RoleSelectPage } from "./RoleSelectPage";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { createSeedDb } from "../../data/seed";

describe("RoleSelectPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("會顯示醫師與行政兩個登入入口，且預設密碼提示為 0000", () => {
    render(
      <MemoryRouter>
        <AppProviders>
          <RoleSelectPage />
        </AppProviders>
      </MemoryRouter>
    );

    expect(screen.getByText("居家醫師")).toBeInTheDocument();
    expect(screen.getByText("行政管理")).toBeInTheDocument();
    expect(screen.getByText("共用行政帳號")).toBeInTheDocument();
    expect(screen.getByText("行政人員")).toBeInTheDocument();
    expect(
      screen.getByText(/醫師登入後會立即要求手機瀏覽器定位分享/)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/預設密碼為 `0000`/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "登入並進入" }).length).toBe(2);
  });

  it("密碼錯誤時會顯示錯誤訊息", () => {
    render(
      <MemoryRouter>
        <AppProviders>
          <RoleSelectPage />
        </AppProviders>
      </MemoryRouter>
    );

    fireEvent.change(screen.getAllByLabelText("登入密碼")[0], {
      target: { value: "1111" }
    });
    fireEvent.click(screen.getAllByRole("button", { name: "登入並進入" })[0]);

    expect(screen.getByRole("status")).toHaveTextContent("密碼錯誤");
  });

  it("若帳號有未讀通知，登入頁會先顯示未讀提醒", () => {
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

    render(
      <MemoryRouter>
        <AppProviders>
          <RoleSelectPage />
        </AppProviders>
      </MemoryRouter>
    );

    expect(screen.getByText("這個醫師帳號目前有 1 則未讀通知，登入後請先查看通知中心。")).toBeInTheDocument();
    expect(screen.getByText("行政人員目前有 1 則未讀通知，登入後請先查看通知中心。")).toBeInTheDocument();
  });
});
