import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { VisitAutomationPanel } from "../maps/VisitAutomationPanel";
import { Badge } from "../../shared/ui/Badge";
import { formatDateTimeFull, formatTimeOnly } from "../../shared/utils/format";
import {
  resolveLocationKeyword,
  sameAddressLocationKeyword
} from "../../shared/utils/location-keyword";
import {
  doctorActionButtonClass,
  getScheduleDisplayRange,
  isVisitFinished,
  isVisitUnlocked,
  shouldPromptArrival
} from "./doctor-page-helpers";

export function DoctorVisitCard({ scheduleId }: { scheduleId: string }) {
  const { repositories, db, services, session } = useAppContext();
  const detail = repositories.visitRepository.getScheduleDetail(scheduleId);

  if (!detail) {
    return null;
  }

  const displayStatus = services.visitAutomation.getDisplayStatus(
    detail.schedule,
    detail.record?.arrival_time ?? null,
    detail.record?.departure_from_patient_home_time ?? null
  );
  const runtime = services.visitAutomation.getTrackingState(detail.schedule.id);
  const latestDoctorLocation = [...db.doctor_location_logs]
    .filter((log) => log.doctor_id === detail.doctor.id)
    .sort(
      (left, right) =>
        new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()
    )[0];
  const latestSample = runtime?.latestSample;
  const orderedSchedules = repositories.visitRepository.getDoctorRouteSchedules(
    session.activeDoctorId,
    session.activeRoutePlanId
  );
  const unlocked = isVisitUnlocked(orderedSchedules, detail.schedule.id, detail.record);
  const arrivalReady = shouldPromptArrival(detail.schedule, runtime);
  const visitFinished =
    Boolean(detail.record?.departure_from_patient_home_time) ||
    isVisitFinished(detail.schedule.status);
  const nextSchedule = (() => {
    const currentIndex = orderedSchedules.findIndex((schedule) => schedule.id === detail.schedule.id);
    if (currentIndex < 0) {
      return undefined;
    }
    return orderedSchedules[currentIndex + 1];
  })();
  const nextScheduleDetail = nextSchedule
    ? repositories.visitRepository.getScheduleDetail(nextSchedule.id)
    : undefined;
  const currentStopMapUrl = services.maps.buildPatientEmbedUrl({
    address: detail.schedule.address_snapshot,
    locationKeyword: detail.schedule.location_keyword_snapshot,
    latitude: detail.schedule.home_latitude_snapshot,
    longitude: detail.schedule.home_longitude_snapshot
  });

  const navigationUrl = services.maps.buildNavigationUrl({
    destinationAddress: detail.schedule.address_snapshot,
    destinationKeyword: detail.schedule.location_keyword_snapshot,
    destinationLatitude: detail.schedule.home_latitude_snapshot,
    destinationLongitude: detail.schedule.home_longitude_snapshot,
    originLatitude: latestSample?.latitude ?? latestDoctorLocation?.latitude ?? null,
    originLongitude: latestSample?.longitude ?? latestDoctorLocation?.longitude ?? null
  });
  const nextNavigationUrl = nextScheduleDetail
    ? services.maps.buildNavigationUrl({
        destinationAddress: nextScheduleDetail.schedule.address_snapshot,
        destinationKeyword: nextScheduleDetail.schedule.location_keyword_snapshot,
        destinationLatitude: nextScheduleDetail.schedule.home_latitude_snapshot,
        destinationLongitude: nextScheduleDetail.schedule.home_longitude_snapshot,
        originLatitude: latestSample?.latitude ?? latestDoctorLocation?.latitude ?? null,
        originLongitude: latestSample?.longitude ?? latestDoctorLocation?.longitude ?? null
      })
    : null;
  const activeNavigationStage =
    unlocked && Boolean(detail.record?.departure_time) && !detail.record?.arrival_time && !visitFinished;
  const activeNavigationStageKey = activeNavigationStage
    ? `${detail.schedule.id}-${detail.record?.departure_time ?? "pending"}`
    : null;
  const [showRouteDirectory, setShowRouteDirectory] = useState(false);
  const [navigationSheetDismissed, setNavigationSheetDismissed] = useState(false);

  useEffect(() => {
    if (!activeNavigationStageKey) {
      setShowRouteDirectory(false);
      setNavigationSheetDismissed(false);
      return;
    }
    setNavigationSheetDismissed(false);
  }, [activeNavigationStageKey]);

  const openNavigation = (url: string | null) => {
    if (!url || typeof window === "undefined") {
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDepart = () => {
    const nextRecord = repositories.visitRepository.startVisitTravel(detail.schedule.id);
    services.visitAutomation.startTracking({
      ...detail,
      record: nextRecord ?? detail.record,
      schedule: {
        ...detail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });
    setNavigationSheetDismissed(false);
    openNavigation(navigationUrl);
  };

  const handleConfirmArrival = () => {
    services.visitAutomation.confirmArrival(detail.schedule.id, "doctor");
  };

  const handleCompleteTreatment = () => {
    services.visitAutomation.confirmDeparture(detail.schedule.id, "doctor");
  };

  const handleProceedToNextStop = () => {
    services.visitAutomation.confirmDeparture(detail.schedule.id, "doctor");
    if (!nextScheduleDetail) {
      return;
    }

    const nextRecord = repositories.visitRepository.startVisitTravel(nextScheduleDetail.schedule.id);
    services.visitAutomation.startTracking({
      ...nextScheduleDetail,
      record: nextRecord ?? nextScheduleDetail.record,
      schedule: {
        ...nextScheduleDetail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });
    setNavigationSheetDismissed(false);
    openNavigation(nextNavigationUrl);
  };

  const handleResumeNavigation = () => {
    setNavigationSheetDismissed(false);
    openNavigation(navigationUrl);
  };

  const routeDirectoryItems = orderedSchedules.map((schedule) => {
    const scheduleDetail = repositories.visitRepository.getScheduleDetail(schedule.id);
    const isCurrent = schedule.id === detail.schedule.id;
    const isCompleted = isVisitFinished(schedule.status);
    const stateLabel = isCompleted ? "已完成" : isCurrent ? "本站" : "待前往";

    return {
      id: schedule.id,
      patientName: scheduleDetail?.patient.name ?? schedule.patient_id,
      address: schedule.address_snapshot,
      locationKeyword: schedule.location_keyword_snapshot,
      stateLabel
    };
  });
  const showNavigationLayout = activeNavigationStage && !navigationSheetDismissed;

  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold text-brand-ink">{detail.patient.name}</h3>
            <Badge value={displayStatus} compact />
          </div>
          <p className="text-sm text-slate-600">地址：{detail.schedule.address_snapshot}</p>
          <p className="text-sm text-slate-600">
            定位關鍵字：
            {detail.schedule.location_keyword_snapshot === sameAddressLocationKeyword
              ? `同住址（${resolveLocationKeyword(
                  detail.schedule.location_keyword_snapshot,
                  detail.schedule.address_snapshot
                )}）`
              : detail.schedule.location_keyword_snapshot}
          </p>
          <p className="text-sm text-slate-600">
            預約時段：{formatDateTimeFull(detail.schedule.scheduled_start_at)} -{" "}
            {formatTimeOnly(detail.schedule.scheduled_end_at)}
          </p>
          <p className="text-sm text-slate-600">
            預估治療時段：{getScheduleDisplayRange(detail.schedule, detail.record)}
          </p>
          <p className="text-sm text-slate-600">主要問題：{detail.patient.primary_diagnosis}</p>
          <div className="flex flex-wrap gap-2">
            {detail.patient.reminder_tags
              .concat(detail.schedule.reminder_tags)
              .slice(0, 4)
              .map((tag) => (
                <span
                  key={`${detail.schedule.id}-${tag}`}
                  className="rounded-full bg-brand-sand px-3 py-1 text-xs font-medium text-brand-forest"
                >
                  {tag}
                </span>
              ))}
          </div>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:min-w-[280px]">
          <Link to={`/doctor/patients/${detail.patient.id}`} className={doctorActionButtonClass()}>
            查看個案
          </Link>
          <a href={`tel:${detail.patient.phone}`} className={doctorActionButtonClass()}>
            撥打電話
          </a>
          <Link
            to={`/doctor/records/${detail.schedule.id}`}
            className={doctorActionButtonClass("primary")}
          >
            填寫紀錄
          </Link>
          {unlocked ? (
            <a
              href={navigationUrl}
              target="_blank"
              rel="noreferrer"
              className={doctorActionButtonClass()}
            >
              {detail.record?.departure_time ? "重新開啟本站導航" : "查看本站導航"}
            </a>
          ) : (
            <div className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-400">
              請先完成前一站
            </div>
          )}
          {unlocked && !detail.record?.departure_time ? (
            <button type="button" onClick={handleDepart} className={doctorActionButtonClass("primary")}>
              開始行程
            </button>
          ) : null}
          {activeNavigationStage && navigationSheetDismissed ? (
            <button
              type="button"
              onClick={handleResumeNavigation}
              className={doctorActionButtonClass("primary")}
            >
              接續行程
            </button>
          ) : null}
          {unlocked && detail.record?.departure_time && !detail.record?.arrival_time && arrivalReady ? (
            <button
              type="button"
              onClick={handleConfirmArrival}
              className={doctorActionButtonClass("primary")}
            >
              已抵達
            </button>
          ) : null}
          {unlocked && detail.record?.arrival_time && !visitFinished ? (
            <div className="inline-flex items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              {nextSchedule
                ? "已抵達，完成治療後可按「啟程去下一個據點」。"
                : "已抵達最後一站，完成治療後請按「行程完畢」。"}
            </div>
          ) : null}
          {unlocked && detail.record?.arrival_time && !visitFinished ? (
            <button
              type="button"
              onClick={nextSchedule ? handleProceedToNextStop : handleCompleteTreatment}
              className={doctorActionButtonClass("primary")}
            >
              {nextSchedule ? "啟程去下一個據點" : "行程完畢"}
            </button>
          ) : null}
          {!visitFinished && detail.record?.departure_time && !arrivalReady ? (
            <div className="inline-flex items-center justify-center rounded-full border border-brand-sand bg-brand-sand/40 px-3 py-2 text-xs font-semibold text-brand-forest">
              靠近導航目的地 100 公尺內時會自動出現「已抵達」
            </div>
          ) : null}
          {visitFinished && nextSchedule ? (
            <div className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              下一站已解鎖：{nextScheduleDetail?.patient.name ?? nextSchedule.patient_id}
            </div>
          ) : null}
          {visitFinished && !nextSchedule ? (
            <div className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              本日行程已完成
            </div>
          ) : null}
        </div>
      </div>
      {showNavigationLayout ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_320px]">
          <section className="overflow-hidden rounded-[1.75rem] border border-brand-moss/30 bg-gradient-to-br from-brand-forest via-brand-forest to-brand-moss text-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
              <div className="space-y-1">
                <p className="text-xs font-semibold tracking-[0.2em] text-white/70">導航進行中</p>
                <h4 className="text-lg font-semibold sm:text-xl">前往 {detail.patient.name} 的停留點</h4>
                <p className="text-sm text-white/80">
                  導航階段會優先顯示本站地圖與操作，回程後可再展開總目錄檢查後續站點。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowRouteDirectory((current) => !current)}
                  className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  {showRouteDirectory ? "收合總目錄" : "叫出總目錄"}
                </button>
                <button
                  type="button"
                  onClick={() => setNavigationSheetDismissed(true)}
                  className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white px-4 py-2 text-xs font-semibold text-brand-forest transition hover:bg-brand-sand"
                >
                  結束導航
                </button>
              </div>
            </div>

            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-4">
                <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-2 shadow-inner">
                  <iframe
                    title={`導航地圖-${detail.schedule.id}`}
                    src={currentStopMapUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="h-[360px] w-full rounded-[1.1rem] bg-white sm:h-[420px] xl:h-[520px]"
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <a
                    href={navigationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-brand-coral px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    用 Google 地圖導航到本站
                  </a>
                  <button
                    type="button"
                    onClick={handleResumeNavigation}
                    className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                  >
                    接續行程
                  </button>
                </div>
              </div>

              <div className="space-y-3 rounded-[1.5rem] border border-white/10 bg-white/10 p-4">
                <div>
                  <p className="text-xs text-white/70">本站定位關鍵字</p>
                  <p className="mt-1 text-sm font-semibold">
                    {resolveLocationKeyword(
                      detail.schedule.location_keyword_snapshot,
                      detail.schedule.address_snapshot
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-white/70">本站地址</p>
                  <p className="mt-1 text-sm leading-6 text-white/90">
                    {detail.schedule.address_snapshot}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-white/70">本段提醒</p>
                  <p className="mt-1 text-sm leading-6 text-white/90">
                    靠近目的地 100 公尺內時，畫面會改成可按「已抵達」，完成治療後再按「啟程去下一個據點」。
                  </p>
                </div>
                {nextScheduleDetail ? (
                  <div className="rounded-2xl bg-white/10 px-4 py-3">
                    <p className="text-xs text-white/70">下一站</p>
                    <p className="mt-1 text-sm font-semibold">{nextScheduleDetail.patient.name}</p>
                    <p className="mt-1 text-xs leading-5 text-white/80">
                      {resolveLocationKeyword(
                        nextScheduleDetail.schedule.location_keyword_snapshot,
                        nextScheduleDetail.schedule.address_snapshot
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/85">
                    這是今天最後一站，抵達並完成治療後會出現「行程完畢」。
                  </div>
                )}
              </div>
            </div>
          </section>

          {showRouteDirectory ? (
            <aside className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-4 shadow-inner">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-brand-ink">今日總目錄</p>
                  <p className="mt-1 text-xs text-slate-500">
                    可快速確認本站、已完成與後續待前往的停留點。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRouteDirectory(false)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-brand-ink"
                >
                  收合
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {routeDirectoryItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      item.id === detail.schedule.id
                        ? "border-brand-moss bg-white shadow-card"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">{item.patientName}</p>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        {item.stateLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{item.locationKeyword}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{item.address}</p>
                  </div>
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5">
        <VisitAutomationPanel detail={detail} compact />
      </div>
    </article>
  );
}
