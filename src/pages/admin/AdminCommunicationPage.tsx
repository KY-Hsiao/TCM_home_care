import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import { StaffCommunicationPanel } from "../../shared/components/StaffCommunicationDialog";
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

export function AdminTeamCommunicationPage() {
  const { db, repositories, session } = useAppContext();
  const admins = repositories.patientRepository.getAdmins();
  const doctors = repositories.patientRepository.getDoctors();
  const selectedAdmin = admins.find((admin) => admin.id === session.activeAdminId) ?? admins[0];
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(session.activeDoctorId || doctors[0]?.id || "");

  useEffect(() => {
    if (!doctors.some((doctor) => doctor.id === selectedDoctorId)) {
      setSelectedDoctorId(doctors[0]?.id || "");
    }
  }, [doctors, selectedDoctorId]);

  const selectedDoctor = doctors.find((doctor) => doctor.id === selectedDoctorId) ?? doctors[0];
  const doctorSchedules = useMemo(
    () =>
      selectedDoctor
        ? repositories.visitRepository
            .getSchedules({ doctorId: selectedDoctor.id })
            .sort(
              (left, right) =>
                new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime()
            )
        : [],
    [repositories, selectedDoctor]
  );
  const activeSchedule =
    doctorSchedules.find((schedule) => ACTIVE_VISIT_STATUSES.includes(schedule.status as (typeof ACTIVE_VISIT_STATUSES)[number])) ??
    doctorSchedules[0] ??
    null;
  const activePatient = activeSchedule
    ? repositories.patientRepository.getPatientById(activeSchedule.patient_id)
    : undefined;

  const createAdminDoctorContactLog = async (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => {
    if (!selectedDoctor || !selectedAdmin) {
      return;
    }
    const now = new Date().toISOString();
    await conversation.createMessage({
      id: `staff-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      doctorId: selectedDoctor.id,
      adminUserId: selectedAdmin.id,
      senderRole: "admin",
      senderUserId: selectedAdmin.id,
      receiverRole: "doctor",
      receiverUserId: selectedDoctor.id,
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
    doctorId: selectedDoctor?.id ?? "",
    adminUserId: selectedAdmin?.id ?? "",
    viewerRole: "admin",
    viewerUserId: selectedAdmin?.id ?? "",
    enabled: Boolean(selectedDoctor && selectedAdmin)
  });

  useEffect(() => {
    if (!selectedDoctor || !selectedAdmin) {
      return;
    }
    void conversation.markConversationRead();
    // 行政端切進對話頁或切換醫師時，主動同步已讀，避免外層未讀燈殘留舊值。
  }, [selectedAdmin?.id, selectedDoctor?.id]);

  if (!selectedDoctor || !selectedAdmin) {
    return <Panel title="團隊通訊">目前找不到可使用的行政或醫師資料。</Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel title="團隊通訊" className="p-3 lg:p-4">
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          <div className="space-y-3">
            {doctors.map((doctor) => {
              const doctorLogCount = db.contact_logs.filter(
                (log) =>
                  log.doctor_id === doctor.id &&
                  log.admin_user_id === selectedAdmin.id &&
                  ["phone", "web_notice"].includes(log.channel)
              ).length;
              const isSelected = doctor.id === selectedDoctor.id;
              return (
                <button
                  key={doctor.id}
                  type="button"
                  onClick={() => setSelectedDoctorId(doctor.id)}
                  onDoubleClick={() => setSelectedDoctorId(doctor.id)}
                  className={`w-full rounded-[1.4rem] border px-4 py-3 text-left transition ${
                    isSelected
                      ? "border-brand-forest bg-emerald-50/50"
                      : "border-slate-200 bg-white hover:border-brand-forest/40"
                  }`}
                >
                  <p className="font-semibold text-brand-ink">{doctor.name}</p>
                  <p className="mt-1 text-sm text-slate-600">電話：{doctor.phone || "未設定"}</p>
                  <p className="mt-2 text-xs text-slate-500">目前聯絡紀錄 {doctorLogCount} 筆</p>
                </button>
              );
            })}
          </div>

          <div className="h-[min(72dvh,820px)] min-h-[420px]">
            <StaffCommunicationPanel
              title={selectedDoctor.name}
              counterpartLabel={selectedDoctor.name}
              counterpartPhone={selectedDoctor.phone}
              currentUserLabel="行政人員"
              contextLabel={
                activeSchedule && activePatient
                  ? `第 ${activeSchedule.route_order} 站 ${maskPatientName(activePatient.name)}`
                  : `${selectedDoctor.name} 院內協調`
              }
              doctorId={selectedDoctor.id}
              adminUserId={selectedAdmin.id}
              patientId={activePatient?.id ?? null}
              visitScheduleId={activeSchedule?.id ?? null}
              logs={conversation.messages}
              unreadConversationCount={conversation.unreadCount}
              syncError={conversation.syncError}
              lastSyncedAt={conversation.lastSyncedAt}
              isRefreshing={conversation.isRefreshing}
              onRefresh={() => void conversation.refresh()}
              onConversationViewed={() => void conversation.markConversationRead()}
              onCreateLog={createAdminDoctorContactLog}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}
