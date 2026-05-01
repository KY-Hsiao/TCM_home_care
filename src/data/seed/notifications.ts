import type {
  NotificationCenterItem,
  NotificationTask,
  NotificationTemplate
} from "../../domain/models";
import { stamp } from "./helpers";

export const notificationTemplatesSeed: NotificationTemplate[] = [
  {
    id: "tpl-003",
    code: "reschedule_phone",
    title: "改期電話腳本",
    category: "行政協作",
    channel: "phone",
    subject_template: "訪視改期通知",
    body_template: "您好，因 {{reason}}，{{patient_name}} 原定訪視需調整至 {{new_time}}。",
    card_message_draft: "{\n  \"type\": \"text\",\n  \"note\": \"電話腳本暫無卡片內容\"\n}",
    variables: ["reason", "patient_name", "new_time"],
    ...stamp(-4)
  },
  {
    id: "tpl-004",
    code: "leave_conflict_sms",
    title: "請假衝突簡訊",
    category: "行政協作",
    channel: "sms",
    subject_template: "訪視時段異動通知",
    body_template: "因醫師行程調整，{{patient_name}} 訪視將再確認新時段。",
    card_message_draft: "{\n  \"type\": \"text\",\n  \"note\": \"簡訊通知無卡片內容\"\n}",
    variables: ["patient_name"],
    ...stamp(-4)
  },
  {
    id: "tpl-006",
    code: "follow_up_phone",
    title: "追蹤電話提醒",
    category: "關懷追蹤",
    channel: "phone",
    subject_template: "追蹤回訪腳本",
    body_template: "請確認 {{patient_name}} 近三日狀況。",
    card_message_draft: "{\n  \"type\": \"text\",\n  \"note\": \"電話追蹤腳本\"\n}",
    variables: ["patient_name"],
    ...stamp(-3)
  },
  {
    id: "tpl-007",
    code: "doctor_departure_check",
    title: "醫師出發確認",
    category: "醫師流程",
    channel: "google_chat",
    subject_template: "請確認是否出發",
    body_template: "{{doctor_name}} 醫師，請確認是否已前往 {{patient_name}}，並開啟定位追蹤。",
    card_message_draft: "{\n  \"cardsV2\": [{\n    \"cardId\": \"doctor_departure_check\"\n  }]\n}",
    variables: ["doctor_name", "patient_name"],
    ...stamp(-2)
  },
  {
    id: "tpl-008",
    code: "doctor_arrival_feedback",
    title: "逼近終點回饋",
    category: "醫師流程",
    channel: "google_chat",
    subject_template: "請確認現場狀況",
    body_template: "已接近 {{patient_name}}，請選擇正常看診、不在家、行政追蹤或緊急處置。",
    card_message_draft: "{\n  \"cardsV2\": [{\n    \"cardId\": \"doctor_arrival_feedback\"\n  }]\n}",
    variables: ["patient_name"],
    ...stamp(-2)
  },
  {
    id: "tpl-009",
    code: "doctor_emergency_alert",
    title: "緊急處置警示",
    category: "醫師流程",
    channel: "google_chat",
    subject_template: "緊急處置",
    body_template: "{{patient_name}} 發生緊急狀況，行政已收到通知並啟動後續處理。",
    card_message_draft: "{\n  \"cardsV2\": [{\n    \"cardId\": \"doctor_emergency_alert\"\n  }]\n}",
    variables: ["patient_name"],
    ...stamp(-2)
  }
];

export const notificationTasksSeed: NotificationTask[] = [];

export const notificationCenterItemsSeed: NotificationCenterItem[] = [];
