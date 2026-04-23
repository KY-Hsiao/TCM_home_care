import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { LocationSummaryCard } from "../../modules/maps/LocationSummaryCard";
import { VisitAutomationPanel } from "../../modules/maps/VisitAutomationPanel";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";

export function DemoOverviewPage() {
  const { db } = useAppContext();

  const items = [
    ["醫師", db.doctors.length],
    ["行政", db.admin_users.length],
    ["個案", db.patients.length],
    ["訪視排程", db.visit_schedules.length],
    ["訪視紀錄", db.visit_records.length],
    ["聯絡紀錄", db.contact_logs.length],
    ["提醒", db.reminders.length],
    ["定位紀錄", db.doctor_location_logs.length]
  ];

  return (
    <div className="space-y-6">
      <Panel title="系統總覽">
        <p className="text-sm text-slate-600">
          目前資料層完全以 local mock repository 運作，UI 已預留未來串接 SQLite、正式 API 與定位服務的接口。
        </p>
      </Panel>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        {items.map(([label, count]) => (
          <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-card">
            <p className="text-sm text-brand-moss">{label}</p>
            <p className="mt-2 text-3xl font-bold text-brand-ink">{count}</p>
          </div>
        ))}
      </div>

      <Panel title="模組狀態">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-brand-ink">ContactLog / 流程紀錄</p>
              <Badge value="pending" compact />
            </div>
            <p className="mt-2 text-sm text-slate-600">通知任務功能已停用，目前以 ContactLog、訪視紀錄與流程資料為主。</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-brand-ink">地圖 / 定位</p>
              <Badge value="preparing" compact />
            </div>
            <p className="mt-2 text-sm text-slate-600">已有定位 log 結構與頁面 placeholder。</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-brand-ink">個案資料</p>
              <Badge value="scheduled" compact />
            </div>
            <p className="mt-2 text-sm text-slate-600">目前以個案、排程、定位與流程紀錄為主，不再維護家屬聯絡模組。</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function MapsOverviewPage() {
  const { repositories, session } = useAppContext();
  const doctors = repositories.patientRepository.getDoctors();
  const schedules = repositories.visitRepository.getSchedules({
    doctorId: session.activeDoctorId
  });
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(schedules[0]?.id ?? "");
  const detail = useMemo(
    () =>
      selectedScheduleId
        ? repositories.visitRepository.getScheduleDetail(selectedScheduleId)
        : undefined,
    [repositories, selectedScheduleId]
  );

  return (
    <div className="space-y-6">
      <Panel title="地圖與定位 simulation console">
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            {schedules.map((schedule) => {
              const detailItem = repositories.visitRepository.getScheduleDetail(schedule.id);
              if (!detailItem) {
                return null;
              }
              return (
                <button
                  key={schedule.id}
                  type="button"
                  onClick={() => setSelectedScheduleId(schedule.id)}
                  className={`w-full rounded-2xl border p-4 text-left ${
                    selectedScheduleId === schedule.id
                      ? "border-brand-forest bg-brand-sand/60"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{detailItem.patient.name}</p>
                    <Badge value={schedule.geofence_status} compact />
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{schedule.address_snapshot}</p>
                </button>
              );
            })}
          </div>
          <div className="space-y-4">
            {detail ? (
              <>
                <LocationSummaryCard patient={detail.patient} schedule={detail.schedule} />
                <VisitAutomationPanel detail={detail} />
              </>
            ) : (
              <p className="text-sm text-slate-500">請先選擇左側訪視。</p>
            )}
          </div>
        </div>
      </Panel>
      <Panel title="醫師軌跡入口">
        <div className="grid gap-4 md:grid-cols-3">
          {doctors.map((doctor) => (
            <Link
              key={doctor.id}
              to={`/maps/doctor-trace/${doctor.id}`}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-brand-forest"
            >
              查看 {doctor.name} 軌跡
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function DoctorTracePage() {
  const { doctorId } = useParams();
  const { repositories } = useAppContext();
  const doctor = repositories.patientRepository.getDoctors().find((item) => item.id === doctorId);
  const schedules = doctorId
    ? repositories.visitRepository.getSchedules({ doctorId })
    : [];
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(schedules[0]?.id ?? "");
  const detail = selectedScheduleId
    ? repositories.visitRepository.getScheduleDetail(selectedScheduleId)
    : undefined;

  return (
    <div className="space-y-6">
      <Panel title={`${doctor?.name ?? "醫師"} 軌跡與定位模擬`}>
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            {schedules.map((schedule) => {
              const detailItem = repositories.visitRepository.getScheduleDetail(schedule.id);
              return (
                <button
                  key={schedule.id}
                  type="button"
                  onClick={() => setSelectedScheduleId(schedule.id)}
                  className={`w-full rounded-2xl border p-4 text-left ${
                    selectedScheduleId === schedule.id
                      ? "border-brand-forest bg-brand-sand/60"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="font-semibold text-brand-ink">
                    {detailItem?.patient.name ?? schedule.patient_id}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{schedule.address_snapshot}</p>
                </button>
              );
            })}
          </div>
          <div>
            {detail ? (
              <VisitAutomationPanel detail={detail} />
            ) : (
              <p className="text-sm text-slate-500">目前無可用排程。</p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
