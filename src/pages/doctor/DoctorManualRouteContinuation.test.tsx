import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { useAppContext } from "../../app/use-app-context";
import { maskPatientName } from "../../shared/utils/patient-name";
import { DoctorLocationPage } from "./DoctorDashboardAndSchedulePages";

let capturedContext: ReturnType<typeof useAppContext> | null = null;

function CaptureAppContext() {
  capturedContext = useAppContext();
  return null;
}

function renderLocationPage() {
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
        <CaptureAppContext />
        <DoctorLocationPage />
      </AppProviders>
    </MemoryRouter>
  );
}

function getCurrentAndNextStop() {
  if (!capturedContext) {
    throw new Error("找不到 AppContext。");
  }

  const ctx = capturedContext;
  const activeRoutePlan =
    ctx.session.activeRoutePlanId
      ? ctx.repositories.visitRepository.getSavedRoutePlanById(ctx.session.activeRoutePlanId)
      : ctx.repositories.visitRepository.getActiveRoutePlan(ctx.session.activeDoctorId);
  const routeSchedules = ctx.repositories.visitRepository.getDoctorRouteSchedules(
    ctx.session.activeDoctorId,
    activeRoutePlan?.id ?? null
  );
  const currentSchedule = routeSchedules[0];
  const nextSchedule = routeSchedules[1];

  if (!currentSchedule || !nextSchedule) {
    throw new Error("找不到可測試的前後站排程。");
  }

  const currentDetail = ctx.repositories.visitRepository.getScheduleDetail(currentSchedule.id);
  const nextDetail = ctx.repositories.visitRepository.getScheduleDetail(nextSchedule.id);

  if (!currentDetail || !nextDetail) {
    throw new Error("找不到站點詳細資料。");
  }

  return {
    ctx,
    activeRoutePlan,
    currentSchedule,
    nextSchedule,
    currentDetail,
    nextDetail
  };
}

function resetRouteProgress() {
  const { ctx, activeRoutePlan } = getCurrentAndNextStop();

  if (!activeRoutePlan) {
    throw new Error("找不到目前路線。");
  }

  act(() => {
    ctx.repositories.visitRepository.resetRoutePlanProgress(activeRoutePlan.id);
  });
}

function openNavigationModal() {
  expect(screen.queryByRole("button", { name: "開啟即時導航" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "即時導航全頁視窗" })).not.toBeInTheDocument();
  expect(
    screen.getAllByRole("button").some((button) =>
      button.textContent?.includes("點這裡查看受試者名單與單人紀錄")
    )
  ).toBe(true);
}

function openCurrentPatientDetail(patientName: string) {
  openNavigationModal();

  const routeButton = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.includes("點這裡查看受試者名單與單人紀錄"));

  if (!routeButton) {
    throw new Error("找不到今日路線按鈕。");
  }

  fireEvent.click(routeButton);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(maskPatientName(patientName)) }));
}

describe("DoctorManualRouteContinuation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
    vi.restoreAllMocks();
  });

  it("單人紀錄開始行程時，會在頁內開啟目前這一家的導航", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderLocationPage();
    resetRouteProgress();

    const { currentDetail } = getCurrentAndNextStop();

    openCurrentPatientDetail(currentDetail.patient.name);
    fireEvent.click(screen.getByRole("button", { name: "開始行程" }));

    const navigationWindow = screen.getByRole("dialog", { name: "Google 導航視窗" });
    expect(openSpy).not.toHaveBeenCalled();
    expect(within(navigationWindow).getByRole("link", { name: /外部 Google 地圖/ })).toHaveAttribute(
      "href",
      expect.stringContaining(`destination=${encodeURIComponent(currentDetail.schedule.address_snapshot)}`)
    );
  });

  it("單人紀錄治療完成後接續下一站時，會在頁內開啟下一家的導航", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderLocationPage();
    resetRouteProgress();

    const { ctx, currentSchedule, currentDetail, nextDetail } = getCurrentAndNextStop();

    act(() => {
      ctx.repositories.visitRepository.startVisitTravel(
        currentSchedule.id,
        "2026-04-24T01:00:00.000Z"
      );
    });
    act(() => {
      ctx.repositories.visitRepository.confirmArrival(
        currentSchedule.id,
        "doctor",
        "2026-04-24T01:20:00.000Z"
      );
    });

    openCurrentPatientDetail(currentDetail.patient.name);
    fireEvent.click(screen.getByRole("button", { name: "啟程去下一個據點" }));

    const navigationWindow = screen.getByRole("dialog", { name: "Google 導航視窗" });
    const externalLink = within(navigationWindow).getByRole("link", { name: /外部 Google 地圖/ });
    expect(openSpy).not.toHaveBeenCalled();
    expect(externalLink).toHaveAttribute(
      "href",
      expect.stringContaining(`destination=${encodeURIComponent(nextDetail.schedule.address_snapshot)}`)
    );
    expect(externalLink.getAttribute("href") ?? "").not.toContain(
      `destination=${encodeURIComponent(currentDetail.schedule.address_snapshot)}`
    );
  });

});
