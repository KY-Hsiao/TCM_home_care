import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { summarizeDoctorDashboard } from "../../modules/doctor/doctor-selectors";
import { VisitAutomationPanel } from "../../modules/maps/VisitAutomationPanel";
import { DoctorVisitCard } from "../../modules/doctor/doctor-page-shared";
import {
  buildReadonlySummary,
  doctorActionButtonClass,
  getScheduleDisplayRange
} from "../../modules/doctor/doctor-page-helpers";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { StatCard } from "../../shared/ui/StatCard";
import { formatDateTimeFull, formatTimeOnly } from "../../shared/utils/format";

function DoctorRouteSelector() {
  const { repositories, session, setActiveRoutePlanId } = useAppContext();
  const routePlans = repositories.visitRepository.getSavedRoutePlans({
    doctorId: session.activeDoctorId,
    routeDate: new Date().toISOString().slice(0, 10)
  });
  const activeRoutePlan = session.activeRoutePlanId
    ? repositories.visitRepository.getSavedRoutePlanById(session.activeRoutePlanId)
    : undefined;

  useEffect(() => {
    if (routePlans.length === 0) {
      if (session.activeRoutePlanId !== null) {
        setActiveRoutePlanId(null);
      }
      return;
    }
    if (!session.activeRoutePlanId || !routePlans.some((routePlan) => routePlan.id === session.activeRoutePlanId)) {
      setActiveRoutePlanId(routePlans[0].id);
    }
  }, [routePlans, session.activeRoutePlanId, setActiveRoutePlanId]);

  return (
    <Panel title="今日導航路線">
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          先選今天要執行的已儲存路線，再從第一站開始導航；完成一站後，系統會沿著這條路線接續到最後一站。
        </div>
        <div className="flex flex-wrap gap-2">
          {routePlans.length > 0 ? (
            routePlans.map((routePlan) => (
              <button
                key={routePlan.id}
                type="button"
                onClick={() => setActiveRoutePlanId(routePlan.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  session.activeRoutePlanId === routePlan.id
                    ? "bg-brand-forest text-white"
                    : "bg-white text-brand-ink ring-1 ring-slate-200"
                }`}
              >
                {routePlan.service_time_slot} / {routePlan.schedule_ids.length} 站
              </button>
            ))
          ) : (
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-500">
              今日尚未有行政端儲存的路線
            </div>
          )}
        </div>
        {activeRoutePlan ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p className="font-semibold text-brand-ink">{activeRoutePlan.route_name}</p>
            <p className="mt-2">
              起點 {activeRoutePlan.start_address} / 終點 {activeRoutePlan.end_address}
            </p>
            <p className="mt-1">
              行車總時間 {activeRoutePlan.total_minutes} 分鐘 / 行車總距離{" "}
              {activeRoutePlan.total_distance_kilometers.toFixed(1)} 公里
            </p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function DoctorDashboardPage() {
  const { repositories, session } = useAppContext();
  const dashboard = repositories.visitRepository.getDoctorDashboard(session.activeDoctorId);
  const routeSchedules = repositories.visitRepository.getDoctorRouteSchedules(
    session.activeDoctorId,
    session.activeRoutePlanId
  );
  const routeAwareDashboard = {
    ...dashboard,
    todaySchedules: routeSchedules,
    activeSchedules: routeSchedules.filter((schedule) =>
      ["waiting_departure", "preparing", "on_the_way", "tracking", "proximity_pending", "arrived", "in_treatment", "issue_pending"].includes(schedule.status)
    )
  };
  const summary = summarizeDoctorDashboard(routeAwareDashboard);

  return (
    <div className="space-y-6">
      <DoctorRouteSelector />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="今日訪視總數" value={summary.scheduleCount} hint="今日排定的所有訪視案件" />
        <StatCard label="進行中案件" value={summary.activeCount} hint="前往中、已抵達與治療中" />
        <StatCard label="待出發案件" value={summary.upcomingCount} hint="尚未完成且可繼續處理的訪視" />
        <StatCard label="待提醒事項" value={summary.reminderCount} hint="醫師待辦與未完成紀錄" />
      </div>

      <Panel title="今日訪視首頁">
        <div className="space-y-4">
          {routeSchedules.map((schedule) => (
            <DoctorVisitCard key={schedule.id} scheduleId={schedule.id} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function DoctorLocationPage() {
  const { repositories, services, session, db } = useAppContext();
  const currentDoctor =
    repositories.patientRepository.getDoctors().find((doctor) => doctor.id === session.activeDoctorId) ??
    repositories.patientRepository.getDoctors()[0];
  const effectiveDoctorId = currentDoctor?.id ?? session.activeDoctorId;
  const locationLogs = repositories.visitRepository
    .getDoctorLocationLogs(effectiveDoctorId)
    .slice()
    .sort(
      (left, right) =>
        new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()
    );
  const latestLocation = locationLogs[0];
  const activeSchedule =
    repositories.visitRepository.getSchedules({
      doctorId: effectiveDoctorId,
      statuses: ["on_the_way", "tracking", "proximity_pending", "arrived", "in_treatment"]
    })[0] ??
    repositories.visitRepository.getSchedules({
      doctorId: effectiveDoctorId
    })[0];
  const activePatient = activeSchedule
    ? db.patients.find((patient) => patient.id === activeSchedule.patient_id)
    : undefined;
  const mapUrl = latestLocation
    ? services.maps.buildPatientMapUrl({
        address: "醫師目前位置",
        latitude: latestLocation.latitude,
        longitude: latestLocation.longitude
      })
    : activeSchedule
      ? services.maps.buildPatientMapUrl({
          address: activeSchedule.address_snapshot,
          locationKeyword: activeSchedule.location_keyword_snapshot,
          latitude: activeSchedule.home_latitude_snapshot,
          longitude: activeSchedule.home_longitude_snapshot
        })
      : "https://www.google.com/maps";
  const embedMapUrl = latestLocation
    ? services.maps.buildPatientEmbedUrl({
        address: "醫師目前位置",
        latitude: latestLocation.latitude,
        longitude: latestLocation.longitude
      })
    : activeSchedule
      ? services.maps.buildPatientEmbedUrl({
          address: activeSchedule.address_snapshot,
          locationKeyword: activeSchedule.location_keyword_snapshot,
          latitude: activeSchedule.home_latitude_snapshot,
          longitude: activeSchedule.home_longitude_snapshot
        })
      : "https://maps.google.com/maps?q=%E9%AB%98%E9%9B%84%E5%B8%82%E6%97%97%E5%B1%B1%E5%8D%80&z=13&output=embed";
  const coordinateLabel = latestLocation
    ? services.maps.buildCoordinateLabel(latestLocation.latitude, latestLocation.longitude)
    : "尚未取得精確座標";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="目前定位"
          value={latestLocation ? coordinateLabel : "等待授權"}
          hint={latestLocation ? "已依手機網頁定位回傳最新座標" : "請用手機登入並允許位置授權"}
        />
        <StatCard
          label="最後更新"
          value={latestLocation ? formatTimeOnly(latestLocation.recorded_at) : "尚未回傳"}
          hint={latestLocation ? formatDateTimeFull(latestLocation.recorded_at) : "系統尚未收到位置資料"}
        />
        <StatCard
          label="目前案件"
          value={activePatient?.name ?? "尚未指定"}
          hint={
            activeSchedule
              ? `第 ${activeSchedule.route_order} 站 / ${activeSchedule.status}`
              : "目前沒有進行中的訪視案件"
          }
        />
      </div>

      <Panel title="Google 地圖 / 目前位置">
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              這個分頁只顯示你自己的手機網頁目前位置；若已按下開始行程並允許定位，地圖會持續更新。
            </div>
            <iframe
              title="醫師目前位置 Google 地圖"
              src={embedMapUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-[460px] w-full rounded-3xl border border-slate-200 bg-white"
            />
            <div className="flex flex-wrap gap-2">
              <a
                href={mapUrl}
                target="_blank"
                rel="noreferrer"
                className={doctorActionButtonClass("primary")}
              >
                用 Google 地圖開啟目前位置
              </a>
              {activeSchedule ? (
                <Link
                  to={`/doctor/schedules/${activeSchedule.id}`}
                  className={doctorActionButtonClass()}
                >
                  查看目前案件
                </Link>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-brand-ink">目前位置摘要</p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>目前帳號：{currentDoctor?.name ?? "未指定醫師"}</p>
                <p>定位座標：{coordinateLabel}</p>
                <p>最後更新：{latestLocation ? formatDateTimeFull(latestLocation.recorded_at) : "尚未回傳"}</p>
                <p>定位精度：{latestLocation ? `${Math.round(latestLocation.accuracy)} 公尺` : "尚未回傳"}</p>
                <p>資料來源：{latestLocation?.source ?? "等待定位中"}</p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-brand-ink">對應中的訪視案件</p>
                {activeSchedule ? <Badge value={activeSchedule.status} compact /> : null}
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>個案：{activePatient?.name ?? "尚未指定"}</p>
                <p>地址：{activeSchedule?.address_snapshot ?? "尚未指定"}</p>
                <p>定位關鍵字：{activeSchedule?.location_keyword_snapshot ?? "尚未指定"}</p>
                <p>
                  時段：
                  {activeSchedule
                    ? `${formatDateTimeFull(activeSchedule.scheduled_start_at)} - ${formatTimeOnly(activeSchedule.scheduled_end_at)}`
                    : "尚未指定"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function DoctorSchedulesPage() {
  const { repositories, session } = useAppContext();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const schedules = repositories.visitRepository.getDoctorRouteSchedules(
    session.activeDoctorId,
    session.activeRoutePlanId
  );
  const visibleSchedules =
    statusFilter === "all"
      ? schedules
      : schedules.filter((schedule) => schedule.status === statusFilter);

  return (
    <div className="space-y-6">
      <DoctorRouteSelector />
      <Panel title="醫師排程清單">
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            ["all", "全部"],
            ["scheduled", "已排程"],
            ["on_the_way", "前往中"],
            ["in_treatment", "治療中"],
            ["completed", "已完成"],
            ["rescheduled", "已改期"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                statusFilter === value
                  ? "bg-brand-forest text-white"
                  : "bg-white text-brand-ink ring-1 ring-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 2xl:grid-cols-2">
          {visibleSchedules.map((schedule) => (
            <DoctorVisitCard key={schedule.id} scheduleId={schedule.id} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function DoctorScheduleDetailPage() {
  const { id } = useParams();
  const { repositories, services } = useAppContext();
  const detail = id ? repositories.visitRepository.getScheduleDetail(id) : undefined;

  if (!detail) {
    return <Panel title="查無訪視">找不到指定訪視排程。</Panel>;
  }

  const timeSummary = buildReadonlySummary(detail.record);
  const displayStatus = services.visitAutomation.getDisplayStatus(
    detail.schedule,
    detail.record?.arrival_time ?? null,
    detail.record?.departure_from_patient_home_time ?? null
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <Panel
        title={`${detail.patient.name} 今日訪視詳情`}
        action={
          <Link
            to={`/doctor/records/${detail.schedule.id}`}
            className={doctorActionButtonClass("primary")}
          >
            填寫紀錄
          </Link>
        }
      >
        <div className="space-y-4 text-sm text-slate-600">
          <div className="flex items-center gap-3">
            <Badge value={displayStatus} />
            <Link
              to={`/doctor/patients/${detail.patient.id}`}
              className="rounded-full bg-slate-100 px-3 py-1 font-medium text-brand-forest"
            >
              查看個案詳細
            </Link>
          </div>
          <p>地址：{detail.schedule.address_snapshot}</p>
          <p>定位關鍵字：{detail.schedule.location_keyword_snapshot}</p>
          <p>預約時段：{formatDateTimeFull(detail.schedule.scheduled_start_at)}</p>
          <p>預估治療時段：{getScheduleDisplayRange(detail.schedule, detail.record)}</p>
          <p>主要問題：{detail.patient.primary_diagnosis}</p>
          <p>注意事項：{detail.patient.precautions}</p>
          <p>本次提醒：{detail.schedule.note}</p>
        </div>
      </Panel>

      <div className="space-y-6">
        <Panel title="定位與自動判定流程">
          <VisitAutomationPanel detail={detail} />
        </Panel>

        <Panel title="今日訪視時間資訊摘要">
          <div className="grid gap-3 sm:grid-cols-2">
            {timeSummary.map((item) => (
              <div key={item.label} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className="mt-2 font-semibold text-brand-ink">{item.value}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="流程補充說明">
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              目前不再建立通知任務；出發、抵達、治療完成與定位狀態會直接記錄在本頁與行政端排程畫面。
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
