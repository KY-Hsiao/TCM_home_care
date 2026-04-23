import type { Caregiver, CaregiverChatBinding } from "../../domain/models";
import { stamp } from "./helpers";

export const caregiversSeed: Caregiver[] = [
  { id: "cg-001", patient_id: "pat-001", name: "王怡萱", relationship: "女兒", phone: "0910-001-001", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "白天可即時回覆", ...stamp(-6) },
  { id: "cg-002", patient_id: "pat-002", name: "陳明凱", relationship: "兒子", phone: "0910-001-002", preferred_contact_channel: "phone", is_primary: true, receives_notifications: true, notes: "上午較方便", ...stamp(-6) },
  { id: "cg-003", patient_id: "pat-002", name: "陳淑芬", relationship: "配偶", phone: "0910-001-003", preferred_contact_channel: "google_chat", is_primary: false, receives_notifications: true, notes: "主要在家陪同", ...stamp(-6) },
  { id: "cg-004", patient_id: "pat-003", name: "李宜庭", relationship: "女兒", phone: "0910-001-004", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "希望訪後 Google Chat 摘要", ...stamp(-5) },
  { id: "cg-005", patient_id: "pat-004", name: "周明哲", relationship: "兒子", phone: "0910-001-005", preferred_contact_channel: "phone", is_primary: true, receives_notifications: true, notes: "需提前 30 分通知", ...stamp(-5) },
  { id: "cg-006", patient_id: "pat-005", name: "郭佩琪", relationship: "女兒", phone: "0910-001-006", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "有照護筆記需求", ...stamp(-5) },
  { id: "cg-007", patient_id: "pat-005", name: "陳建華", relationship: "女婿", phone: "0910-001-007", preferred_contact_channel: "sms", is_primary: false, receives_notifications: false, notes: "僅異常時通知", ...stamp(-5) },
  { id: "cg-008", patient_id: "pat-006", name: "黃筱雯", relationship: "女兒", phone: "0910-001-008", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "要提醒吸入器使用", ...stamp(-4) },
  { id: "cg-009", patient_id: "pat-007", name: "蔡靜怡", relationship: "媳婦", phone: "0910-001-009", preferred_contact_channel: "phone", is_primary: true, receives_notifications: true, notes: "家屬下午才有空", ...stamp(-4) },
  { id: "cg-010", patient_id: "pat-007", name: "蔡宏宇", relationship: "兒子", phone: "0910-001-010", preferred_contact_channel: "google_chat", is_primary: false, receives_notifications: true, notes: "可收電子摘要", ...stamp(-4) },
  { id: "cg-011", patient_id: "pat-008", name: "鄭雅玲", relationship: "女兒", phone: "0910-001-011", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "目前暫停訪視", ...stamp(-4) },
  { id: "cg-012", patient_id: "pat-009", name: "蕭宇翔", relationship: "兒子", phone: "0910-001-012", preferred_contact_channel: "sms", is_primary: true, receives_notifications: true, notes: "出差時改聯繫配偶", ...stamp(-3) },
  { id: "cg-013", patient_id: "pat-010", name: "劉芝儀", relationship: "女兒", phone: "0910-001-013", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "固定上午陪診", ...stamp(-3) },
  { id: "cg-014", patient_id: "pat-011", name: "何文修", relationship: "兒子", phone: "0910-001-014", preferred_contact_channel: "phone", is_primary: true, receives_notifications: true, notes: "改月訪後改由行政月初確認", ...stamp(-3) },
  { id: "cg-015", patient_id: "pat-012", name: "彭曉琪", relationship: "女兒", phone: "0910-001-015", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "住院後追蹤狀態", ...stamp(-3) },
  { id: "cg-016", patient_id: "pat-009", name: "蕭陳雪麗", relationship: "配偶", phone: "0910-001-016", preferred_contact_channel: "phone", is_primary: false, receives_notifications: false, notes: "晚間可接電話", ...stamp(-2) },
  { id: "cg-017", patient_id: "pat-013", name: "許雅婷", relationship: "女兒", phone: "0910-001-017", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "上午先訊息提醒", ...stamp(-2) },
  { id: "cg-018", patient_id: "pat-014", name: "張慧君", relationship: "媳婦", phone: "0910-001-018", preferred_contact_channel: "phone", is_primary: true, receives_notifications: true, notes: "上午家中可配合", ...stamp(-2) },
  { id: "cg-019", patient_id: "pat-015", name: "吳品蓉", relationship: "女兒", phone: "0910-001-019", preferred_contact_channel: "google_chat", is_primary: true, receives_notifications: true, notes: "下午較方便陪同", ...stamp(-2) },
  { id: "cg-020", patient_id: "pat-016", name: "陳柏睿", relationship: "兒子", phone: "0910-001-020", preferred_contact_channel: "phone", is_primary: true, receives_notifications: true, notes: "下午需先電話確認在家", ...stamp(-2) }
];

export const caregiverChatBindingsSeed: CaregiverChatBinding[] = [
  { id: "cb-001", caregiver_id: "cg-001", google_chat_user_id: "users/001", google_account_email: "family001@example.com", google_account_logged_in: true, display_name: "怡萱", is_active: true, bound_at: "2026-03-10T09:00:00+08:00", last_interaction_at: "2026-04-19T19:30:00+08:00", ...stamp(-4) },
  { id: "cb-002", caregiver_id: "cg-003", google_chat_user_id: "users/002", google_account_email: "family002@example.com", google_account_logged_in: true, display_name: "陳淑芬", is_active: true, bound_at: "2026-03-12T10:30:00+08:00", last_interaction_at: null, ...stamp(-4) },
  { id: "cb-003", caregiver_id: "cg-004", google_chat_user_id: "users/003", google_account_email: "family003@example.com", google_account_logged_in: true, display_name: "宜庭", is_active: true, bound_at: "2026-03-15T14:00:00+08:00", last_interaction_at: "2026-04-18T13:00:00+08:00", ...stamp(-4) },
  { id: "cb-004", caregiver_id: "cg-006", google_chat_user_id: "users/004", google_account_email: "family004@example.com", google_account_logged_in: true, display_name: "佩琪", is_active: true, bound_at: "2026-03-16T11:00:00+08:00", last_interaction_at: "2026-04-20T08:20:00+08:00", ...stamp(-3) },
  { id: "cb-005", caregiver_id: "cg-008", google_chat_user_id: "users/005", google_account_email: "family005@example.com", google_account_logged_in: true, display_name: "筱雯", is_active: true, bound_at: "2026-03-20T15:00:00+08:00", last_interaction_at: "2026-04-17T17:45:00+08:00", ...stamp(-3) },
  { id: "cb-006", caregiver_id: "cg-010", google_chat_user_id: "users/006", google_account_email: "family006@example.com", google_account_logged_in: true, display_name: "宏宇", is_active: true, bound_at: "2026-03-24T12:30:00+08:00", last_interaction_at: null, ...stamp(-3) },
  { id: "cb-007", caregiver_id: "cg-011", google_chat_user_id: "users/007", google_account_email: "family007@example.com", google_account_logged_in: false, display_name: "雅玲", is_active: false, bound_at: "2026-03-26T16:30:00+08:00", last_interaction_at: "2026-04-02T10:00:00+08:00", ...stamp(-2) },
  { id: "cb-008", caregiver_id: "cg-013", google_chat_user_id: "users/008", google_account_email: "family008@example.com", google_account_logged_in: true, display_name: "芝儀", is_active: true, bound_at: "2026-03-28T09:20:00+08:00", last_interaction_at: "2026-04-19T20:10:00+08:00", ...stamp(-2) },
  { id: "cb-009", caregiver_id: "cg-015", google_chat_user_id: "users/009", google_account_email: "family009@example.com", google_account_logged_in: true, display_name: "曉琪", is_active: true, bound_at: "2026-04-01T18:10:00+08:00", last_interaction_at: null, ...stamp(-2) }
];
