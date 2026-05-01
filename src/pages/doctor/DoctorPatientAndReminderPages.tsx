import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { buildReadonlySummary } from "../../modules/doctor/doctor-page-helpers";
import { ReminderCenterPanel } from "../shared/ReminderCenterPanel";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { maskPatientName } from "../../shared/utils/patient-name";
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
          title={`${maskPatientName(profile.patient.name)} 個案詳細頁`}
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
            <p className="break-words">地址：{profile.patient.address}</p>
            <p className="break-words">定位關鍵字：{profile.patient.location_keyword}</p>
              <a
              href={profile.patient.google_maps_link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full break-words rounded-full bg-brand-sand px-3 py-1 font-medium text-brand-forest"
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
  const { session } = useAppContext();

  return (
    <div className="space-y-6">
      <ReminderCenterPanel
        role="doctor"
        ownerId={session.activeDoctorId}
        title="通知中心"
        detailBasePath="/doctor/patients"
        emptyText="目前醫師端沒有待處理通知。"
      />
    </div>
  );
}

export function DoctorLeaveRequestPage() {
  const { repositories, db, session } = useAppContext();
  const activeDoctor = db.doctors.find((doctor) => doctor.id === session.activeDoctorId) ?? db.doctors[0];
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("請假登記");
  const [handoffNote, setHandoffNote] = useState("請協助檢查受影響個案");
  const [statusFeedback, setStatusFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const leaveHistory = useMemo(
    () =>
      repositories.staffingRepository
        .getLeaveRequests()
        .filter((leaveRequest) => leaveRequest.doctor_id === activeDoctor?.id)
        .sort(
          (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        ),
    [activeDoctor?.id, db.leave_requests, repositories]
  );

  const handleCreateLeaveRequest = () => {
    if (!activeDoctor) {
      setStatusFeedback({
        tone: "error",
        message: "目前找不到登入中的醫師資料。"
      });
      return;
    }
    if (!startDate || !endDate || !reason.trim()) {
      setStatusFeedback({
        tone: "error",
        message: "請完整填寫請假期間與原因。"
      });
      return;
    }
    if (startDate > endDate) {
      setStatusFeedback({
        tone: "error",
        message: "開始日期不可晚於結束日期。"
      });
      return;
    }
    repositories.staffingRepository.createLeaveRequest({
      doctorId: activeDoctor.id,
      startDate,
      endDate,
      reason: reason.trim(),
      handoffNote: handoffNote.trim(),
      status: "pending"
    });
    setIsLeaveDialogOpen(false);
    setStatusFeedback({
      tone: "success",
      message: "請假申請已送出，行政人員可在待處理請假查看。"
    });
  };

  const handleDeleteLeaveRequest = (leaveRequestId: string) => {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const confirmed = window.confirm("確定要刪除這筆請假申請嗎？");
      if (!confirmed) {
        return;
      }
    }
    repositories.staffingRepository.deleteLeaveRequest(leaveRequestId);
    setStatusFeedback({
      tone: "success",
      message: "請假申請已刪除。"
    });
  };

  return (
    <div className="space-y-6">
      <Panel
        title="請假申請"
        action={
          <button
            type="button"
            onClick={() => {
              setStatusFeedback(null);
              setIsLeaveDialogOpen(true);
            }}
            className="rounded-full bg-brand-coral px-5 py-2.5 text-sm font-semibold text-white"
          >
            提出請假申請
          </button>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600">
            <p className="font-medium text-brand-ink">目前登入醫師</p>
            <p className="mt-1">{activeDoctor?.name ?? "未指定醫師"}</p>
            <p className="mt-1 text-xs text-slate-500">按「提出請假申請」後，在視窗內填寫期間、原因與交班備註。</p>
          </div>
          {statusFeedback && !isLeaveDialogOpen ? (
            <div
              role="status"
              className={`rounded-2xl border px-4 py-3 ${
                statusFeedback.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              {statusFeedback.message}
            </div>
          ) : null}

          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 lg:rounded-3xl lg:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-brand-ink">請假申請紀錄</p>
              <span className="text-xs text-slate-500">{leaveHistory.length} 筆</span>
            </div>
            <div className="mt-4 space-y-3">
              {leaveHistory.length ? (
                leaveHistory.map((leaveRequest) => (
                  <div key={leaveRequest.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <p className="card-clamp-1 font-medium text-brand-ink">
                          {leaveRequest.start_date} 至 {leaveRequest.end_date}
                        </p>
                        <Badge value={leaveRequest.status} compact />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteLeaveRequest(leaveRequest.id)}
                        className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600"
                      >
                        刪除請假單
                      </button>
                    </div>
                    <p className="card-clamp-2 mt-2 text-slate-600">{leaveRequest.reason}</p>
                    <p className="card-clamp-2 mt-1 text-xs text-slate-500">{leaveRequest.handoff_note}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  目前還沒有請假申請紀錄。
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>

      {isLeaveDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="請假申請視窗"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl lg:rounded-[32px] lg:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">醫師請假</p>
                <h2 className="mt-1 text-xl font-semibold text-brand-ink">提出請假申請</h2>
                <p className="mt-2 text-sm text-slate-600">
                  送出後會進入行政端待處理請假，並同步通知中心。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsLeaveDialogOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉視窗
              </button>
            </div>

            <div className="mt-6 space-y-4 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600">
                <p className="font-medium text-brand-ink">目前登入醫師</p>
                <p className="mt-1">{activeDoctor?.name ?? "未指定醫師"}</p>
              </div>
              {statusFeedback ? (
                <div
                  role="status"
                  className={`rounded-2xl border px-4 py-3 ${
                    statusFeedback.tone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {statusFeedback.message}
                </div>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">開始日期</span>
                <input
                  type="date"
                  aria-label="開始日期"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">結束日期</span>
                <input
                  type="date"
                  aria-label="結束日期"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">請假原因</span>
              <input
                type="text"
                aria-label="請假原因"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">交班備註</span>
              <textarea
                aria-label="交班備註"
                value={handoffNote}
                onChange={(event) => setHandoffNote(event.target.value)}
                rows={4}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
            <button
              type="button"
              onClick={handleCreateLeaveRequest}
              className="rounded-full bg-brand-coral px-5 py-3 font-semibold text-white"
            >
              送出請假申請
            </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
