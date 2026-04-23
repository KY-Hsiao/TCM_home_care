import type { ContactLog } from "../../domain/models";
import { at, stamp } from "./helpers";

const contactRows = [
  ["cl-001", "pat-001", "vs-002", "cg-001", null, "admin-001", "google_chat", "訪前提醒", "已提醒王怡萱今日上午訪視。", "家屬已讀。", 0, 7, 40],
  ["cl-002", "pat-002", "vs-002", "cg-002", "doc-001", null, "phone", "今日確認", "確認上午可進行訪視。", "家屬表示可。", 0, 7, 55],
  ["cl-003", "pat-003", "vs-003", "cg-004", null, "admin-002", "google_chat", "睡眠摘要需求", "家屬希望訪後提供摘要。", "已加入提醒。", 0, 8, 50],
  ["cl-004", "pat-004", "vs-004", "cg-005", null, "admin-002", "phone", "到府前通知", "告知醫師已出發。", "家屬會在家等候。", 0, 9, 5],
["cl-005", "pat-005", "vs-005", "cg-006", "doc-001", null, "in_person", "現場說明", "說明動作練習重點。", "家屬表示理解。", 0, 11, 40],
["cl-006", "pat-006", "vs-006", "cg-008", "doc-001", null, "in_person", "衛教預告", "治療後將補充呼吸衛教。", "家屬等待摘要。", 0, 14, 35],
["cl-007", "pat-007", "vs-007", "cg-009", "doc-001", null, "phone", "訪後關懷", "追蹤便祕改善與睡眠情形。", "家屬回覆有改善。", 0, 11, 20],
  ["cl-008", "pat-008", "vs-008", "cg-011", null, "admin-001", "phone", "改期聯繫", "病家希望改為隔日下午。", "待行政安排。", 1, 9, 15],
  ["cl-009", "pat-009", "vs-009", "cg-012", null, "admin-002", "phone", "取消追蹤", "個案外出，需另約。", "家屬同意待通知。", 1, 15, 20],
  ["cl-010", "pat-010", "vs-010", "cg-013", null, "admin-001", "sms", "上午提醒", "發送固定上午訪視提醒。", "簡訊發送失敗。", 1, 7, 52],
  ["cl-011", "pat-001", "vs-011", "cg-001", "doc-001", null, "google_chat", "加開訪視", "說明明日下午加開追蹤。", "家屬尚未回覆。", 1, 12, 30],
  ["cl-012", "pat-003", "vs-012", "cg-004", null, "admin-002", "google_chat", "模板測試", "測試訪後摘要模板內容。", "家屬表示格式清楚。", 2, 9, 20],
  ["cl-013", "pat-004", "vs-013", "cg-005", null, "admin-001", "phone", "電梯確認", "提醒病家安排樓管協助。", "已確認。", 2, 13, 50],
  ["cl-014", "pat-005", "vs-014", "cg-007", null, "admin-002", "sms", "異常通知規則", "僅在異常時通知次要家屬。", "設定完成。", 2, 16, 10],
["cl-015", "pat-006", "vs-015", "cg-008", "doc-001", null, "google_chat", "用藥提醒需求", "家屬希望加上吸入器提醒。", "已轉為 reminder。", 3, 8, 45],
  ["cl-016", "pat-007", "vs-016", "cg-010", null, "admin-001", "google_chat", "家屬摘要偏好", "次要家屬可收電子摘要。", "已備註。", 3, 10, 0],
  ["cl-017", "pat-009", "vs-017", "cg-016", null, "admin-002", "phone", "改期同步", "配偶可於晚間接電話。", "今晚再撥。", 3, 17, 30],
["cl-018", "pat-010", "vs-018", "cg-013", "doc-001", null, "phone", "請假風險說明", "若醫師請假需先改派。", "家屬可接受提早通知。", 4, 8, 15],
  ["cl-019", "pat-002", "vs-019", "cg-003", null, "admin-001", "google_chat", "次要家屬綁定", "確認配偶可接 Google Chat 通知。", "已綁定成功。", 4, 11, 40],
  ["cl-020", "pat-011", "vs-020", "cg-014", null, "admin-002", "phone", "月訪說明", "說明改為月訪流程。", "家屬表示了解。", 5, 10, 45],
  ["cl-021", "pat-012", "vs-021", "cg-015", null, "admin-001", "phone", "出院後關懷", "確認是否恢復居家訪視。", "家屬希望先電話追蹤。", 5, 14, 10],
  ["cl-022", "pat-004", "vs-022", "cg-005", null, "admin-001", "sms", "路線確認", "提醒下週仍維持原址。", "已發送。", 6, 8, 20],
["cl-023", "pat-005", "vs-023", "cg-006", "doc-001", null, "google_chat", "起身訓練回報", "家屬上傳近三日起身狀況。", "醫師待查看。", 6, 13, 10],
  ["cl-024", "pat-001", "vs-024", "cg-001", null, "admin-001", "google_chat", "下週固定排程", "確認維持每週一上午。", "家屬確認。", 7, 10, 30]
] as const;

export const contactLogsSeed: ContactLog[] = contactRows.map(
  ([
    id,
    patientId,
    visitScheduleId,
    caregiverId,
    doctorId,
    adminUserId,
    channel,
    subject,
    content,
    outcome,
    dayOffset,
    hour,
    minute
  ]) => ({
    id,
    patient_id: patientId,
    visit_schedule_id: visitScheduleId,
    caregiver_id: caregiverId,
    doctor_id: doctorId,
    admin_user_id: adminUserId,
    channel,
    subject,
    content,
    outcome,
    contacted_at: at(dayOffset, hour, minute),
    ...stamp(dayOffset)
  })
);
