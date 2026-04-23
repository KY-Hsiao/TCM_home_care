import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "../../app/providers";
import { MOCK_DB_STORAGE_KEY } from "../../data/mock/db";
import { DESKTOP_LINE_SETTINGS_STORAGE_KEY } from "../../services/line/desktop-line-settings";
import {
  AdminDashboardPage,
  AdminGuidePage,
  AdminDoctorTrackingPage,
  AdminNotificationsPage,
  AdminPatientsPage,
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

describe("AdminPages", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("AdminSchedulesPage 會先以時段為單位顯示，點進去再看路線明細", () => {
    renderWithProviders(<AdminSchedulesPage />);

    expect(
      screen.getByText(/先選醫師，再選星期幾，最後再選上午或下午。排程管理已直接整合自動排序、拖曳手動排序、導航接力與起終點設定/)
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "篩選星期" })).toBeInTheDocument();

    const targetSlotButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("蕭坤元醫師"));

    if (!targetSlotButton) {
      throw new Error("找不到蕭坤元醫師的時段按鈕。");
    }

    fireEvent.click(targetSlotButton);

    expect(screen.getByRole("heading", { name: /蕭坤元醫師/ })).toBeInTheDocument();
    expect(screen.getByText("路線明細與導航接力")).toBeInTheDocument();
    expect(screen.getByText("第 1 站")).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("旗山醫院").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/拖曳排序/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/(定位|位置)關鍵字/).length).toBeGreaterThan(0);
  });

  it("AdminSchedulesPage 可在路線明細中模擬取消並顯示最近操作", () => {
    renderWithProviders(<AdminSchedulesPage />);

    const targetSlotButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("陳正雄") && button.textContent?.includes("蕭坤元醫師"));

    if (!targetSlotButton) {
      throw new Error("找不到陳正雄所在的時段按鈕。");
    }

    fireEvent.click(targetSlotButton);
    fireEvent.click(screen.getAllByRole("button", { name: "模擬取消" })[0]);

    expect(screen.getByRole("status")).toHaveTextContent("已模擬取消本次排程");
  });

  it("已完成或已取消的路線站點動作按鈕會停用", () => {
    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.change(screen.getByRole("combobox", { name: "篩選醫師" }), {
      target: { value: "doc-001" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "篩選星期" }), {
      target: { value: "all" }
    });

    const completedSlotButton = screen
      .getAllByRole("button")
      .find((button) => button.textContent?.includes("王麗珠") && button.textContent?.includes("蕭坤元醫師"));

    if (!completedSlotButton) {
      throw new Error("找不到王麗珠所在的已完成時段按鈕。");
    }

    fireEvent.click(completedSlotButton);

    expect(screen.getAllByRole("button", { name: "模擬改期" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "模擬改派" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "模擬取消" })[0]).toBeDisabled();
  });

  it("AdminNotificationsPage 會顯示通知任務已停用說明", () => {
    renderWithProviders(<AdminNotificationsPage />);

    expect(screen.getByText("通知任務已停用")).toBeInTheDocument();
    expect(
      screen.getByText("目前系統不再建立家屬聯絡、外部綁定或任何通訊軟體通知任務，流程統一改由排程、定位與 ContactLog 管理。")
    ).toBeInTheDocument();
    expect(
      screen.getByText("出發、抵達、治療完成與路線調整目前都直接記錄在排程、定位與訪視資料內，不另外建立通知任務。")
    ).toBeInTheDocument();
  });

  it("AdminNotificationsPage 保留 ContactLog 回寫預覽與紀錄說明", () => {
    renderWithProviders(<AdminNotificationsPage />);

    expect(
      screen.getByText("目前系統不再建立家屬聯絡、外部綁定或任何通訊軟體通知任務，流程統一改由排程、定位與 ContactLog 管理。")
    ).toBeInTheDocument();
    expect(screen.getByText("ContactLog 回寫預覽與紀錄")).toBeInTheDocument();
    expect(
      screen.getByText("外部 webhook、互動按鈕與家屬表單提交流程已移除；但 ContactLog 的流程紀錄仍保留，方便行政追蹤。")
    ).toBeInTheDocument();
    expect(screen.queryByText("標記待回覆")).not.toBeInTheDocument();
  });

  it("AdminSchedulesPage 可依時間或距離自動排序並顯示行車總時間與距離", () => {
    renderWithProviders(<AdminSchedulesPage />);

    fireEvent.change(screen.getByRole("combobox", { name: "自動排序依據" }), {
      target: { value: "distance" }
    });
    fireEvent.click(screen.getByRole("button", { name: "套用自動排序" }));
    expect(screen.getByRole("status")).toHaveTextContent("最少距離");
    expect(screen.getAllByText(/行車總時間/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/行車總距離/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "儲存此時段路線" }));
    expect(screen.getByRole("status")).toHaveTextContent("醫師端可直接選擇這條路線導航");
    expect(screen.getAllByText(/路線/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "醫師出發，傳送第一站導航" }));
    expect(screen.getByRole("status")).toHaveTextContent("第一站導航");
  });

  it("AdminSchedulesPage 會用下拉選單顯示已儲存路線，避免佔用過多空間", () => {
    renderWithProviders(<AdminSchedulesPage />);

    expect(screen.getByRole("combobox", { name: "已儲存的路線" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /2026-.*路線/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刪除這條路線" })).toBeInTheDocument();
  });

  it("AdminSchedulesPage 可從已儲存路線下拉選單直接切到對應時段並開啟查看", async () => {
    renderWithProviders(<AdminSchedulesPage />);

    const savedRouteSelect = screen.getByRole("combobox", { name: "已儲存的路線" });
    const routeOptions = within(savedRouteSelect)
      .getAllByRole("option")
      .filter((option) => option.getAttribute("value"));
    const targetOption = routeOptions[0];

    if (!targetOption) {
      throw new Error("找不到可切換的已儲存路線。");
    }

    const targetRouteId = targetOption.getAttribute("value");
    const optionText = targetOption.textContent ?? "";
    const [targetRouteName, targetRouteDate, targetServiceTimeSlot] = optionText.split("｜");

    if (!targetRouteId || !targetRouteName || !targetRouteDate || !targetServiceTimeSlot) {
      throw new Error("已儲存路線 option 格式不完整。");
    }

    const targetWeekday = String(new Date(targetRouteDate).getDay());
    const differentWeekday = targetWeekday === "0" ? "1" : "0";
    const differentTimeSlot = targetServiceTimeSlot === "上午" ? "下午" : "上午";

    fireEvent.change(screen.getByRole("combobox", { name: "篩選星期" }), {
      target: { value: differentWeekday }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "篩選時段" }), {
      target: { value: differentTimeSlot }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "已儲存的路線" }), {
      target: { value: targetRouteId }
    });

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "篩選星期" })).toHaveValue(targetWeekday);
      expect(screen.getByRole("combobox", { name: "篩選時段" })).toHaveValue(targetServiceTimeSlot);
      expect(screen.getByRole("combobox", { name: "已儲存的路線" })).toHaveValue(targetRouteId);
      expect(screen.getByRole("status")).toHaveTextContent(`已開啟 ${targetRouteName}`);
    });
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

  it("AdminDashboardPage 只保留行政儀表板，不在主內容區重複顯示醫師追蹤入口", () => {
    renderWithProviders(<AdminDashboardPage />);

    expect(screen.getByText("個案異常儀表板")).toBeInTheDocument();
    expect(screen.getByText("角色與任務儀表板")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "醫師追蹤入口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打開醫師追蹤" })).not.toBeInTheDocument();
    expect(screen.queryByText("教學指引")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Google Map 追蹤圖")).not.toBeInTheDocument();
    expect(screen.queryByText("目前距離")).not.toBeInTheDocument();
  });

  it("AdminDoctorTrackingPage 會集中顯示 Google Map 追蹤圖與站點進度", () => {
    renderWithProviders(<AdminDoctorTrackingPage />);

    expect(screen.getByText("Google Map 追蹤圖")).toBeInTheDocument();
    expect(screen.getByTitle("Google Map 追蹤圖")).toBeInTheDocument();
    expect(screen.getByText("目前距離")).toBeInTheDocument();
    expect(screen.getByText("最近移動軌跡")).toBeInTheDocument();
    expect(screen.getAllByText("已經過的地點").length).toBeGreaterThan(0);
    expect(screen.getByText("還沒有去的地點")).toBeInTheDocument();
  });

  it("AdminGuidePage 會集中顯示登入、定位授權與角色設定說明", () => {
    renderWithProviders(<AdminGuidePage />);

    expect(screen.getByText("教學指引")).toBeInTheDocument();
    expect(screen.getByText("目前作業方式")).toBeInTheDocument();
    expect(screen.getByText("角色設定說明")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往角色設置" })).toBeInTheDocument();
    expect(
      screen.getByText("這裡集中放登入、定位授權與角色維護的操作備忘，改成左側獨立標籤後，不再占用行政首頁主畫面空間。")
    ).toBeInTheDocument();
    expect(
      screen.getByText("2. 行政端固定為共用帳號「行政人員」，醫師資料與 LINE 聯絡設定都在角色設置頁集中維護。")
    ).toBeInTheDocument();
  });

  it("AdminDashboardPage 會顯示已移除家屬聯絡流程說明", () => {
    renderWithProviders(<AdminDashboardPage />);

    expect(screen.getByText("聯絡流程說明")).toBeInTheDocument();
    expect(
      screen.getByText("目前系統不再提供家屬聯絡、綁定或外部通訊流程；行政首頁只保留排程、定位、角色與 ContactLog 流程紀錄。")
    ).toBeInTheDocument();
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
  });

  it("AdminPatientsPage 儲存個案後會自動排入服務時段", () => {
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
    expect(screen.getByRole("status")).toHaveTextContent("自動排入");
    expect(screen.queryByRole("dialog", { name: "新增個案視窗" })).not.toBeInTheDocument();
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

    expect(screen.getByRole("status")).toHaveTextContent("個案非服務中，未自動排程");

    fireEvent.click(screen.getByRole("button", { name: "編輯 王麗珠" }));
    dialog = screen.getByRole("dialog", { name: "王○珠 編輯資料" });
    const statusSelect = within(dialog).getByRole("combobox", { name: "狀態管理" });
    expect(statusSelect).toHaveValue("paused");
    expect(within(statusSelect).getByRole("option", { name: "恢復治療" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByLabelText("王麗珠 勾選"));
    fireEvent.click(screen.getByRole("button", { name: "恢復" }));

    expect(screen.getByRole("status")).toHaveTextContent("已恢復 1 位個案");

    fireEvent.click(screen.getByRole("button", { name: "編輯 王麗珠" }));
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
    expect(screen.getByRole("button", { name: "LINE 聯絡設定" })).toBeInTheDocument();

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

  it("AdminStaffPage 可儲存醫師的 LINE 搜尋關鍵字", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: /蕭坤元醫師/ }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("LINE 搜尋關鍵字"), {
      target: { value: "蕭坤元主治" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存角色設置" }));

    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(
      storedDb.doctors.find((doctor: { id: string }) => doctor.id === "doc-001")?.line_search_keyword
    ).toBe("蕭坤元主治");
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

  it("AdminStaffPage 可開啟並儲存 LINE 聯絡設定", () => {
    renderWithProviders(<AdminStaffPage />);

    fireEvent.click(screen.getByRole("button", { name: "LINE 聯絡設定" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "LINE 聯絡設定" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("行政 LINE 入口連結"), {
      target: { value: "line://msg/text/admin-link" }
    });
    fireEvent.click(within(dialog).getByLabelText("啟用桌面 LINE 自動化"));
    fireEvent.change(within(dialog).getByLabelText("LINE helper 位址"), {
      target: { value: "http://127.0.0.1:9000/" }
    });
    fireEvent.change(within(dialog).getByLabelText("LINE 視窗標題提示"), {
      target: { value: "LINE 視窗" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "儲存 LINE 設定" }));

    expect(screen.getByRole("status")).toHaveTextContent("已儲存 LINE 聯絡設定。");
    const storedDb = JSON.parse(window.localStorage.getItem(MOCK_DB_STORAGE_KEY) ?? "{}");
    expect(storedDb.communication_settings?.doctor_contact_line_url).toBe("line://msg/text/admin-link");
    const helperSettings = JSON.parse(
      window.localStorage.getItem(DESKTOP_LINE_SETTINGS_STORAGE_KEY) ?? "{}"
    );
    expect(helperSettings.enabled).toBe(true);
    expect(helperSettings.helper_base_url).toBe("http://127.0.0.1:9000");
    expect(helperSettings.line_window_hint).toBe("LINE 視窗");
  });
});
