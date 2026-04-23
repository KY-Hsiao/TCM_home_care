import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { buildReadonlySummary } from "../../modules/doctor/doctor-page-helpers";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import {
  formatDateOnly,
  formatDateTimeFull
} from "../../shared/utils/format";

export function DoctorPatientPage() {
  const { id } = useParams();
  const { repositories } = useAppContext();
  const profile = id ? repositories.patientRepository.getPatientProfile(id) : undefined;

  if (!profile) {
    return <Panel title="查無個案">找不到指定個案。</Panel>;
  }

  const todayRecord = profile.todaySchedule
    ? profile.visitRecords.find((record) => record.visit_schedule_id === profile.todaySchedule?.id)
    : undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel
          title={`${profile.patient.name} 個案詳細頁`}
          action={
            <Link
              to={`/doctor/return-records?patientId=${profile.patient.id}`}
              className="rounded-full bg-brand-coral px-4 py-2 text-xs font-semibold text-white"
            >
              建立回院病歷
            </Link>
          }
        >
          <div className="space-y-4 text-sm text-slate-600">
            <p>基本資料：{profile.patient.gender} / {formatDateOnly(profile.patient.date_of_birth)}</p>
            <p>地址：{profile.patient.address}</p>
            <p>定位關鍵字：{profile.patient.location_keyword}</p>
            <a
              href={profile.patient.google_maps_link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-full bg-brand-sand px-3 py-1 font-medium text-brand-forest"
            >
              地圖連結
            </a>
            <div className="flex items-center gap-2">
              <span>個案狀態：</span>
              <Badge value={profile.patient.status} compact />
            </div>
            <p>重要病史：{profile.patient.important_medical_history}</p>
            <p>注意事項：{profile.patient.precautions}</p>
            <p>用藥摘要：{profile.patient.medication_summary}</p>
            <p>上次訪視摘要：{profile.patient.last_visit_summary}</p>
            <p>下次追蹤重點：{profile.patient.next_follow_up_focus}</p>
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
            {profile.contactLogs.map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{log.subject}</p>
                  <span className="text-xs text-slate-500">{formatDateTimeFull(log.contacted_at)}</span>
                </div>
                <p className="mt-2 text-slate-600">{log.content}</p>
                <p className="mt-1 text-slate-500">結果：{log.outcome}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="訪視紀錄列表">
          <div className="space-y-3">
            {profile.visitRecords.slice(0, 8).map((record) => {
              const schedule = profile.recentSchedules.find(
                (item) => item.id === record.visit_schedule_id
              );
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
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function DoctorRemindersPage() {
  const { repositories, session } = useAppContext();
  const doctorSchedules = repositories.visitRepository.getSchedules({
    doctorId: session.activeDoctorId
  });
  const doctorDetails = doctorSchedules
    .map((schedule) => repositories.visitRepository.getScheduleDetail(schedule.id))
    .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));

  const reminderSections = useMemo(
    () => ({
      incompleteRecords: doctorDetails.filter(
        (detail) =>
          ["completed", "in_treatment", "arrived"].includes(detail.schedule.status) &&
          (!detail.record || !detail.record.physician_assessment || !detail.record.follow_up_note)
      ),
      callbackCases: doctorDetails.filter(
        (detail) =>
          detail.notifications.some(
            (task) => task.channel === "phone" && ["pending", "awaiting_reply"].includes(task.status)
          ) || detail.schedule.note.includes("電話")
      ),
      rescheduledCases: doctorDetails.filter((detail) => detail.schedule.status === "rescheduled"),
      repliedPendingCases: doctorDetails.filter((detail) =>
        detail.notifications.some((task) => task.status === "replied")
      ),
      followUpCases: doctorDetails.filter((detail) => {
        const nextDate = detail.record?.next_visit_suggestion_date;
        if (!nextDate) {
          return false;
        }
        const next = new Date(nextDate);
        const now = new Date();
        const diff = next.getTime() - now.getTime();
        return diff >= 0 && diff <= 1000 * 60 * 60 * 24 * 10;
      })
    }),
    [doctorDetails]
  );

  const sectionItems = [
    ["今日未完成紀錄", reminderSections.incompleteRecords],
    ["待回電個案", reminderSections.callbackCases],
    ["已改期待重新安排個案", reminderSections.rescheduledCases],
    ["已有回覆待處理案件", reminderSections.repliedPendingCases],
    ["近期應追蹤個案", reminderSections.followUpCases]
  ] as const;

  return (
    <div className="space-y-6">
      {sectionItems.map(([title, items]) => (
        <Panel key={title} title={title}>
          <div className="grid gap-4 md:grid-cols-2">
            {items.length ? (
              items.map((detail) => (
                <div key={detail.schedule.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{detail.patient.name}</p>
                    <Badge value={detail.schedule.status} compact />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{detail.schedule.note}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    預約：{formatDateTimeFull(detail.schedule.scheduled_start_at)}
                  </p>
                  <Link
                    to={`/doctor/records/${detail.schedule.id}`}
                    className="mt-4 inline-flex rounded-full bg-brand-sand px-3 py-2 text-xs font-semibold text-brand-forest"
                  >
                    前往處理
                  </Link>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">目前此分類沒有待處理案件。</p>
            )}
          </div>
        </Panel>
      ))}
    </div>
  );
}
