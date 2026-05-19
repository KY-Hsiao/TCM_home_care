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

function formatDoctorDisplayName(name: string) {
  const normalized = name.trim();
  return normalized.endsWith("醫師") ? normalized : `${normalized}醫師`;
}

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
  const selectedDoctorName = selectedDoctor ? formatDoctorDisplayName(selectedDoctor.name) : "";
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
  const markConversationRead = conversation.markConversationRead;

  useEffect(() => {
    if (!selectedDoctor || !selectedAdmin) {
      return;
    }
    void markConversationRead();
    // 行政端切進對話頁或切換醫師時，主動同步已讀，避免外層未讀燈殘留舊值。
  }, [markConversationRead, selectedAdmin, selectedDoctor]);

  if (!selectedDoctor || !selectedAdmin) {
    return <Panel title="團隊通訊">目前找不到可使用的行政或醫師資料。</Panel>;
  }

  return (
    <div className="space-y-3">
      <Panel title="團隊通訊">
        <div className="grid min-h-[620px] gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="min-h-0 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-semibold text-brand-ink">醫師名單</p>
            <p className="mt-1 text-xs text-slate-500">選擇醫師後右側直接對話。</p>
            <div className="mt-3 grid max-h-[540px] gap-2 overflow-y-auto pr-1">
              {doctors.map((doctor) => {
                const doctorName = formatDoctorDisplayName(doctor.name);
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
                    className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                      isSelected
                        ? "border-brand-forest bg-emerald-50/70"
                        : "border-slate-200 bg-white hover:border-brand-forest/40"
                    }`}
                  >
                    <p className="font-semibold text-brand-ink">{doctorName}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{doctor.phone || "未設定電話"}</p>
                    <p className="mt-1 text-[11px] text-slate-500">聯絡紀錄 {doctorLogCount} 筆</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-[520px] min-w-0">
            <StaffCommunicationPanel
              counterpartLabel={selectedDoctorName}
              currentUserLabel="行政人員"
              contextLabel={
                activeSchedule && activePatient
                  ? `第 ${activeSchedule.route_order} 站 ${maskPatientName(activePatient.name)}`
                  : `${selectedDoctorName} 院內協調`
              }
              doctorId={selectedDoctor.id}
              adminUserId={selectedAdmin.id}
              logs={conversation.messages}
              unreadConversationCount={conversation.unreadCount}
              syncError={conversation.syncError}
              lastSyncedAt={conversation.lastSyncedAt}
              onConversationViewed={() => void conversation.markConversationRead()}
              onCreateLog={createAdminDoctorContactLog}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}
