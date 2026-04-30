import { useMemo } from "react";
import { useAppContext } from "../../app/use-app-context";
import { StaffCommunicationPanel } from "../../shared/components/StaffCommunicationDialog";
import { maskPatientName } from "../../shared/utils/patient-name";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull } from "../../shared/utils/format";

const ACTIVE_VISIT_STATUSES = [
  "waiting_departure",
  "preparing",
  "on_the_way",
  "tracking",
  "proximity_pending",
  "arrived",
  "in_treatment",
  "followup_pending",
  "issue_pending",
  "scheduled"
] as const;

export function DoctorTeamCommunicationPage() {
  const { db, repositories, session } = useAppContext();
  const currentDoctor = repositories.patientRepository.getDoctors().find((doctor) => doctor.id === session.activeDoctorId);
  const currentAdmin =
    repositories.patientRepository.getAdmins().find((admin) => admin.id === session.activeAdminId) ??
    repositories.patientRepository.getAdmins()[0];

  const doctorSchedules = useMemo(
    () =>
      currentDoctor
        ? repositories.visitRepository
            .getSchedules({ doctorId: currentDoctor.id })
            .sort(
              (left, right) =>
                new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime()
            )
        : [],
    [currentDoctor, repositories]
  );
  const activeSchedule =
    doctorSchedules.find((schedule) => ACTIVE_VISIT_STATUSES.includes(schedule.status as (typeof ACTIVE_VISIT_STATUSES)[number])) ??
    doctorSchedules[0] ??
    null;
  const activePatient = activeSchedule
    ? repositories.patientRepository.getPatientById(activeSchedule.patient_id)
    : undefined;
  const conversationLogs = useMemo(
    () =>
      currentDoctor && currentAdmin
        ? [...db.contact_logs]
            .filter(
              (log) =>
                log.doctor_id === currentDoctor.id &&
                log.admin_user_id === currentAdmin.id &&
                ["phone", "web_notice"].includes(log.channel)
            )
            .sort(
              (left, right) =>
                new Date(right.contacted_at).getTime() - new Date(left.contacted_at).getTime()
            )
        : [],
    [currentAdmin, currentDoctor, db.contact_logs]
  );
  const unreadTeamCommunicationItems = useMemo(
    () =>
      currentDoctor
        ? repositories.notificationRepository
            .getNotificationCenterItems("doctor", currentDoctor.id)
            .filter(
              (item) =>
                item.is_unread &&
                item.role === "doctor" &&
                item.owner_user_id === currentDoctor.id &&
                item.linked_doctor_id === currentDoctor.id &&
                ["manual_notice", "system_notification"].includes(item.source_type) &&
                (item.title.startsWith("院內對話｜") ||
                  item.title.startsWith("語音通話邀請｜") ||
                  item.content.includes("團隊通訊"))
            )
            .sort(
              (left, right) =>
                new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
            )
        : [],
    [currentDoctor, repositories]
  );
  const latestUnreadTeamCommunication = unreadTeamCommunicationItems[0] ?? null;
  const markDoctorConversationRead = () => {
    unreadTeamCommunicationItems.forEach((item) => {
      repositories.notificationRepository.markNotificationCenterItemRead(item.id);
    });
  };

  const createDoctorAdminContactLog = (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => {
    if (!currentDoctor || !currentAdmin) {
      return;
    }
    const now = new Date().toISOString();
    repositories.contactRepository.createContactLog({
      id: `staff-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      patient_id: activePatient?.id ?? null,
      visit_schedule_id: activeSchedule?.id ?? null,
      caregiver_id: null,
      doctor_id: currentDoctor.id,
      admin_user_id: currentAdmin.id,
      channel: input.channel,
      subject: input.subject,
      content: input.content,
      outcome: input.outcome,
      contacted_at: now,
      created_at: now,
      updated_at: now
    });
    if (input.channel === "web_notice" || input.channel === "phone") {
      repositories.notificationRepository.createNotificationCenterItem({
        id: `nc-staff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "admin",
        owner_user_id: currentAdmin.id,
        source_type: input.channel === "phone" ? "system_notification" : "manual_notice",
        title: input.subject,
        content:
          input.channel === "phone"
            ? `${input.content}\n請打開團隊通訊頁面立即回應。`
            : input.content,
        linked_patient_id: activePatient?.id ?? null,
        linked_visit_schedule_id: activeSchedule?.id ?? null,
        linked_doctor_id: currentDoctor.id,
        linked_leave_request_id: null,
        status: "pending",
        is_unread: true,
        reply_text: null,
        reply_updated_at: null,
        reply_updated_by_role: null,
        created_at: now,
        updated_at: now
      });
    }
  };

  if (!currentDoctor || !currentAdmin) {
    return <Panel title="團隊通訊">目前找不到登入中的醫師或行政資料。</Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel title="團隊通訊" className="p-3 lg:p-4">
        <div className="space-y-3">
          {unreadTeamCommunicationItems.length ? (
            <div className="rounded-[1.6rem] border-2 border-rose-300 bg-rose-50 p-4 text-rose-800 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">行政人員有 {unreadTeamCommunicationItems.length} 則未讀團隊通訊</p>
                  <p className="mt-1 text-xs text-rose-700">請優先查看最新訊息並回應，避免漏掉院內協調或語音通話邀請。</p>
                </div>
                <span className="rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white">
                  未讀 {unreadTeamCommunicationItems.length}
                </span>
              </div>
              {latestUnreadTeamCommunication ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-white/80 px-4 py-3 text-sm">
                  <p className="font-semibold text-brand-ink">{latestUnreadTeamCommunication.title}</p>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{latestUnreadTeamCommunication.content}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    收到時間：{formatDateTimeFull(latestUnreadTeamCommunication.created_at)}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-2.5 md:grid-cols-3">
            <div className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm">
              <p className="text-xs text-slate-500">對話對象</p>
              <p className="mt-2 font-semibold text-brand-ink">行政人員</p>
            </div>
            <div className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm">
              <p className="text-xs text-slate-500">目前案件</p>
              <p className="mt-2 font-semibold text-brand-ink">
                {activeSchedule && activePatient
                  ? `第 ${activeSchedule.route_order} 站 ${maskPatientName(activePatient.name)}`
                  : "院內行政協調"}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3 text-sm">
              <p className="text-xs text-slate-500">最近聯絡時間</p>
              <p className="mt-2 font-semibold text-brand-ink">
                {conversationLogs[0] ? formatDateTimeFull(conversationLogs[0].contacted_at) : "尚未聯絡"}
              </p>
            </div>
          </div>

          <div className="h-[min(72dvh,820px)] min-h-[420px]">
            <StaffCommunicationPanel
              title="團隊通訊｜行政人員"
              counterpartLabel="行政人員"
              counterpartPhone={currentAdmin.phone}
              currentUserLabel={currentDoctor.name}
              contextLabel={
                activeSchedule && activePatient
                  ? `第 ${activeSchedule.route_order} 站 ${maskPatientName(activePatient.name)}`
                  : "院內行政協調"
              }
              doctorId={currentDoctor.id}
              adminUserId={currentAdmin.id}
              patientId={activePatient?.id ?? null}
              visitScheduleId={activeSchedule?.id ?? null}
              logs={conversationLogs}
              unreadConversationCount={unreadTeamCommunicationItems.length}
              onConversationViewed={markDoctorConversationRead}
              onCreateLog={createDoctorAdminContactLog}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}
