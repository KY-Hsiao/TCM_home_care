import { useAppContext } from "../../app/use-app-context";
import type { VisitDetail } from "../../domain/repository";
import { Badge } from "../../shared/ui/Badge";
import { formatDateTimeFull, formatMinutes } from "../../shared/utils/format";
import { LocationSummaryCard } from "./LocationSummaryCard";
import { shouldPromptArrival } from "../doctor/doctor-page-helpers";
import { differenceInMinutes } from "date-fns";

type VisitAutomationPanelProps = {
  detail: VisitDetail;
  compact?: boolean;
};

export function VisitAutomationPanel({ detail, compact = false }: VisitAutomationPanelProps) {
  const { repositories, services } = useAppContext();
  const runtime = services.visitAutomation.getTrackingState(detail.schedule.id);
  const scenarios = services.visitAutomation.getScenarios();
  const displayStatus = services.visitAutomation.getDisplayStatus(
    detail.schedule,
    detail.record?.arrival_time ?? null,
    detail.record?.departure_from_patient_home_time ?? null
  );
  const latestSample = runtime?.latestSample;
  const arrivalReady = shouldPromptArrival(detail.schedule, runtime);
  const navigationDestinationAddress = detail.schedule.address_snapshot || detail.patient.home_address;
  const navigationDestinationKeyword = detail.schedule.location_keyword_snapshot || detail.patient.location_keyword;
  const navigationUrl = services.maps.buildNavigationUrl({
    destinationAddress: navigationDestinationAddress,
    destinationKeyword: navigationDestinationKeyword,
    destinationLatitude: detail.schedule.home_latitude_snapshot,
    destinationLongitude: detail.schedule.home_longitude_snapshot,
    originLatitude: latestSample?.latitude ?? null,
    originLongitude: latestSample?.longitude ?? null,
    navigationTarget: "web"
  });
  const navigationEmbedUrl = services.maps.buildNavigationEmbedUrl({
    destinationAddress: navigationDestinationAddress,
    destinationKeyword: navigationDestinationKeyword,
    destinationLatitude: detail.schedule.home_latitude_snapshot,
    destinationLongitude: detail.schedule.home_longitude_snapshot,
    originLatitude: latestSample?.latitude ?? null,
    originLongitude: latestSample?.longitude ?? null
  });
  const canManuallyConfirmArrival = Boolean(detail.record?.departure_time) && !detail.record?.arrival_time;
  const travelDurationMinutes =
    detail.record?.departure_time && detail.record?.arrival_time
      ? Math.max(
          0,
          differenceInMinutes(
            new Date(detail.record.arrival_time),
            new Date(detail.record.departure_time)
          )
        )
      : null;

  const handleStart = () => {
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
  };

  const handlePause = () => {
    services.visitAutomation.pauseTracking(detail.schedule.id);
  };

  const handleResume = () => {
    const nextDetail = repositories.visitRepository.getScheduleDetail(detail.schedule.id);
    if (nextDetail) {
      services.visitAutomation.resumeTracking(nextDetail);
    }
  };

  const handleReset = () => {
    services.visitAutomation.resetTracking(detail.schedule.id);
  };

  const handleConfirmArrival = () => {
    services.visitAutomation.confirmArrival(detail.schedule.id, "doctor");
  };

  const handleCompleteTreatment = () => {
    services.visitAutomation.confirmDeparture(detail.schedule.id, "doctor");
  };

  const watchStatus = runtime?.watchStatus ?? "idle";
  const scenarioId = runtime?.scenarioId ?? "normal_arrival_complete";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-brand-ink">定位情境</span>
          <select
            value={scenarioId}
            onChange={(event) =>
              services.visitAutomation.configureTracking(detail.schedule.id, {
                scenarioId: event.target.value as typeof scenarioId
              })
            }
            className="w-full rounded-2xl border border-slate-200 px-4 py-3"
          >
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          {!detail.record?.departure_time ? (
            <button
              type="button"
              onClick={handleStart}
              className="rounded-full bg-brand-coral px-4 py-2 text-sm font-semibold text-white"
            >
              出發
            </button>
          ) : null}
          {detail.record?.departure_time && !detail.record?.arrival_time && arrivalReady ? (
            <button
              type="button"
              onClick={handleConfirmArrival}
              className="rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
            >
              已抵達
            </button>
          ) : null}
          {detail.record?.arrival_time && !detail.record?.departure_from_patient_home_time ? (
            <button
              type="button"
              onClick={handleCompleteTreatment}
              className="rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
            >
              治療完成
            </button>
          ) : null}
          <button
            type="button"
            onClick={handlePause}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
          >
            暫停
          </button>
          <button
            type="button"
            onClick={handleResume}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
          >
            恢復
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
          >
            重設
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">顯示狀態</p>
          <div className="mt-2">
            <Badge value={displayStatus} compact />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">geofence 狀態</p>
          <div className="mt-2">
            <Badge value={runtime?.geofenceStatus ?? detail.schedule.geofence_status} compact />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">watch 狀態</p>
          <p className="mt-2 font-semibold text-brand-ink">{watchStatus}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">定位精度 / 距離</p>
          <p className="mt-2 font-semibold text-brand-ink">
            {runtime?.latestAccuracy ?? "—"}m / {runtime?.latestDistanceMeters ?? "—"}m
          </p>
        </div>
      </div>

      {runtime?.fallbackMessage ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {runtime.fallbackMessage}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 lg:px-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-brand-coral">內嵌導航介面</p>
            <p className="mt-1 text-base font-semibold text-brand-ink">前往 {navigationDestinationAddress}</p>
            <p className="mt-1 text-xs text-slate-500">
              醫師可在本頁查看路線，抵達後直接按「已抵達」回寫狀態。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={navigationUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
            >
              啟動 Google Maps 導航
            </a>
            <button
              type="button"
              onClick={handleConfirmArrival}
              disabled={!canManuallyConfirmArrival}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-brand-coral px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              已抵達
            </button>
          </div>
        </div>
        {navigationEmbedUrl ? (
          <iframe
            title={`${navigationDestinationAddress} 內嵌導航`}
            src={navigationEmbedUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-[420px] w-full border-0 lg:h-[520px]"
            allowFullScreen
          />
        ) : (
          <div className="bg-slate-50 px-4 py-5 text-sm text-slate-600 lg:px-5">
            <p className="font-semibold text-brand-ink">尚未取得可嵌入的起點座標</p>
            <p className="mt-2 leading-6">
              請先按「出發」或「恢復」讓系統取得醫師定位；若現場網路或瀏覽器定位受限，仍可按「啟動 Google Maps 導航」開啟實際導航。抵達後可直接按「已抵達」回寫紀錄。
            </p>
          </div>
        )}
      </div>

      {!compact ? (
        <LocationSummaryCard
          patient={detail.patient}
          schedule={detail.schedule}
          latestOrigin={
            latestSample
              ? { latitude: latestSample.latitude, longitude: latestSample.longitude }
              : undefined
          }
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">出發時間</p>
          <p className="mt-2 font-semibold text-brand-ink">
            {formatDateTimeFull(detail.record?.departure_time)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">抵達時間</p>
          <p className="mt-2 font-semibold text-brand-ink">
            {formatDateTimeFull(detail.record?.arrival_time)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">車程時間</p>
          <p className="mt-2 font-semibold text-brand-ink">
            {formatMinutes(travelDurationMinutes)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">治療時段</p>
          <p className="mt-2 font-semibold text-brand-ink">
            {formatDateTimeFull(detail.record?.treatment_start_time)} -{" "}
            {formatDateTimeFull(detail.record?.treatment_end_time)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">離開患者時間</p>
          <p className="mt-2 font-semibold text-brand-ink">
            {formatDateTimeFull(detail.record?.departure_from_patient_home_time)}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 p-4 text-sm">
        <p className="font-semibold text-brand-ink">模擬事件紀錄</p>
        <div className="mt-3 space-y-2">
          {(runtime?.eventLog.length ? runtime.eventLog : ["尚未開始模擬"]).map((item) => (
            <p key={item} className="text-slate-600">
              {item}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
