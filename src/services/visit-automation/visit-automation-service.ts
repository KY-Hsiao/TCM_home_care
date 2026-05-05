import { differenceInSeconds } from "date-fns";
import type { VisitSchedule } from "../../domain/models";
import type { VisitDetail } from "../../domain/repository";
import type {
  DoctorLocationSyncService,
  GeolocationProviderAdapter,
  GeolocationProviderEvent,
  GeolocationScenario,
  ServicesContextDeps,
  TrackingRuntime,
  VisitAutomationService
} from "../types";
import { geolocationScenarios } from "../geolocation/scenarios";
import { loadAdminApiTokenSettings } from "../../shared/utils/admin-api-tokens";

type ManagedFamilyLineContact = {
  id: string;
  displayName: string;
  lineUserId: string;
  linkedPatientIds: string[];
  note: string;
  source: "webhook" | "official_friend";
  updatedAt: string;
};

const MANAGED_CONTACTS_STORAGE_KEY = "tcm-family-line-managed-contacts";
const SETTINGS_STORAGE_KEY = "tcm-family-line-settings";

function loadArrayStorage<T>(key: string): T[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function isDoctorArrivalReminderEnabled() {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return true;
    }
    const parsed = JSON.parse(raw) as { doctorArrivalReminder?: boolean };
    return parsed.doctorArrivalReminder !== false;
  } catch {
    return true;
  }
}

function isAfterReturnCareEnabled() {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return true;
    }
    const parsed = JSON.parse(raw) as { afterReturnCare?: boolean };
    return parsed.afterReturnCare !== false;
  } catch {
    return true;
  }
}

function loadManagedLineContacts() {
  return loadArrayStorage<ManagedFamilyLineContact>(MANAGED_CONTACTS_STORAGE_KEY).filter(
    (contact) =>
      (contact.source === "webhook" || contact.source === "official_friend") &&
      typeof contact.lineUserId === "string" &&
      Array.isArray(contact.linkedPatientIds)
  );
}

function normalizeManagedLineContacts(
  contacts: Array<Partial<ManagedFamilyLineContact> & { userId?: string }>
): ManagedFamilyLineContact[] {
  return contacts
    .map((contact) => {
      const lineUserId = String(contact.lineUserId ?? contact.userId ?? "").trim();
      const source: ManagedFamilyLineContact["source"] =
        contact.source === "official_friend" ? "official_friend" : "webhook";
      return {
        id: String(contact.id ?? `line-contact-${lineUserId}`),
        displayName: String(contact.displayName ?? lineUserId),
        lineUserId,
        linkedPatientIds: Array.isArray(contact.linkedPatientIds)
          ? contact.linkedPatientIds.map((patientId) => String(patientId ?? "").trim()).filter(Boolean)
          : [],
        note: String(contact.note ?? ""),
        source,
        updatedAt: String(contact.updatedAt ?? new Date().toISOString())
      };
    })
    .filter((contact) => contact.lineUserId);
}

function saveManagedLineContacts(contacts: ManagedFamilyLineContact[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(MANAGED_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

function resolveScheduleServiceTimeSlot(schedule: VisitSchedule): "上午" | "下午" {
  if (schedule.service_time_slot.includes("上午")) {
    return "上午";
  }
  if (schedule.service_time_slot.includes("下午")) {
    return "下午";
  }
  return new Date(schedule.scheduled_start_at).getHours() < 13 ? "上午" : "下午";
}

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

  private arrivalReminderInFlight = new Set<string>();

  private afterReturnCareInFlight = new Set<string>();

  private afterReturnCareSentRouteKeys = new Set<string>();

  constructor(
    private readonly deps: ServicesContextDeps,
    private readonly geolocationProvider: GeolocationProviderAdapter,
    private readonly doctorLocationSync: DoctorLocationSyncService
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

  private async loadLineContactsForPatient(patientId: string) {
    const localContacts = loadManagedLineContacts();
    const localMatchedContacts = localContacts.filter(
      (contact) => contact.linkedPatientIds.includes(patientId) && contact.lineUserId.trim()
    );
    if (localMatchedContacts.length > 0 || typeof fetch !== "function") {
      return localMatchedContacts;
    }

    try {
      const response = await fetch("/api/admin/family-line/contacts", { cache: "no-store" });
      if (!response.ok) {
        return localMatchedContacts;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        contacts?: Array<Partial<ManagedFamilyLineContact> & { userId?: string }>;
        friends?: Array<Partial<ManagedFamilyLineContact> & { userId?: string }>;
      };
      const contacts = Array.isArray(payload.contacts)
        ? payload.contacts
        : Array.isArray(payload.friends)
          ? payload.friends
          : [];
      const normalizedContacts = normalizeManagedLineContacts(contacts);
      saveManagedLineContacts(normalizedContacts);
      return normalizedContacts.filter(
        (contact) => contact.linkedPatientIds.includes(patientId) && contact.lineUserId.trim()
      );
    } catch {
      return localMatchedContacts;
    }
  }

  private resolveNextStopDetail(currentSchedule: VisitSchedule): VisitDetail | null {
    const currentDate = currentSchedule.scheduled_start_at.slice(0, 10);
    const currentSlot = resolveScheduleServiceTimeSlot(currentSchedule);
    const currentRouteOrder = currentSchedule.route_order ?? Number.MAX_SAFE_INTEGER;
    const sameRouteSchedules = this.deps
      .getRepositories()
      .visitRepository.getSchedules({
        doctorId: currentSchedule.assigned_doctor_id,
        dateFrom: `${currentDate}T00:00:00`,
        dateTo: `${currentDate}T23:59:59`
      })
      .filter((schedule) => {
        if (schedule.id === currentSchedule.id) {
          return false;
        }
        if (resolveScheduleServiceTimeSlot(schedule) !== currentSlot) {
          return false;
        }
        if (currentSchedule.route_group_id && schedule.route_group_id !== currentSchedule.route_group_id) {
          return false;
        }
        if (["cancelled", "paused", "completed", "followup_pending"].includes(schedule.status)) {
          return false;
        }
        return (schedule.route_order ?? Number.MAX_SAFE_INTEGER) > currentRouteOrder;
      })
      .sort((left, right) => {
        const orderDiff =
          (left.route_order ?? Number.MAX_SAFE_INTEGER) -
          (right.route_order ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime();
      });

    const nextSchedule = sameRouteSchedules[0];
    return nextSchedule
      ? this.deps.getRepositories().visitRepository.getScheduleDetail(nextSchedule.id) ?? null
      : null;
  }

  private async sendArrivalReminderForNextStop(
    currentDetail: VisitDetail,
    runtime: TrackingRuntime,
    triggeredAt: string
  ) {
    if (!isDoctorArrivalReminderEnabled()) {
      appendEvent(runtime, "LINE 抵達前提醒已停用，略過下一站家屬通知。");
      this.notify();
      return;
    }
    if (typeof fetch !== "function") {
      appendEvent(runtime, "目前環境無法呼叫 LINE 發送端點，略過下一站家屬通知。");
      this.notify();
      return;
    }

    const nextDetail = this.resolveNextStopDetail(currentDetail.schedule);
    if (!nextDetail) {
      appendEvent(runtime, "目前路線沒有下一站，未發送抵達前提醒。");
      this.notify();
      return;
    }
    if (this.arrivalReminderInFlight.has(nextDetail.schedule.id)) {
      return;
    }

    const contacts = await this.loadLineContactsForPatient(nextDetail.patient.id);
    if (contacts.length === 0) {
      appendEvent(runtime, `下一站 ${nextDetail.patient.name} 尚未關聯 LINE 家屬，無法發送抵達前提醒。`);
      this.notify();
      return;
    }

    this.arrivalReminderInFlight.add(nextDetail.schedule.id);
    const subject = "醫師即將抵達提醒";
    const content = `您好，${currentDetail.doctor.name} 已完成前一站，接下來會前往 ${nextDetail.patient.name} 的住處。請協助家中環境與個案狀態準備；若臨時不便，請盡快回覆行政人員。`;
    const recipients = contacts.map((contact) => ({
      caregiverId: contact.id,
      caregiverName: contact.displayName,
      patientId: nextDetail.patient.id,
      patientName: nextDetail.patient.name,
      doctorId: currentDetail.doctor.id,
      doctorName: currentDetail.doctor.name,
      lineUserId: contact.lineUserId
    }));
    const apiTokens = loadAdminApiTokenSettings();

    try {
      const response = await fetch("/api/admin/family-line/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          content,
          recipients,
          lineChannelAccessToken: apiTokens.lineChannelAccessToken
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        sentCount?: number;
        error?: string;
      };
      if (!response.ok) {
        this.arrivalReminderInFlight.delete(nextDetail.schedule.id);
        appendEvent(
          runtime,
          `下一站 ${nextDetail.patient.name} 抵達前 LINE 發送失敗：${payload.error ?? "LINE 發送端點回傳錯誤"}`
        );
        this.notify();
        return;
      }

      const now = new Date().toISOString();
      contacts.forEach((contact) => {
        this.deps.getRepositories().contactRepository.createContactLog({
          id: `line-arrival-${nextDetail.schedule.id}-${contact.id}-${Date.now()}`,
          patient_id: nextDetail.patient.id,
          visit_schedule_id: nextDetail.schedule.id,
          caregiver_id: null,
          doctor_id: currentDetail.doctor.id,
          admin_user_id: null,
          channel: "line",
          subject,
          content,
          outcome: "前一站離開後自動發送抵達前提醒",
          contacted_at: triggeredAt,
          created_at: now,
          updated_at: now
        });
      });
      appendEvent(
        runtime,
        `已在離開前一站後，發送下一站 ${nextDetail.patient.name} 抵達前 LINE 提醒給 ${payload.sentCount ?? contacts.length} 位家屬。`
      );
      this.notify();
    } catch {
      this.arrivalReminderInFlight.delete(nextDetail.schedule.id);
      appendEvent(runtime, "無法連線到 LINE 發送端點，下一站抵達前提醒未送出。");
      this.notify();
    }
  }

  private buildAfterReturnCareRouteKey(schedule: VisitSchedule) {
    const routeDate = schedule.scheduled_start_at.slice(0, 10);
    const routeSlot = resolveScheduleServiceTimeSlot(schedule);
    return schedule.route_group_id
      ? `${schedule.route_group_id}-${routeSlot}`
      : `${schedule.assigned_doctor_id}-${routeDate}-${routeSlot}`;
  }

  private resolveCompletedRouteDetails(referenceSchedule: VisitSchedule) {
    const routeDate = referenceSchedule.scheduled_start_at.slice(0, 10);
    const routeSlot = resolveScheduleServiceTimeSlot(referenceSchedule);
    return this.deps
      .getRepositories()
      .visitRepository.getSchedules({
        doctorId: referenceSchedule.assigned_doctor_id,
        dateFrom: `${routeDate}T00:00:00`,
        dateTo: `${routeDate}T23:59:59`
      })
      .filter((schedule) => {
        if (schedule.visit_type === "回院病歷") {
          return false;
        }
        if (["cancelled", "paused"].includes(schedule.status)) {
          return false;
        }
        if (resolveScheduleServiceTimeSlot(schedule) !== routeSlot) {
          return false;
        }
        if (
          referenceSchedule.route_group_id &&
          schedule.route_group_id !== referenceSchedule.route_group_id
        ) {
          return false;
        }
        const record = this.deps
          .getRepositories()
          .visitRepository.getVisitRecordByScheduleId(schedule.id);
        return (
          Boolean(record?.departure_from_patient_home_time) ||
          ["completed", "followup_pending"].includes(schedule.status)
        );
      })
      .sort((left, right) => {
        const orderDiff =
          (left.route_order ?? Number.MAX_SAFE_INTEGER) -
          (right.route_order ?? Number.MAX_SAFE_INTEGER);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return (
          new Date(left.scheduled_start_at).getTime() -
          new Date(right.scheduled_start_at).getTime()
        );
      })
      .map((schedule) => this.deps.getRepositories().visitRepository.getScheduleDetail(schedule.id))
      .filter((detail): detail is VisitDetail => Boolean(detail));
  }

  private async sendAfterReturnCareForRoute(
    referenceDetail: VisitDetail,
    runtime: TrackingRuntime,
    triggeredAt: string
  ) {
    if (!isAfterReturnCareEnabled()) {
      appendEvent(runtime, "LINE 結束後關心已停用，略過回程終點家屬通知。");
      this.notify();
      return;
    }
    if (typeof fetch !== "function") {
      appendEvent(runtime, "目前環境無法呼叫 LINE 發送端點，略過結束後關心。");
      this.notify();
      return;
    }

    const routeKey = this.buildAfterReturnCareRouteKey(referenceDetail.schedule);
    if (
      this.afterReturnCareInFlight.has(routeKey) ||
      this.afterReturnCareSentRouteKeys.has(routeKey)
    ) {
      return;
    }
    this.afterReturnCareInFlight.add(routeKey);

    const completedDetails = this.resolveCompletedRouteDetails(referenceDetail.schedule);
    const recipientByLineUserId = new Map<
      string,
      {
        caregiverId: string;
        caregiverName: string;
        patientId: string;
        patientName: string;
        doctorId: string;
        doctorName: string;
        lineUserId: string;
        scheduleId: string;
      }
    >();

    for (const detail of completedDetails) {
      const contacts = await this.loadLineContactsForPatient(detail.patient.id);
      contacts.forEach((contact) => {
        if (recipientByLineUserId.has(contact.lineUserId)) {
          return;
        }
        recipientByLineUserId.set(contact.lineUserId, {
          caregiverId: contact.id,
          caregiverName: contact.displayName,
          patientId: detail.patient.id,
          patientName: detail.patient.name,
          doctorId: referenceDetail.doctor.id,
          doctorName: referenceDetail.doctor.name,
          lineUserId: contact.lineUserId,
          scheduleId: detail.schedule.id
        });
      });
    }

    const recipientsWithSchedule = Array.from(recipientByLineUserId.values());
    if (recipientsWithSchedule.length === 0) {
      this.afterReturnCareInFlight.delete(routeKey);
      appendEvent(runtime, "本趟路線沒有已關聯 LINE 家屬，未發送結束後關心。");
      this.notify();
      return;
    }

    const subject = "訪視後關心";
    const content =
      "您好，今日居家訪視已完成，醫師已抵達回程終點。請持續觀察個案狀態、補充水分並依醫師建議照護。若有不適或疑問，請回覆此 LINE 訊息。";
    const recipients = recipientsWithSchedule.map(({ scheduleId: _scheduleId, ...recipient }) => recipient);
    const apiTokens = loadAdminApiTokenSettings();

    try {
      const response = await fetch("/api/admin/family-line/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          content,
          recipients,
          lineChannelAccessToken: apiTokens.lineChannelAccessToken
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        sentCount?: number;
        error?: string;
      };
      if (!response.ok) {
        this.afterReturnCareInFlight.delete(routeKey);
        appendEvent(
          runtime,
          `結束後關心 LINE 發送失敗：${payload.error ?? "LINE 發送端點回傳錯誤"}`
        );
        this.notify();
        return;
      }

      const now = new Date().toISOString();
      recipientsWithSchedule.forEach((recipient) => {
        this.deps.getRepositories().contactRepository.createContactLog({
          id: `line-after-return-${routeKey}-${recipient.caregiverId}-${Date.now()}`,
          patient_id: recipient.patientId,
          visit_schedule_id: recipient.scheduleId,
          caregiver_id: null,
          doctor_id: referenceDetail.doctor.id,
          admin_user_id: null,
          channel: "line",
          subject,
          content,
          outcome: "抵達回程終點後自動發送結束後關心",
          contacted_at: triggeredAt,
          created_at: now,
          updated_at: now
        });
      });
      this.afterReturnCareInFlight.delete(routeKey);
      this.afterReturnCareSentRouteKeys.add(routeKey);
      appendEvent(
        runtime,
        `已在抵達回程終點後，發送結束後關心給 ${payload.sentCount ?? recipientsWithSchedule.length} 位家屬。`
      );
      this.notify();
    } catch {
      this.afterReturnCareInFlight.delete(routeKey);
      appendEvent(runtime, "無法連線到 LINE 發送端點，結束後關心未送出。");
      this.notify();
    }
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

    this.doctorLocationSync.pushSample({
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
          !runtime.proximityTriggeredAt
        ) {
          runtime.proximityTriggeredAt = sample.recorded_at;
          runtime.geofenceStatus = "inside_candidate";
          this.updateSchedule({
            ...(effectiveSchedule ?? detail.schedule),
            geofence_status: "inside_candidate"
          });
          appendEvent(runtime, `已記錄接近目的地時間：${sample.recorded_at}，請醫師手動確認抵達。`);
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
    this.updateSchedule({
      ...(effectiveSchedule ?? detail.schedule),
      geofence_status: "outside_candidate"
    });
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
    runtime.completedAt = null;
    runtime.lastUpdatedAt = new Date().toISOString();
    runtime.routeOrder = detail.schedule.route_order;
    runtime.googleShareFallbackActive = Boolean(detail.doctor.google_location_share_enabled);
    runtime.permissionState = this.geolocationProvider.getPermissionState(runtime.scenarioId);
    runtime.proximityTriggeredAt = null;
    runtime.arrivalConfirmationPending = false;
    runtime.insideCandidateCount = 0;
    runtime.insideCandidateStartedAt = null;
    runtime.outsideCandidateCount = 0;
    runtime.outsideCandidateStartedAt = null;
    runtime.stopReason = null;
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
    runtime.eventLog = ["已開始導航追蹤，請改由 Google 地圖前往目的地。", ...runtime.eventLog].slice(0, 10);
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
    const recordedAt = runtime.proximityTriggeredAt ?? new Date().toISOString();
    const nextRecord = this.deps
      .getRepositories()
      .visitRepository.confirmArrival(scheduleId, confirmedBy, recordedAt);
    runtime.arrivalConfirmationPending = false;
    runtime.geofenceStatus = "arrived";
    appendEvent(
      runtime,
      runtime.proximityTriggeredAt
        ? `已由 ${confirmedBy} 手動確認抵達，沿用接近目的地時間：${recordedAt}`
        : `已由 ${confirmedBy} 手動確認抵達：${recordedAt}`
    );
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
    if (feedbackCode === "absent") {
      runtime.watchStatus = "completed";
      runtime.geofenceStatus = "completed";
      runtime.stopReason = "patient_absent";
      this.geolocationProvider.stopWatch(scheduleId);
    }
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
    const recordedAt = new Date().toISOString();
    const nextRecord = this.deps
      .getRepositories()
      .visitRepository.confirmDeparture(scheduleId, confirmedBy, recordedAt);
    runtime.watchStatus = "completed";
    runtime.geofenceStatus = "completed";
    runtime.completedAt = recordedAt;
    runtime.familyFollowUpStatus = nextRecord?.family_followup_status ?? runtime.familyFollowUpStatus;
    runtime.stopReason = "manual_confirmed";
    this.geolocationProvider.stopWatch(scheduleId);
    appendEvent(runtime, `已由 ${confirmedBy} 手動確認離開：${recordedAt}`);
    void this.sendArrivalReminderForNextStop(detail, runtime, recordedAt);
    this.notify();
  }

  confirmReturnToEndpoint(scheduleId: string, confirmedBy: "doctor" | "admin" | "system") {
    const detail = this.deps.getRepositories().visitRepository.getScheduleDetail(scheduleId);
    if (!detail) {
      return;
    }
    const runtime = this.getRuntime(detail);
    const recordedAt = new Date().toISOString();
    appendEvent(runtime, `已由 ${confirmedBy} 確認抵達回程終點：${recordedAt}`);
    void this.sendAfterReturnCareForRoute(detail, runtime, recordedAt);
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
    if (schedule.status === "paused") {
      return "paused";
    }
    if (departureTime) {
      return "completed";
    }
    if (arrivalTime) {
      return "in_treatment";
    }
    return schedule.status;
  }
}
