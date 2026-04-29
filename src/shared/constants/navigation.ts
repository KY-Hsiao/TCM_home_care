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
    { to: "/doctor/reminders", label: "通知中心", description: "站內通知、個案追蹤與回覆紀錄" }
  ],
  admin: [
    { to: "/admin/dashboard", label: "行政總覽", description: "查看儀錶板指標、異常摘要與角色任務" },
    { to: "/admin/reminders", label: "通知中心", description: "集中查看站內通知、提醒、請假與異常通報" },
    { to: "/admin/doctor-tracking", label: "醫師追蹤", description: "查看 Google Map 追蹤圖、距離與站點進度" },
    { to: "/admin/patients", label: "個案管理", description: "新增、編輯、指派醫師與狀態管理" },
    { to: "/admin/schedules", label: "排程管理", description: "查看排程、最短路線規劃與導航接力" },
    { to: "/admin/staff", label: "角色設置", description: "管理系統人員身分、Google 帳號與服務設定" }
  ],
  caregiver: []
};
