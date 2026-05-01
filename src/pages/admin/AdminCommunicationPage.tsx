import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  const [isCommunicationOpen, setIsCommunicationOpen] = useState(true);

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
    <div className="space-y-3">
      <Panel
        title="團隊通訊"
        action={
          <button
            type="button"
            onClick={() => setIsCommunicationOpen(true)}
            className="rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
          >
            開啟全頁對話
          </button>
        }
      >
        <div className="flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>目前對象：{selectedDoctor.name}</span>
          <span>雙擊醫師名單可直接切換對話。</span>
        </div>
      </Panel>

      {isCommunicationOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label="團隊通訊全頁視窗"
              className="fixed inset-0 z-50 bg-slate-950/45 p-2 sm:p-3"
            >
              <div className="flex h-[calc(100dvh-1rem)] min-w-0 flex-col overflow-hidden rounded-[1.25rem] bg-white shadow-2xl sm:h-[calc(100dvh-1.5rem)] lg:rounded-[1.75rem]">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 py-2.5 lg:px-4 lg:py-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-brand-ink lg:text-lg">團隊通訊全頁對話</h2>
                    <p className="text-xs text-slate-500">選擇醫師後直接在右側對話區打字。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCommunicationOpen(false)}
                    className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
                  >
                    關閉視窗
                  </button>
                </div>
                <div className="grid min-h-0 flex-1 gap-2 bg-brand-cream p-2 lg:grid-cols-[240px_minmax(0,1fr)] lg:p-3">
                  <div className="min-h-0 overflow-y-auto rounded-[1.15rem] border border-slate-200 bg-white p-2 lg:rounded-[1.35rem]">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
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
                            className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                              isSelected
                                ? "border-brand-forest bg-emerald-50/70"
                                : "border-slate-200 bg-white hover:border-brand-forest/40"
                            }`}
                          >
                            <p className="font-semibold text-brand-ink">{doctor.name}</p>
                            <p className="mt-0.5 text-xs text-slate-600">{doctor.phone || "未設定電話"}</p>
                            <p className="mt-1 text-[11px] text-slate-500">聯絡紀錄 {doctorLogCount} 筆</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-h-[420px] min-w-0 lg:min-h-0">
                    <StaffCommunicationPanel
                      counterpartLabel={selectedDoctor.name}
                      currentUserLabel="行政人員"
                      contextLabel={
                        activeSchedule && activePatient
                          ? `第 ${activeSchedule.route_order} 站 ${maskPatientName(activePatient.name)}`
                          : `${selectedDoctor.name} 院內協調`
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
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
