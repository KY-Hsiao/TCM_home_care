import { differenceInSeconds } from "date-fns";
import type { VisitSchedule } from "../../domain/models";
import type { VisitDetail } from "../../domain/repository";
import type {
  GeolocationProviderAdapter,
  GeolocationProviderEvent,
  GeolocationScenario,
  ServicesContextDeps,
  TrackingRuntime,
  VisitAutomationService
} from "../types";
import { geolocationScenarios } from "../geolocation/scenarios";

function haversineDistanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number }
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(right.latitude - left.latitude);
  const dLon = toRadians(right.longitude - left.longitude);
  const lat1 = toRadians(left.latitude);
  const lat2 = toRadians(right.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function buildRuntime(detail: VisitDetail): TrackingRuntime {
  return {
    scheduleId: detail.schedule.id,
    doctorId: detail.doctor.id,
    patientId: detail.patient.id,
    patientName: detail.patient.name,
    targetPatientId: detail.patient.id,
    routeOrder: detail.schedule.route_order,
    scenarioId: "normal_arrival_complete",
    watchStatus: "idle",
    geofenceStatus: detail.schedule.geofence_status,
    latestSample: null,
    latestDistanceMeters: null,
    latestAccuracy: null,
    permissionState: "granted",
    fallbackMessage: null,
    startedAt: null,
    completedAt: null,
    lastUpdatedAt: null,
    proximityTriggeredAt: null,
    arrivalConfirmationPending: false,
    stopReason: null,
    googleShareFallbackActive: Boolean(detail.doctor.google_location_share_enabled),
    doctorFeedbackCode: detail.schedule.last_feedback_code,
    familyFollowUpStatus: detail.record?.family_followup_status ?? "not_needed",
    eventLog: [],
    samplesProcessed: 0,
    insideCandidateCount: 0,
    insideCandidateStartedAt: null,
    outsideCandidateCount: 0,
    outsideCandidateStartedAt: null
  };
}

function appendEvent(runtime: TrackingRuntime, message: string) {
  runtime.eventLog = [message, ...runtime.eventLog].slice(0, 10);
}

export class MockVisitAutomationService implements VisitAutomationService {
  private runtimes: Record<string, TrackingRuntime> = {};

  private listeners = new Set<() => void>();

  constructor(
    private readonly deps: ServicesContextDeps,
    private readonly geolocationProvider: GeolocationProviderAdapter
  ) {
    this.geolocationProvider.subscribe((event) => {
      this.handleProviderEvent(event);
    });
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private getRuntime(detail: VisitDetail): TrackingRuntime {
    if (!this.runtimes[detail.schedule.id]) {
      this.runtimes[detail.schedule.id] = buildRuntime(detail);
    }
    return this.runtimes[detail.schedule.id];
  }

  private updateSchedule(schedule: VisitSchedule) {
    this.deps.getRepositories().visitRepository.upsertSchedule(schedule);
  }

  private noteDisabledNotification(
    _detail: VisitDetail,
    runtime: TrackingRuntime,
    type:
      | "visit_today"
      | "visit_completed"
      | "doctor_departure_check"
      | "doctor_arrival_feedback"
      | "doctor_emergency_alert"
      | "family_followup_normal"
      | "family_followup_absent"
      | "family_followup_admin"
      | "family_followup_urgent"
  ) {
    const isDoctorTask = type.startsWith("doctor_");
    appendEvent(
      runtime,
      isDoctorTask
        ? "通知任務功能已停用，本次不再自動建立醫師通知。"
        : "家屬通知功能已停用，略過自動追蹤訊息。"
    );
  }

  private autoConfirmArrival(
    detail: VisitDetail,
    runtime: TrackingRuntime,
    recordedAt: string
  ) {
    const nextRecord = this.deps
      .getRepositories()
      .visitRepository.confirmArrival(detail.schedule.id, "system", recordedAt);
    runtime.geofenceStatus = "arrived";
    runtime.arrivalConfirmationPending = false;
    appendEvent(runtime, `已自動判定抵達：${recordedAt}`);
    this.noteDisabledNotification(
      {
        ...detail,
        record: nextRecord ?? detail.record,
        schedule: {
          ...detail.schedule,
          status: "arrived",
          geofence_status: "arrived",
          arrival_confirmed_by: "system"
        }
      },
      runtime,
      "doctor_arrival_feedback"
    );
  }

  private autoConfirmCompleted(
    detail: VisitDetail,
    runtime: TrackingRuntime,
    recordedAt: string
  ) {
    if (!detail.record?.arrival_time) {
      return;
    }

    const nextRecord = this.deps
      .getRepositories()
      .visitRepository.confirmDeparture(detail.schedule.id, "system", recordedAt);
    runtime.watchStatus = "completed";
    runtime.geofenceStatus = "completed";
    runtime.completedAt = recordedAt;
    runtime.stopReason = "visit_completed";
    runtime.familyFollowUpStatus = nextRecord?.family_followup_status ?? runtime.familyFollowUpStatus;
    appendEvent(runtime, `已自動判定離開完成：${recordedAt}`);
    appendEvent(runtime, "家屬追蹤訊息功能已停用，本次不自動建立通知。");
    this.geolocationProvider.stopWatch(detail.schedule.id);
  }

  private handleProviderEvent(event: GeolocationProviderEvent) {
    const detail = this.deps
      .getRepositories()
      .visitRepository
      .getScheduleDetail(event.scheduleId);
    if (!detail) {
      return;
    }
    const runtime = this.getRuntime(detail);
    runtime.lastUpdatedAt = new Date().toISOString();

    if (event.type === "permission_denied") {
      runtime.watchStatus = "error";
      runtime.permissionState = "denied";
      runtime.geofenceStatus = "permission_denied";
      runtime.fallbackMessage = event.message;
      this.updateSchedule({
        ...detail.schedule,
        geofence_status: "permission_denied"
      });
      appendEvent(runtime, event.message);
      this.notify();
      return;
    }

    if (event.type === "completed") {
      if (runtime.watchStatus !== "completed") {
        runtime.watchStatus = "paused";
      }
      this.notify();
      return;
    }

    const sample = event.sample;
    runtime.latestSample = sample;
    runtime.latestAccuracy = sample.accuracy;
    runtime.samplesProcessed += 1;

    if (sample.kind === "signal_lost") {
      runtime.watchStatus = "error";
      runtime.geofenceStatus = "signal_lost";
      runtime.fallbackMessage = "定位中斷，請確認網路與權限。";
      this.updateSchedule({
        ...detail.schedule,
        geofence_status: "signal_lost"
      });
      appendEvent(runtime, "定位中斷，尚未自動完成離開判定。");
      this.notify();
      return;
    }

    this.deps.getRepositories().visitRepository.appendDoctorLocationLog({
      id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      doctor_id: detail.doctor.id,
      recorded_at: sample.recorded_at,
      latitude: sample.latitude,
      longitude: sample.longitude,
      accuracy: sample.accuracy,
      source: sample.source,
      linked_visit_schedule_id: detail.schedule.id
    });

    const homeLatitude = detail.schedule.home_latitude_snapshot ?? detail.patient.home_latitude;
    const homeLongitude =
      detail.schedule.home_longitude_snapshot ?? detail.patient.home_longitude;

    if (homeLatitude === null || homeLongitude === null) {
      runtime.watchStatus = "error";
      runtime.geofenceStatus = "coordinate_missing";
      runtime.fallbackMessage = "住家尚未有精確座標，請先使用地址與地圖連結。";
      this.updateSchedule({
        ...detail.schedule,
        geofence_status: "coordinate_missing"
      });
      appendEvent(runtime, "因缺少住家座標，無法自動判定抵達 / 離開。");
      this.notify();
      return;
    }

    const distanceMeters = haversineDistanceMeters(
      { latitude: sample.latitude, longitude: sample.longitude },
      { latitude: homeLatitude, longitude: homeLongitude }
    );
    runtime.latestDistanceMeters = Math.round(distanceMeters);

    if (sample.accuracy > 60) {
      runtime.geofenceStatus = "low_accuracy";
      runtime.fallbackMessage = "定位精度太差，暫不進行到離判定。";
      runtime.insideCandidateCount = 0;
      runtime.outsideCandidateCount = 0;
      this.updateSchedule({
        ...detail.schedule,
        geofence_status: "low_accuracy"
      });
      appendEvent(runtime, `定位精度過差：${sample.accuracy}m`);
      this.notify();
      return;
    }

    runtime.fallbackMessage = null;
    const insideRadius = distanceMeters <= detail.schedule.arrival_radius_meters;
    const effectiveSchedule = this.deps
      .getRepositories()
      .visitRepository
      .getScheduleDetail(event.scheduleId)?.schedule;
    const effectiveRecord = this.deps
      .getRepositories()
      .visitRepository
      .getVisitRecordByScheduleId(event.scheduleId);
    const isArrived = Boolean(effectiveRecord?.arrival_time);

    if (!isArrived) {
      if (insideRadius) {
        runtime.geofenceStatus = "inside_candidate";
        runtime.insideCandidateCount += 1;
        runtime.insideCandidateStartedAt ??= sample.recorded_at;
        const insideCandidateStartedAt = runtime.insideCandidateStartedAt ?? sample.recorded_at;
        const elapsedSeconds = differenceInSeconds(
          new Date(sample.recorded_at),
          new Date(insideCandidateStartedAt)
        );
        this.updateSchedule({
          ...(effectiveSchedule ?? detail.schedule),
          geofence_status: "inside_candidate"
        });
        if (
          runtime.insideCandidateCount >= 3 &&
          elapsedSeconds >= 15 &&
          !runtime.arrivalConfirmationPending
        ) {
          runtime.proximityTriggeredAt = sample.recorded_at;
          runtime.arrivalConfirmationPending = true;
          runtime.geofenceStatus = "proximity_pending";
          this.updateSchedule({
            ...(effectiveSchedule ?? detail.schedule),
            status: "proximity_pending",
            geofence_status: "proximity_pending"
          });
          appendEvent(runtime, `已逼近目的地，等待醫師 / 行政確認：${sample.recorded_at}`);
          this.noteDisabledNotification(
            {
              ...detail,
              record: effectiveRecord,
              schedule: {
                ...(effectiveSchedule ?? detail.schedule),
                status: "proximity_pending",
                geofence_status: "proximity_pending"
              }
            },
            runtime,
            "doctor_arrival_feedback"
          );
        }
      } else {
        runtime.insideCandidateCount = 0;
        runtime.insideCandidateStartedAt = null;
        runtime.geofenceStatus = "tracking";
        this.updateSchedule({
          ...(effectiveSchedule ?? detail.schedule),
          geofence_status: "tracking"
        });
      }
      this.notify();
      return;
    }

    if (insideRadius) {
      runtime.outsideCandidateCount = 0;
      runtime.outsideCandidateStartedAt = null;
      runtime.geofenceStatus = "arrived";
      this.updateSchedule({
        ...(effectiveSchedule ?? detail.schedule),
        geofence_status: "arrived"
      });
      this.notify();
      return;
    }

    runtime.geofenceStatus = "outside_candidate";
    runtime.outsideCandidateCount += 1;
    runtime.outsideCandidateStartedAt ??= sample.recorded_at;
    const outsideCandidateStartedAt = runtime.outsideCandidateStartedAt ?? sample.recorded_at;
    const elapsedSeconds = differenceInSeconds(
      new Date(sample.recorded_at),
      new Date(outsideCandidateStartedAt)
    );
    this.updateSchedule({
      ...(effectiveSchedule ?? detail.schedule),
      geofence_status: "outside_candidate"
    });
    if (runtime.outsideCandidateCount >= 3 && elapsedSeconds >= 60) {
      this.autoConfirmCompleted(
        {
          ...detail,
          record: effectiveRecord
        },
        runtime,
        sample.recorded_at
      );
    }
    this.notify();
  }

  getScenarios(): GeolocationScenario[] {
    return geolocationScenarios;
  }

  getTrackingState(scheduleId: string) {
    return this.runtimes[scheduleId];
  }

  getTrackingStates() {
    return this.runtimes;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  configureTracking(
    scheduleId: string,
    input: Partial<Pick<TrackingRuntime, "scenarioId">>
  ) {
    const detail = this.deps.getRepositories().visitRepository.getScheduleDetail(scheduleId);
    if (!detail) {
      return;
    }
    const runtime = this.getRuntime(detail);
    if (input.scenarioId) {
      runtime.scenarioId = input.scenarioId;
    }
    this.notify();
  }

  startTracking(detail: VisitDetail) {
    const runtime = this.getRuntime(detail);
    runtime.watchStatus = "running";
    runtime.startedAt = detail.record?.departure_time ?? new Date().toISOString();
    runtime.routeOrder = detail.schedule.route_order;
    runtime.googleShareFallbackActive = Boolean(detail.doctor.google_location_share_enabled);
    runtime.permissionState = this.geolocationProvider.getPermissionState(runtime.scenarioId);
    runtime.geofenceStatus =
      runtime.scenarioId === "coordinate_missing" ||
      detail.schedule.home_latitude_snapshot === null ||
      detail.schedule.home_longitude_snapshot === null
        ? "coordinate_missing"
        : "tracking";
    runtime.fallbackMessage =
      runtime.geofenceStatus === "coordinate_missing"
        ? "住家尚未有精確座標，請先使用地址與地圖連結。"
        : null;
    runtime.eventLog = ["開始模擬定位移動", ...runtime.eventLog].slice(0, 10);
    this.updateSchedule({
      ...detail.schedule,
      geofence_status: runtime.geofenceStatus
    });
    if (runtime.geofenceStatus === "coordinate_missing") {
      appendEvent(runtime, "因座標缺失情境，改以地址與地圖連結作為 fallback。");
      this.notify();
      return;
    }
    this.geolocationProvider.startWatch({
      watchId: detail.schedule.id,
      scheduleId: detail.schedule.id,
      doctorId: detail.doctor.id,
      patient: detail.patient,
      schedule: detail.schedule,
      scenarioId: runtime.scenarioId
    });
    this.notify();
  }

  pauseTracking(scheduleId: string) {
    const runtime = this.runtimes[scheduleId];
    if (!runtime) {
      return;
    }
    runtime.watchStatus = "paused";
    this.geolocationProvider.pauseWatch(scheduleId);
    appendEvent(runtime, "已暫停模擬定位。");
    this.notify();
  }

  resumeTracking(detail: VisitDetail) {
    const runtime = this.getRuntime(detail);
    runtime.watchStatus = "running";
    this.geolocationProvider.resumeWatch(detail.schedule.id);
    appendEvent(runtime, "已恢復模擬定位。");
    this.notify();
  }

  confirmArrival(scheduleId: string, confirmedBy: "doctor" | "admin" | "system") {
    const detail = this.deps.getRepositories().visitRepository.getScheduleDetail(scheduleId);
    if (!detail) {
      return;
    }
    const runtime = this.getRuntime(detail);
    const nextRecord = this.deps
      .getRepositories()
      .visitRepository.confirmArrival(scheduleId, confirmedBy);
    runtime.arrivalConfirmationPending = false;
    runtime.geofenceStatus = "arrived";
    appendEvent(runtime, `已由 ${confirmedBy} 確認抵達。`);
    this.notify();
    if (nextRecord?.visit_feedback_code === "normal") {
      runtime.doctorFeedbackCode = "normal";
    }
  }

  recordDoctorFeedback(scheduleId: string, feedbackCode: "normal" | "absent" | "admin_followup" | "urgent") {
    const detail = this.deps.getRepositories().visitRepository.getScheduleDetail(scheduleId);
    if (!detail) {
      return;
    }
    const runtime = this.getRuntime(detail);
    if (!detail.record?.arrival_time) {
      this.deps.getRepositories().visitRepository.confirmArrival(scheduleId, "doctor");
    }
    this.deps.getRepositories().visitRepository.recordVisitFeedback(scheduleId, feedbackCode);
    runtime.doctorFeedbackCode = feedbackCode;
    runtime.familyFollowUpStatus = feedbackCode === "normal" ? "not_needed" : "draft_ready";
    runtime.arrivalConfirmationPending = false;
    appendEvent(runtime, `醫師回覆：${feedbackCode}`);
    if (feedbackCode === "urgent") {
      this.noteDisabledNotification(detail, runtime, "doctor_emergency_alert");
    }
    this.notify();
  }

  confirmDeparture(scheduleId: string, confirmedBy: "doctor" | "admin" | "system") {
    const detail = this.deps.getRepositories().visitRepository.getScheduleDetail(scheduleId);
    if (!detail) {
      return;
    }
    const runtime = this.getRuntime(detail);
    const nextRecord = this.deps
      .getRepositories()
      .visitRepository.confirmDeparture(scheduleId, confirmedBy);
    runtime.watchStatus = "completed";
    runtime.geofenceStatus = "completed";
    runtime.familyFollowUpStatus = nextRecord?.family_followup_status ?? runtime.familyFollowUpStatus;
    runtime.stopReason = "manual_confirmed";
    this.geolocationProvider.stopWatch(scheduleId);
    appendEvent(runtime, `已由 ${confirmedBy} 確認離開。`);
    this.notify();
  }

  resetTracking(scheduleId: string) {
    this.geolocationProvider.stopWatch(scheduleId);
    delete this.runtimes[scheduleId];
    const detail = this.deps.getRepositories().visitRepository.getScheduleDetail(scheduleId);
    if (detail) {
      this.updateSchedule({
        ...detail.schedule,
        geofence_status:
          detail.schedule.home_latitude_snapshot === null ||
          detail.schedule.home_longitude_snapshot === null
            ? "coordinate_missing"
            : "idle"
      });
    }
    this.notify();
  }

  resetAll() {
    Object.keys(this.runtimes).forEach((scheduleId) => {
      this.geolocationProvider.stopWatch(scheduleId);
    });
    this.runtimes = {};
    this.notify();
  }

  getDisplayStatus(schedule: VisitSchedule, arrivalTime: string | null, departureTime: string | null) {
    if (departureTime) {
      return "completed";
    }
    if (arrivalTime) {
      return "in_treatment";
    }
    return schedule.status;
  }
}
