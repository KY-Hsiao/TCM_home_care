import { Link, useNavigate } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
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
  isVisitUnlocked
} from "./doctor-page-helpers";

function openExternalNavigation(url: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function DoctorVisitCard({
  scheduleId
}: {
  scheduleId: string;
}) {
  const { repositories, services, session } = useAppContext();
  const navigate = useNavigate();
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
  const orderedSchedules = repositories.visitRepository.getDoctorRouteSchedules(
    session.activeDoctorId,
    session.activeRoutePlanId
  );
  const unlocked = isVisitUnlocked(orderedSchedules, detail.schedule.id, detail.record);
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
  const activeNavigationStage =
    unlocked && Boolean(detail.record?.departure_time) && !detail.record?.arrival_time && !visitFinished;
  const navigationUrl = services.maps.buildNavigationUrl({
    destinationAddress: detail.schedule.address_snapshot,
    destinationKeyword: detail.schedule.location_keyword_snapshot,
    destinationLatitude: detail.schedule.home_latitude_snapshot,
    destinationLongitude: detail.schedule.home_longitude_snapshot,
    originLatitude: runtime?.latestSample?.latitude ?? null,
    originLongitude: runtime?.latestSample?.longitude ?? null
  });
  const nextNavigationUrl = nextScheduleDetail
    ? services.maps.buildNavigationUrl({
        destinationAddress: nextScheduleDetail.schedule.address_snapshot,
        destinationKeyword: nextScheduleDetail.schedule.location_keyword_snapshot,
        destinationLatitude: nextScheduleDetail.schedule.home_latitude_snapshot,
        destinationLongitude: nextScheduleDetail.schedule.home_longitude_snapshot,
        originLatitude: runtime?.latestSample?.latitude ?? detail.schedule.home_latitude_snapshot,
        originLongitude: runtime?.latestSample?.longitude ?? detail.schedule.home_longitude_snapshot
      })
    : null;

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
    navigate("/doctor/navigation");
    openExternalNavigation(navigationUrl);
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
    navigate("/doctor/navigation");
    if (nextNavigationUrl) {
      openExternalNavigation(nextNavigationUrl);
    }
  };

  const handleResumeNavigation = () => {
    navigate("/doctor/navigation");
    openExternalNavigation(navigationUrl);
  };

  const handlePauseVisit = () => {
    services.visitAutomation.recordDoctorFeedback(detail.schedule.id, "absent");
  };

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
            {Array.from(
              new Set(detail.patient.reminder_tags.concat(detail.schedule.reminder_tags))
            )
              .slice(0, 4)
              .map((tag, index) => (
                <span
                  key={`${detail.schedule.id}-${tag}-${index}`}
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
          {unlocked && detail.record?.departure_time ? (
            <button type="button" onClick={handleResumeNavigation} className={doctorActionButtonClass()}>
              前往即時導航
            </button>
          ) : !unlocked ? (
            <div className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-400">
              請先完成前一站
            </div>
          ) : null}
          {unlocked && !detail.record?.departure_time ? (
            <button type="button" onClick={handleDepart} className={doctorActionButtonClass("primary")}>
              開始行程
            </button>
          ) : null}
          {unlocked && detail.record?.departure_time && !detail.record?.arrival_time ? (
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
          {unlocked && !visitFinished && detail.schedule.status !== "paused" ? (
            <button
              type="button"
              onClick={handlePauseVisit}
              className={doctorActionButtonClass()}
            >
              標記暫停
            </button>
          ) : null}
          {!visitFinished && detail.record?.departure_time && !detail.record?.arrival_time ? (
            <div className="inline-flex items-center justify-center rounded-full border border-brand-sand bg-brand-sand/40 px-3 py-2 text-xs font-semibold text-brand-forest">
              到站後請手動按「已抵達」；系統會依接近距離先記錄到站時間候選值。
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
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        {activeNavigationStage
          ? "目前導航會外接 Google 地圖；系統頁只保留案件狀態與手動抵達 / 完成治療操作。"
          : "排程清單目前只保留案件資訊與狀態操作；Google 地圖導航集中從「即時導航」開啟。"}
      </div>
    </article>
  );
}
