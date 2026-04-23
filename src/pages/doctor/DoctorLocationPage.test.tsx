import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { DoctorLocationPage } from "./DoctorPages";

function renderDoctorLocationPage() {
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

  return render(
    <MemoryRouter>
      <AppProviders>
        <DoctorLocationPage />
      </AppProviders>
    </MemoryRouter>
  );
}

describe("DoctorLocationPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("只會顯示醫師自己的導航摘要與即時更新的導航按鍵", () => {
    renderDoctorLocationPage();

    expect(screen.getByText("即時導航")).toBeInTheDocument();
    expect(screen.queryByText("今日訪視總數")).not.toBeInTheDocument();
    expect(screen.queryByText("進行中案件")).not.toBeInTheDocument();
    expect(screen.queryByText("待出發案件")).not.toBeInTheDocument();
    expect(screen.queryByText("待提醒事項")).not.toBeInTheDocument();
    expect(screen.queryByTitle("醫師目前位置 Google 地圖")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看目前位置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開啟本站導航" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開啟下一站導航" })).not.toBeInTheDocument();
    expect(screen.queryByText("最近移動軌跡")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "切換醫師位置" })).not.toBeInTheDocument();
    expect(screen.queryByText("切換醫師位置")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "開始出發" })).toBeInTheDocument();
    expect(screen.queryByText(/按開始出發後會外接 Google 地圖導航至第 2 站 蕭瑞芬/)).not.toBeInTheDocument();
    expect(screen.queryByText("同步案件：第 2 站 / 蕭瑞芬")).not.toBeInTheDocument();
  });
});
