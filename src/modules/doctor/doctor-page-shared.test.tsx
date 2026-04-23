import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { loadDb, persistDb } from "../../data/mock/db";
import { DoctorVisitCard } from "./doctor-page-shared";

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
    <MemoryRouter>
      <AppProviders>
        <DoctorVisitCard scheduleId={scheduleId} />
      </AppProviders>
    </MemoryRouter>
  );
}

describe("DoctorVisitCard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("按下開始行程時會直接開啟本站導航", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderDoctorVisitCard("vs-021", "doc-001");

    fireEvent.click(screen.getByRole("button", { name: "開始行程" }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("導航進行中")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "叫出總目錄" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "結束導航" })).toBeInTheDocument();
    expect(screen.getByText("靠近導航目的地 100 公尺內時會自動出現「已抵達」")).toBeInTheDocument();
  });

  it("導航中可以結束導航並再接續行程", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderDoctorVisitCard("vs-021", "doc-001");

    fireEvent.click(screen.getByRole("button", { name: "開始行程" }));
    fireEvent.click(screen.getByRole("button", { name: "結束導航" }));

    expect(screen.queryByText("導航進行中")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接續行程" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "接續行程" }));

    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText("導航進行中")).toBeInTheDocument();
  });

  it("導航中可以叫出今日總目錄", () => {
    vi.spyOn(window, "open").mockImplementation(() => null);

    renderDoctorVisitCard("vs-021", "doc-001");

    fireEvent.click(screen.getByRole("button", { name: "開始行程" }));
    fireEvent.click(screen.getByRole("button", { name: "叫出總目錄" }));

    expect(screen.getByText("今日總目錄")).toBeInTheDocument();
  });

  it("已抵達後會提示可啟程去下一個據點", () => {
    renderDoctorVisitCard("vs-005", "doc-001");

    expect(screen.getByText("已抵達，完成治療後可按「啟程去下一個據點」。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "啟程去下一個據點" })).toBeInTheDocument();
  });

  it("最後一站會顯示行程完畢按鈕", () => {
    const db = loadDb();
    persistDb({
      ...db,
      visit_schedules: db.visit_schedules.map((schedule) =>
        schedule.id === "vs-006" ? { ...schedule, route_order: 99 } : schedule
      )
    });

    renderDoctorVisitCard("vs-006", "doc-001");

    expect(screen.getByText("已抵達最後一站，完成治療後請按「行程完畢」。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "行程完畢" })).toBeInTheDocument();
  });
});
