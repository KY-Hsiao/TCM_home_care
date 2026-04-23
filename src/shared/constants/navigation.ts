import type { UserRole } from "../../domain/enums";

export type NavItem = {
  to: string;
  label: string;
  description: string;
};

export const navigationByRole: Record<UserRole, NavItem[]> = {
  doctor: [
    { to: "/doctor/dashboard", label: "今日訪視", description: "查看今日案件、快速出發與通知" },
    { to: "/doctor/schedules", label: "排程清單", description: "追蹤狀態與時間變化" },
    { to: "/doctor/location", label: "目前位置", description: "查看 Google 地圖與目前所在位置" },
    { to: "/doctor/return-records", label: "回院病歷", description: "勾選四診並延續上次病史產生病歷" },
    { to: "/doctor/reminders", label: "提醒中心", description: "未完成紀錄、回電與追蹤案件" }
  ],
  admin: [
    { to: "/admin/dashboard", label: "行政總覽", description: "查看儀錶板指標、異常摘要與角色任務" },
    { to: "/admin/doctor-tracking", label: "醫師追蹤", description: "查看 Google Map 追蹤圖、距離與站點進度" },
    { to: "/admin/patients", label: "個案管理", description: "新增、編輯、指派醫師與狀態管理" },
    { to: "/admin/schedules", label: "排程管理", description: "查看排程、最短路線規劃與導航接力" },
    { to: "/admin/staff", label: "角色設置", description: "管理系統人員身分、Google 帳號與請假異動" },
    { to: "/admin/notifications", label: "流程紀錄", description: "查看 ContactLog 與停用中的通知說明" },
    { to: "/admin/guide", label: "教學指引", description: "查看登入、定位授權與操作備忘" }
  ],
  caregiver: []
};
