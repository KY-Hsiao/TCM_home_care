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

  it("只會顯示醫師自己的目前位置地圖與軌跡摘要", () => {
    renderDoctorLocationPage();

    expect(screen.getByText("Google 地圖 / 目前位置")).toBeInTheDocument();
    expect(screen.getByTitle("醫師目前位置 Google 地圖")).toBeInTheDocument();
    expect(screen.getByText("目前位置摘要")).toBeInTheDocument();
    expect(screen.queryByText("最近移動軌跡")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "切換醫師位置" })).not.toBeInTheDocument();
    expect(screen.queryByText("切換醫師位置")).not.toBeInTheDocument();
    expect(screen.getByText("目前帳號：蕭坤元醫師")).toBeInTheDocument();
    expect(screen.getByText(/這個分頁只顯示你自己的手機網頁目前位置/)).toBeInTheDocument();
  });
});
