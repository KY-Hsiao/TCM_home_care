import { useEffect, useMemo } from "react";
import { useAppContext } from "../../app/use-app-context";
import { StaffCommunicationDialog } from "../../shared/components/StaffCommunicationDialog";
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
      messageType: "text",
      callStatus: null,
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
  const markConversationRead = conversation.markConversationRead;

  useEffect(() => {
    if (!currentDoctor || !currentAdmin) {
      return;
    }
    void markConversationRead();
    // 團隊通訊頁一打開就主動同步已讀，避免線上環境因輪詢/載入順序差異而殘留未讀燈。
  }, [currentAdmin, currentDoctor, markConversationRead]);

  if (!currentDoctor || !currentAdmin) {
    return <Panel title="團隊通訊">目前找不到登入中的醫師或行政資料。</Panel>;
  }

  return (
    <div className="min-w-0 space-y-3">
      <StaffCommunicationDialog
        counterpartLabel="行政人員"
        currentUserLabel={currentDoctor.name}
        contextLabel={
          activeSchedule && activePatient
            ? `第 ${activeSchedule.route_order} 站 ${maskPatientName(activePatient.name)}`
            : "院內行政協調"
        }
        doctorId={currentDoctor.id}
        adminUserId={currentAdmin.id}
        logs={conversation.messages}
        unreadConversationCount={conversation.unreadCount}
        syncError={conversation.syncError}
        lastSyncedAt={conversation.lastSyncedAt}
        onConversationViewed={() => void markConversationRead()}
        onClose={() => {
          if (typeof window !== "undefined") {
            window.close();
          }
        }}
        onCreateLog={createDoctorAdminContactLog}
      />
    </div>
  );
}
