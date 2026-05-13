import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { buildReadonlySummary } from "../../modules/doctor/doctor-page-helpers";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateOnly, formatDateTimeFull } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";

function isMeaningful(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return Boolean(text) && text !== "未填" && text !== "未填寫" && text !== "無";
}

function isDefaultBirthDate(value: string | null | undefined) {
  return !value || value === "1950-01-01" || value === "1950/01/01";
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") {
    return null;
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold text-brand-ink">{children}</div>
    </div>
  );
}

export function DoctorPatientPage() {
  const { id } = useParams();
  const { repositories } = useAppContext();
  const profile = id ? repositories.patientRepository.getPatientProfile(id) : undefined;

  if (!profile) {
    return <Panel title="查無個案">找不到指定個案。</Panel>;
  }

  const patient = profile.patient;
  const todayRecord = profile.todaySchedule
    ? profile.visitRecords.find((record) => record.visit_schedule_id === profile.todaySchedule?.id)
    : undefined;
  const basicInfo = [
    isMeaningful(patient.gender) ? patient.gender : "",
    isDefaultBirthDate(patient.date_of_birth) ? "" : formatDateOnly(patient.date_of_birth)
  ].filter(Boolean).join(" / ");
  const addressText = [patient.address, patient.phone ? `(${patient.phone})` : ""].filter(Boolean).join("");
  const serviceNeeds = patient.service_needs?.length ? patient.service_needs.join("、") : "";

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel
          title={`${maskPatientName(patient.name)} 個案詳細頁`}
          action={
            <Link
              to={`/doctor/return-records?patientId=${patient.id}`}
              className="rounded-full bg-brand-coral px-4 py-2 text-xs font-semibold text-white"
            >
              建立回院病歷
            </Link>
          }
        >
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <InfoRow label="個案狀態"><Badge value={patient.status} compact /></InfoRow>
            {basicInfo ? <InfoRow label="基本資料">{basicInfo}</InfoRow> : null}
            {isMeaningful(addressText) ? <InfoRow label="地址 / 電話">{addressText}</InfoRow> : null}
            {isMeaningful(patient.primary_diagnosis) ? <InfoRow label="主診斷">{patient.primary_diagnosis}</InfoRow> : null}
            {isMeaningful(serviceNeeds) ? <InfoRow label="需求項目">{serviceNeeds}</InfoRow> : null}
            {isMeaningful(patient.precautions) ? <InfoRow label="注意事項">{patient.precautions}</InfoRow> : null}
            {isMeaningful(patient.important_medical_history) ? <InfoRow label="重要病史">{patient.important_medical_history}</InfoRow> : null}
            {isMeaningful(patient.next_follow_up_focus) ? <InfoRow label="下次追蹤">{patient.next_follow_up_focus}</InfoRow> : null}
            {isMeaningful(patient.google_maps_link) ? (
              <div className="sm:col-span-2">
                <a
                  href={patient.google_maps_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
                >
                  開啟地圖
                </a>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="今日訪視時間資訊摘要">
          <div className="grid gap-3 sm:grid-cols-2">
            {buildReadonlySummary(todayRecord).map((item) => (
              <div key={item.label} className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className="mt-2 font-semibold text-brand-ink">{item.value}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel title="聯絡紀錄時間線">
          <div className="space-y-3">
            {profile.contactLogs.length ? (
              profile.contactLogs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{log.subject}</p>
                    <span className="text-xs text-slate-500">{formatDateTimeFull(log.contacted_at)}</span>
                  </div>
                  <p className="mt-2 text-slate-600">{log.content}</p>
                  <p className="mt-1 text-slate-500">結果：{log.outcome}</p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                尚無聯絡紀錄。
              </div>
            )}
          </div>
        </Panel>

        <Panel title="訪視紀錄列表">
          <div className="space-y-3">
            {profile.visitRecords.slice(0, 8).length ? (
              profile.visitRecords.slice(0, 8).map((record) => {
                const schedule = profile.recentSchedules.find((item) => item.id === record.visit_schedule_id);
                return (
                  <div key={record.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">
                        {schedule ? formatDateOnly(schedule.scheduled_start_at) : "未對應排程"}
                      </p>
                      {schedule ? <Badge value={schedule.status} compact /> : null}
                    </div>
                    <p className="mt-2 text-slate-600">主訴：{record.chief_complaint || "尚未填寫"}</p>
                    <p className="mt-1 text-slate-500">評估摘要：{record.physician_assessment || "尚未填寫"}</p>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                尚無訪視紀錄。
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
