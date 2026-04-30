import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import { StaffCommunicationPanel } from "../../shared/components/StaffCommunicationDialog";
import { maskPatientName } from "../../shared/utils/patient-name";
import { Panel } from "../../shared/ui/Panel";

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
  const conversationLogs = useMemo(
    () =>
      selectedDoctor && selectedAdmin
        ? [...db.contact_logs]
            .filter(
              (log) =>
                log.doctor_id === selectedDoctor.id &&
                log.admin_user_id === selectedAdmin.id &&
                ["phone", "web_notice"].includes(log.channel)
            )
            .sort(
              (left, right) =>
                new Date(right.contacted_at).getTime() - new Date(left.contacted_at).getTime()
            )
        : [],
    [db.contact_logs, selectedAdmin, selectedDoctor]
  );
  const unreadTeamCommunicationItems = useMemo(
    () =>
      selectedDoctor && selectedAdmin
        ? repositories.notificationRepository
            .getNotificationCenterItems("admin", selectedAdmin.id)
            .filter(
              (item) =>
                item.is_unread &&
                item.role === "admin" &&
                item.owner_user_id === selectedAdmin.id &&
                item.linked_doctor_id === selectedDoctor.id &&
                ["manual_notice", "system_notification"].includes(item.source_type) &&
                (item.title.startsWith("院內對話｜") ||
                  item.title.startsWith("語音通話邀請｜") ||
                  item.content.includes("團隊通訊"))
            )
        : [],
    [repositories, selectedAdmin, selectedDoctor]
  );
  const markAdminConversationRead = () => {
    unreadTeamCommunicationItems.forEach((item) => {
      repositories.notificationRepository.markNotificationCenterItemRead(item.id);
    });
  };

  const createAdminDoctorContactLog = (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => {
    if (!selectedDoctor || !selectedAdmin) {
      return;
    }
    const now = new Date().toISOString();
    repositories.contactRepository.createContactLog({
      id: `staff-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      patient_id: activePatient?.id ?? null,
      visit_schedule_id: activeSchedule?.id ?? null,
      caregiver_id: null,
      doctor_id: selectedDoctor.id,
      admin_user_id: selectedAdmin.id,
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
        role: "doctor",
        owner_user_id: selectedDoctor.id,
        source_type: input.channel === "phone" ? "system_notification" : "manual_notice",
        title: input.subject,
        content:
          input.channel === "phone"
            ? `${input.content}\n請打開團隊通訊頁面立即回應。`
            : input.content,
        linked_patient_id: activePatient?.id ?? null,
        linked_visit_schedule_id: activeSchedule?.id ?? null,
        linked_doctor_id: selectedDoctor.id,
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
              title={`團隊通訊｜${selectedDoctor.name}`}
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
              logs={conversationLogs}
              unreadConversationCount={unreadTeamCommunicationItems.length}
              onConversationViewed={markAdminConversationRead}
              onCreateLog={createAdminDoctorContactLog}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}
