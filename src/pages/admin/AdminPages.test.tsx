import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { createSeedDb } from "../../data/seed";
import { DoctorLocationPage, DoctorTeamCommunicationPage } from "../doctor/DoctorPages";
import {
  AdminDashboardPage,
  AdminDoctorTrackingPage,
  AdminLeaveRequestsPage,
  AdminPatientsPage,
  AdminRemindersPage,
  AdminSchedulesPage,
  AdminStaffPage,
  AdminTeamCommunicationPage
} from "./AdminPages";

function renderWithProviders(page: ReactNode) {
  return render(
    <MemoryRouter>
      <AppProviders>{page}</AppProviders>
    </MemoryRouter>
  );
}

async function readBlobAsText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

async function readBlobAsBytes(blob: Blob) {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function selectScheduleFilters(routeDate = "2026-04-29") {
  fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
    target: { value: "doc-001" }
  });
  fireEvent.change(screen.getByLabelText("路線日期"), {
    target: { value: routeDate }
  });
}

function openSlotPatientDialog() {
  fireEvent.click(screen.getByRole("button", { name: "選擇符合時段個案" }));
  return screen.getByRole("dialog", { name: "符合時段的個案清單視窗" });
}

function openRouteEndpointsDialog() {
  fireEvent.click(screen.getByRole("button", { name: "設定起終點" }));
  return screen.getByRole("dialog", { name: "起終點設定視窗" });
}

function resolveTimeSlot(dateTime: string) {
  return new Date(dateTime).getHours() < 12 ? "上午" : "下午";
}

describe("AdminPages", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("AdminSchedulesPage 會依醫師、星期與時段自動列出符合條件的個案", () => {
    renderWithProviders(<AdminSchedulesPage />);

    expect(screen.getByText("起點：旗山醫院｜終點：旗山醫院")).toBeInTheDocument();
    expect(screen.getByText("全部排程清單")).toBeInTheDocument();
    expect(screen.getByText("排程 vs-002")).toBeInTheDocument();
    expect(screen.getAllByText("蕭坤元醫師").length).toBeGreaterThan(0);
    expect(screen.queryByText("林若謙醫師")).not.toBeInTheDocument();

    selectScheduleFilters();
    const slotPatientDialog = openSlotPatientDialog();

    expect(within(slotPatientDialog).getByText("目前共有 8 位個案")).toBeInTheDocument();
    expect(within(slotPatientDialog).getByLabelText("王○珠 勾選")).toBeChecked();
    expect(within(slotPatientDialog).getByLabelText("陳○雄 勾選")).toBeChecked();
    expect(within(slotPatientDialog).getAllByText("高雄市旗山區延平一路 128 號").length).toBeGreaterThan(0);
    expect(within(slotPatientDialog).getAllByText("高雄市旗山區中華路 76 號").length).toBeGreaterThan(0);
    expect(within(slotPatientDialog).getAllByRole("button", { name: "結案" })).toHaveLength(8);
  });

  it("AdminSchedulesPage 選醫師後只顯示該醫師可用日期，並在選日期後帶入星期與時段", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T09:00:00+08:00"));

    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
      target: { value: "doc-001" }
    });

    const routeDateSelect = screen.getByLabelText("路線日期");
    const routeDateOptions = within(routeDateSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(routeDateOptions.length).toBeGreaterThan(1);
    expect(routeDateOptions[0]).toBe("請選擇日期");
    expect(routeDateOptions.some((option) => option?.includes("2026/05/06"))).toBe(true);
    expect(routeDateOptions.some((option) => option?.includes("2026/05/07"))).toBe(true);
    expect(routeDateOptions.some((option) => option?.includes("2026/06/04"))).toBe(false);
    expect(routeDateSelect).toHaveValue("2026-04-29");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期三");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("上午");

    fireEvent.change(routeDateSelect, {
      target: { value: "2026-05-06" }
    });

    const weekdaySelect = screen.getByRole("combobox", { name: "篩選星期" });
    const weekdayOptions = within(weekdaySelect)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(weekdayOptions).toEqual(["請選擇星期", "星期三"]);
    expect(weekdaySelect).toHaveValue("星期三");

    const timeSlotSelect = screen.getByRole("combobox", { name: "篩選時段" });
    const timeSlotOptions = within(timeSlotSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(timeSlotOptions).toContain("上午");
    expect(timeSlotSelect).toHaveValue("上午");
  });

  it("AdminSchedulesPage 會依醫師可服務時段原始順序帶入同日預設時段", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T09:00:00+08:00"));

    const customDb = createSeedDb();
    customDb.doctors = customDb.doctors.map((doctor) =>
      doctor.id === "doc-001"
        ? {
            ...doctor,
            available_service_slots: ["星期三下午", "星期三上午", "星期四下午"]
          }
        : doctor
    );
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));

    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
      target: { value: "doc-001" }
    });

    fireEvent.change(screen.getByLabelText("路線日期"), {
      target: { value: "2026-05-06" }
    });

    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-05-06");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期三");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("下午");

    const timeSlotOptions = within(screen.getByRole("combobox", { name: "篩選時段" }))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(timeSlotOptions).toEqual(["請選擇時段", "下午", "上午"]);
  });

  it("AdminSchedulesPage 可切換成突發出巡事件並手動選日期", () => {
    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.click(screen.getByRole("button", { name: "突發出巡事件" }));
    fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
      target: { value: "doc-001" }
    });
    fireEvent.change(screen.getByLabelText("路線日期"), {
      target: { value: "2026-05-08" }
    });

    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-05-08");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期五");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("上午");
    expect(
      within(screen.getByRole("combobox", { name: "篩選時段" }))
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["請選擇時段", "上午", "下午"]);
  });

  it("AdminSchedulesPage 突發出巡事件也會依醫師時段順序帶入預設時段", () => {
    const customDb = createSeedDb();
    customDb.doctors = customDb.doctors.map((doctor) =>
      doctor.id === "doc-001"
        ? {
            ...doctor,
            available_service_slots: ["星期三下午", "星期三上午", "星期五下午"]
          }
        : doctor
    );
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));

    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.click(screen.getByRole("button", { name: "突發出巡事件" }));
    fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
      target: { value: "doc-001" }
    });
    fireEvent.change(screen.getByLabelText("路線日期"), {
      target: { value: "2026-05-06" }
    });

    return waitFor(() => {
      expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期三");
      expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("下午");
    });
  });

  it("AdminSchedulesPage 選完日期後會自動帶入星期與時段", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T09:00:00+08:00"));

    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
      target: { value: "doc-001" }
    });

    fireEvent.change(screen.getByLabelText("路線日期"), {
      target: { value: "2026-05-06" }
    });

    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期三");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("上午");
    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-05-06");
    expect(screen.getByRole("button", { name: "選擇符合時段個案" })).toBeEnabled();
  });

  it("AdminSchedulesPage 取消勾選後，個案會改成暫停且不進入路線排序", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    const slotPatientDialog = openSlotPatientDialog();
    fireEvent.click(within(slotPatientDialog).getByLabelText("王○珠 勾選"));

    expect(within(slotPatientDialog).getByLabelText("王○珠 勾選")).not.toBeChecked();
    expect(screen.queryByText("第 1 站 王○珠")).not.toBeInTheDocument();
    expect(screen.getByText("第 1 站 陳○雄")).toBeInTheDocument();
    expect(screen.getByText("可執行 7 站")).toBeInTheDocument();
    expect(screen.getAllByText("暫停").length).toBeGreaterThan(0);
  });

  it("AdminSchedulesPage 可在符合時段個案視窗中全選與反全選", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    const slotPatientDialog = openSlotPatientDialog();

    fireEvent.click(within(slotPatientDialog).getByRole("button", { name: "反全選" }));

    expect(within(slotPatientDialog).getByLabelText("王○珠 勾選")).not.toBeChecked();
    expect(within(slotPatientDialog).getByLabelText("陳○雄 勾選")).not.toBeChecked();
    expect(screen.getByText("可執行 0 站")).toBeInTheDocument();

    fireEvent.click(within(slotPatientDialog).getByRole("button", { name: "全選" }));

    expect(within(slotPatientDialog).getByLabelText("王○珠 勾選")).toBeChecked();
    expect(within(slotPatientDialog).getByLabelText("陳○雄 勾選")).toBeChecked();
    expect(screen.getByText("可執行 8 站")).toBeInTheDocument();
  });

  it("AdminSchedulesPage 開啟時會偵測三天內未排時段，經行政同意後沿用 7 天前同時段路線並建立通知", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T08:00:00+08:00"));

    const customDb = createSeedDb();
    const sourceRoutePlan = {
      ...customDb.saved_route_plans[0],
      id: "route-auto-source-001",
      route_group_id: "route-auto-source-001",
      doctor_id: "doc-001",
      route_name: "4/22 蕭坤元醫師 星期三上午路線",
      route_date: "2026-04-22",
      route_weekday: "星期三",
      service_time_slot: "上午",
      execution_status: "archived",
      schedule_ids: [],
      route_items: [
        {
          patient_id: "pat-001",
          schedule_id: null,
          checked: true,
          route_order: 1,
          status: "scheduled",
          patient_name: "王麗珠",
          address: "高雄市旗山區延平一路 128 號"
        }
      ]
    } satisfies typeof customDb.saved_route_plans[number];
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...customDb,
        doctors: customDb.doctors.map((doctor) =>
          doctor.id === "doc-001"
            ? { ...doctor, available_service_slots: ["星期三上午"] }
            : { ...doctor, available_service_slots: [] }
        ),
        visit_schedules: [],
        saved_route_plans: [sourceRoutePlan],
        notification_center_items: []
      })
    );

    renderWithProviders(<AdminSchedulesPage />);

    expect(screen.getByText("排程待確認")).toBeInTheDocument();
    expect(screen.getByText(/2026\/04\/29 星期三上午/)).toBeInTheDocument();

    await act(async () => undefined);
    let storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(
      (storedDb.notification_center_items ?? []).some(
        (item: { title: string; status: string; is_unread: boolean }) =>
          item.title === "排程待確認｜蕭坤元醫師" &&
          item.status === "pending" &&
          item.is_unread === true
      )
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "同意排入" }));

    expect(screen.getByRole("status")).toHaveTextContent("已沿用 7 天前同時段路線");
    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-04-29");
    expect(screen.getByText("第 1 站 王○珠")).toBeInTheDocument();

    storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(
      (storedDb.saved_route_plans ?? []).some(
        (routePlan: { route_date: string; service_time_slot: string; execution_status: string }) =>
          routePlan.route_date === "2026-04-29" &&
          routePlan.service_time_slot === "上午" &&
          routePlan.execution_status === "draft"
      )
    ).toBe(true);
    expect(
      (storedDb.notification_center_items ?? []).some(
        (item: { title: string; status: string; is_unread: boolean }) =>
          item.title === "排程待確認｜蕭坤元醫師" &&
          item.status === "completed" &&
          item.is_unread === false
      )
    ).toBe(true);
  });

  it("AdminSchedulesPage 會顯示帶背景地圖的頁內路線預覽與外部 Google 路線按鈕", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    const routeEndpointsDialog = openRouteEndpointsDialog();
    fireEvent.change(within(routeEndpointsDialog).getByLabelText("路線起點"), {
      target: { value: "高雄市政府" }
    });
    fireEvent.change(within(routeEndpointsDialog).getByLabelText("路線終點"), {
      target: { value: "高雄車站" }
    });
    fireEvent.click(within(routeEndpointsDialog).getByRole("button", { name: "完成設定" }));

    expect(screen.getByText("路線圖預覽")).toBeInTheDocument();
    expect(screen.getByText("頁內示意路線預覽")).toBeInTheDocument();
    expect(screen.getByTitle(/頁內路線底圖/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /頁內路線圖預覽/ })).toBeInTheDocument();
    const routeLink = screen.getByRole("link", { name: "用 Google 地圖開啟完整路線" });
    expect(routeLink).toHaveAttribute("href", expect.stringContaining("waypoints="));
    expect(routeLink).toHaveAttribute("href", expect.stringContaining(encodeURIComponent("高雄市政府")));
    expect(routeLink).toHaveAttribute("href", expect.stringContaining(encodeURIComponent("高雄車站")));

    const slotPatientDialog = openSlotPatientDialog();
    fireEvent.click(within(slotPatientDialog).getByLabelText("王○珠 勾選"));

    expect(routeLink).not.toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("高雄市旗山區延平一路 128 號"))
    );
  });

  it("AdminSchedulesPage 可拖曳調整本次路線排序", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();

    const firstRouteStop = screen.getByText("第 1 站 王○珠").closest("div[draggable='true']");
    const thirdRouteStop = screen.getByText("第 3 站 李○蘭").closest("div[draggable='true']");

    expect(firstRouteStop).not.toBeNull();
    expect(thirdRouteStop).not.toBeNull();

    fireEvent.dragStart(firstRouteStop!);
    fireEvent.dragEnter(thirdRouteStop!);
    fireEvent.dragOver(thirdRouteStop!);
    fireEvent.drop(thirdRouteStop!);
    fireEvent.dragEnd(firstRouteStop!);

    expect(screen.getByText("第 1 站 陳○雄")).toBeInTheDocument();
    expect(screen.getByText("第 2 站 李○蘭")).toBeInTheDocument();
    expect(screen.getByText("第 3 站 王○珠")).toBeInTheDocument();
  });

  it("AdminSchedulesPage 可依下一個停留點最短距離自動排序本次路線", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();

    expect(screen.getByText("第 2 站 陳○雄")).toBeInTheDocument();
    expect(screen.getByText("第 8 站 鄭○華")).toBeInTheDocument();
    const routeLink = screen.getByRole("link", { name: "用 Google 地圖開啟完整路線" });
    const initialHref = routeLink.getAttribute("href");

    fireEvent.click(screen.getByRole("button", { name: "自動排序" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "已依目前點到下一個停留點距離最短的原則完成自動排序。"
    );
    expect(routeLink.getAttribute("href")).not.toBe(initialHref);
  });

  it("AdminSchedulesPage 可儲存路線、清除頁面，再完整還原醫師、日期、勾選狀態與排序", async () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    let slotPatientDialog = openSlotPatientDialog();
    fireEvent.click(within(slotPatientDialog).getByLabelText("王○珠 勾選"));
    fireEvent.click(within(slotPatientDialog).getByRole("button", { name: "關閉" }));
    fireEvent.click(screen.getAllByRole("button", { name: "下移" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "儲存路線" }));

    expect(screen.getByRole("status")).toHaveTextContent("已儲存路線");
    expect(screen.getByRole("combobox", { name: "已儲存的路線" })).toHaveValue(
      "route-doc-001-2026-04-29-星期三-上午"
    );

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("");
    expect(screen.getByLabelText("路線日期")).toHaveValue("");
    expect(screen.getByRole("button", { name: "選擇符合時段個案" })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "已儲存的路線" }), {
      target: { value: "route-doc-001-2026-04-29-星期三-上午" }
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("doc-001");
      expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期三");
      expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("上午");
      expect(screen.getByLabelText("路線日期")).toHaveValue("2026-04-29");
      expect(screen.getByText("第 1 站 李○蘭")).toBeInTheDocument();
    });

    slotPatientDialog = openSlotPatientDialog();
    expect(within(slotPatientDialog).getByLabelText("王○珠 勾選")).not.toBeChecked();
  });

  it("AdminSchedulesPage 按下清除後會重置成初始狀態", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.getByRole("status")).toHaveTextContent("已清除排程管理頁面內容");
    expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("");
    expect(screen.getByLabelText("路線日期")).toHaveValue("");
    expect(screen.getByText("可執行 0 站")).toBeInTheDocument();
  });

  it("AdminSchedulesPage 按下實行路線後，醫師端可收到這次規劃路線", async () => {
    const adminView = renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters("2026-04-29");
    fireEvent.click(screen.getByRole("button", { name: "實行路線" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("醫師端會以這條路線作為本次執行清單")
    );

    adminView.unmount();
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

    renderWithProviders(<DoctorLocationPage />);

    await waitFor(() => {
      expect(screen.getByText("即時導航")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /4月29日 星期三上午 \/ 8位/ })).toBeInTheDocument();
    });
  });

  it("AdminSchedulesPage 會用下拉選單顯示已儲存路線", () => {
    renderWithProviders(<AdminSchedulesPage />);

    expect(screen.getByRole("combobox", { name: "已儲存的路線" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "套用前次路線" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刪除這條路線" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批次刪除路線" })).toBeInTheDocument();
  });

  it("AdminSchedulesPage 可套用同醫師前次路線但不沿用舊排程 ID", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters("2026-05-06");
    fireEvent.click(screen.getByRole("button", { name: "套用前次路線" }));

    expect(screen.getByRole("status")).toHaveTextContent("已套用前次路線");
    expect(screen.getByRole("status")).toHaveTextContent("本次日期與時段維持目前設定");
    fireEvent.click(screen.getByRole("button", { name: "儲存路線" }));

    const savedRouteSelect = screen.getByRole("combobox", { name: "已儲存的路線" }) as HTMLSelectElement;
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    const savedRoutePlan = (storedDb.saved_route_plans ?? []).find(
      (routePlan: { id: string }) => routePlan.id === savedRouteSelect.value
    );

    expect(savedRoutePlan).toBeTruthy();
    expect(savedRoutePlan.route_date).toBe("2026-05-06");
    expect(savedRoutePlan.route_items.length).toBeGreaterThan(0);
    expect(savedRoutePlan.route_items.every((item: { schedule_id: string | null }) => item.schedule_id === null)).toBe(true);
    expect(savedRoutePlan.schedule_ids).toEqual([]);
  });

  it("AdminSchedulesPage 可刪除已儲存路線", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminSchedulesPage />);

    const savedRouteSelect = screen.getByRole("combobox", { name: "已儲存的路線" });
    const routeOptions = within(savedRouteSelect)
      .getAllByRole("option")
      .filter((option) => option.getAttribute("value"));
    const initialOptionCount = routeOptions.length;

    if (routeOptions.length === 0) {
      throw new Error("找不到可刪除的已儲存路線。");
    }

    const selectedRouteId = routeOptions[0].getAttribute("value");
    if (!selectedRouteId) {
      throw new Error("已儲存路線 option 缺少 value。");
    }

    fireEvent.change(savedRouteSelect, {
      target: { value: selectedRouteId }
    });
    expect(savedRouteSelect).toHaveValue(selectedRouteId);
    fireEvent.click(screen.getByRole("button", { name: "刪除這條路線" }));

    expect(screen.getByRole("status")).toHaveTextContent("已刪除");
    await waitFor(() => {
      const refreshedSelect = screen.getByRole("combobox", { name: "已儲存的路線" });
      const refreshedOptions = within(refreshedSelect)
        .getAllByRole("option")
        .filter((option) => option.getAttribute("value"));
      expect(refreshedOptions).toHaveLength(initialOptionCount - 1);
      expect(refreshedSelect).toHaveValue("");
      expect(refreshedOptions.some((option) => option.getAttribute("value") === selectedRouteId)).toBe(false);
    });
  });

  it("AdminSchedulesPage 可批次刪除多條已儲存路線", async () => {
    renderWithProviders(<AdminSchedulesPage />);

    const savedRouteSelect = screen.getByRole("combobox", { name: "已儲存的路線" });
    const routeOptions = within(savedRouteSelect)
      .getAllByRole("option")
      .filter((option) => option.getAttribute("value"));

    if (routeOptions.length < 2) {
      throw new Error("測試需要至少兩條已儲存路線。");
    }

    fireEvent.click(screen.getByRole("button", { name: "批次刪除路線" }));

    const batchDeleteDialog = screen.getByRole("dialog", { name: "批次刪除路線視窗" });
    const targetRouteIds = routeOptions
      .slice(0, 2)
      .map((option) => option.getAttribute("value"))
      .filter((value): value is string => Boolean(value));

    targetRouteIds.forEach((routePlanId) => {
      const routeOption = routeOptions.find((option) => option.getAttribute("value") === routePlanId);
      const routeName = routeOption?.textContent;
      if (!routeName) {
        throw new Error("找不到已儲存路線名稱。");
      }
      fireEvent.click(within(batchDeleteDialog).getByLabelText(`${routeName} ${routePlanId} 批次刪除勾選`));
    });

    fireEvent.click(within(batchDeleteDialog).getByRole("button", { name: "確定刪除" }));

    expect(screen.getByRole("status")).toHaveTextContent("已批次刪除 2 條已儲存路線");
    await waitFor(() => {
      const refreshedOptions = within(screen.getByRole("combobox", { name: "已儲存的路線" }))
        .getAllByRole("option")
        .filter((option) => option.getAttribute("value"));
      expect(
        refreshedOptions.every((option) => !targetRouteIds.includes(option.getAttribute("value") ?? ""))
      ).toBe(true);
    });
  });

  it("從排程頁結案後，個案管理頁會同步顯示結案結果", () => {
    const scheduleView = renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    const slotPatientDialog = openSlotPatientDialog();
    fireEvent.click(within(slotPatientDialog).getAllByRole("button", { name: "結案" })[0]);
    expect(screen.getByRole("status")).toHaveTextContent("已結案 王○珠");
    expect(within(slotPatientDialog).queryByLabelText("王○珠 勾選")).not.toBeInTheDocument();

    scheduleView.unmount();
    renderWithProviders(<AdminPatientsPage />);

    const closedCard = screen.getByRole("button", { name: "編輯 王○珠" }).closest("[data-patient-id='pat-001']");
    expect(closedCard).toHaveAttribute("data-patient-status", "closed");
    expect(closedCard?.className).toContain("bg-slate-100");
  });

  it("從個案管理頁結案後，排程頁不會再顯示該時段個案", () => {
    const patientView = renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByLabelText("王○珠 勾選"));
    fireEvent.click(screen.getByRole("button", { name: "結案" }));
    expect(screen.getByRole("status")).toHaveTextContent("已結案 1 位個案");

    patientView.unmount();
    renderWithProviders(<AdminSchedulesPage />);
    selectScheduleFilters();

    const slotPatientDialog = openSlotPatientDialog();
    expect(within(slotPatientDialog).queryByLabelText("王○珠 勾選")).not.toBeInTheDocument();
    expect(within(slotPatientDialog).getByText("目前共有 7 位個案")).toBeInTheDocument();
  });

  it("AdminDashboardPage 只保留行政儀表板，不在主內容區重複顯示醫師追蹤入口", () => {
    renderWithProviders(<AdminDashboardPage />);

    expect(screen.getByText("個案異常儀表板")).toBeInTheDocument();
    expect(screen.getByText("通知與任務儀表板")).toBeInTheDocument();
    expect(screen.getAllByText("執行人次").length).toBeGreaterThan(0);
    expect(screen.getAllByText("暫停人次").length).toBeGreaterThan(0);
    expect(screen.getAllByText("緊急處置人次").length).toBeGreaterThan(0);
    expect(screen.getByText("上月總計")).toBeInTheDocument();
    expect(screen.queryByText("待實行路線")).not.toBeInTheDocument();
    expect(screen.getByText("待重排案件")).toBeInTheDocument();
    expect(screen.getByText("待補紀錄")).toBeInTheDocument();
    expect(screen.queryByText("待處理通知數")).not.toBeInTheDocument();
    expect(screen.queryByText("待處理任務")).not.toBeInTheDocument();
    expect(screen.queryByText("總提醒數")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "醫師追蹤入口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打開醫師追蹤" })).not.toBeInTheDocument();
    expect(screen.queryByText("教學指引")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Google Map 追蹤圖")).not.toBeInTheDocument();
    expect(screen.queryByText("目前距離")).not.toBeInTheDocument();
  });

  it("AdminDashboardPage 的總覽數字會連接實際排程與異常通知資料", () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        notification_center_items: [
          {
            id: "nc-dashboard-exception-001",
            role: "admin",
            owner_user_id: "admin-001",
            source_type: "patient_exception",
            title: "異常個案｜張○發",
            content: "本次案件需行政後續追蹤。",
            linked_patient_id: "pat-014",
            linked_visit_schedule_id: "vs-026",
            linked_doctor_id: "doc-002",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-30T09:00:00+08:00",
            updated_at: "2026-04-30T09:00:00+08:00"
          }
        ]
      })
    );

    renderWithProviders(<AdminDashboardPage />);

    const executedCard = screen.getAllByText("執行人次")[0].closest("div");
    expect(executedCard).not.toBeNull();
    expect(within(executedCard!).getByText("6")).toBeInTheDocument();

    const previousMonthCard = screen.getByText("上月總計").closest("div");
    expect(previousMonthCard).not.toBeNull();
    expect(previousMonthCard?.textContent).toContain("2026年4月");

    expect(screen.getAllByText("緊急處置人次").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /張○發/ })).toBeInTheDocument();
  });

  it("AdminDoctorTrackingPage 會集中顯示多醫師總覽圖與個別站點進度", () => {
    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getByText("同時段醫師追蹤總覽")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "個案分布排程" })).toBeInTheDocument();
    expect(screen.getByLabelText("蕭坤元醫師 追蹤地圖")).toBeInTheDocument();
    expect(screen.getByTitle("蕭坤元醫師 Google Map 追蹤圖")).toBeInTheDocument();
    expect(screen.getAllByText("目前位置").length).toBeGreaterThan(0);
    const locationSummaryLabel = screen.getAllByText("目前位置", { selector: "p" }).at(-1);
    expect(locationSummaryLabel?.parentElement?.textContent).toContain("附近");
    expect(screen.getByRole("button", { name: "蕭坤元醫師" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "支援醫師" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "林若謙醫師" })).not.toBeInTheDocument();
    expect(screen.getAllByText("已經過的地點").length).toBeGreaterThan(0);
  });

  it("AdminDoctorTrackingPage 會優先帶入最近且可追蹤的路線日期，切換日期時不會跳錯天", () => {
    const customDb = createSeedDb();
    customDb.saved_route_plans = customDb.saved_route_plans.filter((routePlan) =>
      ["2026-04-29", "2026-04-30"].includes(routePlan.route_date)
    );
    customDb.saved_route_plans = customDb.saved_route_plans.map((routePlan) =>
      routePlan.route_date === "2026-04-30"
        ? {
            ...routePlan,
            service_time_slot: "下午" as const,
            execution_status: "archived" as const
          }
        : {
            ...routePlan,
            execution_status: "archived" as const
          }
    );
    customDb.visit_schedules = customDb.visit_schedules.filter((schedule) => {
      const routeDate = schedule.scheduled_start_at.slice(0, 10);
      if (routeDate === "2026-04-29") {
        return schedule.visit_type !== "回院病歷";
      }
      return routeDate === "2026-04-30" && resolveTimeSlot(schedule.scheduled_start_at) === "下午";
    });

    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));

    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-04-30");
    expect(screen.getByRole("combobox", { name: "規劃時段" })).toHaveValue("下午");

    fireEvent.change(screen.getByLabelText("路線日期"), {
      target: { value: "2026-04-29" }
    });

    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-04-29");
    expect(screen.getByRole("combobox", { name: "規劃時段" })).toHaveValue("上午");
  });

  it("AdminDoctorTrackingPage 在桌機版會停止滾輪縮放，但保留拖曳與按鍵縮放", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: "(min-width: 1024px) and (hover: hover) and (pointer: fine)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));

    renderWithProviders(<AdminDoctorTrackingPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "放大地圖" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "縮小地圖" })).toBeInTheDocument();
      expect(
        screen.getByText("可拖曳移動地圖，請改用右上角按鍵放大或縮小，重新點醫師姓名可回到醫師中心")
      ).toBeInTheDocument();
    });

    const zoomLabel = screen.getByLabelText("目前地圖縮放層級");
    const initialZoomText = zoomLabel.textContent;
    const zoomOutButton = screen.getByRole("button", { name: "縮小地圖" });

    expect(zoomOutButton).toBeEnabled();
    fireEvent.click(zoomOutButton);

    await waitFor(() => {
      expect(zoomLabel.textContent).not.toBe(initialZoomText);
    });

    const zoomAfterOutText = zoomLabel.textContent;
    const zoomInButton = screen.getByRole("button", { name: "放大地圖" });

    expect(zoomInButton).toBeEnabled();
    fireEvent.click(zoomInButton);

    await waitFor(() => {
      expect(zoomLabel.textContent).not.toBe(zoomAfterOutText);
    });

    window.matchMedia = originalMatchMedia;
  });

  it("AdminDoctorTrackingPage 會標示定位延遲與尚未收到定位", () => {
    const seededDb = createSeedDb();
    const seededLatestLog = seededDb.doctor_location_logs
      .filter((log) => log.doctor_id === "doc-001" && log.linked_visit_schedule_id === "vs-003")
      .at(-1);
    if (!seededLatestLog) {
      throw new Error("找不到 doc-001 / vs-003 的定位 seed。");
    }
    vi.useFakeTimers();
    vi.setSystemTime(new Date(new Date(seededLatestLog.recorded_at).getTime() + 30 * 60 * 1000));

    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        doctor_location_logs: []
      })
    );

    const missingView = renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getAllByText("未上線").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已用最近排程起點作為參考位置/).length).toBeGreaterThan(0);
    expect(screen.getByText("高雄市旗山區中華路 76 號附近")).toBeInTheDocument();
    missingView.unmount();

    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(seededDb));
    renderWithProviders(<AdminDoctorTrackingPage />);

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const locationStatusPanel = screen.getByText("定位狀態").parentElement;
    expect(locationStatusPanel?.textContent).toContain("定位延遲");
  });

  it("AdminDoctorTrackingPage 會在 storage 事件後同步更新醫師定位", async () => {
    const seededDb = createSeedDb();
    const seededLatestLog = seededDb.doctor_location_logs
      .filter((log) => log.doctor_id === "doc-001" && log.linked_visit_schedule_id === "vs-003")
      .at(-1);
    if (!seededLatestLog) {
      throw new Error("找不到 doc-001 / vs-003 的定位 seed。");
    }
    const liveNow = new Date(new Date(seededLatestLog.recorded_at).getTime() + 2 * 60 * 1000);
    vi.useFakeTimers();
    vi.setSystemTime(liveNow);

    const emptyLocationDb = {
      ...seededDb,
      doctor_location_logs: []
    };
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(emptyLocationDb));

    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getAllByText("未上線").length).toBeGreaterThan(0);

    const nextDb = {
      ...emptyLocationDb,
      doctor_location_logs: [
        {
          id: "loc-sync-001",
          doctor_id: "doc-001",
          recorded_at: seededLatestLog.recorded_at,
          latitude: 22.8861,
          longitude: 120.5012,
          accuracy: 8,
          source: "gps",
          linked_visit_schedule_id: "vs-003"
        }
      ]
    };
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(nextDb));
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: MOCK_DB_STORAGE_KEY,
          newValue: JSON.stringify(nextDb)
        })
      );
      vi.runOnlyPendingTimers();
    });

    const locationStatusPanel = screen.getByText("定位狀態").parentElement;
    expect(locationStatusPanel?.textContent).toContain("定位正常");
    expect(screen.getByText(/最後定位/)).toBeInTheDocument();
    expect(screen.getByText("高雄市旗山區大德路 52 號附近")).toBeInTheDocument();
  });

  it("AdminDoctorTrackingPage 會忽略遠離本次路線的同日定位 sample，避免把醫師位置帶偏", () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        doctor_location_logs: [
          {
            id: "loc-fallback-001",
            doctor_id: "doc-001",
            recorded_at: "2026-04-30T09:20:00+08:00",
            latitude: 24.9968,
            longitude: 121.5522,
            accuracy: 8,
            source: "gps",
            linked_visit_schedule_id: null
          }
        ]
      })
    );

    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.queryByText("目前這個日期與時段沒有可繪製的醫師位置資料。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("蕭坤元醫師 追蹤地圖")).toBeInTheDocument();
    expect(screen.getByTitle("蕭坤元醫師 Google Map 追蹤圖")).toBeInTheDocument();
    expect(screen.getAllByText("未上線").length).toBeGreaterThan(0);
    expect(screen.queryByText(/最後定位/)).not.toBeInTheDocument();
  });

  it("AdminTeamCommunicationPage 可從獨立頁面直接送出給醫師的院內文字訊息", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderWithProviders(<AdminTeamCommunicationPage />);

    expect(screen.getByRole("heading", { name: "團隊通訊" })).toBeInTheDocument();
    expect(screen.queryByText("全部已讀")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("訊息內容"), {
      target: { value: "請先確認今日下午第三站的回院病歷摘要。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "送出站內訊息" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("站內訊息已送出")
    );
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(
      (storedDb.notification_center_items ?? []).some(
        (item: { role: string; owner_user_id: string; content: string }) =>
          item.role === "doctor" &&
          item.owner_user_id === "doc-001" &&
          item.content === "請先確認今日下午第三站的回院病歷摘要。"
      )
    ).toBe(true);
  });

  it("AdminTeamCommunicationPage 可雙擊醫師名單直接切換對話對象", () => {
    const customDb = createSeedDb();
    customDb.doctors.push({
      ...customDb.doctors[0],
      id: "doc-extra",
      name: "林若謙醫師",
      phone: "0912-110-002",
      available_service_slots: ["星期三上午"]
    });
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderWithProviders(<AdminTeamCommunicationPage />);

    fireEvent.doubleClick(screen.getByRole("button", { name: /林若謙醫師/ }));

    expect(screen.getByLabelText("訊息內容")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/林若謙醫師/)).toBeInTheDocument();
  });

  it("AdminTeamCommunicationPage 只保留文字訊息入口", () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        role: "admin",
        activeDoctorId: "doc-001",
        activeAdminId: "admin-001",
        authenticatedDoctorId: null,
        authenticatedAdminId: "admin-001"
      })
    );

    renderWithProviders(<AdminTeamCommunicationPage />);

    expect(screen.getByLabelText("訊息內容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出站內訊息" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "語音通話" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "開始語音通話" })).not.toBeInTheDocument();
  });

  it("AdminRemindersPage 初始為空，並可新增行政公告與指定醫師通知", async () => {
    renderWithProviders(<AdminRemindersPage />);

    expect(screen.getByText("通知中心")).toBeInTheDocument();
    expect(screen.getByText("目前行政端沒有待處理通知。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "建立站內通知" }));

    let dialog = screen.getByRole("dialog", { name: "建立站內通知視窗" });
    fireEvent.change(within(dialog).getByLabelText("標題"), {
      target: { value: "今日交班提醒" }
    });
    fireEvent.change(within(dialog).getByLabelText("內容"), {
      target: { value: "上午案件請先整理成同批摘要再交班。" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "送出站內通知" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("行政內部公告已建立");
      expect(screen.getByText("今日交班提醒")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "建立站內通知" }));

    dialog = screen.getByRole("dialog", { name: "建立站內通知視窗" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "通知類型" }), {
      target: { value: "doctor" }
    });
    fireEvent.change(within(dialog).getByLabelText("指定醫師"), {
      target: { value: "doc-001" }
    });
    fireEvent.change(within(dialog).getByLabelText("標題"), {
      target: { value: "請補回院病歷" }
    });
    fireEvent.change(within(dialog).getByLabelText("內容"), {
      target: { value: "回院後請優先補上剛完成案件。" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "送出站內通知" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("指定醫師通知已建立");
      expect(screen.getByText("請補回院病歷")).toBeInTheDocument();
    });
  });

  it("AdminRemindersPage 進入選擇模式後可選取刪除指定通知", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<AdminRemindersPage />);

    fireEvent.click(screen.getByRole("button", { name: "建立站內通知" }));

    const dialog = screen.getByRole("dialog", { name: "建立站內通知視窗" });
    fireEvent.change(within(dialog).getByLabelText("標題"), {
      target: { value: "今日異常交班" }
    });
    fireEvent.change(within(dialog).getByLabelText("內容"), {
      target: { value: "請確認上午第一站的補件情況。" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "送出站內通知" }));

    await waitFor(() => {
      expect(screen.getByText("今日異常交班")).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("勾選刪除 今日異常交班")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /刪除已選/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "選擇通知" }));
    fireEvent.click(screen.getByLabelText("勾選刪除 今日異常交班"));
    fireEvent.click(screen.getByRole("button", { name: "刪除已選 1 筆通知" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith("確定要刪除已選取的 1 筆通知嗎？");
      expect(screen.queryByText("今日異常交班")).not.toBeInTheDocument();
      expect(screen.getByText("目前行政端沒有待處理通知。")).toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  });

  it("AdminRemindersPage 雙擊通知標題後會自動標記已讀，且未讀統計會消失", async () => {
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        notification_center_items: [
          {
            id: "nc-open-read-001",
            role: "admin",
            owner_user_id: "admin-001",
            source_type: "manual_notice",
            title: "請確認回院病歷",
            content: "請檢查今日上午第一批案件的回院病歷是否已完成。",
            linked_patient_id: null,
            linked_visit_schedule_id: null,
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-30T08:00:00+08:00",
            updated_at: "2026-04-30T08:00:00+08:00"
          }
        ]
      })
    );

    renderWithProviders(<AdminRemindersPage />);

    expect(screen.getByText("未讀 1 筆")).toBeInTheDocument();
    expect(screen.getByText("新訊息")).toBeInTheDocument();
    expect(screen.queryByLabelText("回覆內容")).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole("button", { name: /請確認回院病歷/ }));

    await waitFor(() => {
      expect(screen.queryByText("未讀 1 筆")).not.toBeInTheDocument();
      expect(screen.queryByText("新訊息")).not.toBeInTheDocument();
      expect(screen.queryByText("未讀 0 筆")).not.toBeInTheDocument();
      expect(screen.getByText("請檢查今日上午第一批案件的回院病歷是否已完成。")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "回覆通知" }));
    expect(screen.getByLabelText("回覆內容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "儲存回覆" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "標記完成" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("回覆內容"), {
      target: { value: "已確認上午第一批病歷，目前已補齊。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "標記完成" }));

    await waitFor(() => {
      expect(screen.getByLabelText("已標記完成")).toBeInTheDocument();
      expect(screen.getByText("已完成")).toBeInTheDocument();
    });
  });

  it("AdminLeaveRequestsPage 會顯示待處理請假並可核准", async () => {
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...createSeedDb(),
        leave_requests: [
          {
            id: "leave-001",
            doctor_id: "doc-001",
            start_date: "2026-05-01",
            end_date: "2026-05-02",
            reason: "院內會議",
            handoff_note: "請協助檢查上午個案。",
            status: "pending",
            created_at: "2026-04-30T08:00:00.000Z",
            updated_at: "2026-04-30T08:00:00.000Z"
          }
        ]
      })
    );

    renderWithProviders(<AdminLeaveRequestsPage />);

    expect(screen.getByRole("heading", { name: "待處理請假" })).toBeInTheDocument();
    expect(screen.getByText("院內會議")).toBeInTheDocument();
    expect(screen.getByText("請協助檢查上午個案。")).toBeInTheDocument();
    expect(screen.getByText("王○珠")).toBeInTheDocument();
    expect(screen.queryByText("王麗珠")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "核准請假" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("請假申請已核准");
      expect(screen.getAllByText("已核准").length).toBeGreaterThan(0);
    });
  });

  it("AdminLeaveRequestsPage 可由行政端建立請假申請並同步通知中心", async () => {
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...createSeedDb(),
        leave_requests: [],
        notification_center_items: []
      })
    );

    renderWithProviders(<AdminLeaveRequestsPage />);

    fireEvent.change(screen.getByLabelText("請假醫師"), {
      target: { value: "doc-001" }
    });
    fireEvent.change(screen.getByLabelText("行政請假開始日期"), {
      target: { value: "2026-05-06" }
    });
    fireEvent.change(screen.getByLabelText("行政請假結束日期"), {
      target: { value: "2026-05-06" }
    });
    fireEvent.change(screen.getByLabelText("行政請假原因"), {
      target: { value: "行政代填院內訓練" }
    });
    fireEvent.change(screen.getByLabelText("行政請假交班備註"), {
      target: { value: "請協助調整當日訪視。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "建立請假申請" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("行政端已建立請假申請");
      expect(screen.getByText("行政代填院內訓練")).toBeInTheDocument();
    });

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.leave_requests?.[0]).toMatchObject({
      doctor_id: "doc-001",
      start_date: "2026-05-06",
      end_date: "2026-05-06",
      reason: "行政代填院內訓練",
      handoff_note: "請協助調整當日訪視。",
      status: "pending"
    });
    expect(storedDb.notification_center_items?.[0]).toMatchObject({
      role: "admin",
      source_type: "leave_request",
      linked_doctor_id: "doc-001",
      linked_leave_request_id: storedDb.leave_requests?.[0]?.id,
      status: "pending",
      is_unread: true
    });
  });

  it("AdminLeaveRequestsPage 駁回請假時可填寫並保存駁回理由", async () => {
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...createSeedDb(),
        leave_requests: [
          {
            id: "leave-reject-001",
            doctor_id: "doc-001",
            start_date: "2026-05-03",
            end_date: "2026-05-03",
            reason: "個人行程",
            handoff_note: "請協助調整下午兩位個案。",
            rejection_reason: null,
            status: "pending",
            created_at: "2026-04-30T08:10:00.000Z",
            updated_at: "2026-04-30T08:10:00.000Z"
          }
        ]
      })
    );

    renderWithProviders(<AdminLeaveRequestsPage />);

    expect(screen.queryByLabelText("駁回理由")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "駁回申請" }));
    expect(screen.getByLabelText("駁回理由")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("駁回理由"), {
      target: { value: "該時段已有醫師不足，請改提其他日期。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "確認駁回" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("請假申請已駁回，並已記錄駁回理由");
      expect(screen.getAllByText("已駁回").length).toBeGreaterThan(0);
      expect(screen.getByText("駁回理由：該時段已有醫師不足，請改提其他日期。")).toBeInTheDocument();
    });

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.leave_requests?.[0]?.rejection_reason).toBe("該時段已有醫師不足，請改提其他日期。");
  });

  it("AdminLeaveRequestsPage 取消駁回時會收起駁回理由輸入框而不送出", () => {
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...createSeedDb(),
        leave_requests: [
          {
            id: "leave-reject-cancel-001",
            doctor_id: "doc-001",
            start_date: "2026-05-04",
            end_date: "2026-05-04",
            reason: "家庭因素",
            handoff_note: "請協助上午排程。",
            status: "pending",
            rejection_reason: null,
            created_at: "2026-04-30T08:00:00.000Z",
            updated_at: "2026-04-30T08:00:00.000Z"
          }
        ]
      })
    );

    renderWithProviders(<AdminLeaveRequestsPage />);

    fireEvent.click(screen.getByRole("button", { name: "駁回申請" }));
    fireEvent.change(screen.getByLabelText("駁回理由"), {
      target: { value: "暫時不允許。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "取消駁回" }));

    expect(screen.queryByLabelText("駁回理由")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認駁回" })).not.toBeInTheDocument();

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.leave_requests?.[0]?.status).toBe("pending");
    expect(storedDb.leave_requests?.[0]?.rejection_reason).toBeNull();
  });

  it("AdminLeaveRequestsPage 可取消駁回並恢復為待處理", async () => {
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...createSeedDb(),
        leave_requests: [
          {
            id: "leave-cancel-reject-001",
            doctor_id: "doc-001",
            start_date: "2026-05-03",
            end_date: "2026-05-03",
            reason: "身體不適",
            handoff_note: "請協助調整上午個案。",
            status: "rejected",
            rejection_reason: "該時段人力不足，請改提其他日期。",
            created_at: "2026-04-30T08:00:00.000Z",
            updated_at: "2026-04-30T08:00:00.000Z"
          }
        ]
      })
    );

    renderWithProviders(<AdminLeaveRequestsPage />);

    fireEvent.click(screen.getByRole("button", { name: "取消駁回" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已取消駁回，請假申請已恢復待處理。");
      expect(screen.queryByText("駁回理由：該時段人力不足，請改提其他日期。")).not.toBeInTheDocument();
      expect(screen.getAllByText("待處理").length).toBeGreaterThan(0);
    });

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.leave_requests?.[0]?.status).toBe("pending");
    expect(storedDb.leave_requests?.[0]?.rejection_reason).toBeNull();
  });

  it("AdminLeaveRequestsPage 可刪除請假案件並同步清掉對應通知", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        leave_requests: [
          {
            id: "leave-delete-admin-001",
            doctor_id: "doc-001",
            start_date: "2026-05-01",
            end_date: "2026-05-02",
            reason: "院內會議",
            handoff_note: "請協助檢查上午個案。",
            status: "pending",
            created_at: "2026-04-30T08:00:00.000Z",
            updated_at: "2026-04-30T08:00:00.000Z"
          }
        ],
        notification_center_items: [
          {
            id: "nc-leave-leave-delete-admin-001",
            role: "admin",
            owner_user_id: null,
            source_type: "leave_request",
            title: "醫師請假申請｜蕭坤元醫師",
            content: "2026-05-01 至 2026-05-02｜院內會議｜交班：請協助檢查上午個案。",
            linked_patient_id: null,
            linked_visit_schedule_id: null,
            linked_doctor_id: "doc-001",
            linked_leave_request_id: "leave-delete-admin-001",
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-04-30T08:00:00.000Z",
            updated_at: "2026-04-30T08:00:00.000Z"
          }
        ]
      })
    );

    renderWithProviders(<AdminLeaveRequestsPage />);

    expect(screen.getByText("院內會議")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刪除請假案件" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("請假案件已刪除");
      expect(screen.getByText("目前沒有請假申請。")).toBeInTheDocument();
      expect(screen.getByText("目前沒有可查看的請假單。")).toBeInTheDocument();
    });

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect((storedDb.leave_requests ?? [])).toHaveLength(0);
    expect((storedDb.notification_center_items ?? [])).toHaveLength(0);
  });

  it("AdminDashboardPage 不再提供家屬草稿與綁定編輯欄位", () => {
    renderWithProviders(<AdminDashboardPage />);

    expect(screen.queryByRole("combobox", { name: "周文德 收件對象" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("周文德 Google Chat userId")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "儲存 Google Chat 綁定" })).not.toBeInTheDocument();
    expect(screen.queryByText("家屬追蹤草稿與發送")).not.toBeInTheDocument();
  });

  it("AdminPatientsPage 會顯示去識別化姓名並隱藏病歷號欄位", () => {
    renderWithProviders(<AdminPatientsPage />);

    expect(screen.getByText("王○珠")).toBeInTheDocument();
    expect(screen.queryByText("病歷號")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暫停" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢復" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "結案" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部個案暫停" })).not.toBeInTheDocument();
  });

  it("AdminPatientsPage 可用 CSV 匯入個案", async () => {
    renderWithProviders(<AdminPatientsPage />);

    const csvFile = new File(
      [
        "個案姓名,主診斷,需求項目,地址,狀態管理,負責醫師,服務時段\n",
        "趙小華,慢性肩痛,中藥|針灸,台北市中山區復興北路 1 號,服務中,蕭坤元醫師,星期三上午\n"
      ],
      "patients.csv",
      { type: "text/csv" }
    );

    fireEvent.change(screen.getByLabelText("CSV 匯入"), {
      target: { files: [csvFile] }
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("CSV 匯入完成：成功 1 筆")
    );
    expect(screen.getByText("趙○華")).toBeInTheDocument();
    await waitFor(() => {
      const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
      expect(
        (storedDb.patients ?? []).some(
          (patient: { name: string }) => patient.name === "趙○華"
        )
      ).toBe(true);
    });
  });

  it("AdminPatientsPage 可匯入帶 UTF-8 BOM 的 CSV", async () => {
    renderWithProviders(<AdminPatientsPage />);

    const csvFile = new File(
      [
        "\uFEFF個案姓名,主診斷,需求項目,地址,狀態管理,負責醫師,服務時段\n",
        "林小芳,膝痛追蹤,中藥,台北市松山區八德路 88 號,服務中,蕭坤元醫師,星期三上午\n"
      ],
      "patients-bom.csv",
      { type: "text/csv" }
    );

    fireEvent.change(screen.getByLabelText("CSV 匯入"), {
      target: { files: [csvFile] }
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("CSV 匯入完成：成功 1 筆")
    );
    expect(screen.getByText("林○芳")).toBeInTheDocument();
  });

  it("AdminPatientsPage 下載 CSV 範本時會輸出含 UTF-8 BOM 的檔案", async () => {
    renderWithProviders(<AdminPatientsPage />);

    const exportedBlobRef: { current: Blob | null } = { current: null };
    const originalCreateElement = document.createElement.bind(document);
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn((blob: Blob) => {
          exportedBlobRef.current = blob;
          return "blob:patient-template";
        }),
        revokeObjectURL: vi.fn()
      })
    );
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      return originalCreateElement(tagName, options);
    }) as typeof document.createElement);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "下載 CSV 範本" }));

    if (!exportedBlobRef.current) {
      throw new Error("CSV 範本 blob 未建立");
    }

    const blob = exportedBlobRef.current;
    expect(blob.type).toBe("text/csv;charset=utf-8;");
    const exportedBytes = await readBlobAsBytes(blob);
    expect(Array.from(exportedBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const exportedText = await readBlobAsText(blob);
    expect(exportedText).toContain("個案姓名,主診斷,需求項目,地址,狀態管理,負責醫師,服務時段");
  });

  it("AdminPatientsPage 儲存個案後會提示改到排程管理頁建立或實行路線", () => {
    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增個案" }));
    const dialog = screen.getByRole("dialog", { name: "新增個案視窗" });
    expect(within(dialog).getByLabelText("位置關鍵字")).toHaveValue("同住址");
    fireEvent.change(within(dialog).getByLabelText("個案姓名"), {
      target: { value: "張大明" }
    });
    fireEvent.change(within(dialog).getByLabelText("主診斷"), {
      target: { value: "腰背痠痛" }
    });
    fireEvent.change(within(dialog).getByLabelText("地址"), {
      target: { value: "台北市大安區和平東路 100 號" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存個案設定" }));

    expect(screen.getByRole("status")).toHaveTextContent("張○明");
    expect(screen.getByRole("status")).toHaveTextContent("請到排程管理頁建立或實行路線");
    expect(screen.queryByRole("dialog", { name: "新增個案視窗" })).not.toBeInTheDocument();
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(
      (storedDb.patients ?? []).some(
        (patient: { name: string }) => patient.name === "張○明"
      )
    ).toBe(true);
  });

  it("AdminPatientsPage 只在編輯時才顯示個案詳細資料視窗", () => {
    renderWithProviders(<AdminPatientsPage />);

    expect(screen.queryByText("家屬群發內容")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "發送給勾選個案家屬" })).not.toBeInTheDocument();
    expect(screen.queryByText("最近訪視排程")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "編輯 王○珠" }));

    const dialog = screen.getByRole("dialog", { name: "王○珠 編輯資料" });
    expect(within(dialog).queryByLabelText("聯絡人姓名")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("聯絡方式")).not.toBeInTheDocument();
    expect(within(dialog).getByText("最近訪視排程")).toBeInTheDocument();
    expect(within(dialog).getByText("最近訪視紀錄")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "王○珠 編輯資料" })).not.toBeInTheDocument();
  });

  it("AdminPatientsPage 暫停中的個案會顯示恢復治療選項，且可用勾選批次恢復", () => {
    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 王○珠" }));
    let dialog = screen.getByRole("dialog", { name: "王○珠 編輯資料" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "狀態管理" }), {
      target: { value: "paused" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存個案設定" }));

    expect(screen.getByRole("status")).toHaveTextContent("個案非服務中，未納入排程");

    fireEvent.click(screen.getByRole("button", { name: "編輯 王○珠" }));
    dialog = screen.getByRole("dialog", { name: "王○珠 編輯資料" });
    const statusSelect = within(dialog).getByRole("combobox", { name: "狀態管理" });
    expect(statusSelect).toHaveValue("paused");
    expect(within(statusSelect).getByRole("option", { name: "恢復治療" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByLabelText("王○珠 勾選"));
    fireEvent.click(screen.getByRole("button", { name: "恢復" }));

    expect(screen.getByRole("status")).toHaveTextContent("已恢復 1 位個案");

    fireEvent.click(screen.getByRole("button", { name: "編輯 王○珠" }));
    dialog = screen.getByRole("dialog", { name: "王○珠 編輯資料" });
    expect(within(dialog).getByRole("combobox", { name: "狀態管理" })).toHaveValue("active");
    expect(within(dialog).getByRole("option", { name: "服務中" })).toBeInTheDocument();
  });

  it("AdminPatientsPage 結案後會把個案排到最後並以灰色弱化顯示", () => {
    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByLabelText("王○珠 勾選"));
    fireEvent.click(screen.getByRole("button", { name: "結案" }));

    expect(screen.getByRole("status")).toHaveTextContent("已結案 1 位個案");

    const editButtons = screen.getAllByRole("button", { name: /編輯 / });
    expect(editButtons.at(-1)).toHaveAccessibleName("編輯 王○珠");

    const closedCard = screen.getByRole("button", { name: "編輯 王○珠" }).closest("[data-patient-id='pat-001']");
    expect(closedCard).toHaveAttribute("data-patient-status", "closed");
    expect(closedCard?.className).toContain("bg-slate-100");
  });

  it("AdminPatientsPage 可刪除沒有進行中訪視的個案", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 何○惜" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除個案" }));

    expect(screen.getByRole("status")).toHaveTextContent("已刪除 何○惜");
    expect(screen.queryByRole("button", { name: "編輯 何○惜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("AdminPatientsPage 可從個案卡片直接刪除，並清除已儲存路線中的站點", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const customDb = createSeedDb();
    const routePlan = customDb.saved_route_plans[0];
    const routeItem = routePlan?.route_items[0];
    if (!routePlan || !routeItem) {
      throw new Error("缺少已儲存路線測試資料。");
    }
    customDb.saved_route_plans = [
      {
        ...routePlan,
        id: "route-pat-011-cleanup",
        route_items: [
          ...routePlan.route_items,
          {
            ...routeItem,
            patient_id: "pat-011",
            patient_name: "何○惜",
            schedule_id: null,
            route_order: 99
          }
        ]
      }
    ];
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "刪除 何○惜" }));

    expect(screen.getByRole("status")).toHaveTextContent("已刪除 何○惜");
    expect(screen.queryByRole("button", { name: "編輯 何○惜" })).not.toBeInTheDocument();
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.patients.some((patient: { id: string }) => patient.id === "pat-011")).toBe(false);
    expect(
      storedDb.saved_route_plans.some((storedRoutePlan: { route_items: Array<{ patient_id: string }> }) =>
        storedRoutePlan.route_items.some((item) => item.patient_id === "pat-011")
      )
    ).toBe(false);
  });

  it("AdminPatientsPage 不允許刪除已經開始移動或治療中的個案", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 李○蘭" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除個案" }));

    expect(screen.getByRole("status")).toHaveTextContent("無法刪除 李○蘭");
    expect(screen.getByRole("button", { name: "編輯 李○蘭" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "李○蘭 編輯資料" })).toBeInTheDocument();
  });

  it("AdminPatientsPage 可刪除尚未出發的個案", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 陳○雄" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除個案" }));

    expect(screen.getByRole("status")).toHaveTextContent("已刪除 陳○雄");
    expect(screen.queryByRole("button", { name: "編輯 陳○雄" })).not.toBeInTheDocument();
  });

  it("AdminStaffPage 點擊人員後會開啟個人資料視窗並帶入資料", () => {
    renderWithProviders(<AdminStaffPage />);

    expect(screen.queryByText("角色設定說明")).not.toBeInTheDocument();
    expect(screen.queryByText("1. 醫師與行政現在都改用站內通知與帳密登入，預設密碼為 0000。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "LINE 聯絡設定" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "蕭坤元醫師 醫師資料" })).toBeInTheDocument();
    expect(within(dialog).getByText("醫師")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("角色姓名")).toHaveValue("蕭坤元醫師");
    expect(within(dialog).queryByLabelText("Google 登入帳號")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Google Chat userId")).not.toBeInTheDocument();
  });

  it("AdminStaffPage 可在個人資料視窗中修改醫師資料", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("角色姓名"), {
      target: { value: "蕭坤元主任醫師" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存角色設置" }));

    expect(screen.getByRole("status")).toHaveTextContent("已將 蕭坤元主任醫師 設為醫師");
    expect(screen.getByRole("button", { name: /蕭坤元主任醫師/ })).toBeInTheDocument();
  });

  it("AdminStaffPage 可新增醫師並用分離式時段勾選", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: "新增醫師" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("角色姓名"), {
      target: { value: "新加入醫師" }
    });
    fireEvent.change(within(dialog).getByLabelText("聯絡電話"), {
      target: { value: "02-2933-1199" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "星期一" }));
    fireEvent.click(within(dialog).getByLabelText("星期一上午"));

    fireEvent.click(within(dialog).getByRole("button", { name: "儲存角色設置" }));

    expect(screen.getByRole("status")).toHaveTextContent("已將 新加入醫師 設為醫師");
    expect(screen.getAllByText("醫師").length).toBeGreaterThan(0);
  });

  it("AdminStaffPage 可移除仍有排程的醫師，並同步清除關聯排程與路線", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const customDb = createSeedDb();
    customDb.doctors.push({
      ...customDb.doctors[0],
      id: "doc-extra",
      name: "測試醫師",
      phone: "0912-000-999",
      available_service_slots: ["星期三上午"]
    });
    customDb.visit_schedules.push({
      ...customDb.visit_schedules[0],
      id: "vs-extra",
      assigned_doctor_id: "doc-extra",
      route_group_id: "route-doc-extra-2026-04-30-上午"
    });
    customDb.saved_route_plans.push({
      ...customDb.saved_route_plans[0],
      id: "route-doc-extra-2026-04-30-上午",
      doctor_id: "doc-extra",
      route_group_id: "route-doc-extra-2026-04-30-上午",
      schedule_ids: ["vs-extra"],
      route_items: [
        {
          ...customDb.saved_route_plans[0].route_items[0],
          schedule_id: "vs-extra"
        }
      ]
    });
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));

    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /測試醫師/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/仍有 1 筆排程案件/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "移除此角色" }));

    expect(screen.getByRole("status")).toHaveTextContent("已移除 測試醫師");
    expect(screen.queryByRole("button", { name: /測試醫師/ })).not.toBeInTheDocument();

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.doctors.some((doctor: { id: string }) => doctor.id === "doc-extra")).toBe(false);
    expect(storedDb.visit_schedules.some((schedule: { id: string }) => schedule.id === "vs-extra")).toBe(false);
    expect(
      storedDb.saved_route_plans.some((routePlan: { doctor_id: string }) => routePlan.doctor_id === "doc-extra")
    ).toBe(false);
  });

  it("AdminStaffPage 醫師資料視窗不再顯示 LINE 搜尋欄位", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("LINE 搜尋關鍵字")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText("醫師資料只維護姓名、電話與可服務時段。登入後使用手機網頁接收站內提示並回傳即時位置，行政端可同步查看路線與進度。")
    ).toBeInTheDocument();
  });

  it("AdminStaffPage 醫師角色視窗不再顯示 Google 欄位，仍可直接儲存", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("醫師端改用手機網頁即時定位。醫師登入後若允許位置分享，行政端會直接看到最新位置、距離、軌跡與已過 / 未到站點。")
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Google 登入帳號")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Google Chat userId")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存角色設置" }));

    expect(screen.getByRole("status")).toHaveTextContent("已將 蕭坤元醫師 設為醫師");
  });

  it("AdminStaffPage 編輯醫師時不顯示星期日選項", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("星期日上午")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/偵測到舊版時段資料/)).not.toBeInTheDocument();
  });

  it("AdminStaffPage 會依既有醫師時段帶入目前星期與上午下午勾選", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("星期三上午")).toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "星期四" }));
    expect(within(dialog).getByLabelText("星期四下午")).toBeChecked();
    expect(within(dialog).getAllByText("星期三上午").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("星期四下午").length).toBeGreaterThan(0);
  });

  it("AdminStaffPage 可直接刪除已選服務時段並同步取消勾選", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("星期三上午")).toBeChecked();

    fireEvent.click(within(dialog).getByRole("button", { name: "刪除 星期三上午" }));

    expect(within(dialog).queryByRole("button", { name: "刪除 星期三上午" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("星期三上午")).not.toBeChecked();
  });

  it("AdminStaffPage 不再提供 LINE 聯絡設定入口", () => {
    renderWithProviders(<AdminStaffPage />);

    expect(screen.queryByRole("button", { name: "LINE 聯絡設定" })).not.toBeInTheDocument();
    expect(screen.queryByText("共享聯絡入口")).not.toBeInTheDocument();
  });

  it("AdminStaffPage 不再顯示重複的請假處理區塊", () => {
    renderWithProviders(<AdminStaffPage />);

    expect(screen.queryByText("請假與任務摘要")).not.toBeInTheDocument();
    expect(screen.queryByText("請假與異動處理")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "建立請假申請" })).not.toBeInTheDocument();
  });

  it("AdminStaffPage 不再顯示線上更新與部署密碼區塊", () => {
    renderWithProviders(<AdminStaffPage />);

    expect(screen.queryByText("線上更新")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新到 GitHub / Vercel" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("請輸入部署密碼")).not.toBeInTheDocument();
  });
});
