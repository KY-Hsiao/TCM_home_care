import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

  const view = render(
    <MemoryRouter initialEntries={["/doctor/navigation"]}>
      <AppProviders>
        <CaptureAppContext />
        <Routes>
          <Route path="/doctor/navigation" element={<DoctorLocationPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
  activateForwardRouteForTest();
  return view;
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

  const view = render(
    <MemoryRouter>
      <AppProviders>
        <CaptureAppContext />
        <DoctorLocationPage />
      </AppProviders>
    </MemoryRouter>
  );
  activateForwardRouteForTest();
  return view;
}

function activateForwardRouteForTest() {
  if (!capturedContext) {
    return;
  }
  const ctx = capturedContext;
  const routePlan = ctx.repositories.visitRepository
    .getSavedRoutePlans({ doctorId: "doc-001" })
    .find((plan) => {
      const routeSchedules = ctx.repositories.visitRepository.getDoctorRouteSchedules("doc-001", plan.id);
      return routeSchedules.filter((schedule) => schedule.status === "scheduled").length >= 2;
    });
  if (!routePlan) {
    return;
  }
  act(() => {
    ctx.repositories.visitRepository.upsertSavedRoutePlan({
      ...routePlan,
      execution_status: "executing",
      executed_at: new Date().toISOString()
    });
    ctx.setActiveRoutePlanId(routePlan.id);
    ctx.repositories.visitRepository.resetRoutePlanProgress(routePlan.id);
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

function resetCurrentRouteFromNavigationModal() {
  fireEvent.click(screen.getAllByRole("button", { name: "重置路線" })[0]);
}

function openCurrentRouteList() {
  openNavigationModal();

  const routeButton = screen.getAllByRole("button").find((button) =>
    button.textContent?.includes("點這裡查看受試者名單與單人紀錄")
  );

  if (!routeButton) {
    throw new Error("找不到今日路線按鈕。");
  }

  fireEvent.click(routeButton);
}

function getActiveRoutePlan() {
  const ctx = capturedContext;

  if (!ctx) {
    throw new Error("找不到 AppContext。");
  }

  const activeRoutePlan = ctx.session.activeRoutePlanId
    ? ctx.repositories.visitRepository.getSavedRoutePlanById(ctx.session.activeRoutePlanId)
    : ctx.repositories.visitRepository.getActiveRoutePlan(ctx.session.activeDoctorId);

  if (!activeRoutePlan) {
    throw new Error("找不到目前路線。");
  }

  return activeRoutePlan;
}

function getFirstRoutePatientName() {
  const activeRoutePlan = getActiveRoutePlan();
  const firstRouteItem = activeRoutePlan.route_items
    .filter((item) => item.checked)
    .sort((left, right) => (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER))[0];

  if (!firstRouteItem) {
    throw new Error("找不到路線第一位患者。");
  }

  return firstRouteItem.patient_name;
}

function expectNavigationWindowOrExternalOpen(openSpy: { mock: { calls: unknown[][] } }) {
  const navigationWindow = screen.queryByRole("dialog", { name: "Google 導航視窗" });
  if (navigationWindow) {
    expect(
      within(navigationWindow).getByRole("button", { name: /關閉導航|已抵達，回到即時導航/ })
    ).toBeInTheDocument();
    expect(within(navigationWindow).getByRole("link", { name: /外部 Google 地圖/ })).toBeInTheDocument();
    return;
  }
  expect(openSpy.mock.calls.length).toBeGreaterThan(0);
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
    openNavigationModal();

    const routeButton = screen.getAllByRole("button").find((button) =>
      button.textContent?.includes("點這裡查看受試者名單與單人紀錄")
    );

    if (!routeButton) {
      throw new Error("找不到今日路線按鈕。");
    }

    fireEvent.click(routeButton);

    expect(screen.getByText("受試者名單")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用 Google 地圖開啟完整路線" })).toBeInTheDocument();
  });

  it("可從主畫面的即時導航區開始出發並切到即時導航流程", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    openNavigationModal();
    resetCurrentRouteFromNavigationModal();
    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    expectNavigationWindowOrExternalOpen(openSpy);
    expect(screen.getByRole("heading", { name: "即時導航" })).toBeInTheDocument();
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
    openNavigationModal();
    resetCurrentRouteFromNavigationModal();
    const firstPatientName = getFirstRoutePatientName();
    expect(screen.getByText(new RegExp(`即將前往第 1 站 ${maskPatientName(firstPatientName)}`))).toBeInTheDocument();
    expect(screen.queryByText(`同步案件：第 1 站 / ${maskPatientName(firstPatientName)}`)).not.toBeInTheDocument();
    expect(screen.queryByText("李美蘭")).not.toBeInTheDocument();
    expect(screen.queryByText("24.99540, 121.55500")).not.toBeInTheDocument();
  });

  it("即時導航頁可先開受試者名單，再打開單人紀錄視窗", () => {
    renderLocationPage();
    const firstPatientName = getFirstRoutePatientName();

    openCurrentRouteList();

    expect(screen.getByText("受試者名單")).toBeInTheDocument();
    expect(screen.getAllByText("已排程").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(maskPatientName(firstPatientName)) }));

    expect(screen.getByRole("heading", { name: `${maskPatientName(firstPatientName)} 訪視紀錄` })).toBeInTheDocument();
    expect(screen.getByText("查看個案")).toBeInTheDocument();
    expect(screen.getByText("撥打電話")).toBeInTheDocument();
    expect(screen.getByText("填寫紀錄")).toBeInTheDocument();
    expect(screen.getByText("目前患者暫停")).toBeInTheDocument();
  });

  it("受試者名單 modal 會顯示整條路線的頁內預覽與外部 Google 路線按鈕", () => {
    renderLocationPage();

    openCurrentRouteList();

    expect(screen.getByText("路線圖預覽")).toBeInTheDocument();
    expect(screen.getByText("頁內示意路線預覽")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /頁內路線圖預覽/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用 Google 地圖開啟完整路線" })).toHaveAttribute(
      "href",
      expect.stringContaining("waypoints=")
    );
  });

  it("受試者名單 modal 在小螢幕改為靠底展開，避免內容過度偏上", () => {
    renderLocationPage();

    openCurrentRouteList();

    const routeListHeading = screen.getByRole("heading", { name: /\d+月\d+日 星期.上午|下午 \/ \d+位/ });
    const modalOverlay = routeListHeading.closest("div.fixed");

    expect(modalOverlay).toHaveClass("items-end");
    expect(modalOverlay).not.toHaveClass("items-center");
  });

  it("關閉單人紀錄後，會回到前一層受試者名單", () => {
    renderLocationPage();
    const firstPatientName = getFirstRoutePatientName();

    openCurrentRouteList();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(maskPatientName(firstPatientName)) }));

    expect(screen.getByRole("heading", { name: `${maskPatientName(firstPatientName)} 訪視紀錄` })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "關閉" }).at(-1)!);

    expect(screen.queryByRole("heading", { name: `${maskPatientName(firstPatientName)} 訪視紀錄` })).not.toBeInTheDocument();
    expect(screen.getByText("受試者名單")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(maskPatientName(firstPatientName)) })).toBeInTheDocument();
  });

  it("今日導航路線不再重複放出發按鈕，改由即時導航區啟動", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    expect(screen.queryByRole("button", { name: "出發" })).not.toBeInTheDocument();
    openNavigationModal();
    resetCurrentRouteFromNavigationModal();
    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    expectNavigationWindowOrExternalOpen(openSpy);
    expect(screen.getByRole("heading", { name: "即時導航" })).toBeInTheDocument();
  });

  it("可用路線重置按鈕將目前路線回到第一位待出發患者", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    openNavigationModal();
    resetCurrentRouteFromNavigationModal();
    const firstPatientName = getFirstRoutePatientName();
    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    expectNavigationWindowOrExternalOpen(openSpy);
    expect(screen.getByText(`前往 ${maskPatientName(firstPatientName)} 的停留點`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置路線" }));

    expect(screen.queryByText(`前往 ${maskPatientName(firstPatientName)} 的停留點`)).not.toBeInTheDocument();
    expect(screen.getByText(/即將前往第 1 站/)).toBeInTheDocument();
  });

  it("重置路線會讀取行政端重新儲存的同日同時段新版本", async () => {
    renderDashboard();

    openNavigationModal();
    resetCurrentRouteFromNavigationModal();

    const ctx = capturedContext;
    if (!ctx) {
      throw new Error("找不到 AppContext。");
    }

    const currentRoutePlan = getActiveRoutePlan();
    const checkedRouteItems = currentRoutePlan.route_items
      .filter((item) => item.checked)
      .sort((left, right) => (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER));
    const newFirstRouteItem = checkedRouteItems.at(-1);
    if (!newFirstRouteItem) {
      throw new Error("找不到可反轉的新路線站點。");
    }

    const correctedRoutePlanId = `route-${currentRoutePlan.doctor_id}-${currentRoutePlan.route_date}-${currentRoutePlan.route_weekday}-${currentRoutePlan.service_time_slot}`;
    const now = new Date().toISOString();

    act(() => {
      ctx.repositories.visitRepository.upsertSavedRoutePlan({
        ...currentRoutePlan,
        id: correctedRoutePlanId,
        route_group_id: correctedRoutePlanId,
        route_name: `${currentRoutePlan.route_name} 修正版`,
        schedule_ids: [],
        route_items: [
          ...checkedRouteItems
            .slice()
            .reverse()
            .map((item, index) => ({
              ...item,
              schedule_id: null,
              route_order: index + 1,
              status: "scheduled" as const
            })),
          ...currentRoutePlan.route_items
            .filter((item) => !item.checked)
            .map((item) => ({
              ...item,
              schedule_id: null,
              route_order: null,
              status: "paused" as const
            }))
        ],
        execution_status: "draft",
        executed_at: null,
        saved_at: now,
        updated_at: now
      });
    });

    await waitFor(() => {
      expect(
        capturedContext?.repositories.visitRepository.getSavedRoutePlanById(correctedRoutePlanId)?.execution_status
      ).toBe("executing");
    });

    fireEvent.click(screen.getByRole("button", { name: "重置路線" }));

    await waitFor(() => {
      const resetRoutePlan = capturedContext?.repositories.visitRepository.getSavedRoutePlanById(correctedRoutePlanId);
      const firstRouteItem = resetRoutePlan?.route_items
        .filter((item) => item.checked)
        .sort((left, right) => (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER))[0];

      expect(capturedContext?.session.activeRoutePlanId).toBe(correctedRoutePlanId);
      expect(firstRouteItem?.patient_id).toBe(newFirstRouteItem.patient_id);
      expect(
        screen.getByText(new RegExp(`即將前往第 1 站 ${maskPatientName(newFirstRouteItem.patient_name)}`))
      ).toBeInTheDocument();
    });
  });

  it("導航途中可將目前患者標記暫停並接續下一位", () => {
    renderDashboard();

    openNavigationModal();
    resetCurrentRouteFromNavigationModal();
    const firstPatientName = getFirstRoutePatientName();
    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));

    const navigationWindow = screen.queryByRole("dialog", { name: "Google 導航視窗" });
    if (navigationWindow) {
      fireEvent.click(within(navigationWindow).getByRole("button", { name: "目前患者暫停" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "目前患者暫停" }));
    }

    const activeRoutePlan = getActiveRoutePlan();
    const firstRouteItem = activeRoutePlan.route_items.find(
      (item) => item.patient_name === firstPatientName
    );
    const nextRouteItem = activeRoutePlan.route_items
      .filter((item) => item.checked && item.status !== "paused")
      .sort((left, right) => (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER))[0];
    const pausedSchedule = firstRouteItem?.schedule_id
      ? capturedContext?.repositories.visitRepository.getScheduleDetail(firstRouteItem.schedule_id)
      : null;

    expect(firstRouteItem?.status).toBe("paused");
    expect(pausedSchedule?.schedule.status).toBe("paused");
    expect(screen.queryByText(`前往 ${maskPatientName(firstPatientName)} 的停留點`)).not.toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`即將前往第 1 站 ${maskPatientName(nextRouteItem?.patient_name ?? "")}`))
    ).toBeInTheDocument();
  });

  it("即時導航可一鍵通報訪視異常並同步行政通知中心", () => {
    renderDashboard();

    openNavigationModal();
    resetCurrentRouteFromNavigationModal();
    const firstPatientName = getFirstRoutePatientName();
    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));
    fireEvent.click(screen.getByRole("button", { name: "地址錯誤" }));

    const activeRoutePlan = getActiveRoutePlan();
    const reportedRouteItem = activeRoutePlan.route_items.find(
      (item) => item.patient_name === firstPatientName
    );
    const reportedSchedule = reportedRouteItem?.schedule_id
      ? capturedContext?.repositories.visitRepository.getScheduleDetail(reportedRouteItem.schedule_id)
      : null;
    const adminNotifications =
      capturedContext?.repositories.notificationRepository.getNotificationCenterItems("admin") ?? [];
    const exceptionNotification = adminNotifications.find(
      (item) =>
        item.title === "訪視異常通報｜地址錯誤" &&
        item.linked_visit_schedule_id === reportedRouteItem?.schedule_id
    );

    expect(reportedRouteItem?.status).toBe("paused");
    expect(reportedSchedule?.schedule.status).toBe("issue_pending");
    expect(reportedSchedule?.record?.visit_feedback_code).toBe("admin_followup");
    expect(exceptionNotification?.status).toBe("pending");
    expect(exceptionNotification?.content).toContain("地址或定位資訊錯誤");
    expect(screen.queryByText(`前往 ${maskPatientName(firstPatientName)} 的停留點`)).not.toBeInTheDocument();
  });

  it("跑到下一站後，重置路線仍會回到第一位待出發患者", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(window);

    renderDashboard();

    openNavigationModal();
    resetCurrentRouteFromNavigationModal();
    const firstPatientName = getFirstRoutePatientName();
    fireEvent.click(screen.getByRole("button", { name: "開始出發" }));
    fireEvent.click(screen.getByRole("button", { name: "已抵達，開始治療" }));
    expect(screen.getByText(/按下後會在頁內開啟下一家 .+ 的 Google 導航。/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成治療，前往下一家" }));

    expectNavigationWindowOrExternalOpen(openSpy);
    expect(screen.queryByText(`前往 ${maskPatientName(firstPatientName)} 的停留點`)).not.toBeInTheDocument();
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
      screen.getByText(new RegExp(`即將前往第 1 站 ${maskPatientName(firstRouteItem?.patient_name ?? "")}`))
    ).toBeInTheDocument();
  });
});
