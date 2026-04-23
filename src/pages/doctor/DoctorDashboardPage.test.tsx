import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { DoctorDashboardPage } from "./DoctorDashboardAndSchedulePages";

function renderDashboard() {
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      role: "doctor",
      activeDoctorId: "doc-001",
      activeAdminId: "admin-001",
      activeRoutePlanId: null,
      authenticatedDoctorId: "doc-001",
      authenticatedAdminId: null
    })
  );

  return render(
    <MemoryRouter>
      <AppProviders>
        <DoctorDashboardPage />
      </AppProviders>
    </MemoryRouter>
  );
}

describe("DoctorDashboardPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("可選擇已儲存路線並切換當前導航站點", () => {
    renderDashboard();

    expect(screen.getByRole("heading", { name: "今日導航路線" })).toBeInTheDocument();
    const afternoonRouteButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes("下午 /")
    );

    if (!afternoonRouteButton) {
      throw new Error("找不到今日下午路線按鈕。");
    }

    fireEvent.click(afternoonRouteButton);

    expect(screen.getByText(/下午路線/)).toBeInTheDocument();
    expect(
      [
        "蕭瑞芬",
        "劉錦堂",
        "何阿惜",
        "彭世傑",
        "許秋蓮",
        "張順發",
        "吳玉鳳",
        "陳清山"
      ].some((patientName) => screen.queryByText(patientName))
    ).toBe(true);
    expect(screen.queryByText("陳正雄")).not.toBeInTheDocument();
  });
});
