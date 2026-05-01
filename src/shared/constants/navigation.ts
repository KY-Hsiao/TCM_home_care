import type { UserRole } from "../../domain/enums";

export type NavItem = {
  to: string;
  label: string;
  description: string;
};

export const navigationByRole: Record<UserRole, NavItem[]> = {
  doctor: [
    { to: "/doctor/navigation", label: "即時導航", description: "在系統內查看導航、到站與接續下一站" },
    { to: "/doctor/return-records", label: "回院病歷", description: "勾選四診並延續上次病史產生病歷" },
    { to: "/doctor/leave-requests", label: "請假申請", description: "填寫請假期間、原因與交班備註" },
    { to: "/doctor/team-communication", label: "團隊通訊", description: "直接聯絡行政人員並查看院內協作紀錄" },
    { to: "/doctor/reminders", label: "通知中心", description: "站內通知、個案追蹤與回覆紀錄" }
  ],
  admin: [
    { to: "/admin/dashboard", label: "行政總覽", description: "查看儀錶板指標、異常摘要與角色任務" },
    { to: "/admin/reminders", label: "通知中心", description: "集中查看站內通知、提醒與異常通報" },
    { to: "/admin/leave-requests", label: "待處理請假", description: "集中查看醫師請假申請、核准狀態與受影響案件" },
    { to: "/admin/doctor-tracking", label: "醫師追蹤", description: "查看 Google Map 追蹤圖、距離與站點進度" },
    { to: "/admin/team-communication", label: "團隊通訊", description: "直接與醫師進行院內協作通訊並查看聯絡紀錄" },
    { to: "/admin/family-line", label: "LINE 家屬聯繫", description: "設定 LINE 家屬通知、自動提醒與群發公告" },
    { to: "/admin/schedules", label: "排程管理", description: "查看排程、最短路線規劃與導航接力" },
    { to: "/admin/patients", label: "個案管理", description: "新增、編輯、指派醫師與狀態管理" },
    { to: "/admin/staff", label: "角色設置", description: "管理系統人員身分、Google 帳號與服務設定" }
  ],
  caregiver: []
};
