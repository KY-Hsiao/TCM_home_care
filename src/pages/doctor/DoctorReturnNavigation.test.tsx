import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { useAppContext } from "../../app/use-app-context";
import { DoctorLocationPage } from "./DoctorDashboardAndSchedulePages";

let capturedContext: ReturnType<typeof useAppContext> | null = null;

function CaptureAppContext() {
  capturedContext = useAppContext();
  return null;
}

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
    <MemoryRouter initialEntries={["/doctor/navigation"]}>
      <AppProviders>
        <CaptureAppContext />
        <Routes>
          <Route path="/doctor/navigation" element={<DoctorLocationPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

describe("DoctorReturnNavigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
  });

  it("主畫面最後一站完成治療後，會直接開啟返院導航", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    expect(screen.queryByRole("button", { name: "開啟即時導航" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "即時導航全頁視窗" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "重置路線" })[0]);

    const activeRoutePlan =
      capturedContext?.repositories.visitRepository.getActiveRoutePlan("doc-001") ?? null;

    if (!activeRoutePlan) {
      throw new Error("找不到目前執行中的路線。");
    }

    const destinationQuery = encodeURIComponent(
      `${activeRoutePlan.end_latitude},${activeRoutePlan.end_longitude}`
    );

    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    let returned = false;
    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "已抵達，開始治療" }));

      const returnButton = screen.queryByRole("button", { name: "完成治療，返回醫院" });
      if (returnButton) {
        fireEvent.click(returnButton);
        returned = true;
        break;
      }

      fireEvent.click(screen.getByRole("button", { name: "完成治療，前往下一家" }));
    }

    expect(returned).toBe(true);
    expect(openSpy).toHaveBeenCalled();
    expect(String(openSpy.mock.lastCall?.[0] ?? "")).toContain(`destination=${destinationQuery}`);
  });
});
