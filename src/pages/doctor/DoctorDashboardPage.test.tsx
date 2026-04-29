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

describe("DoctorDashboardPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    capturedContext = null;
  });

  it("可選擇已儲存路線並切換當前導航站點", () => {
    renderDashboard();

    expect(screen.getByRole("heading", { name: "即時導航" })).toBeInTheDocument();
    expect(screen.queryByText(/上午 \/ 1位/)).not.toBeInTheDocument();
    const afternoonRouteButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes("下午 /")
    );

    if (!afternoonRouteButton) {
      throw new Error("找不到今日下午路線按鈕。");
    }

    fireEvent.click(afternoonRouteButton);

    expect(screen.getByText("受試者名單")).toBeInTheDocument();
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
      ].some((patientName) => screen.queryAllByText(patientName).length > 0)
    ).toBe(true);
    expect(screen.queryByText("陳正雄")).not.toBeInTheDocument();
  });

  it("可從主畫面的即時導航區開始出發並切到即時導航流程", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    expect(openSpy).toHaveBeenCalled();
    expect(screen.getByText("即時導航")).toBeInTheDocument();
    expect(
      screen.queryByText("導航目的地會依患者順序接續，但到站與離站都改成手動確認，不再自動切換或自動結束 Google 地圖。")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("本站個案")).not.toBeInTheDocument();
    expect(screen.queryByText(/下一位 返院/)).not.toBeInTheDocument();
  });

  it("未開始導航時，即時導航頁會顯示待出發站點，但不會混入 seed 的舊定位", () => {
    renderLocationPage();

    expect(screen.queryByText("目前定位")).not.toBeInTheDocument();
    expect(screen.queryByText("最後更新")).not.toBeInTheDocument();
    expect(screen.queryByText("目前案件")).not.toBeInTheDocument();
    expect(screen.getByText(/即將前往第 1 站 蕭瑞芬/)).toBeInTheDocument();
    expect(screen.queryByText("同步案件：第 1 站 / 蕭瑞芬")).not.toBeInTheDocument();
    expect(screen.queryByText("李美蘭")).not.toBeInTheDocument();
    expect(screen.queryByText("24.99540, 121.55500")).not.toBeInTheDocument();
  });

  it("即時導航頁可先開受試者名單，再打開單人紀錄視窗", () => {
    renderLocationPage();

    const routeButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes("/ 8位")
    );

    if (!routeButton) {
      throw new Error("找不到今日路線按鈕。");
    }

    fireEvent.click(routeButton);

    expect(screen.getByText("受試者名單")).toBeInTheDocument();
    expect(screen.getAllByText("已排程").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /蕭瑞芬/ }));

    expect(screen.getByRole("heading", { name: "蕭瑞芬 訪視紀錄" })).toBeInTheDocument();
    expect(screen.getByText("查看個案")).toBeInTheDocument();
    expect(screen.getByText("撥打電話")).toBeInTheDocument();
    expect(screen.getByText("填寫紀錄")).toBeInTheDocument();
    expect(screen.getByText("標記暫停")).toBeInTheDocument();
  });

  it("受試者名單 modal 會顯示整條路線預覽 fallback 與外部 Google 路線按鈕", () => {
    renderLocationPage();

    const routeButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes("/ 8位")
    );

    if (!routeButton) {
      throw new Error("找不到今日路線按鈕。");
    }

    fireEvent.click(routeButton);

    expect(screen.getByText("路線圖預覽")).toBeInTheDocument();
    expect(screen.getByText("頁內路線圖尚未啟用")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用 Google 地圖開啟完整路線" })).toHaveAttribute(
      "href",
      expect.stringContaining("waypoints=")
    );
  });

  it("受試者名單 modal 在小螢幕改為靠底展開，避免內容過度偏上", () => {
    renderLocationPage();

    const routeButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes("/ 8位")
    );

    if (!routeButton) {
      throw new Error("找不到今日路線按鈕。");
    }

    fireEvent.click(routeButton);

    const routeListHeading = screen.getByRole("heading", { name: /4月23日 星期四下午 \/ 8位/ });
    const modalOverlay = routeListHeading.closest("div.fixed");

    expect(modalOverlay).toHaveClass("items-end");
    expect(modalOverlay).not.toHaveClass("items-center");
  });

  it("關閉單人紀錄後，會回到前一層受試者名單", () => {
    renderLocationPage();

    const routeButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes("/ 8位")
    );

    if (!routeButton) {
      throw new Error("找不到今日路線按鈕。");
    }

    fireEvent.click(routeButton);
    fireEvent.click(screen.getByRole("button", { name: /蕭瑞芬/ }));

    expect(screen.getByRole("heading", { name: "蕭瑞芬 訪視紀錄" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "關閉" }).at(-1)!);

    expect(screen.queryByRole("heading", { name: "蕭瑞芬 訪視紀錄" })).not.toBeInTheDocument();
    expect(screen.getByText("受試者名單")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /蕭瑞芬/ })).toBeInTheDocument();
  });

  it("今日導航路線不再重複放出發按鈕，改由即時導航區啟動", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    expect(screen.queryByRole("button", { name: "出發" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    expect(openSpy).toHaveBeenCalled();
    expect(screen.getByText("即時導航")).toBeInTheDocument();
  });

  it("可用路線重置按鈕將目前路線回到第一位待出發患者", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    expect(openSpy).toHaveBeenCalled();
    expect(screen.getByText("前往 蕭瑞芬 的停留點")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置路線" }));

    expect(screen.queryByText("前往 蕭瑞芬 的停留點")).not.toBeInTheDocument();
    expect(screen.getByText(/即將前往第 1 站/)).toBeInTheDocument();
  });

  it("跑到下一站後，重置路線仍會回到第一位待出發患者", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));
    fireEvent.click(screen.getByRole("button", { name: "已抵達，開始治療" }));
    expect(screen.getByText(/按下後會直接開啟下一家 .+ 的 Google 地圖導航。/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成治療，前往下一家" }));

    expect(openSpy).toHaveBeenCalled();
    expect(screen.queryByText("前往 蕭瑞芬 的停留點")).not.toBeInTheDocument();
    expect(screen.getByText(/前往 .* 的停留點/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置路線" }));

    const activeRoutePlanId = capturedContext?.session.activeRoutePlanId ?? null;
    const activeRoutePlan = activeRoutePlanId
      ? capturedContext?.repositories.visitRepository.getSavedRoutePlanById(activeRoutePlanId)
      : capturedContext?.repositories.visitRepository.getActiveRoutePlan("doc-001");
    const routeSchedules = capturedContext?.repositories.visitRepository.getDoctorRouteSchedules(
      "doc-001",
      activeRoutePlan?.id ?? null
    );
    const activeCheckedRouteItems =
      activeRoutePlan?.route_items
        .filter((item) => item.checked)
        .sort((left, right) => (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER)) ?? [];
    const firstRouteItem = activeCheckedRouteItems[0];

    expect(activeCheckedRouteItems.map((item) => item.route_order)).toEqual(
      activeCheckedRouteItems.map((_, index) => index + 1)
    );
    expect(routeSchedules?.slice(0, 2).map((schedule) => schedule.route_order)).toEqual([1, 2]);

    expect(screen.queryByText(/前往 .* 的停留點/)).not.toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`即將前往第 1 站 ${firstRouteItem?.patient_name ?? ""}`))
    ).toBeInTheDocument();
  });
});
