import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { DoctorVisitCard } from "./doctor-page-shared";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderDoctorVisitCard(scheduleId: string, activeDoctorId = "doc-001") {
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      role: "doctor",
      activeDoctorId,
      activeAdminId: "admin-001",
      authenticatedDoctorId: activeDoctorId,
      authenticatedAdminId: null
    })
  );

  return render(
    <MemoryRouter initialEntries={["/doctor/schedules"]}>
      <AppProviders>
        <Routes>
          <Route
            path="/doctor/schedules"
            element={
              <>
                <DoctorVisitCard scheduleId={scheduleId} />
                <LocationProbe />
              </>
            }
          />
          <Route
            path="/doctor/navigation"
            element={
              <>
                <div>即時導航頁</div>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

describe("DoctorVisitCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("按下開始行程時會切到即時導航頁，並外接 Google 地圖", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDoctorVisitCard("vs-021", "doc-001");

    fireEvent.click(screen.getByRole("button", { name: "開始行程" }));

    expect(openSpy).toHaveBeenCalled();
    expect(screen.getByText("即時導航頁")).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/doctor/navigation");
  });

  it("已出發的案件會用前往即時導航按鈕切到即時導航頁，並外接 Google 地圖", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDoctorVisitCard("vs-005", "doc-001");

    fireEvent.click(screen.getByRole("button", { name: "前往即時導航" }));

    expect(openSpy).toHaveBeenCalled();
    expect(screen.getByText("即時導航頁")).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/doctor/navigation");
  });

  it("排程卡不再直接顯示導航地圖 iframe", () => {
    renderDoctorVisitCard("vs-021", "doc-001");

    expect(screen.queryByTitle(/導航地圖-/)).not.toBeInTheDocument();
    expect(
      screen.getByText("排程清單目前只保留案件資訊與狀態操作；Google 地圖導航集中從「即時導航」開啟。")
    ).toBeInTheDocument();
  });

  it("治療中且後面仍有站點時，會顯示啟程去下一個據點按鈕", () => {
    renderDoctorVisitCard("vs-005", "doc-001");

    expect(screen.getByText("已抵達，完成治療後可按「啟程去下一個據點」。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "啟程去下一個據點" })).toBeInTheDocument();
  });

  it("中途中斷後接續下一站時，會外接下一站而不是目前這一站的導航", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDoctorVisitCard("vs-005", "doc-001");

    const currentAddressText = screen.getByText(/地址：/).textContent ?? "";
    const currentAddress = currentAddressText.replace("地址：", "").trim();

    fireEvent.click(screen.getByRole("button", { name: "啟程去下一個據點" }));

    expect(openSpy).toHaveBeenCalled();
    expect(screen.getByText("即時導航頁")).toBeInTheDocument();
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/doctor/navigation");
    expect(String(openSpy.mock.lastCall?.[0] ?? "")).not.toContain(
      `destination=${encodeURIComponent(currentAddress)}`
    );
  });
});
