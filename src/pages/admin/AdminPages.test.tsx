import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SESSION_STORAGE_KEY } from "../../app/auth-storage";
import { AppProviders } from "../../app/providers";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { createSeedDb } from "../../data/seed";
import { DoctorLocationPage } from "../doctor/DoctorPages";
import {
  AdminDashboardPage,
  AdminDoctorTrackingPage,
  AdminPatientsPage,
  AdminRemindersPage,
  AdminSchedulesPage,
  AdminStaffPage
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

function selectScheduleFilters(routeDate = "2026-04-25") {
  fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
    target: { value: "doc-001" }
  });
  fireEvent.change(screen.getByRole("combobox", { name: "篩選星期" }), {
    target: { value: "星期三" }
  });
  fireEvent.change(screen.getByRole("combobox", { name: "篩選時段" }), {
    target: { value: "上午" }
  });
  fireEvent.change(screen.getByLabelText("路線日期"), {
    target: { value: routeDate }
  });
}

describe("AdminPages", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("AdminSchedulesPage 會依醫師、星期與時段自動列出符合條件的個案", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();

    expect(screen.getByText("共 8 位")).toBeInTheDocument();
    expect(screen.getByLabelText("王麗珠 勾選")).toBeChecked();
    expect(screen.getByLabelText("陳正雄 勾選")).toBeChecked();
    expect(screen.getAllByText("高雄市旗山區延平一路 128 號").length).toBeGreaterThan(0);
    expect(screen.getAllByText("高雄市旗山區中華路 76 號").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "結案" })).toHaveLength(8);
  });

  it("AdminSchedulesPage 選醫師後只顯示該醫師可服務的星期與時段", () => {
    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
      target: { value: "doc-001" }
    });

    const weekdaySelect = screen.getByRole("combobox", { name: "篩選星期" });
    const weekdayOptions = within(weekdaySelect)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(weekdayOptions).toEqual(["請選擇星期", "星期三", "星期四"]);

    fireEvent.change(weekdaySelect, {
      target: { value: "星期三" }
    });

    const timeSlotSelect = screen.getByRole("combobox", { name: "篩選時段" });
    const timeSlotOptions = within(timeSlotSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(timeSlotOptions).toEqual(["請選擇時段", "上午"]);
  });

  it("AdminSchedulesPage 取消勾選後，個案會改成暫停且不進入路線排序", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    fireEvent.click(screen.getByLabelText("王麗珠 勾選"));

    expect(screen.getByLabelText("王麗珠 勾選")).not.toBeChecked();
    expect(screen.queryByText("第 1 站 王麗珠")).not.toBeInTheDocument();
    expect(screen.getByText("第 1 站 陳正雄")).toBeInTheDocument();
    expect(screen.getByText("可執行 7 站")).toBeInTheDocument();
    expect(screen.getAllByText("暫停").length).toBeGreaterThan(0);
  });

  it("AdminSchedulesPage 會顯示路線圖預覽 fallback 與外部 Google 路線按鈕", () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();

    expect(screen.getByText("路線圖預覽")).toBeInTheDocument();
    expect(screen.queryByTitle(/路線圖預覽/)).not.toBeInTheDocument();
    expect(screen.getByText("頁內路線圖尚未啟用")).toBeInTheDocument();
    const routeLink = screen.getByRole("link", { name: "用 Google 地圖開啟完整路線" });
    expect(routeLink).toHaveAttribute("href", expect.stringContaining("waypoints="));

    fireEvent.click(screen.getByLabelText("王麗珠 勾選"));

    expect(routeLink).not.toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent("高雄市旗山區延平一路 128 號"))
    );
  });

  it("AdminSchedulesPage 可儲存路線、清除頁面，再完整還原醫師、日期、勾選狀態與排序", async () => {
    renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    fireEvent.click(screen.getByLabelText("王麗珠 勾選"));
    fireEvent.click(screen.getAllByRole("button", { name: "下移" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "儲存路線" }));

    expect(screen.getByRole("status")).toHaveTextContent("已儲存路線");
    expect(screen.getByRole("combobox", { name: "已儲存的路線" })).toHaveValue(
      "route-doc-001-2026-04-25-星期三-上午"
    );

    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("");
    expect(screen.getByLabelText("路線日期")).toHaveValue("");
    expect(screen.getByText("共 0 位")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "已儲存的路線" }), {
      target: { value: "route-doc-001-2026-04-25-星期三-上午" }
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "篩選醫師" })).toHaveValue("doc-001");
      expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue("星期三");
      expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue("上午");
      expect(screen.getByLabelText("路線日期")).toHaveValue("2026-04-25");
      expect(screen.getByLabelText("王麗珠 勾選")).not.toBeChecked();
      expect(screen.getByText("第 1 站 李美蘭")).toBeInTheDocument();
    });
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

    selectScheduleFilters("2026-04-25");
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
      expect(screen.getByRole("button", { name: /4月25日 星期三上午 \/ 8位/ })).toBeInTheDocument();
    });
  });

  it("AdminSchedulesPage 會用下拉選單顯示已儲存路線", () => {
    renderWithProviders(<AdminSchedulesPage />);

    expect(screen.getByRole("combobox", { name: "已儲存的路線" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刪除這條路線" })).toBeInTheDocument();
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

  it("從排程頁結案後，個案管理頁會同步顯示結案結果", () => {
    const scheduleView = renderWithProviders(<AdminSchedulesPage />);

    selectScheduleFilters();
    fireEvent.click(screen.getAllByRole("button", { name: "結案" })[0]);
    expect(screen.getByRole("status")).toHaveTextContent("已結案 王○珠");
    expect(screen.queryByLabelText("王麗珠 勾選")).not.toBeInTheDocument();

    scheduleView.unmount();
    renderWithProviders(<AdminPatientsPage />);

    const closedCard = screen.getByRole("button", { name: "編輯 王麗珠" }).closest("[data-patient-id='pat-001']");
    expect(closedCard).toHaveAttribute("data-patient-status", "closed");
    expect(closedCard?.className).toContain("bg-slate-100");
  });

  it("從個案管理頁結案後，排程頁不會再顯示該時段個案", () => {
    const patientView = renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByLabelText("王麗珠 勾選"));
    fireEvent.click(screen.getByRole("button", { name: "結案" }));
    expect(screen.getByRole("status")).toHaveTextContent("已結案 1 位個案");

    patientView.unmount();
    renderWithProviders(<AdminSchedulesPage />);
    selectScheduleFilters();

    expect(screen.queryByLabelText("王麗珠 勾選")).not.toBeInTheDocument();
    expect(screen.getByText("共 7 位")).toBeInTheDocument();
  });

  it("AdminDashboardPage 只保留行政儀表板，不在主內容區重複顯示醫師追蹤入口", () => {
    renderWithProviders(<AdminDashboardPage />);

    expect(screen.getByText("個案異常儀表板")).toBeInTheDocument();
    expect(screen.getByText("通知與任務儀表板")).toBeInTheDocument();
    expect(screen.getAllByText("待實行路線").length).toBeGreaterThan(0);
    expect(screen.getByText("待重排案件")).toBeInTheDocument();
    expect(screen.getByText("暫停案件")).toBeInTheDocument();
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

  it("AdminDoctorTrackingPage 會集中顯示多醫師總覽圖與個別站點進度", () => {
    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getByText("同時段醫師追蹤總覽")).toBeInTheDocument();
    expect(screen.getByLabelText("多醫師追蹤總覽圖")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "蕭坤元醫師" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "林若謙醫師" })).toBeInTheDocument();
    expect(screen.getAllByText("已經過的地點").length).toBeGreaterThan(0);
    expect(screen.getByText("最近定位軌跡")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "聯絡此醫師" })).toBeInTheDocument();
  });

  it("AdminDoctorTrackingPage 會標示定位延遲與尚未收到定位", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T10:00:00+08:00"));

    const seededDb = createSeedDb();
    window.localStorage.setItem(
      MOCK_DB_STORAGE_KEY,
      JSON.stringify({
        ...seededDb,
        doctor_location_logs: []
      })
    );

    const missingView = renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getAllByText("尚未收到定位").length).toBeGreaterThan(0);
    missingView.unmount();

    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(seededDb));
    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getAllByText("定位延遲").length).toBeGreaterThan(0);
  });

  it("AdminDoctorTrackingPage 會在 storage 事件後同步更新醫師定位", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T09:00:00+08:00"));

    const seededDb = createSeedDb();
    const emptyLocationDb = {
      ...seededDb,
      doctor_location_logs: []
    };
    window.localStorage.setItem(MOCK_DB_STORAGE_KEY, JSON.stringify(emptyLocationDb));

    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getAllByText("尚未收到定位").length).toBeGreaterThan(0);

    const nextDb = {
      ...emptyLocationDb,
      doctor_location_logs: [
        {
          id: "loc-sync-001",
          doctor_id: "doc-001",
          recorded_at: "2026-04-29T08:58:00+08:00",
          latitude: 24.9982,
          longitude: 121.5499,
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
    });

    expect(screen.getAllByText("定位正常").length).toBeGreaterThan(0);
    expect(screen.getByText(/最後定位/)).toBeInTheDocument();
  });

  it("AdminDoctorTrackingPage 可直接送出給醫師的院內文字訊息", () => {
    renderWithProviders(<AdminDoctorTrackingPage />);

    fireEvent.click(screen.getByRole("button", { name: "聯絡此醫師" }));
    fireEvent.change(screen.getByLabelText("訊息內容"), {
      target: { value: "回院後請優先補上剛完成案件的病歷與提醒摘要。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "送出站內訊息" }));

    expect(screen.getByRole("status")).toHaveTextContent("站內訊息已送出");
  });

  it("AdminRemindersPage 初始為空，並可新增行政公告、指定醫師通知與請假申請", async () => {
    renderWithProviders(<AdminRemindersPage />);

    expect(screen.getByText("通知中心")).toBeInTheDocument();
    expect(screen.getByText("目前行政端沒有待處理通知。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("標題"), {
      target: { value: "今日交班提醒" }
    });
    fireEvent.change(screen.getByLabelText("內容"), {
      target: { value: "上午案件請先整理成同批摘要再交班。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "建立站內通知" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("行政內部公告已建立");
      expect(screen.getByText("今日交班提醒")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox", { name: "通知類型" }), {
      target: { value: "doctor" }
    });
    fireEvent.change(screen.getByLabelText("指定醫師"), {
      target: { value: "doc-001" }
    });
    fireEvent.change(screen.getByLabelText("標題"), {
      target: { value: "請補回院病歷" }
    });
    fireEvent.change(screen.getByLabelText("內容"), {
      target: { value: "回院後請優先補上剛完成案件。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "建立站內通知" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("指定醫師通知已建立");
      expect(screen.getByText("請補回院病歷")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("請假原因"), {
      target: { value: "上午院內會議" }
    });
    fireEvent.click(screen.getByRole("button", { name: "建立請假申請" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("請假申請已送入通知中心");
      expect(screen.getByText(/醫師請假申請｜/)).toBeInTheDocument();
    });
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
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(
      (storedDb.patients ?? []).some(
        (patient: { name: string }) => patient.name === "趙○華"
      )
    ).toBe(true);
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

    fireEvent.click(screen.getByRole("button", { name: "編輯 王麗珠" }));

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

    fireEvent.click(screen.getByRole("button", { name: "編輯 王麗珠" }));
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

    fireEvent.click(screen.getByLabelText("王麗珠 勾選"));
    fireEvent.click(screen.getByRole("button", { name: "結案" }));

    expect(screen.getByRole("status")).toHaveTextContent("已結案 1 位個案");

    const editButtons = screen.getAllByRole("button", { name: /編輯 / });
    expect(editButtons.at(-1)).toHaveAccessibleName("編輯 王麗珠");

    const closedCard = screen.getByRole("button", { name: "編輯 王麗珠" }).closest("[data-patient-id='pat-001']");
    expect(closedCard).toHaveAttribute("data-patient-status", "closed");
    expect(closedCard?.className).toContain("bg-slate-100");
  });

  it("AdminPatientsPage 可刪除沒有進行中訪視的個案", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 何阿惜" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除個案" }));

    expect(screen.getByRole("status")).toHaveTextContent("已刪除 何○惜");
    expect(screen.queryByRole("button", { name: "編輯 何阿惜" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("AdminPatientsPage 不允許刪除已經開始移動或治療中的個案", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 李美蘭" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除個案" }));

    expect(screen.getByRole("status")).toHaveTextContent("無法刪除 李○蘭");
    expect(screen.getByRole("button", { name: "編輯 李美蘭" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "李○蘭 編輯資料" })).toBeInTheDocument();
  });

  it("AdminPatientsPage 可刪除尚未出發的個案", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<AdminPatientsPage />);

    fireEvent.click(screen.getByRole("button", { name: "編輯 陳正雄" }));
    fireEvent.click(screen.getByRole("button", { name: "刪除個案" }));

    expect(screen.getByRole("status")).toHaveTextContent("已刪除 陳○雄");
    expect(screen.queryByRole("button", { name: "編輯 陳正雄" })).not.toBeInTheDocument();
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

  it("AdminStaffPage 不再提供 LINE 聯絡設定入口", () => {
    renderWithProviders(<AdminStaffPage />);

    expect(screen.queryByRole("button", { name: "LINE 聯絡設定" })).not.toBeInTheDocument();
    expect(screen.queryByText("共享聯絡入口")).not.toBeInTheDocument();
  });
});
