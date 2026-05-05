import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { createSeedDb } from "../../data/seed";
import { ADMIN_API_TOKEN_STORAGE_KEY } from "../../shared/utils/admin-api-tokens";
import { DoctorLocationPage } from "../doctor/DoctorPages";
import {
  AdminDashboardPage,
  AdminDoctorTrackingPage,
  AdminFamilyLinePage,
  AdminLeaveRequestsPage,
  AdminPatientsPage,
  AdminRemindersPage,
  AdminSchedulesPage,
  AdminStaffPage,
  AdminTeamCommunicationPage
} from "./AdminPages";

function renderWithProviders(page: ReactNode, initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
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

function selectScheduleFilters(routeDate = "2026-05-06") {
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

function createXlsxFile(sheets: Array<{ name: string; rows: string[][] }>, filename = "home-care.xlsx") {
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  });
  const workbookBytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([workbookBytes], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

function openRouteEndpointsDialog() {
  fireEvent.click(screen.getByRole("button", { name: "設定起終點" }));
  return screen.getByRole("dialog", { name: "起終點設定視窗" });
}

function expectRouteStopLabel(label: string) {
  expect(screen.getAllByText(label).length).toBeGreaterThan(0);
}

function getDraggableRouteStop(label: string) {
  const routeStop = screen
    .getAllByText(label)
    .map((element) => element.closest("div[draggable='true']"))
    .find((element): element is HTMLElement => element instanceof HTMLElement);

  if (!routeStop) {
    throw new Error(`找不到可拖曳站點：${label}`);
  }

  return routeStop;
}

function resolveTimeSlot(dateTime: string) {
  return new Date(dateTime).getHours() < 12 ? "上午" : "下午";
}

describe("AdminPages", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ status: "ZERO_RESULTS", results: [] })
      })
    );
    vi.useRealTimers();
  });

  it("AdminSchedulesPage 會依醫師、星期與時段自動列出符合條件的個案", () => {
    renderWithProviders(<AdminSchedulesPage />);

    expect(screen.getByText("起點：旗山醫院｜終點：旗山醫院")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /全部排程清單/ }));
    const allSchedulesDialog = screen.getByRole("dialog", { name: "全部排程清單視窗" });
    expect(within(allSchedulesDialog).getByText("排程 vs-002")).toBeInTheDocument();
    expect(within(allSchedulesDialog).getAllByText("蕭坤元醫師").length).toBeGreaterThan(0);
    expect(within(allSchedulesDialog).queryByText("林若謙醫師")).not.toBeInTheDocument();
    fireEvent.click(within(allSchedulesDialog).getByRole("button", { name: "關閉" }));

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
    expect(routeDateSelect).toHaveValue("2026-04-30");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期四");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("下午");

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
    expectRouteStopLabel("第 1 站 陳○雄");
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
    expectRouteStopLabel("第 1 站 王○珠");

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

  it("AdminSchedulesPage 會顯示同座標系背景地圖的頁內路線預覽與外部 Google 路線按鈕", () => {
    const { container } = renderWithProviders(<AdminSchedulesPage />);

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
    expect(screen.getByRole("button", { name: "放大" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "縮小" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "醫師置中" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回預設" })).toBeInTheDocument();
    expect(screen.getByText("目前視野：廣域")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(screen.getByText("目前視野：標準")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "回預設" }));
    const zoomOutButton = screen.getByRole("button", { name: "縮小" });
    ["全域", "超全域", "縣市", "全台"].forEach((zoomLabel) => {
      fireEvent.click(zoomOutButton);
      expect(screen.getByText(`目前視野：${zoomLabel}`)).toBeInTheDocument();
    });
    expect(zoomOutButton).toBeDisabled();
    expect(container.querySelector('svg image[href*="tile.openstreetmap.org"]')).toBeInTheDocument();
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

  it("AdminSchedulesPage 選定排程後會自動用 Google 補座標並寫回個案與未完成排程", async () => {
    const customDb = createSeedDb();
    customDb.patients = customDb.patients.map((patient) =>
      patient.id === "pat-001"
        ? {
            ...patient,
            home_latitude: null,
            home_longitude: null,
            geocoding_status: "missing" as const
          }
        : patient
    );
    customDb.visit_schedules = customDb.visit_schedules.map((schedule) =>
      schedule.patient_id === "pat-001"
        ? {
            ...schedule,
            home_latitude_snapshot: null,
            home_longitude_snapshot: null,
            geofence_status: "coordinate_missing" as const
          }
        : schedule
    );
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latitude: 22.88612,
        longitude: 120.48234,
        formattedAddress: "高雄市旗山區延平一路128號"
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<AdminSchedulesPage />);
    selectScheduleFilters();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/已由 Google Map 補上/)).toBeInTheDocument());
    expect(screen.getByRole("img", { name: /頁內路線圖預覽/ })).toBeInTheDocument();
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    const updatedPatient = storedDb.patients.find((patient: { id: string }) => patient.id === "pat-001");
    const updatedSchedule = storedDb.visit_schedules.find(
      (schedule: { patient_id: string; status: string }) =>
        schedule.patient_id === "pat-001" && !["completed", "cancelled"].includes(schedule.status)
    );
    expect(updatedPatient.home_latitude).toBe(22.88612);
    expect(updatedPatient.home_longitude).toBe(120.48234);
    expect(updatedSchedule.home_latitude_snapshot).toBe(22.88612);
    expect(updatedSchedule.home_longitude_snapshot).toBe(120.48234);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/maps/geocode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          address: "高雄市旗山區延平一路 128 號",
          googleMapsApiKey: ""
        })
      })
    );
  });

  it("AdminSchedulesPage 補座標失敗時會在地圖預覽顯示 Google 回傳原因", async () => {
    const customDb = createSeedDb();
    customDb.patients = customDb.patients.map((patient) =>
      patient.id === "pat-001"
        ? {
            ...patient,
            home_latitude: null,
            home_longitude: null,
            geocoding_status: "missing" as const
          }
        : patient
    );
    customDb.visit_schedules = customDb.visit_schedules.map((schedule) =>
      schedule.patient_id === "pat-001"
        ? {
            ...schedule,
            home_latitude_snapshot: null,
            home_longitude_snapshot: null,
            geofence_status: "coordinate_missing" as const
          }
        : schedule
    );
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          reason: "ZERO_RESULTS",
          error: "Google Geocoding API 回傳 ZERO_RESULTS：找不到「高雄市旗山區延平一路 128 號」的座標"
        })
      })
    );

    renderWithProviders(<AdminSchedulesPage />);
    selectScheduleFilters();

    await waitFor(() =>
      expect(
        screen.getAllByText(/Google Geocoding API 回傳 ZERO_RESULTS/).length
      ).toBeGreaterThan(0)
    );
    expect(screen.getByText(/Google 回傳原因：Google Geocoding API 回傳 ZERO_RESULTS/)).toBeInTheDocument();
  });

  it("AdminSchedulesPage 可拖曳調整本次路線排序", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();

    const firstRouteStop = getDraggableRouteStop("第 1 站 王○珠");
    const thirdRouteStop = getDraggableRouteStop("第 3 站 李○蘭");

    fireEvent.dragStart(firstRouteStop);
    fireEvent.dragEnter(thirdRouteStop);
    fireEvent.dragOver(thirdRouteStop);
    fireEvent.drop(thirdRouteStop);
    fireEvent.dragEnd(firstRouteStop);

    expectRouteStopLabel("第 1 站 陳○雄");
    expectRouteStopLabel("第 2 站 李○蘭");
    expectRouteStopLabel("第 3 站 王○珠");
  });

  it("AdminSchedulesPage 可依下一個停留點最短距離自動排序本次路線", async () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();

    expectRouteStopLabel("第 2 站 陳○雄");
    expectRouteStopLabel("第 8 站 鄭○華");
    const routeLink = screen.getByRole("link", { name: "用 Google 地圖開啟完整路線" });
    const initialHref = routeLink.getAttribute("href");

    fireEvent.click(screen.getByRole("button", { name: "自動排序" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "已依目前點到下一個停留點距離最短的原則完成自動排序。"
      )
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
      "route-doc-001-2026-05-06-星期三-上午"
    );

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("");
    expect(screen.getByLabelText("路線日期")).toHaveValue("");
    expect(screen.getByRole("button", { name: "選擇符合時段個案" })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "已儲存的路線" }), {
      target: { value: "route-doc-001-2026-05-06-星期三-上午" }
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("doc-001");
      expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期三");
      expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("上午");
      expect(screen.getByLabelText("路線日期")).toHaveValue("2026-05-06");
      expectRouteStopLabel("第 1 站 李○蘭");
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

    selectScheduleFilters("2026-05-06");
    fireEvent.click(screen.getByRole("button", { name: "實行路線" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("醫師端會以這條路線作為本次執行清單")
    );

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    const executedRoutePlan = (storedDb.saved_route_plans ?? []).find(
      (routePlan: { doctor_id: string; route_date: string; execution_status: string }) =>
        routePlan.doctor_id === "doc-001" &&
        routePlan.route_date === "2026-05-06" &&
        routePlan.execution_status === "executing"
    );
    const executedScheduleIds = new Set(
      (executedRoutePlan?.schedule_ids ?? []) as string[]
    );
    const executedSchedules = (storedDb.visit_schedules ?? []).filter(
      (schedule: { id: string }) => executedScheduleIds.has(schedule.id)
    );
    expect(executedSchedules.length).toBeGreaterThan(0);
    expect(
      executedSchedules.every(
        (schedule: {
          status: string;
          tracking_started_at: string | null;
          tracking_stopped_at: string | null;
        }) =>
          schedule.status === "waiting_departure" &&
          schedule.tracking_started_at === null &&
          schedule.tracking_stopped_at === null
      )
    ).toBe(true);

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
      expect(screen.getAllByText("即時導航").length).toBeGreaterThan(0);
      expect(screen.getByText("5月6日 星期三上午 / 8位")).toBeInTheDocument();
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

  it("AdminDashboardPage 會顯示回院病歷勾選異常後建立的通知中心案件", () => {
    const seededDb = createSeedDb();
    const baseSchedule = seededDb.visit_schedules.find((schedule) => schedule.patient_id === "pat-001");
    if (!baseSchedule) {
      throw new Error("找不到測試用個案排程");
    }

    const returnRecordSchedule = {
      ...baseSchedule,
      id: "vs-return-dashboard-exception-001",
      scheduled_start_at: "2026-05-18T01:00:00.000Z",
      scheduled_end_at: "2026-05-18T01:30:00.000Z",
      service_time_slot: "回院病歷",
      route_group_id: "return-vs-001",
      status: "completed" as const,
      visit_type: "回院病歷",
      note: "回院病歷｜治療後頭暈｜異常個案",
      updated_at: "2026-05-18T01:30:00.000Z"
    };

    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        visit_schedules: [returnRecordSchedule, ...seededDb.visit_schedules],
        notification_center_items: [
          {
            id: "nc-reminder-return-dashboard-exception-001",
            role: "admin",
            owner_user_id: null,
            source_type: "patient_exception",
            title: "異常個案｜王○珠",
            content: "王○珠 已於回院病歷勾選為異常個案，主訴：治療後頭暈",
            linked_patient_id: "pat-001",
            linked_visit_schedule_id: "vs-return-dashboard-exception-001",
            linked_doctor_id: "doc-001",
            linked_leave_request_id: null,
            status: "pending",
            is_unread: true,
            reply_text: null,
            reply_updated_at: null,
            reply_updated_by_role: null,
            created_at: "2026-05-18T01:30:00.000Z",
            updated_at: "2026-05-18T01:30:00.000Z"
          }
        ]
      })
    );

    renderWithProviders(<AdminDashboardPage />);

    const exceptionPanel = screen.getByText("個案異常儀表板").closest("section");
    expect(exceptionPanel).not.toBeNull();
    expect(within(exceptionPanel!).getByRole("link", { name: /王○珠/ })).toBeInTheDocument();
    expect(within(exceptionPanel!).queryByText("今日沒有需要特別關注的異常案件。")).not.toBeInTheDocument();
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
    expect(screen.queryByRole("dialog", { name: "醫師狀態清單視窗" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "開啟醫師狀態清單" }));
    expect(screen.getByRole("dialog", { name: "醫師狀態清單視窗" })).toBeInTheDocument();
  });

  it("AdminDoctorTrackingPage 打開醫師路線時會排除暫停與結案個案", () => {
    const customDb = createSeedDb();
    const pausedSchedule = customDb.visit_schedules.find((schedule) => schedule.id === "vs-002");
    const completedSchedule = customDb.visit_schedules.find((schedule) => schedule.id === "vs-007");
    const activeSchedule = customDb.visit_schedules.find((schedule) => schedule.id === "vs-003");

    if (!pausedSchedule || !completedSchedule || !activeSchedule) {
      throw new Error("追蹤路線測試缺少必要 seed schedule。");
    }

    customDb.visit_schedules = customDb.visit_schedules.map((schedule) =>
      schedule.id === pausedSchedule.id
        ? { ...schedule, status: "paused" as const }
        : schedule.id === completedSchedule.id
          ? { ...schedule, status: "completed" as const }
          : schedule
    );

    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));

    renderWithProviders(<AdminDoctorTrackingPage />);

    fireEvent.click(screen.getByRole("button", { name: "開啟醫師狀態清單" }));
    const routeLink = within(screen.getByRole("dialog", { name: "醫師狀態清單視窗" })).getByRole("link", {
      name: "打開 蕭坤元醫師 路線"
    });
    const decodedRouteUrl = decodeURIComponent(routeLink.getAttribute("href") ?? "");

    expect(decodedRouteUrl).toContain(activeSchedule.address_snapshot);
    expect(decodedRouteUrl).not.toContain(pausedSchedule.address_snapshot);
    expect(decodedRouteUrl).not.toContain(completedSchedule.address_snapshot);
  });

  it("AdminDoctorTrackingPage 會優先帶入最近且可追蹤的路線日期，切換日期時不會跳錯天", () => {
    const customDb = createSeedDb();
    customDb.saved_route_plans = customDb.saved_route_plans.filter((routePlan) =>
      ["2026-05-05", "2026-05-06"].includes(routePlan.route_date)
    );
    customDb.saved_route_plans = customDb.saved_route_plans.map((routePlan) =>
      routePlan.route_date === "2026-05-06"
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
      if (routeDate === "2026-05-05") {
        return schedule.visit_type !== "回院病歷";
      }
      return routeDate === "2026-05-06" && resolveTimeSlot(schedule.scheduled_start_at) === "下午";
    });

    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));

    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-05-05");
    expect(screen.getByRole("combobox", { name: "規劃時段" })).toHaveValue("上午");

    fireEvent.change(screen.getByLabelText("路線日期"), {
      target: { value: "2026-05-06" }
    });

    expect(screen.getByLabelText("路線日期")).toHaveValue("2026-05-06");
    expect(screen.getByRole("combobox", { name: "規劃時段" })).toHaveValue("下午");
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
    fireEvent.click(screen.getByRole("button", { name: "開啟醫師狀態清單" }));
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
    fireEvent.click(screen.getByRole("button", { name: "開啟醫師狀態清單" }));
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

  it("AdminTeamCommunicationPage 可雙擊醫師名單直接切換對話對象", async () => {
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
    await waitFor(() => expect(screen.getByText(/最後同步/)).toBeInTheDocument());
  });

  it("AdminTeamCommunicationPage 只保留文字訊息入口", async () => {
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
    await waitFor(() => expect(screen.getByText(/最後同步/)).toBeInTheDocument());
  });

  it("AdminFamilyLinePage 發送人員只顯示 webhook 收到的 LINE 好友", () => {
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-a",
          displayName: "王先生 LINE",
          lineUserId: "U1234567890abcdef1234567890abcdef",
          linkedPatientIds: ["pat-001"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    renderWithProviders(<AdminFamilyLinePage />);

    fireEvent.click(screen.getByRole("button", { name: /LINE 自動發送設定/ }));
    expect(screen.getByRole("dialog", { name: "LINE 自動發送設定" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /醫師請假時自動發/ }));
    fireEvent.click(screen.getByRole("button", { name: "顯示詳細" }));
    fireEvent.click(screen.getByLabelText("王先生 LINE 發送勾選"));

    expect(screen.getByText("本次選擇")).toBeInTheDocument();
    expect(screen.getAllByText("U1234567890abcdef1234567890abcdef").length).toBeGreaterThan(0);
    expect(screen.queryByText("王怡萱 /")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("tcm-family-line-user-bindings")).toBeNull();
  });

  it("AdminFamilyLinePage 可依 patientId 預選已關聯的 LINE 好友", () => {
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-a",
          displayName: "王先生 LINE",
          lineUserId: "U1234567890abcdef1234567890abcdef",
          linkedPatientIds: ["pat-001"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        },
        {
          id: "line-contact-b",
          displayName: "其他家屬 LINE",
          lineUserId: "Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          linkedPatientIds: ["pat-002"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    renderWithProviders(<AdminFamilyLinePage />, ["/admin/family-line?patientId=pat-001"]);

    expect(screen.getByText("目前只顯示 王○珠 已關聯的 LINE 好友名單。")).toBeInTheDocument();
    expect(screen.queryByText("其他家屬 LINE")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "批次關聯居家個案" })).toHaveValue("pat-001");
    fireEvent.click(screen.getByRole("button", { name: "顯示詳細" }));
    expect(screen.getByLabelText("王先生 LINE 發送勾選")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("doc-001");
    fireEvent.click(screen.getByRole("button", { name: "顯示全部 LINE 好友以新增關聯" }));
    expect(screen.getByText("其他家屬 LINE")).toBeInTheDocument();
  });

  it("AdminFamilyLinePage 可管理 webhook 收到的 LINE 好友並作為發送對象", () => {
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-a",
          displayName: "王先生 LINE",
          lineUserId: "U1234567890abcdef1234567890abcdef",
          linkedPatientIds: ["pat-001"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    renderWithProviders(<AdminFamilyLinePage />);

    expect(screen.getAllByText("王先生 LINE").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "顯示詳細" }));
    expect(screen.getByLabelText("王先生 LINE 發送勾選")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("王先生 LINE 好友註記"), {
      target: { value: "主要照顧者" }
    });
    expect(window.localStorage.getItem("tcm-family-line-managed-contacts")).toContain("主要照顧者");
  });

  it("AdminFamilyLinePage 可批次選擇 LINE 好友並關聯到現有個案且重新開啟仍記得", async () => {
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-a",
          displayName: "王先生 LINE",
          lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          linkedPatientIds: [],
          note: "",
          source: "official_friend",
          updatedAt: "2026-05-01T00:00:00.000Z"
        },
        {
          id: "line-contact-b",
          displayName: "王太太 LINE",
          lineUserId: "Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          linkedPatientIds: [],
          note: "",
          source: "official_friend",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contact: {} })
    });
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderWithProviders(<AdminFamilyLinePage />);

    fireEvent.click(screen.getAllByRole("button", { name: "顯示詳細" })[0]);
    fireEvent.click(screen.getByLabelText("王先生 LINE 批次關聯勾選"));
    fireEvent.change(screen.getByLabelText("批次關聯居家個案"), {
      target: { value: "pat-001" }
    });
    fireEvent.click(screen.getByRole("button", { name: "關聯所選好友" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已將 1 位 LINE 好友關聯到 王○珠");
      expect(screen.getByRole("status")).toHaveTextContent("下次開啟會自動帶入");
    });
    expect(window.localStorage.getItem("tcm-family-line-managed-contacts")).toContain("pat-001");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/family-line/contacts",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          linkedPatientIds: ["pat-001"],
          note: ""
        })
      })
    );

    unmount();
    renderWithProviders(<AdminFamilyLinePage />);
    fireEvent.click(screen.getAllByRole("button", { name: "顯示詳細" })[0]);
    expect(screen.getByLabelText("王先生 LINE 發送勾選")).toBeInTheDocument();
    expect(screen.getAllByText(/關聯個案：王○珠/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText("王先生 LINE 批次關聯勾選"));
    fireEvent.change(screen.getByLabelText("批次關聯居家個案"), {
      target: { value: "pat-001" }
    });
    fireEvent.click(screen.getByRole("button", { name: "取消所選關聯" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已將 1 位 LINE 好友取消與 王○珠 的關聯");
      expect(screen.getByRole("status")).toHaveTextContent("下次開啟會自動帶入");
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/family-line/contacts",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          lineUserId: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          linkedPatientIds: [],
          note: ""
        })
      })
    );
    expect(window.localStorage.getItem("tcm-family-line-managed-contacts")).not.toContain("pat-001");
  });

  it("AdminFamilyLinePage 可勾選抵達前提醒與結束後關心並編輯範本後確認送出", async () => {
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-a",
          displayName: "王先生 LINE",
          lineUserId: "U1234567890abcdef1234567890abcdef",
          linkedPatientIds: ["pat-001"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sentCount: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AdminFamilyLinePage />);

    fireEvent.click(screen.getByRole("button", { name: /範本群發/ }));
    expect(screen.getByRole("dialog", { name: "範本群發" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("醫師抵達前提醒 本次發送勾選"));
    fireEvent.click(screen.getByLabelText("結束後關心 本次發送勾選"));
    fireEvent.click(screen.getByRole("button", { name: "顯示詳細" }));
    fireEvent.click(screen.getByLabelText("王先生 LINE 發送勾選"));

    fireEvent.change(screen.getByLabelText("目前編輯範本"), {
      target: { value: "arrival_reminder" }
    });
    fireEvent.change(screen.getByLabelText("範本內容"), {
      target: { value: "您好，{醫師} 即將抵達，請協助準備。" }
    });
    fireEvent.click(screen.getByLabelText("確認本次 LINE 發送"));
    fireEvent.click(screen.getByRole("button", { name: "送出 LINE 群發" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sendCall = fetchMock.mock.calls.find(
      ([url, options]) => url === "/api/admin/family-line/send" && typeof options?.body === "string"
    );
    expect(sendCall).toBeDefined();
    const requestBody = JSON.parse(sendCall![1].body);
    expect(requestBody.content).toContain("【醫師抵達前提醒】");
    expect(requestBody.content).toContain("您好，負責醫師 即將抵達，請協助準備。");
    expect(requestBody.content).toContain("【結束後關心】");
    expect(requestBody.recipients[0]).toEqual(
      expect.objectContaining({
        doctorId: "doc-001",
        doctorName: "蕭坤元醫師"
      })
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("LINE 群發已送出 1 位家屬");
    });
  });

  it("AdminFamilyLinePage 可即時群發自訂訊息並選擇收件人", async () => {
    window.localStorage.setItem(
      ADMIN_API_TOKEN_STORAGE_KEY,
      JSON.stringify({
        lineChannelAccessToken: "browser-line-token",
        lineChannelSecret: "",
        googleMapsApiKey: ""
      })
    );
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-a",
          displayName: "王先生 LINE",
          lineUserId: "U1234567890abcdef1234567890abcdef",
          linkedPatientIds: ["pat-001"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sentCount: 1, attemptedCount: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AdminFamilyLinePage />);

    fireEvent.click(screen.getByRole("button", { name: /即時群發訊息/ }));
    expect(screen.getByRole("dialog", { name: "即時群發訊息" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("即時群發標題"), {
      target: { value: "臨時訪視通知" }
    });
    fireEvent.change(screen.getByLabelText("即時群發內容"), {
      target: { value: "今日訪視時間提前，請家屬協助留意。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "顯示詳細" }));
    fireEvent.click(screen.getByLabelText("王先生 LINE 發送勾選"));
    fireEvent.click(screen.getByRole("button", { name: "即時發送 LINE 群發" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody).toEqual(
      expect.objectContaining({
        lineChannelAccessToken: "browser-line-token",
        subject: "臨時訪視通知",
        content: "今日訪視時間提前，請家屬協助留意。"
      })
    );
    expect(requestBody.recipients[0]).toEqual(
      expect.objectContaining({
        caregiverId: "line-contact:line-contact-a",
        caregiverName: "王先生 LINE",
        doctorId: "doc-001",
        lineUserId: "U1234567890abcdef1234567890abcdef"
      })
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("LINE 即時群發已送出 1 位家屬");
    });
  });

  it("AdminFamilyLinePage 可單獨發 LINE 訊息給指定家屬", async () => {
    window.localStorage.setItem(
      ADMIN_API_TOKEN_STORAGE_KEY,
      JSON.stringify({
        lineChannelAccessToken: "browser-line-token",
        lineChannelSecret: "",
        googleMapsApiKey: ""
      })
    );
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-a",
          displayName: "王先生 LINE",
          lineUserId: "U1234567890abcdef1234567890abcdef",
          linkedPatientIds: ["pat-001"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        },
        {
          id: "line-contact-b",
          displayName: "李小姐 LINE",
          lineUserId: "Uabcdef1234567890abcdef1234567890",
          linkedPatientIds: ["pat-002"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sentCount: 1, attemptedCount: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AdminFamilyLinePage />);

    fireEvent.click(screen.getByRole("button", { name: /單獨發訊息/ }));
    expect(screen.getByRole("dialog", { name: "單獨發訊息" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("單獨發訊息收件人")).toHaveValue("line-contact:line-contact-a");
    });
    fireEvent.change(screen.getByLabelText("單獨訊息標題"), {
      target: { value: "單一個案提醒" }
    });
    fireEvent.change(screen.getByLabelText("單獨訊息內容"), {
      target: { value: "請協助留意今日用藥。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "送出單獨 LINE 訊息" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody).toEqual(
      expect.objectContaining({
        lineChannelAccessToken: "browser-line-token",
        subject: "單一個案提醒",
        content: "請協助留意今日用藥。"
      })
    );
    expect(requestBody.recipients).toHaveLength(1);
    expect(requestBody.recipients[0]).toEqual(
      expect.objectContaining({
        caregiverId: "line-contact:line-contact-a",
        caregiverName: "王先生 LINE",
        doctorId: "doc-001",
        lineUserId: "U1234567890abcdef1234567890abcdef"
      })
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("LINE 單獨訊息已送出給 王先生 LINE");
    });
  });

  it("AdminFamilyLinePage 群發會依關聯個案對應到關聯醫師", async () => {
    const customDb = createSeedDb();
    customDb.patients = customDb.patients.map((patient) =>
      patient.id === "pat-002"
        ? {
            ...patient,
            preferred_doctor_id: "doc-002"
          }
        : patient
    );
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(customDb));
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-multi",
          displayName: "跨醫師家屬 LINE",
          lineUserId: "Umulti1234567890abcdef1234567890",
          linkedPatientIds: ["pat-001", "pat-002"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sentCount: 1, attemptedCount: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<AdminFamilyLinePage />);

    fireEvent.change(screen.getByLabelText("篩選醫師"), {
      target: { value: "doc-002" }
    });
    fireEvent.click(screen.getByRole("button", { name: "顯示詳細" }));
    expect(screen.getByLabelText("跨醫師家屬 LINE 發送勾選")).toBeInTheDocument();
    expect(screen.getAllByText(/蕭坤元醫師、支援醫師|支援醫師、蕭坤元醫師/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /範本群發/ }));
    expect(screen.getByRole("dialog", { name: "範本群發" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("醫師抵達前提醒 本次發送勾選"));
    fireEvent.click(screen.getByLabelText("跨醫師家屬 LINE 發送勾選"));
    fireEvent.click(screen.getByLabelText("確認本次 LINE 發送"));
    fireEvent.click(screen.getByRole("button", { name: "送出 LINE 群發" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.recipients[0]).toEqual(
      expect.objectContaining({
        doctorId: "doc-002",
        doctorName: "支援醫師",
        lineUserId: "Umulti1234567890abcdef1234567890"
      })
    );
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
      expect(screen.getByRole("status")).toHaveTextContent("行政公告已建立並送給全部角色");
      expect(screen.getByText("今日交班提醒")).toBeInTheDocument();
    });
    let storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    const announcementItems = (storedDb.notification_center_items ?? []).filter(
      (item: { title: string }) => item.title === "今日交班提醒"
    );
    expect(announcementItems.some((item: { role: string }) => item.role === "admin")).toBe(true);
    expect(
      announcementItems.filter((item: { role: string }) => item.role === "doctor")
    ).toHaveLength(createSeedDb().doctors.length);

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
      expect(screen.getByRole("status")).toHaveTextContent("指定醫師通知已建立，行政端已保留副本");
      expect(screen.getByText("請補回院病歷")).toBeInTheDocument();
    });
    storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    const doctorNoticeItems = (storedDb.notification_center_items ?? []).filter(
      (item: { title: string }) => item.title === "請補回院病歷"
    );
    expect(
      doctorNoticeItems.some(
        (item: { role: string; owner_user_id: string | null; linked_doctor_id: string | null }) =>
          item.role === "doctor" && item.owner_user_id === "doc-001" && item.linked_doctor_id === "doc-001"
      )
    ).toBe(true);
    expect(
      doctorNoticeItems.some(
        (item: { role: string; owner_user_id: string | null; linked_doctor_id: string | null }) =>
          item.role === "admin" && item.owner_user_id === null && item.linked_doctor_id === "doc-001"
      )
    ).toBe(true);
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
            start_date: "2026-05-05",
            end_date: "2026-05-05",
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
    expect(screen.getByText("5 筆")).toBeInTheDocument();
    expect(screen.queryByText("王麗珠")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "核准請假" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("請假申請已核准");
      expect(screen.getAllByText("已核准").length).toBeGreaterThan(0);
    });
  });

  it("AdminLeaveRequestsPage 核准請假時會依已關聯患者的 LINE 名單發送請假公告", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sentCount: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem(
      "tcm-family-line-settings",
      JSON.stringify({ doctorLeaveAutoBroadcast: true })
    );
    window.localStorage.setItem(
      "tcm-family-line-managed-contacts",
      JSON.stringify([
        {
          id: "line-contact-leave-a",
          displayName: "王先生 LINE",
          lineUserId: "U1234567890abcdef1234567890abcdef",
          linkedPatientIds: ["pat-001"],
          note: "主要照顧者",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        },
        {
          id: "line-contact-unmatched",
          displayName: "未受影響家屬 LINE",
          lineUserId: "Uunmatched1234567890abcdef12345",
          linkedPatientIds: ["pat-999"],
          note: "",
          source: "webhook",
          updatedAt: "2026-05-01T00:00:00.000Z"
        }
      ])
    );
    const customDb = createSeedDb();
    customDb.visit_schedules = [
      ...customDb.visit_schedules,
      {
        ...customDb.visit_schedules[0],
        id: "vs-leave-line-001",
        patient_id: "pat-001",
        assigned_doctor_id: "doc-001",
        scheduled_start_at: "2026-05-01T09:00:00+08:00",
        scheduled_end_at: "2026-05-01T10:00:00+08:00",
        status: "scheduled"
      }
    ];
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...customDb,
        leave_requests: [
          {
            id: "leave-line-auto-001",
            doctor_id: "doc-001",
            start_date: "2026-05-01",
            end_date: "2026-05-02",
            reason: "院內會議",
            handoff_note: "請協助檢查上午個案。",
            status: "pending",
            rejection_reason: null,
            created_at: "2026-04-30T08:00:00.000Z",
            updated_at: "2026-04-30T08:00:00.000Z"
          }
        ]
      })
    );

    renderWithProviders(<AdminLeaveRequestsPage />);
    expect(screen.getByLabelText("王先生 LINE LINE 請假通知勾選")).toBeChecked();
    expect(screen.queryByLabelText("未受影響家屬 LINE LINE 請假通知勾選")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "核准請假" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/family-line/send",
        expect.objectContaining({
          method: "POST"
        })
      );
    });
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.subject).toBe("醫師請假公告");
    expect(requestBody.recipients).toEqual([
      expect.objectContaining({
        caregiverId: "line-contact-leave-a",
        caregiverName: "王先生 LINE",
        patientId: "pat-001",
        patientName: "王○珠",
        doctorId: "doc-001",
        lineUserId: "U1234567890abcdef1234567890abcdef"
      })
    ]);
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
    expect(screen.getByRole("dialog", { name: "確定刪除這筆請假案件？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "確定刪除" }));

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

    expect(screen.getByRole("table", { name: "個案管理清單" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "個案姓名" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "負責醫師" })).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText("CSV / Excel 匯入"), {
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

  it("AdminPatientsPage 個案列可直接開啟家屬聯繫介面", () => {
    renderWithProviders(<AdminPatientsPage />);

    const familyContactLink = screen.getByRole("link", { name: "王○珠 家屬聯繫" });
    expect(familyContactLink).toHaveAttribute("href", "/admin/family-line?patientId=pat-001");
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

    fireEvent.change(screen.getByLabelText("CSV / Excel 匯入"), {
      target: { files: [csvFile] }
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("CSV 匯入完成：成功 1 筆")
    );
    expect(screen.getByText("林○芳")).toBeInTheDocument();
  });

  it("AdminPatientsPage 可匯入居家患者名單格式", async () => {
    renderWithProviders(<AdminPatientsPage />);

    const csvFile = new File(
      [
        "中醫居家名單,,,,,,\n",
        ",順序,姓名,病歷號,連絡電話,地址,備註\n",
        "星,1,涂黃招娣,131250,Line 聯繫,美濃區獅山里中華路 92-1號,\n",
        "期,2,楊運郎,198103,07-6814570,美濃區興隆里大埤頭 210號,\n",
        "三,3,黃福珠,206034,0987076029,美濃區中圳里民族路40號,4/14結案\n",
        "上,4,李黃秀英,286690,07-6818157,美濃區永安路235號,\n",
        "午,5,張吳明珍,108291,07-6772506,杉林區新庄里司馬路2巷1-11號,\n"
      ],
      "home-care-patients.csv",
      { type: "text/csv" }
    );

    fireEvent.change(screen.getByLabelText("CSV / Excel 匯入"), {
      target: { files: [csvFile] }
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("CSV 匯入完成：成功 5 筆")
    );
    expect(screen.getByText("涂○○娣")).toBeInTheDocument();
    expect(screen.getByText("黃○珠")).toBeInTheDocument();
    await waitFor(() => {
      const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
      const importedPatients = storedDb.patients ?? [];
      expect(
        importedPatients.some(
          (patient: {
            name: string;
            chart_number: string;
            preferred_service_slot: string;
            phone: string;
            notes: string;
            reminder_tags: string[];
          }) =>
            patient.name === "涂○○娣" &&
            patient.chart_number === "131250" &&
            patient.preferred_service_slot === "星期三上午" &&
            patient.phone === "" &&
            patient.notes.includes("Line 聯繫") &&
            patient.reminder_tags.includes("家屬聯繫")
        )
      ).toBe(true);
      expect(
        importedPatients.some(
          (patient: { name: string; chart_number: string; status: string }) =>
            patient.name === "黃○珠" && patient.chart_number === "206034" && patient.status === "closed"
        )
      ).toBe(true);
    });
  });

  it("AdminPatientsPage 可直接匯入 Excel 居家患者名單並跳過重複表頭", async () => {
    renderWithProviders(<AdminPatientsPage />);

    const xlsxFile = createXlsxFile([
      {
        name: "居家4月",
        rows: [
          ["中醫居家名單", "", "", "", "", "", ""],
          ["", "順序", "姓名", "病歷號", "連絡電話", "地址", ""],
          ["星", "1", "涂黃招娣", "131250", "Line 聯繫", "美濃區獅山里中華路 92-1號", ""],
          ["期", "2", "楊運郎", "198103", "07-6814570", "美濃區興隆里大埤頭 210號", ""],
          ["三", "3", "黃福珠", "206034", "0987076029", "美濃區中圳里民族路40號", "4/14結案"],
          ["上", "4", "李黃秀英", "286690", "07-6818157", "美濃區永安路235號", ""],
          ["午", "5", "張吳明珍", "108291", "07-6772506", "杉林區新庄里司馬路2巷1-11號", ""],
          ["", "順序", "姓名", "病歷號", "連絡電話", "地址", ""],
          ["星", "1", "陳柯月霞", "396781", "07-6613266", "旗山區旗南一路232-2號", ""],
          ["期", "2", "柯歐月女", "35360", "0978647604", "旗山區上洲里銀店街9-1號", ""],
          ["四", "3", "陳柯秀貴", "24424", "0978505192", "旗山區文和巷33號", ""],
          ["下", "4", "徐滿祥", "166432", "07-6830818", "美濃區清水里南中街3-3號", ""],
          ["午", "5", "劉勝智", "242423", "0935791871", "美濃區上清街50號", ""]
        ]
      },
      {
        name: "居家4月 (2)",
        rows: [
          ["中醫居家名單", "", "", "", "", "", ""],
          ["", "順序", "姓名", "病歷號", "連絡電話", "地址", ""],
          ["星", "1", "涂黃招娣", "131250", "Line 聯繫", "美濃區獅山里中華路 92-1號", ""]
        ]
      }
    ]);

    fireEvent.change(screen.getByLabelText("CSV / Excel 匯入"), {
      target: { files: [xlsxFile] }
    });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Excel 匯入完成：成功 10 筆")
    );
    expect(screen.getByText("陳○○貴")).toBeInTheDocument();
    expect(screen.queryByText("姓○")).not.toBeInTheDocument();

    await waitFor(() => {
      const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
      const importedPatients = storedDb.patients ?? [];
      expect(
        importedPatients.filter((patient: { chart_number: string }) => patient.chart_number === "131250")
      ).toHaveLength(1);
      expect(
        importedPatients.some(
          (patient: { name: string; chart_number: string; preferred_service_slot: string }) =>
            patient.name === "陳○○貴" &&
            patient.chart_number === "24424" &&
            patient.preferred_service_slot === "星期四下午"
        )
      ).toBe(true);
    });
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
    expect(exportedText).toContain("中醫居家名單");
    expect(exportedText).toContain(",順序,姓名,病歷號,連絡電話,地址,備註");
    expect(exportedText).toContain("星,1,王小明,123456");
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

  it("AdminPatientsPage 可批次刪除勾選個案", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByLabelText("何○惜 勾選"));
    fireEvent.click(screen.getByLabelText("彭○傑 勾選"));
    fireEvent.click(screen.getByRole("button", { name: "批次刪除" }));

    expect(screen.getByRole("status")).toHaveTextContent("批次刪除完成：已刪除 2 位個案");
    expect(screen.getByText("目前已勾選 0 位個案")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編輯 何○惜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "編輯 彭○傑" })).not.toBeInTheDocument();
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.patients.some((patient: { id: string }) => patient.id === "pat-011")).toBe(false);
    expect(storedDb.patients.some((patient: { id: string }) => patient.id === "pat-012")).toBe(false);
  });

  it("AdminPatientsPage 可刪除已經開始移動或治療中的個案並清除關聯資料", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 李○蘭" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除個案" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "已刪除 李○蘭，並清除 3 筆相關排程，其中 1 筆進行中訪視已取消並除名。"
    );
    expect(screen.queryByRole("button", { name: "編輯 李○蘭" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.patients.some((patient: { id: string }) => patient.id === "pat-003")).toBe(false);
    expect(
      storedDb.visit_schedules.some((schedule: { patient_id: string }) => schedule.patient_id === "pat-003")
    ).toBe(false);
    expect(
      storedDb.saved_route_plans.some((routePlan: { route_items: Array<{ patient_id: string }> }) =>
        routePlan.route_items.some((item) => item.patient_id === "pat-003")
      )
    ).toBe(false);
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
      within(dialog).getByText("醫師資料只維護姓名、電話與可服務時段。醫師使用手機網頁接收站內提示並回傳即時位置，行政端可同步查看路線與進度。")
    ).toBeInTheDocument();
  });

  it("AdminStaffPage 醫師角色視窗不再顯示 Google 帳號欄位，仍可直接儲存", () => {
    renderWithProviders(<AdminStaffPage />);

    expect(screen.getByText("0912-110-001 / 站內通知 / 手機定位")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("醫師端使用手機網頁即時定位。醫師允許位置分享後，行政端會直接看到最新位置、路線與已過 / 未到站點。")
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
