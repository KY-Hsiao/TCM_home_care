import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { SavedRoutePlan } from "../../domain/models";
import type { RouteMapInput } from "../../services/types";
import { VisitAutomationPanel } from "../../modules/maps/VisitAutomationPanel";
import { RouteMapPreviewCard } from "../../modules/maps/RouteMapPreviewCard";
import {
  buildReadonlySummary,
  doctorActionButtonClass,
  getScheduleDisplayRange,
  isVisitFinished,
  isVisitUnlocked
} from "../../modules/doctor/doctor-page-helpers";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull, formatTimeOnly } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";
import type { TrackingRuntime } from "../../services/types";

function openExternalNavigation(url: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function resolveDoctorRouteStatus(status: string) {
  if (["completed", "followup_pending"].includes(status)) {
    return "completed";
  }
  if (status === "paused") {
    return "paused";
  }
  if (["arrived", "in_treatment"].includes(status)) {
    return "in_treatment";
  }
  if (["on_the_way", "tracking", "proximity_pending"].includes(status)) {
    return "on_the_way";
  }
  return "scheduled";
}

function resolveActiveTrackingContext(input: {
  repositories: ReturnType<typeof useAppContext>["repositories"];
  services: ReturnType<typeof useAppContext>["services"];
  doctorId: string;
  routePlanId: string | null;
}) {
  const routeSchedules = input.repositories.visitRepository.getDoctorRouteSchedules(
    input.doctorId,
    input.routePlanId
  );
  const runtimeEntries = routeSchedules
    .map((schedule) => ({
      schedule,
      runtime: input.services.visitAutomation.getTrackingState(schedule.id)
    }))
    .filter((entry): entry is { schedule: (typeof routeSchedules)[number]; runtime: TrackingRuntime } => {
      const runtime = entry.runtime;
      if (!runtime) {
        return false;
      }
      return runtime.watchStatus === "running" || runtime.watchStatus === "paused";
    })
    .sort((left, right) => {
      const leftRuntime = left.runtime;
      const rightRuntime = right.runtime;
      const leftPriority = leftRuntime.watchStatus === "running" ? 0 : 1;
      const rightPriority = rightRuntime.watchStatus === "running" ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      const leftUpdatedAt = new Date(leftRuntime.lastUpdatedAt ?? leftRuntime.startedAt ?? 0).getTime();
      const rightUpdatedAt = new Date(rightRuntime.lastUpdatedAt ?? rightRuntime.startedAt ?? 0).getTime();
      if (leftUpdatedAt !== rightUpdatedAt) {
        return rightUpdatedAt - leftUpdatedAt;
      }
      return (left.schedule.route_order ?? Number.MAX_SAFE_INTEGER) - (right.schedule.route_order ?? Number.MAX_SAFE_INTEGER);
    });

  return runtimeEntries[0] ?? null;
}

function buildDoctorRouteContexts(input: {
  repositories: ReturnType<typeof useAppContext>["repositories"];
  services: ReturnType<typeof useAppContext>["services"];
  doctorId: string;
  routePlanId: string | null;
}) {
  const routeSchedules = input.repositories.visitRepository.getDoctorRouteSchedules(
    input.doctorId,
    input.routePlanId
  );

  return routeSchedules
    .map((schedule) => {
      const detail = input.repositories.visitRepository.getScheduleDetail(schedule.id);
      if (!detail) {
        return null;
      }
      return {
        schedule,
        detail,
        record: detail.record,
        runtime: input.services.visitAutomation.getTrackingState(schedule.id)
      };
    })
    .filter(
      (
        entry
      ): entry is {
        schedule: (typeof routeSchedules)[number];
        detail: NonNullable<ReturnType<typeof input.repositories.visitRepository.getScheduleDetail>>;
        record: ReturnType<typeof input.repositories.visitRepository.getVisitRecordByScheduleId>;
        runtime: TrackingRuntime | undefined;
      } => Boolean(entry)
    );
}

function findNextUnlockedRouteContext(
  routeContexts: ReturnType<typeof buildDoctorRouteContexts>,
  currentScheduleId?: string
) {
  const currentIndex = currentScheduleId
    ? routeContexts.findIndex((entry) => entry.schedule.id === currentScheduleId)
    : -1;
  const remainingContexts =
    currentIndex >= 0 ? routeContexts.slice(currentIndex + 1) : routeContexts;

  return remainingContexts.find((entry) => {
    const unlocked = isVisitUnlocked(routeContexts.map((item) => item.schedule), entry.schedule.id, entry.record);
    return unlocked && !isVisitFinished(entry.schedule.status);
  });
}

function findNextSequentialRouteContext(
  routeContexts: ReturnType<typeof buildDoctorRouteContexts>,
  currentScheduleId?: string
) {
  const currentIndex = currentScheduleId
    ? routeContexts.findIndex((entry) => entry.schedule.id === currentScheduleId)
    : -1;
  const remainingContexts =
    currentIndex >= 0 ? routeContexts.slice(currentIndex + 1) : routeContexts;

  return remainingContexts.find((entry) => !isVisitFinished(entry.schedule.status));
}

function getRouteDisplayOrder(
  routeSchedules: Array<{ id: string; status: string }>,
  scheduleId: string
) {
  const activeSchedules = routeSchedules.filter((schedule) => schedule.status !== "paused");
  const targetIndex = activeSchedules.findIndex((schedule) => schedule.id === scheduleId);
  return targetIndex >= 0 ? targetIndex + 1 : null;
}

function formatRoutePlanButtonLabel(routePlan: SavedRoutePlan) {
  const [, month, day] = routePlan.route_date.split("-");
  const fallbackDate = new Date(routePlan.route_date);
  const normalizedMonth = Number(month) || fallbackDate.getMonth() + 1;
  const normalizedDay = Number(day) || fallbackDate.getDate();

  return `${normalizedMonth}月${normalizedDay}日 ${routePlan.route_weekday}${routePlan.service_time_slot} / ${routePlan.route_items.length}位`;
}

function resolveRoutePlanItemStatusLabel(status: string) {
  if (status === "paused") {
    return "暫停";
  }
  if (["completed", "followup_pending"].includes(status)) {
    return "已完成";
  }
  if (["arrived", "in_treatment"].includes(status)) {
    return "治療中";
  }
  if (["on_the_way", "tracking", "proximity_pending"].includes(status)) {
    return "前往中";
  }
  return "已排程";
}

function buildRouteMapInputFromRoutePlan(
  routePlan: SavedRoutePlan,
  repositories: ReturnType<typeof useAppContext>["repositories"]
): RouteMapInput | null {
  const orderedStops = routePlan.route_items
    .filter((item) => item.checked)
    .slice()
    .sort((left, right) => {
      const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });

  if (orderedStops.length === 0) {
    return null;
  }

  return {
    origin: {
      address: routePlan.start_address,
      latitude: routePlan.start_latitude,
      longitude: routePlan.start_longitude
    },
    destination: {
      address: routePlan.end_address,
      latitude: routePlan.end_latitude,
      longitude: routePlan.end_longitude
    },
    waypoints: orderedStops.map((item) => {
      const scheduleDetail = item.schedule_id
        ? repositories.visitRepository.getScheduleDetail(item.schedule_id)
        : undefined;
      const patient = repositories.patientRepository.getPatientById(item.patient_id);
      return {
        address: item.address,
        latitude:
          scheduleDetail?.schedule.home_latitude_snapshot ??
          patient?.home_latitude ??
          null,
        longitude:
          scheduleDetail?.schedule.home_longitude_snapshot ??
          patient?.home_longitude ??
          null
      };
    }),
    travelMode: "driving",
    label: formatRoutePlanButtonLabel(routePlan)
  };
}

function resolveRoutePlanNavigationState(input: {
  repositories: ReturnType<typeof useAppContext>["repositories"];
  services: ReturnType<typeof useAppContext>["services"];
  doctorId: string;
  routePlanId: string;
}) {
  const routeSchedules = input.repositories.visitRepository.getDoctorRouteSchedules(
    input.doctorId,
    input.routePlanId
  );
  const activeTrackingContext = resolveActiveTrackingContext({
    repositories: input.repositories,
    services: input.services,
    doctorId: input.doctorId,
    routePlanId: input.routePlanId
  });
  const currentNavigationSchedule =
    activeTrackingContext?.runtime.watchStatus === "running" ||
    activeTrackingContext?.runtime.watchStatus === "paused"
      ? activeTrackingContext.schedule
      : null;
  const nextRouteSchedule =
    routeSchedules.find((schedule) => {
      const record = input.repositories.visitRepository.getVisitRecordByScheduleId(schedule.id);
      return isVisitUnlocked(routeSchedules, schedule.id, record) && !isVisitFinished(schedule.status);
    }) ?? null;
  const nextRouteScheduleDetail = nextRouteSchedule
    ? input.repositories.visitRepository.getScheduleDetail(nextRouteSchedule.id)
    : undefined;
  const currentNavigationDisplayOrder = currentNavigationSchedule
    ? getRouteDisplayOrder(routeSchedules, currentNavigationSchedule.id)
    : null;
  const nextRouteDisplayOrder = nextRouteSchedule
    ? getRouteDisplayOrder(routeSchedules, nextRouteSchedule.id)
    : null;
  const shouldReturnHospital =
    routeSchedules.length > 0 && routeSchedules.every((schedule) => isVisitFinished(schedule.status));
  const routeNavigationButtonLabel = currentNavigationSchedule
    ? "抵達"
    : shouldReturnHospital
      ? "返回醫院"
      : nextRouteSchedule
        ? "出發"
        : "開始導航";
  const routeNavigationHint = currentNavigationSchedule
    ? `目前導航進行到第 ${currentNavigationDisplayOrder ?? currentNavigationSchedule.route_order} 站，抵達後請手動進入治療流程。`
    : nextRouteScheduleDetail
      ? `下一位會從第 ${nextRouteDisplayOrder ?? nextRouteScheduleDetail.schedule.route_order} 站 ${maskPatientName(nextRouteScheduleDetail.patient.name)} 開始。`
      : shouldReturnHospital
        ? "所有患者已完成，最後一段請返回醫院。"
        : "目前這條路線沒有可開始的導航站點。";

  return {
    activeTrackingContext,
    currentNavigationSchedule,
    nextRouteSchedule,
    nextRouteScheduleDetail,
    shouldReturnHospital,
    routeNavigationButtonLabel,
    routeNavigationHint
  };
}

function DoctorRouteSelector({ embedded = false }: { embedded?: boolean }) {
  const {
    repositories,
    services,
    session,
    setActiveRoutePlanId
  } = useAppContext();
  const navigate = useNavigate();
  const routePlans = repositories.visitRepository.getSavedRoutePlans({
    doctorId: session.activeDoctorId,
    executionStatus: "executing"
  });
  const routePlansWithNavigationState = routePlans.map((routePlan) => ({
    routePlan,
    navigationState: resolveRoutePlanNavigationState({
      repositories,
      services,
      doctorId: session.activeDoctorId,
      routePlanId: routePlan.id
    })
  }));
  const hasForwardRoutePlan = routePlansWithNavigationState.some(
    ({ navigationState }) =>
      Boolean(navigationState.currentNavigationSchedule || navigationState.nextRouteSchedule)
  );
  const hasHospitalReturnRoutePlan = routePlansWithNavigationState.some(
    ({ navigationState }) => navigationState.shouldReturnHospital
  );
  const visibleRoutePlans =
    hasForwardRoutePlan
      ? routePlansWithNavigationState.filter(({ navigationState }) =>
          Boolean(navigationState.currentNavigationSchedule || navigationState.nextRouteSchedule)
        )
      : hasHospitalReturnRoutePlan
        ? routePlansWithNavigationState.filter(
            ({ navigationState }) => navigationState.shouldReturnHospital
          )
        : routePlansWithNavigationState;
  const [routeListModalId, setRouteListModalId] = useState<string | null>(null);
  const [patientDetailScheduleId, setPatientDetailScheduleId] = useState<string | null>(null);

  useEffect(() => {
    if (visibleRoutePlans.length === 0) {
      if (session.activeRoutePlanId !== null) {
        setActiveRoutePlanId(null);
      }
      return;
    }
    if (
      !session.activeRoutePlanId ||
      !visibleRoutePlans.some(({ routePlan }) => routePlan.id === session.activeRoutePlanId)
    ) {
      setActiveRoutePlanId(visibleRoutePlans[0].routePlan.id);
    }
  }, [visibleRoutePlans, session.activeRoutePlanId, setActiveRoutePlanId]);

  useEffect(() => {
    if (!routeListModalId) {
      return;
    }
    if (!routePlans.some((routePlan) => routePlan.id === routeListModalId)) {
      setRouteListModalId(null);
    }
  }, [routeListModalId, routePlans]);

  useEffect(() => {
    if (!patientDetailScheduleId) {
      return;
    }
    if (!repositories.visitRepository.getScheduleDetail(patientDetailScheduleId)) {
      setPatientDetailScheduleId(null);
    }
  }, [patientDetailScheduleId, repositories]);

  const handleOpenRouteList = (routePlanId: string) => {
    setActiveRoutePlanId(routePlanId);
    setRouteListModalId(routePlanId);
  };

  const handleResetRouteProgress = (routePlanId: string) => {
    const routePlan = repositories.visitRepository.getSavedRoutePlanById(routePlanId);
    if (!routePlan) {
      return;
    }

    repositories.visitRepository.resetRoutePlanProgress(routePlanId);
    services.visitAutomation.resetAll();
    setPatientDetailScheduleId(null);
    setRouteListModalId(null);
    setActiveRoutePlanId(routePlanId);
    navigate("/doctor/navigation");
  };

  const selectedRoutePlan = routeListModalId
    ? repositories.visitRepository.getSavedRoutePlanById(routeListModalId)
    : undefined;
  const selectedRouteEntries = selectedRoutePlan
    ? selectedRoutePlan.route_items
        .slice()
        .sort((left, right) => {
          const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) {
            return leftOrder - rightOrder;
          }
          return left.patient_name.localeCompare(right.patient_name, "zh-Hant");
        })
        .map((item) => {
          const detail = item.schedule_id
            ? repositories.visitRepository.getScheduleDetail(item.schedule_id)
            : undefined;
          return {
            item,
            detail
          };
        })
    : [];
  const patientDetail = patientDetailScheduleId
    ? repositories.visitRepository.getScheduleDetail(patientDetailScheduleId)
    : undefined;
  const patientDetailActiveRoutePlan = session.activeRoutePlanId
    ? repositories.visitRepository.getSavedRoutePlanById(session.activeRoutePlanId)
    : repositories.visitRepository.getActiveRoutePlan(session.activeDoctorId);
  const patientDetailTimeSummary = patientDetail ? buildReadonlySummary(patientDetail.record) : [];
  const orderedSchedules = repositories.visitRepository.getDoctorRouteSchedules(
    session.activeDoctorId,
    session.activeRoutePlanId
  );
  const patientDetailRuntime = patientDetail
    ? services.visitAutomation.getTrackingState(patientDetail.schedule.id)
    : undefined;
  const patientDetailUnlocked = patientDetail
    ? isVisitUnlocked(orderedSchedules, patientDetail.schedule.id, patientDetail.record)
    : false;
  const patientDetailVisitFinished = patientDetail
    ? Boolean(patientDetail.record?.departure_from_patient_home_time) ||
      isVisitFinished(patientDetail.schedule.status)
    : false;
  const patientDetailNextSchedule = patientDetail
    ? (() => {
        const currentIndex = orderedSchedules.findIndex(
          (schedule) => schedule.id === patientDetail.schedule.id
        );
        if (currentIndex < 0) {
          return undefined;
        }
        return orderedSchedules[currentIndex + 1];
      })()
    : undefined;
  const patientDetailNextScheduleDetail = patientDetailNextSchedule
    ? repositories.visitRepository.getScheduleDetail(patientDetailNextSchedule.id)
    : undefined;
  const patientDetailDisplayOrder = patientDetail
    ? getRouteDisplayOrder(orderedSchedules, patientDetail.schedule.id)
    : null;
  const patientDetailNavigationUrl = patientDetail
    ? services.maps.buildNavigationUrl({
        destinationAddress: patientDetail.schedule.address_snapshot,
        destinationKeyword: patientDetail.schedule.location_keyword_snapshot,
        destinationLatitude: patientDetail.schedule.home_latitude_snapshot,
        destinationLongitude: patientDetail.schedule.home_longitude_snapshot,
        originLatitude: patientDetailRuntime?.latestSample?.latitude ?? null,
        originLongitude: patientDetailRuntime?.latestSample?.longitude ?? null
      })
    : null;
  const patientDetailReturnHospitalNavigationUrl =
    patientDetail && patientDetailActiveRoutePlan
      ? services.maps.buildNavigationUrl({
          destinationAddress: patientDetailActiveRoutePlan.end_address,
          destinationLatitude: patientDetailActiveRoutePlan.end_latitude,
          destinationLongitude: patientDetailActiveRoutePlan.end_longitude,
          originLatitude:
            patientDetailRuntime?.latestSample?.latitude ??
            patientDetail.schedule.home_latitude_snapshot,
          originLongitude:
            patientDetailRuntime?.latestSample?.longitude ??
            patientDetail.schedule.home_longitude_snapshot
        })
      : null;
  const patientDetailNextStopNavigationUrl =
    patientDetail && patientDetailNextScheduleDetail
      ? services.maps.buildNavigationUrl({
          destinationAddress: patientDetailNextScheduleDetail.schedule.address_snapshot,
          destinationKeyword: patientDetailNextScheduleDetail.schedule.location_keyword_snapshot,
          destinationLatitude: patientDetailNextScheduleDetail.schedule.home_latitude_snapshot,
          destinationLongitude: patientDetailNextScheduleDetail.schedule.home_longitude_snapshot,
          originLatitude:
            patientDetailRuntime?.latestSample?.latitude ??
            patientDetail.schedule.home_latitude_snapshot,
          originLongitude:
            patientDetailRuntime?.latestSample?.longitude ??
            patientDetail.schedule.home_longitude_snapshot
        })
      : null;

  const handlePatientDetailDepart = () => {
    if (!patientDetail) {
      return;
    }
    const nextRecord = repositories.visitRepository.startVisitTravel(patientDetail.schedule.id);
    services.visitAutomation.startTracking({
      ...patientDetail,
      record: nextRecord ?? patientDetail.record,
      schedule: {
        ...patientDetail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });
    setPatientDetailScheduleId(null);
    navigate("/doctor/navigation");
    if (patientDetailNavigationUrl) {
      openExternalNavigation(patientDetailNavigationUrl);
    }
  };

  const handlePatientDetailResumeNavigation = () => {
    if (!patientDetail) {
      return;
    }
    if (patientDetailRuntime?.watchStatus === "paused") {
      services.visitAutomation.resumeTracking(patientDetail);
    }
    setPatientDetailScheduleId(null);
    navigate("/doctor/navigation");
    if (patientDetailNavigationUrl) {
      openExternalNavigation(patientDetailNavigationUrl);
    }
  };

  const handlePatientDetailConfirmArrival = () => {
    if (!patientDetail) {
      return;
    }
    services.visitAutomation.confirmArrival(patientDetail.schedule.id, "doctor");
  };

  const handlePatientDetailCompleteTreatment = () => {
    if (!patientDetail) {
      return;
    }
    services.visitAutomation.confirmDeparture(patientDetail.schedule.id, "doctor");
    setPatientDetailScheduleId(null);
    navigate("/doctor/navigation");
    if (patientDetailReturnHospitalNavigationUrl) {
      openExternalNavigation(patientDetailReturnHospitalNavigationUrl);
    }
  };

  const handlePatientDetailProceedToNextStop = () => {
    if (!patientDetail) {
      return;
    }
    services.visitAutomation.confirmDeparture(patientDetail.schedule.id, "doctor");
    if (!patientDetailNextScheduleDetail) {
      setPatientDetailScheduleId(null);
      return;
    }

    const nextRecord = repositories.visitRepository.startVisitTravel(
      patientDetailNextScheduleDetail.schedule.id
    );
    services.visitAutomation.startTracking({
      ...patientDetailNextScheduleDetail,
      record: nextRecord ?? patientDetailNextScheduleDetail.record,
      schedule: {
        ...patientDetailNextScheduleDetail.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });
    setPatientDetailScheduleId(null);
    navigate("/doctor/navigation");
    if (patientDetailNextStopNavigationUrl) {
      openExternalNavigation(patientDetailNextStopNavigationUrl);
    }
  };

  const handlePatientDetailPauseVisit = () => {
    if (!patientDetail) {
      return;
    }
    services.visitAutomation.recordDoctorFeedback(patientDetail.schedule.id, "absent");
  };

  const routeListContent = (
    <div className="space-y-4">
      <div className="space-y-4">
          {visibleRoutePlans.length > 0 ? (
            visibleRoutePlans.map(({ routePlan, navigationState }) => {
              const isActive = session.activeRoutePlanId === routePlan.id;

              return (
                <div
                  key={routePlan.id}
                  className={`rounded-[1.1rem] border p-2 shadow-sm lg:rounded-[1.75rem] lg:p-4 ${
                    isActive ? "border-brand-moss bg-brand-sand/40" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1.35fr)_92px_minmax(0,1fr)] lg:gap-3">
                    <button
                      type="button"
                      onClick={() => handleOpenRouteList(routePlan.id)}
                      className={`min-w-0 rounded-[0.95rem] px-3 py-2 text-left transition lg:rounded-[1.25rem] lg:px-5 lg:py-4 ${
                        isActive
                          ? "bg-brand-forest text-white"
                          : "bg-slate-50 text-brand-ink ring-1 ring-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      <p className="text-[13px] font-semibold leading-tight lg:text-base">
                        {formatRoutePlanButtonLabel(routePlan)}
                      </p>
                      <p className={`mt-0.5 text-[9px] leading-tight lg:mt-1 lg:text-xs ${isActive ? "text-white/80" : "text-slate-500"}`}>
                        點這裡查看受試者名單與單人紀錄
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetRouteProgress(routePlan.id)}
                      className="rounded-[0.95rem] border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-brand-ink transition hover:border-brand-moss hover:text-brand-forest sm:rounded-[1.25rem] lg:px-1.5"
                    >
                      重置路線
                    </button>
                    <div className="rounded-[0.95rem] border border-slate-200 bg-white/70 px-2.5 py-2 text-[10px] leading-tight text-slate-500 ring-1 ring-white/60 sm:rounded-[1.25rem] lg:col-span-1 lg:px-4 lg:py-3 lg:text-xs">
                      <div className="space-y-0.5 lg:space-y-1">
                        <p className="break-words">起點：{routePlan.start_address}</p>
                        <p className="break-words">終點：{routePlan.end_address}</p>
                        <p>行車 {routePlan.total_minutes} 分鐘</p>
                        <p>{routePlan.total_distance_kilometers.toFixed(1)} 公里</p>
                        <p className="break-words">{navigationState.routeNavigationHint}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-500">
              目前尚未有管理端實行的路線
            </div>
          )}
      </div>
    </div>
  );

  return (
    <section id="doctor-route-selector">
      {embedded ? routeListContent : <Panel title="今日導航路線">{routeListContent}</Panel>}

      {selectedRoutePlan && typeof document !== "undefined"
        ? createPortal(
        <div className="fixed inset-0 z-[90] flex items-end justify-center overflow-y-auto bg-slate-950/45 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-3 lg:items-center lg:p-4">
          <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[1.35rem] bg-white shadow-2xl sm:max-h-[calc(100dvh-1.25rem)] lg:max-h-[85vh] lg:rounded-[2rem]">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
              <div>
                <p className="text-sm font-medium text-brand-coral">受試者名單</p>
                <h2 className="mt-1 text-lg font-semibold text-brand-ink lg:text-2xl">
                  {formatRoutePlanButtonLabel(selectedRoutePlan)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRouteListModalId(null)}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600"
              >
                關閉
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 lg:px-6 lg:py-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                點任一位患者即可跳出單人的紀錄視窗；導航仍以右側的開始導航按鈕為主。
              </div>
              <div className="mt-3 lg:mt-4">
                <RouteMapPreviewCard
                  route={buildRouteMapInputFromRoutePlan(selectedRoutePlan, repositories)}
                  emptyText="這條路線目前沒有已勾選的患者站點，因此無法建立整體路線預覽。"
                  compact
                />
              </div>
              <div className="mt-3 space-y-2 pb-1 lg:mt-4 lg:space-y-3">
                {selectedRouteEntries.map(({ item, detail }) => (
                  <button
                    key={`${selectedRoutePlan.id}-${item.patient_id}`}
                    type="button"
                    disabled={!detail}
                    onClick={() => {
                      if (!detail) {
                        return;
                      }
                      setPatientDetailScheduleId(detail.schedule.id);
                    }}
                    className={`w-full rounded-[1rem] border px-3 py-3 text-left transition lg:rounded-[1.25rem] lg:px-4 lg:py-4 ${
                      detail
                        ? "border-slate-200 bg-white hover:border-brand-moss hover:bg-brand-sand/30"
                        : "border-slate-200 bg-slate-100 text-slate-400"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-brand-ink lg:text-base">{maskPatientName(item.patient_name)}</p>
                          <Badge value={item.status} compact />
                        </div>
                        <p className="mt-1 break-words text-sm text-slate-500">{item.address}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="text-sm font-semibold text-brand-forest">
                          {item.status !== "paused" && detail
                            ? `第 ${getRouteDisplayOrder(orderedSchedules, detail.schedule.id) ?? item.route_order ?? "-"} 站`
                            : "未排站"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {resolveRoutePlanItemStatusLabel(item.status)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {patientDetail && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 lg:p-4">
          <div className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-[1.5rem] bg-white p-4 shadow-2xl lg:rounded-[2rem] lg:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">單人紀錄</p>
                <h2 className="mt-1 text-xl font-semibold text-brand-ink lg:text-2xl">
                  {maskPatientName(patientDetail.patient.name)} 訪視紀錄
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPatientDetailScheduleId(null)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600"
              >
                關閉
              </button>
            </div>
            <div className="mt-4 grid gap-4 xl:mt-5 xl:grid-cols-[1.1fr_0.9fr] xl:gap-6">
              <div className="space-y-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 lg:space-y-4 lg:rounded-[1.5rem] lg:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge value={patientDetail.schedule.status} compact />
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-forest ring-1 ring-slate-200">
                    第 {patientDetailDisplayOrder ?? patientDetail.schedule.route_order ?? "-"} 站
                  </span>
                  <Badge value={resolveDoctorRouteStatus(patientDetail.schedule.status)} compact />
                </div>
                <p>地址：{patientDetail.schedule.address_snapshot}</p>
                <p>定位關鍵字：{patientDetail.schedule.location_keyword_snapshot}</p>
                <p>
                  預約時段：{formatDateTimeFull(patientDetail.schedule.scheduled_start_at)} -{" "}
                  {formatTimeOnly(patientDetail.schedule.scheduled_end_at)}
                </p>
                <p>主要問題：{patientDetail.patient.primary_diagnosis}</p>
                <p>注意事項：{patientDetail.patient.precautions}</p>
                <p>本次提醒：{patientDetail.schedule.note}</p>
                <div className="grid gap-2 pt-2 sm:grid-cols-2">
                  <Link
                    to={`/doctor/patients/${patientDetail.patient.id}`}
                    className={doctorActionButtonClass()}
                  >
                    查看個案
                  </Link>
                  <a
                    href={`tel:${patientDetail.patient.phone}`}
                    className={doctorActionButtonClass()}
                  >
                    撥打電話
                  </a>
                  <Link
                    to={`/doctor/records/${patientDetail.schedule.id}`}
                    className={doctorActionButtonClass("primary")}
                  >
                    填寫紀錄
                  </Link>
                  {patientDetailUnlocked && patientDetail.record?.departure_time ? (
                    <button
                      type="button"
                      onClick={handlePatientDetailResumeNavigation}
                      className={doctorActionButtonClass()}
                    >
                      前往即時導航
                    </button>
                  ) : !patientDetailUnlocked ? (
                    <div className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-400">
                      請先完成前一站
                    </div>
                  ) : null}
                  {patientDetailUnlocked && !patientDetail.record?.departure_time ? (
                    <button
                      type="button"
                      onClick={handlePatientDetailDepart}
                      className={doctorActionButtonClass("primary")}
                    >
                      開始行程
                    </button>
                  ) : null}
                  {patientDetailUnlocked &&
                  patientDetail.record?.departure_time &&
                  !patientDetail.record?.arrival_time ? (
                    <button
                      type="button"
                      onClick={handlePatientDetailConfirmArrival}
                      className={doctorActionButtonClass("primary")}
                    >
                      已抵達
                    </button>
                  ) : null}
                  {patientDetailUnlocked &&
                  patientDetail.record?.arrival_time &&
                  !patientDetailVisitFinished ? (
                    <button
                      type="button"
                      onClick={
                        patientDetailNextSchedule
                          ? handlePatientDetailProceedToNextStop
                          : handlePatientDetailCompleteTreatment
                      }
                      className={doctorActionButtonClass("primary")}
                    >
                      {patientDetailNextSchedule ? "啟程去下一個據點" : "行程完畢"}
                    </button>
                  ) : null}
                  {patientDetailUnlocked &&
                  !patientDetailVisitFinished &&
                  patientDetail.schedule.status !== "paused" ? (
                    <button
                      type="button"
                      onClick={handlePatientDetailPauseVisit}
                      className={doctorActionButtonClass()}
                    >
                      標記暫停
                    </button>
                  ) : null}
                  {!patientDetailVisitFinished &&
                  patientDetail.record?.departure_time &&
                  !patientDetail.record?.arrival_time ? (
                    <div className="inline-flex items-center justify-center rounded-full border border-brand-sand bg-brand-sand/40 px-3 py-2 text-xs font-semibold text-brand-forest">
                      到站後請手動按「已抵達」；系統會依接近距離先記錄到站時間候選值。
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-slate-200 bg-white p-4 lg:rounded-[1.5rem] lg:p-5">
                <p className="text-sm font-semibold text-brand-ink">時間紀錄摘要</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:mt-4 lg:gap-3">
                  {patientDetailTimeSummary.map((item) => (
                    <div key={item.label} className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs text-slate-500">{item.label}</p>
                      <p className="mt-2 text-sm font-semibold text-brand-ink">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </section>
  );
}

export function DoctorDashboardPage() {
  return <DoctorLocationPage />;
}

export function DoctorLocationPage() {
  const { repositories, services, session } = useAppContext();
  const currentDoctor =
    repositories.patientRepository.getDoctors().find((doctor) => doctor.id === session.activeDoctorId) ??
    repositories.patientRepository.getDoctors()[0];
  const effectiveDoctorId = currentDoctor?.id ?? session.activeDoctorId;
  const routeSchedules = repositories.visitRepository.getDoctorRouteSchedules(
    effectiveDoctorId,
    session.activeRoutePlanId
  );
  const routeContexts = buildDoctorRouteContexts({
    repositories,
    services,
    doctorId: effectiveDoctorId,
    routePlanId: session.activeRoutePlanId
  });
  const activeRoutePlan = session.activeRoutePlanId
    ? repositories.visitRepository.getSavedRoutePlanById(session.activeRoutePlanId)
    : repositories.visitRepository.getActiveRoutePlan(effectiveDoctorId);
  const navigatingContext = routeContexts.find((entry) => {
    const unlocked = isVisitUnlocked(routeContexts.map((item) => item.schedule), entry.schedule.id, entry.record);
    return (
      unlocked &&
      Boolean(entry.record?.departure_time) &&
      !entry.record?.arrival_time &&
      !isVisitFinished(entry.schedule.status)
    );
  });
  const treatmentContext = routeContexts.find((entry) => {
    const unlocked = isVisitUnlocked(routeContexts.map((item) => item.schedule), entry.schedule.id, entry.record);
    return (
      unlocked &&
      Boolean(entry.record?.arrival_time) &&
      !entry.record?.departure_from_patient_home_time &&
      !isVisitFinished(entry.schedule.status)
    );
  });
  const readyContext = routeContexts.find((entry) => {
    const unlocked = isVisitUnlocked(routeContexts.map((item) => item.schedule), entry.schedule.id, entry.record);
    return (
      unlocked &&
      !entry.record?.departure_time &&
      !entry.record?.arrival_time &&
      !isVisitFinished(entry.schedule.status)
    );
  });
  const currentRouteContext =
    navigatingContext ?? treatmentContext ?? readyContext ?? null;
  const nextRouteContext =
    currentRouteContext
      ? findNextSequentialRouteContext(routeContexts, currentRouteContext.schedule.id)
      : findNextUnlockedRouteContext(routeContexts);
  const shouldShowHospitalReturn =
    Boolean(activeRoutePlan) &&
    routeContexts.length > 0 &&
    routeContexts.every((entry) => isVisitFinished(entry.schedule.status));
  const latestLinkedLocation = currentRouteContext
    ? repositories.visitRepository
        .getDoctorLocationLogs(effectiveDoctorId)
        .filter((log) => log.linked_visit_schedule_id === currentRouteContext.schedule.id)
        .sort(
          (left, right) =>
            new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()
        )[0]
    : undefined;
  const latestLocation = currentRouteContext?.runtime?.latestSample ?? latestLinkedLocation;
  const currentMapUrl = currentRouteContext
    ? services.maps.buildNavigationUrl({
        destinationAddress: currentRouteContext.schedule.address_snapshot,
        destinationKeyword: currentRouteContext.schedule.location_keyword_snapshot,
        destinationLatitude: currentRouteContext.schedule.home_latitude_snapshot,
        destinationLongitude: currentRouteContext.schedule.home_longitude_snapshot,
        originLatitude: latestLocation?.latitude ?? null,
        originLongitude: latestLocation?.longitude ?? null
      })
    : "https://www.google.com/maps";
  const nextMapUrl = nextRouteContext
    ? services.maps.buildNavigationUrl({
        destinationAddress: nextRouteContext.schedule.address_snapshot,
        destinationKeyword: nextRouteContext.schedule.location_keyword_snapshot,
        destinationLatitude: nextRouteContext.schedule.home_latitude_snapshot,
        destinationLongitude: nextRouteContext.schedule.home_longitude_snapshot,
        originLatitude: latestLocation?.latitude ?? null,
        originLongitude: latestLocation?.longitude ?? null
      })
    : null;
  const hospitalMapUrl =
    shouldShowHospitalReturn && activeRoutePlan
      ? services.maps.buildNavigationUrl({
          destinationAddress: activeRoutePlan.end_address,
          destinationLatitude: activeRoutePlan.end_latitude,
          destinationLongitude: activeRoutePlan.end_longitude,
          originLatitude: latestLocation?.latitude ?? null,
          originLongitude: latestLocation?.longitude ?? null
        })
      : null;
  const handleStartRouteStop = (routeContext: typeof currentRouteContext) => {
    if (!routeContext) {
      return;
    }
    const nextRecord =
      routeContext.record?.departure_time
        ? routeContext.record
        : repositories.visitRepository.startVisitTravel(routeContext.schedule.id) ?? routeContext.record;
    services.visitAutomation.startTracking({
      ...routeContext.detail,
      record: nextRecord ?? routeContext.record,
      schedule: {
        ...routeContext.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });
    openExternalNavigation(
      services.maps.buildNavigationUrl({
        destinationAddress: routeContext.schedule.address_snapshot,
        destinationKeyword: routeContext.schedule.location_keyword_snapshot,
        destinationLatitude: routeContext.schedule.home_latitude_snapshot,
        destinationLongitude: routeContext.schedule.home_longitude_snapshot,
        originLatitude: routeContext.runtime?.latestSample?.latitude ?? null,
        originLongitude: routeContext.runtime?.latestSample?.longitude ?? null
      })
    );
  };
  const handleConfirmArrival = () => {
    if (!navigatingContext) {
      return;
    }
    services.visitAutomation.confirmArrival(navigatingContext.schedule.id, "doctor");
  };
  const handleCompleteTreatment = () => {
    if (!treatmentContext) {
      return;
    }
    const returnHospitalNavigationUrl = activeRoutePlan
      ? services.maps.buildNavigationUrl({
          destinationAddress: activeRoutePlan.end_address,
          destinationLatitude: activeRoutePlan.end_latitude,
          destinationLongitude: activeRoutePlan.end_longitude,
          originLatitude:
            treatmentContext.runtime?.latestSample?.latitude ??
            treatmentContext.schedule.home_latitude_snapshot,
          originLongitude:
            treatmentContext.runtime?.latestSample?.longitude ??
            treatmentContext.schedule.home_longitude_snapshot
        })
      : null;
    services.visitAutomation.confirmDeparture(treatmentContext.schedule.id, "doctor");
    const nextContext = findNextSequentialRouteContext(routeContexts, treatmentContext.schedule.id);
    if (!nextContext) {
      if (returnHospitalNavigationUrl) {
        openExternalNavigation(returnHospitalNavigationUrl);
      }
      return;
    }
    const nextRecord =
      nextContext.record?.departure_time
        ? nextContext.record
        : repositories.visitRepository.startVisitTravel(nextContext.schedule.id) ?? nextContext.record;
    services.visitAutomation.startTracking({
      ...nextContext.detail,
      record: nextRecord ?? nextContext.record,
      schedule: {
        ...nextContext.schedule,
        status: "on_the_way",
        geofence_status: "tracking"
      }
    });
    openExternalNavigation(
      services.maps.buildNavigationUrl({
        destinationAddress: nextContext.schedule.address_snapshot,
        destinationKeyword: nextContext.schedule.location_keyword_snapshot,
        destinationLatitude: nextContext.schedule.home_latitude_snapshot,
        destinationLongitude: nextContext.schedule.home_longitude_snapshot,
        originLatitude:
          treatmentContext.runtime?.latestSample?.latitude ??
          treatmentContext.schedule.home_latitude_snapshot,
        originLongitude:
          treatmentContext.runtime?.latestSample?.longitude ??
          treatmentContext.schedule.home_longitude_snapshot
      })
    );
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <Panel title="即時導航">
        <div className="space-y-4 lg:space-y-6">
          <DoctorRouteSelector embedded />
          {navigatingContext ? (
            <section className="overflow-hidden rounded-[1.15rem] border border-brand-moss/30 bg-gradient-to-br from-brand-forest via-brand-forest to-brand-moss text-white lg:rounded-[1.75rem]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 lg:gap-3 lg:px-5 lg:py-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.2em] text-white/70">導航進行中</p>
                  <h3 className="mt-1 text-base font-semibold leading-tight lg:text-xl">前往 {maskPatientName(navigatingContext.detail.patient.name)} 的停留點</h3>
                </div>
                <div className="rounded-xl bg-white/10 px-3 py-2 text-xs lg:rounded-2xl lg:px-4 lg:py-3 lg:text-sm">
                  第 {getRouteDisplayOrder(routeSchedules, navigatingContext.schedule.id) ?? navigatingContext.schedule.route_order} 站 / 下一位 {nextRouteContext ? maskPatientName(nextRouteContext.detail.patient.name) : "返院"}
                </div>
              </div>
              <div className="space-y-3 p-3 xl:p-5">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => openExternalNavigation(currentMapUrl)}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-brand-coral px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    用 Google 地圖開啟本站導航
                  </button>
                  <Link
                    to={`/doctor/schedules/${navigatingContext.schedule.id}`}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                  >
                    查看本站詳情
                  </Link>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {nextMapUrl ? (
                    <button
                      type="button"
                      onClick={() => openExternalNavigation(nextMapUrl)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                    >
                      開啟下一站導航：{nextRouteContext ? maskPatientName(nextRouteContext.detail.patient.name) : ""}
                    </button>
                  ) : hospitalMapUrl ? (
                    <button
                      type="button"
                      onClick={() => openExternalNavigation(hospitalMapUrl)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
                    >
                      開啟返院導航
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={handleConfirmArrival}
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink transition hover:bg-brand-sand"
                >
                  已抵達，開始治療
                </button>
              </div>
            </section>
          ) : null}

          {!navigatingContext && treatmentContext ? (
            <section className="rounded-[1.15rem] border border-emerald-200 bg-emerald-50 p-3 lg:rounded-[1.75rem] lg:p-6">
              <p className="text-sm font-semibold text-emerald-800">治療進行中</p>
              <h3 className="mt-1.5 text-lg font-bold leading-tight text-brand-ink lg:mt-2 lg:text-2xl">
                {maskPatientName(treatmentContext.detail.patient.name)} 已到站，完成治療後即可接續下一段
              </h3>
              <p className="mt-1.5 text-sm text-slate-600">
                {nextRouteContext
                  ? `按下後會直接開啟下一家 ${maskPatientName(nextRouteContext.detail.patient.name)} 的 Google 地圖導航。`
                  : "按下後可接續最後一段返院導航。"}
              </p>
              <button
                type="button"
                onClick={handleCompleteTreatment}
                className="mt-3 inline-flex min-h-[52px] w-full items-center justify-center rounded-[1.1rem] bg-brand-forest px-4 py-3 text-base font-bold text-white transition hover:opacity-90 lg:mt-5 lg:min-h-[88px] lg:rounded-[1.5rem] lg:px-6 lg:py-5 lg:text-xl"
              >
                {nextRouteContext ? "完成治療，前往下一家" : "完成治療，返回醫院"}
              </button>
            </section>
          ) : null}

          {!navigatingContext && !treatmentContext && readyContext ? (
            <section className="rounded-[1.15rem] border border-slate-200 bg-white p-3 lg:rounded-[1.75rem] lg:p-6">
              <p className="text-sm font-semibold text-brand-moss">待出發</p>
              <h3 className="mt-1.5 text-lg font-bold leading-tight text-brand-ink lg:mt-2 lg:text-2xl">
                即將前往第 {getRouteDisplayOrder(routeSchedules, readyContext.schedule.id) ?? readyContext.schedule.route_order} 站 {maskPatientName(readyContext.detail.patient.name)}
              </h3>
              <p className="mt-1.5 text-sm text-slate-600">
                主畫面會固定保留這個即時導航區塊，請直接從這裡開始出發。
              </p>
              <button
                type="button"
                onClick={() => handleStartRouteStop(readyContext)}
                className="mt-3 inline-flex min-h-[52px] w-full items-center justify-center rounded-[1.1rem] bg-brand-coral px-4 py-3 text-base font-bold text-white transition hover:opacity-90 lg:mt-5 lg:min-h-[88px] lg:rounded-[1.5rem] lg:px-6 lg:py-5 lg:text-xl"
              >
                開始出發
              </button>
            </section>
          ) : null}

          {!currentRouteContext && shouldShowHospitalReturn && activeRoutePlan ? (
            <section className="overflow-hidden rounded-[1.35rem] border border-brand-moss/30 bg-gradient-to-br from-slate-900 via-slate-800 to-brand-ink text-white lg:rounded-[1.75rem]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 lg:px-5 lg:py-4">
                <div>
                  <p className="text-xs font-semibold tracking-[0.2em] text-white/70">返院導航</p>
                  <h3 className="mt-1 text-lg font-semibold lg:text-xl">所有患者已完成，最後一站返回醫院</h3>
                  <p className="mt-1 text-sm text-white/80">
                    今日患者都已結束，接下來可手動開啟最後一段返院導航。
                  </p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
                  終點 {activeRoutePlan.end_address}
                </div>
              </div>
              <div className="grid gap-3 p-4 xl:grid-cols-[minmax(0,1.25fr)_300px] xl:gap-4 xl:p-5">
                <div className="space-y-4">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/10 px-4 py-4 text-sm text-white/90">
                    返院階段不再顯示內嵌地圖，請直接用按鍵開啟返院導航。
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (hospitalMapUrl) {
                        openExternalNavigation(hospitalMapUrl);
                      }
                    }}
                    className="inline-flex w-full items-center justify-center rounded-full bg-brand-coral px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    用 Google 地圖開啟返院導航
                  </button>
                  <p className="text-xs text-white/70">
                    返院改由外接 Google 地圖；是否結束返院由醫師自行操作。
                  </p>
                </div>
                <div className="space-y-3 rounded-[1.5rem] border border-white/10 bg-white/10 p-4">
                  <div>
                    <p className="text-xs text-white/70">返院目的地</p>
                    <p className="mt-1 text-sm font-semibold">{activeRoutePlan.end_address}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/70">今日總結</p>
                    <p className="mt-1 text-sm text-white/90">
                      共完成 {routeContexts.length} 站患者服務，返院後即可整理回院病歷與後續紀錄。
                    </p>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {!currentRouteContext && !shouldShowHospitalReturn ? (
            <section className="rounded-[1.75rem] border border-slate-200 bg-white p-6 text-sm text-slate-600">
              目前沒有可即時導航的路線。請先確認管理端已實行路線，再從這頁開啟 Google 地圖導航。
            </section>
          ) : null}
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
        title={`${maskPatientName(detail.patient.name)} 今日訪視詳情`}
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
