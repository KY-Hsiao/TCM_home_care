import { act, fireEvent, render, screen } from "@testing-library/react";
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

function prepareLastStopForReturnNavigation() {
  if (!capturedContext) {
    throw new Error("找不到 AppContext。");
  }

  const activeRoutePlan =
    capturedContext.session.activeRoutePlanId
      ? capturedContext.repositories.visitRepository.getSavedRoutePlanById(
          capturedContext.session.activeRoutePlanId
        )
      : capturedContext.repositories.visitRepository.getActiveRoutePlan("doc-001");

  if (!activeRoutePlan) {
    throw new Error("找不到目前執行中的路線。");
  }

  act(() => {
    capturedContext?.setActiveRoutePlanId(activeRoutePlan.id);
  });

  const routeSchedules = capturedContext.repositories.visitRepository.getDoctorRouteSchedules(
    "doc-001",
    activeRoutePlan.id
  );
  const lastSchedule = routeSchedules.at(-1);

  if (!lastSchedule) {
    throw new Error("找不到最後一站排程。");
  }

  routeSchedules.slice(0, -1).forEach((schedule, index) => {
    const baseHour = String(8 + Math.floor(index / 2)).padStart(2, "0");
    const departureAt = `2026-04-24T${baseHour}:${index % 2 === 0 ? "00" : "30"}:00.000Z`;
    const arrivalAt = `2026-04-24T${baseHour}:${index % 2 === 0 ? "15" : "45"}:00.000Z`;
    const completeAt = `2026-04-24T${baseHour}:${index % 2 === 0 ? "25" : "55"}:00.000Z`;

    act(() => {
      capturedContext?.repositories.visitRepository.startVisitTravel(schedule.id, departureAt);
    });
    act(() => {
      capturedContext?.repositories.visitRepository.confirmArrival(schedule.id, "doctor", arrivalAt);
    });
    act(() => {
      capturedContext?.repositories.visitRepository.confirmDeparture(schedule.id, "doctor", completeAt);
    });
  });

  act(() => {
    capturedContext?.repositories.visitRepository.startVisitTravel(
      lastSchedule.id,
      "2026-04-24T12:00:00.000Z"
    );
  });
  act(() => {
    capturedContext?.repositories.visitRepository.confirmArrival(
      lastSchedule.id,
      "doctor",
      "2026-04-24T12:20:00.000Z"
    );
  });

  const destinationQuery = encodeURIComponent(
    `${activeRoutePlan.end_latitude},${activeRoutePlan.end_longitude}`
  );

  return {
    destinationQuery
  };
}

describe("DoctorReturnNavigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
  });

  it("主畫面最後一站完成治療後，會直接開啟返院導航", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    const { destinationQuery } = prepareLastStopForReturnNavigation();

    fireEvent.click(screen.getByRole("button", { name: "完成治療，返回醫院" }));

    expect(openSpy).toHaveBeenCalled();
    expect(String(openSpy.mock.lastCall?.[0] ?? "")).toContain(`destination=${destinationQuery}`);
  });
});
