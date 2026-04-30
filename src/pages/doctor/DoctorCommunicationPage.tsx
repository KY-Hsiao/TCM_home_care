import { useMemo } from "react";
import { useAppContext } from "../../app/use-app-context";
import { StaffCommunicationPanel } from "../../shared/components/StaffCommunicationDialog";
import { formatDateTimeFull } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";
import { Panel } from "../../shared/ui/Panel";
import { useTeamCommunicationConversation } from "../../services/team-communication/use-team-communication";

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

  const createDoctorAdminContactLog = async (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => {
    if (!currentDoctor || !currentAdmin) {
      return;
    }
    const now = new Date().toISOString();
    await conversation.createMessage({
      id: `staff-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      doctorId: currentDoctor.id,
      adminUserId: currentAdmin.id,
      senderRole: "doctor",
      senderUserId: currentDoctor.id,
      receiverRole: "admin",
      receiverUserId: currentAdmin.id,
      patientId: activePatient?.id ?? null,
      visitScheduleId: activeSchedule?.id ?? null,
      channel: input.channel,
      subject: input.subject,
      content: input.content,
      outcome: input.outcome,
      messageType:
        input.subject.startsWith("語音通話邀請｜")
          ? "voice_invite"
          : input.subject.startsWith("語音通話已接聽｜")
            ? "voice_accept"
            : input.subject.startsWith("語音通話已結束｜")
              ? "voice_end"
              : "text",
      callStatus:
        input.subject.startsWith("語音通話邀請｜")
          ? "ringing"
          : input.subject.startsWith("語音通話已接聽｜")
            ? "connected"
            : input.subject.startsWith("語音通話已結束｜")
              ? "ended"
              : null,
      contactedAt: now
    });
  };

  const conversation = useTeamCommunicationConversation({
    db,
    repositories,
    doctorId: currentDoctor?.id ?? "",
    adminUserId: currentAdmin?.id ?? "",
    viewerRole: "doctor",
    viewerUserId: currentDoctor?.id ?? "",
    enabled: Boolean(currentDoctor && currentAdmin)
  });

  if (!currentDoctor || !currentAdmin) {
    return <Panel title="團隊通訊">目前找不到登入中的醫師或行政資料。</Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel title="團隊通訊" className="p-3 lg:p-4">
        <div className="space-y-3">
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
                {conversation.messages.at(-1)?.contacted_at
                  ? formatDateTimeFull(conversation.messages.at(-1)!.contacted_at)
                  : "尚未聯絡"}
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
              logs={conversation.messages}
              unreadConversationCount={conversation.unreadCount}
              syncError={conversation.syncError}
              lastSyncedAt={conversation.lastSyncedAt}
              isRefreshing={conversation.isRefreshing}
              onRefresh={() => void conversation.refresh()}
              onConversationViewed={() => void conversation.markConversationRead()}
              onCreateLog={createDoctorAdminContactLog}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}
