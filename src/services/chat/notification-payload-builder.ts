import { formatDateTimeFull, formatTimeOnly } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";
import type { NotificationPayloadBuilder } from "../types";

const templateCodeByType = {
  visit_reminder: "visit_reminder_in_app",
  visit_today: "visit_today_in_app",
  visit_delay: "visit_delay_in_app",
  visit_reschedule: "visit_reschedule_in_app",
  visit_coverage: "visit_coverage_in_app",
  visit_completed: "visit_completed_in_app",
  doctor_departure_check: "doctor_departure_check",
  doctor_arrival_feedback: "doctor_arrival_feedback",
  doctor_emergency_alert: "doctor_emergency_alert",
  family_followup_normal: "family_followup_normal",
  family_followup_absent: "family_followup_absent",
  family_followup_admin: "family_followup_admin",
  family_followup_urgent: "family_followup_urgent"
} as const;

export function createNotificationPayloadBuilder(): NotificationPayloadBuilder {
  return {
    buildPayload({ type, detail, summary, delayMinutes, coverageDoctorName, rescheduleNote, feedbackCode }) {
      const visitTime = formatDateTimeFull(detail.schedule.scheduled_start_at);
      const timeRange = `${formatDateTimeFull(detail.schedule.scheduled_start_at)} - ${formatTimeOnly(
        detail.schedule.scheduled_end_at
      )}`;
      const maskedPatientName = maskPatientName(detail.patient.name);
      const sharedPreviewPayload = {
        patient_name: maskedPatientName,
        doctor_name: detail.doctor.name,
        visit_time: visitTime,
        time_range: timeRange,
        address: detail.schedule.address_snapshot
      };

      switch (type) {
        case "visit_reminder":
          return {
            eventType: type,
            subject: "明日訪視提醒",
            body: `您好，${maskedPatientName} 明日 ${visitTime} 由 ${detail.doctor.name} 醫師到宅訪視。若有需要調整，請直接由行政端協助處理。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify(
              {
                cardsV2: [
                  {
                    cardId: "visit_reminder",
                    card: {
                      header: { title: "明日訪視提醒", subtitle: maskedPatientName },
                      sections: [
                        {
                          widgets: [
                            { decoratedText: { text: `醫師：${detail.doctor.name}` } },
                            { decoratedText: { text: `時間：${visitTime}` } }
                          ]
                        }
                      ]
                    }
                  }
                ]
              },
              null,
              2
            ),
            actions: [
              { label: "可配合", action: "approve" },
              { label: "想改期", action: "reschedule_request" }
            ],
            previewPayload: sharedPreviewPayload
          };
        case "visit_today":
          return {
            eventType: type,
            subject: "今日到訪通知",
            body: `${detail.doctor.name} 醫師已抵達 ${maskedPatientName} 住家，系統已自動記錄抵達時間並開始本次訪視。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify(
              {
                cardsV2: [
                  {
                    cardId: "visit_today",
                    card: {
                      header: { title: "今日到訪通知", subtitle: maskedPatientName },
                      sections: [{ widgets: [{ decoratedText: { text: `抵達時間：${detail.record?.arrival_time ?? "auto"}` } }] }]
                    }
                  }
                ]
              },
              null,
              2
            ),
            actions: [
              { label: "收到", action: "approve" },
              { label: "留言給行政", action: "admin_note" }
            ],
            previewPayload: sharedPreviewPayload
          };
        case "visit_delay":
          return {
            eventType: type,
            subject: "延遲通知",
            body: `${maskedPatientName} 本次訪視預估延遲 ${delayMinutes ?? 0} 分鐘，若需調整請直接聯繫行政。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify(
              {
                cardsV2: [
                  {
                    cardId: "visit_delay",
                    card: {
                      header: { title: "延遲通知", subtitle: maskedPatientName },
                      sections: [{ widgets: [{ decoratedText: { text: `預估延遲 ${String(delayMinutes ?? 0)} 分鐘` } }] }]
                    }
                  }
                ]
              },
              null,
              2
            ),
            actions: [
              { label: "了解", action: "approve" },
              { label: "需要改期", action: "reschedule_request" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              delay_minutes: String(delayMinutes ?? 0)
            }
          };
        case "visit_reschedule":
          return {
            eventType: type,
            subject: "請假 / 改期通知",
            body: `${maskedPatientName} 原定訪視需調整。${rescheduleNote ?? "請由行政端確認最新安排。"}。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify(
              {
                cardsV2: [
                  {
                    cardId: "visit_reschedule",
                    card: {
                      header: { title: "請假 / 改期通知", subtitle: maskedPatientName },
                      sections: [{ widgets: [{ textParagraph: { text: rescheduleNote ?? "待行政確認" } }] }]
                    }
                  }
                ]
              },
              null,
              2
            ),
            actions: [
              { label: "收到", action: "approve" },
              { label: "提出改期", action: "reschedule_request" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              reschedule_note: rescheduleNote ?? "待行政確認"
            }
          };
        case "visit_coverage":
          return {
            eventType: type,
            subject: "代班醫師通知",
            body: `${maskedPatientName} 本次訪視改由 ${coverageDoctorName ?? detail.doctor.name} 醫師處理，時間維持 ${visitTime}。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify(
              {
                cardsV2: [
                  {
                    cardId: "visit_coverage",
                    card: {
                      header: { title: "代班醫師通知", subtitle: maskedPatientName },
                      sections: [{ widgets: [{ decoratedText: { text: `醫師：${coverageDoctorName ?? detail.doctor.name}` } }] }]
                    }
                  }
                ]
              },
              null,
              2
            ),
            actions: [
              { label: "收到", action: "approve" },
              { label: "留言給醫師", action: "doctor_note" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              doctor_name: coverageDoctorName ?? detail.doctor.name
            }
          };
        case "visit_completed":
        case "family_followup_normal":
          {
            const completionSummary =
              summary ?? detail.record?.follow_up_note ?? detail.patient.last_visit_summary ?? "已完成訪視";
          return {
            eventType: type,
            subject: "訪視已完成",
            body: `${maskedPatientName} 本次訪視已完成，若需補充說明請由行政端協助處理。摘要：${completionSummary}`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify(
              {
                cardsV2: [
                  {
                    cardId: "visit_completed",
                    card: {
                      header: { title: "訪視已完成", subtitle: maskedPatientName },
                      sections: [{ widgets: [{ textParagraph: { text: completionSummary } }] }]
                    }
                  }
                ]
              },
              null,
              2
            ),
            actions: [
              { label: "收到", action: "approve" },
              { label: "留言給行政", action: "admin_note" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              summary: completionSummary
            }
          };
          }
        case "family_followup_absent":
          return {
            eventType: type,
            subject: "今日未完成看診",
            body: `${maskedPatientName} 今日到訪時未能完成看診，請回覆是否需要協助重新安排。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify({ cardsV2: [{ cardId: "family_followup_absent", card: { header: { title: "今日未完成看診" } } }] }, null, 2),
            actions: [
              { label: "需要改期", action: "reschedule_request" },
              { label: "行政回電", action: "admin_note" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              status: "absent"
            }
          };
        case "family_followup_admin":
          return {
            eventType: type,
            subject: "行政將協助追蹤",
            body: `${maskedPatientName} 本次案件需要行政協助，若需補充資訊請直接回覆。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify({ cardsV2: [{ cardId: "family_followup_admin", card: { header: { title: "行政將協助追蹤" } } }] }, null, 2),
            actions: [
              { label: "收到", action: "approve" },
              { label: "請行政聯絡", action: "admin_note" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              status: "admin_followup"
            }
          };
        case "family_followup_urgent":
          return {
            eventType: type,
            subject: "緊急狀況通知",
            body: `${maskedPatientName} 今日有緊急處置需求，行政將儘速與您聯繫。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify({ cardsV2: [{ cardId: "family_followup_urgent", card: { header: { title: "緊急狀況通知" } } }] }, null, 2),
            actions: [
              { label: "收到", action: "approve" },
              { label: "請立即聯絡", action: "admin_note" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              status: "urgent"
            }
          };
        case "doctor_departure_check":
          return {
            eventType: type,
            subject: "請確認是否出發",
            body: `${detail.doctor.name} 醫師，請按下出發並開啟定位追蹤，系統會在逼近 ${maskedPatientName} 時提醒您回報狀態。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify({ cardsV2: [{ cardId: "doctor_departure_check", card: { header: { title: "請確認是否出發" } } }] }, null, 2),
            actions: [
              { label: "我已出發", action: "doctor_departed" },
              { label: "稍後出發", action: "doctor_note" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              tracking_mode: detail.schedule.tracking_mode
            }
          };
        case "doctor_arrival_feedback":
          return {
            eventType: type,
            subject: "請確認現場狀況",
            body: `系統偵測您已逼近 ${maskedPatientName}，請回報：正常看診 / 不在家 / 行政追蹤 / 緊急處置。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify({ cardsV2: [{ cardId: "doctor_arrival_feedback", card: { header: { title: "請確認現場狀況" } } }] }, null, 2),
            actions: [
              { label: "正常看診", action: "doctor_feedback_normal" },
              { label: "不在家", action: "doctor_feedback_absent" },
              { label: "行政追蹤", action: "doctor_feedback_admin" },
              { label: "緊急處置", action: "doctor_feedback_urgent" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              feedback_code: feedbackCode ?? detail.schedule.last_feedback_code ?? "pending"
            }
          };
        case "doctor_emergency_alert":
          return {
            eventType: type,
            subject: "緊急處置已通知行政",
            body: `${maskedPatientName} 已標記為緊急處置，請優先完成現場處置並等待行政支援。`,
            templateCode: templateCodeByType[type],
            cardDraft: JSON.stringify({ cardsV2: [{ cardId: "doctor_emergency_alert", card: { header: { title: "緊急處置已通知行政" } } }] }, null, 2),
            actions: [
              { label: "已收到", action: "approve" },
              { label: "結束追蹤", action: "doctor_visit_finished" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              feedback_code: "urgent"
            }
          };
        default:
          return {
            eventType: "visit_completed",
            subject: "訪視完成通知",
            body: `${maskedPatientName} 本次訪視已完成。${(summary ?? detail.patient.last_visit_summary) || "若需補充內容，請由行政端協助處理。"}。`,
            templateCode: templateCodeByType.visit_completed,
            cardDraft: JSON.stringify(
              {
                cardsV2: [
                  {
                    cardId: "visit_completed_default",
                    card: {
                      header: { title: "訪視完成通知", subtitle: maskedPatientName },
                      sections: [{ widgets: [{ textParagraph: { text: summary ?? detail.patient.last_visit_summary ?? "待補摘要" } }] }]
                    }
                  }
                ]
              },
              null,
              2
            ),
            actions: [
              { label: "收到", action: "approve" },
              { label: "回覆行政", action: "admin_note" }
            ],
            previewPayload: {
              ...sharedPreviewPayload,
              summary: summary ?? detail.patient.last_visit_summary ?? "待補摘要"
            }
          };
      }
    }
  };
}
