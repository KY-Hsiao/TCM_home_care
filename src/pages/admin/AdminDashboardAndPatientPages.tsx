import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import { Link, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { DoctorLocationLog, Patient, VisitSchedule } from "../../domain/models";
import type { RouteMapInput } from "../../services/types";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { StatCard } from "../../shared/ui/StatCard";
import { formatDateTimeFull, formatTimeOnly } from "../../shared/utils/format";
import { anonymizePatientName, maskPatientName } from "../../shared/utils/patient-name";
import {
  buildGoogleMapsSearchUrl,
  normalizeLocationKeyword,
  resolveLocationKeyword,
  sameAddressLocationKeyword
} from "../../shared/utils/location-keyword";

function mapsLink(address: string, locationKeyword = sameAddressLocationKeyword) {
  return buildGoogleMapsSearchUrl(locationKeyword, address);
}

const patientServiceNeedOptions = ["中藥", "針灸"] as const;
const routeTimeSlotOptions = ["上午", "下午"] as const;
const trackingMapOrigin = {
  address: "旗山醫院",
  latitude: 22.88794,
  longitude: 120.48341
} as const;
const trackingMapDestination = {
  address: "旗山醫院",
  latitude: 22.88794,
  longitude: 120.48341
} as const;
const locationStaleThresholdMs = 5 * 60 * 1000;
const trackingMapTileSize = 256;
const trackingMapDefaultSize = { width: 960, height: 440 } as const;
const trackingMapPadding = 56;
const trackingMapMinZoom = 11;
const trackingMapMaxZoom = 18;
const trackingLocationRouteDistanceThresholdKm = 8;
const inactiveTrackingScheduleStatuses = new Set<VisitSchedule["status"]>([
  "paused",
  "completed",
  "cancelled",
  "rescheduled",
  "followup_pending"
]);
const currentTrackingScheduleStatuses = new Set<VisitSchedule["status"]>([
  "tracking",
  "on_the_way",
  "proximity_pending",
  "arrived",
  "in_treatment",
  "issue_pending"
]);

type RouteTimeSlot = (typeof routeTimeSlotOptions)[number];
type TrackingRouteOption = {
  date: string;
  timeSlot: RouteTimeSlot;
  doctorCount: number;
  hasExecutingRoute: boolean;
  hasRecentLocation: boolean;
};
type TrackingRouteDistributionOption = {
  id: string;
  label: string;
  doctorId: string;
  doctorName: string;
  routeDate: string;
  timeSlot: RouteTimeSlot;
  schedules: VisitSchedule[];
};

function buildCsvTemplate() {
  return [
    "中醫居家名單,,,,,,",
    ",順序,姓名,病歷號,連絡電話,地址,備註",
    "星,1,王小明,123456,0912-000-000,高雄市旗山區示範路 1 號,",
    "期,2,林小芳,234567,07-6000000,高雄市美濃區示範路 2 號,",
    "三,3,陳大華,345678,Line 聯繫,高雄市杉林區示範路 3 號,",
    "上,4,黃秀英,456789,0988-000-000,高雄市旗山區示範路 4 號,",
    "午,5,李明德,567890,07-6000001,高雄市美濃區示範路 5 號,4/30結案"
  ].join("\n");
}

function stripUtf8Bom(content: string) {
  return content.replace(/^\uFEFF/, "");
}

function downloadCsvFile(filename: string, content: string) {
  const blob = new Blob(["\uFEFF", content], {
    type: "text/csv;charset=utf-8;"
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
}

function parseCsvRows(content: string) {
  return stripUtf8Bom(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let currentCell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    if (char === '"' && quoted && nextChar === '"') {
      currentCell += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(currentCell.trim());
      currentCell = "";
      continue;
    }
    currentCell += char;
  }

  cells.push(currentCell.trim());
  return cells;
}

type PatientImportRow = {
  rowNumber: number;
  name: string;
  chartNumber: string;
  phone: string;
  address: string;
  diagnosis: string;
  serviceNeeds: string[];
  status: Patient["status"];
  doctorRaw: string;
  serviceSlot: string;
  notes: string;
  reminderTags: string[];
};

function normalizeHomeCareServiceSlot(input: string) {
  const value = input.replace(/\s/g, "");
  const weekday = value.match(/星期[一二三四五六日天]/)?.[0];
  const timeSlot = value.includes("下午") ? "下午" : value.includes("上午") ? "上午" : "";
  return weekday && timeSlot ? `${weekday.replace("天", "日")}${timeSlot}` : "";
}

function isHomeCareSectionHeader(row: string[]) {
  return row.includes("順序") && row.includes("姓名") && row.includes("病歷號");
}

function isHomeCarePatientList(rows: string[][]) {
  return rows.some((row) => row.some((cell) => cell.includes("中醫居家名單"))) &&
    rows.some(isHomeCareSectionHeader);
}

function normalizeImportedPhone(input: string) {
  return /line/i.test(input) ? "" : input.trim();
}

function buildImportedReminderTags(input: { contactText?: string; notes?: string; serviceNeeds?: string[] }) {
  const tags = new Set(input.serviceNeeds ?? []);
  const text = `${input.contactText ?? ""} ${input.notes ?? ""}`;
  if (/line|聯繫|聯絡|通知|電話/i.test(text)) {
    tags.add("家屬聯繫");
  }
  return Array.from(tags);
}

function buildHomeCarePatientImportRows(rows: string[][]): PatientImportRow[] {
  const headerIndexes = rows
    .map((row, index) => (isHomeCareSectionHeader(row) ? index : -1))
    .filter((index) => index >= 0);
  const importedRows: PatientImportRow[] = [];
  const seenKeys = new Set<string>();

  headerIndexes.forEach((headerIndex, sectionIndex) => {
    const nextHeaderIndex = headerIndexes[sectionIndex + 1] ?? rows.length;
    const sectionRows = rows.slice(headerIndex + 1, nextHeaderIndex);
    const serviceSlot = normalizeHomeCareServiceSlot(
      sectionRows.map((row) => row[0]?.trim() ?? "").join("")
    );

    sectionRows.forEach((row, sectionRowIndex) => {
      const name = row[2]?.trim() ?? "";
      const chartNumber = row[3]?.trim() ?? "";
      const contactText = row[4]?.trim() ?? "";
      const address = row[5]?.trim() ?? "";
      const notes = row[6]?.trim() ?? "";
      if (!name && !chartNumber && !address) {
        return;
      }
      const dedupeKey = `${chartNumber}|${name}|${address}`;
      if (seenKeys.has(dedupeKey)) {
        return;
      }
      seenKeys.add(dedupeKey);

      const phone = normalizeImportedPhone(contactText);
      importedRows.push({
        rowNumber: headerIndex + sectionRowIndex + 2,
        name,
        chartNumber,
        phone,
        address,
        diagnosis: "",
        serviceNeeds: [],
        status: notes.includes("結案") ? "closed" : "active",
        doctorRaw: "",
        serviceSlot,
        notes: [notes, contactText && !phone ? `原表連絡電話：${contactText}` : ""].filter(Boolean).join("；"),
        reminderTags: buildImportedReminderTags({ contactText, notes })
      });
    });
  });

  return importedRows;
}

function buildLegacyPatientImportRows(header: string[], bodyRows: string[][]): PatientImportRow[] {
  if (header.length < 7) {
    return [];
  }

  return bodyRows.map((row, index) => {
    const [name, diagnosis, serviceNeedsRaw, address, statusRaw, doctorRaw, serviceSlot] = row;
    const serviceNeeds = serviceNeedsRaw
      ? serviceNeedsRaw.split(/[|、,]/).map((item) => item.trim()).filter(Boolean)
      : [];
    return {
      rowNumber: index + 2,
      name: name?.trim() ?? "",
      chartNumber: "",
      phone: "",
      address: address?.trim() ?? "",
      diagnosis: diagnosis?.trim() ?? "",
      serviceNeeds,
      status: normalizePatientStatus(statusRaw || "服務中"),
      doctorRaw: doctorRaw?.trim() ?? "",
      serviceSlot: serviceSlot?.trim() ?? "",
      notes: "",
      reminderTags: buildImportedReminderTags({ serviceNeeds })
    };
  });
}

function buildPatientImportRows(rows: string[][]) {
  const [header, ...bodyRows] = rows;
  if (isHomeCarePatientList(rows)) {
    return buildHomeCarePatientImportRows(rows);
  }
  if (!header || header.length < 7) {
    return null;
  }
  return buildLegacyPatientImportRows(header, bodyRows);
}

function normalizePatientStatus(input: string): Patient["status"] {
  if (["暫停", "paused"].includes(input)) {
    return "paused";
  }
  if (["結案", "closed"].includes(input)) {
    return "closed";
  }
  if (["服務中", "恢復治療", "active"].includes(input)) {
    return "active";
  }
  return "active";
}

async function readUploadedFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return stripUtf8Bom(await file.text());
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripUtf8Bom(String(reader.result ?? "")));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function readUploadedFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function readUploadedPatientRows(file: File): Promise<string[][]> {
  const filename = file.name.toLowerCase();
  const isSpreadsheet =
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls") ||
    file.type.includes("spreadsheet") ||
    file.type.includes("excel");

  if (!isSpreadsheet) {
    return parseCsvRows(await readUploadedFileText(file));
  }

  const workbook = XLSX.read(await readUploadedFileArrayBuffer(file), { type: "array" });
  return workbook.SheetNames.flatMap((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: ""
    });
    return rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
  });
}

function estimateDistanceKilometersBetween(
  originLatitude: number | null | undefined,
  originLongitude: number | null | undefined,
  destinationLatitude: number | null | undefined,
  destinationLongitude: number | null | undefined
) {
  if (
    originLatitude === null ||
    originLatitude === undefined ||
    originLongitude === null ||
    originLongitude === undefined ||
    destinationLatitude === null ||
    destinationLatitude === undefined ||
    destinationLongitude === null ||
    destinationLongitude === undefined
  ) {
    return 0;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destinationLatitude - originLatitude);
  const deltaLongitude = toRadians(destinationLongitude - originLongitude);
  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(toRadians(originLatitude)) *
      Math.cos(toRadians(destinationLatitude)) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function resolveTrackingTimeSlot(schedule: Pick<VisitSchedule, "service_time_slot" | "scheduled_start_at">): RouteTimeSlot {
  if (schedule.service_time_slot.includes("上午")) {
    return "上午";
  }
  if (schedule.service_time_slot.includes("下午")) {
    return "下午";
  }
  const hour = new Date(schedule.scheduled_start_at).getHours();
  return hour < 13 ? "上午" : "下午";
}

function resolveTrackingLogDate(log: DoctorLocationLog) {
  const recordedAt = new Date(log.recorded_at);
  return Number.isNaN(recordedAt.getTime())
    ? log.recorded_at.slice(0, 10)
    : buildDateInputValue(recordedAt);
}

function resolveTrackingLogTimeSlot(log: DoctorLocationLog): RouteTimeSlot {
  const recordedAt = new Date(log.recorded_at);
  if (Number.isNaN(recordedAt.getTime())) {
    return "上午";
  }
  return recordedAt.getHours() < 13 ? "上午" : "下午";
}

function buildTrackingReferencePoints(routeSchedules: VisitSchedule[]) {
  const routePoints = routeSchedules
    .filter(
      (schedule) =>
        schedule.home_latitude_snapshot !== null && schedule.home_longitude_snapshot !== null
    )
    .map((schedule) => ({
      latitude: schedule.home_latitude_snapshot as number,
      longitude: schedule.home_longitude_snapshot as number
    }));

  return [{ latitude: trackingMapOrigin.latitude, longitude: trackingMapOrigin.longitude }, ...routePoints];
}

function sortTrackingSchedules(schedules: VisitSchedule[]) {
  return schedules
    .slice()
    .sort(
      (left, right) =>
        (left.route_order ?? Number.MAX_SAFE_INTEGER) - (right.route_order ?? Number.MAX_SAFE_INTEGER) ||
        new Date(left.scheduled_start_at).getTime() - new Date(right.scheduled_start_at).getTime()
    );
}

function isActiveTrackingSchedule(schedule: Pick<VisitSchedule, "status">) {
  return !inactiveTrackingScheduleStatuses.has(schedule.status);
}

function isCurrentTrackingSchedule(schedule: Pick<VisitSchedule, "status">) {
  return currentTrackingScheduleStatuses.has(schedule.status);
}

function hasScheduleCoordinates(
  schedule: VisitSchedule | undefined
): schedule is VisitSchedule & { home_latitude_snapshot: number; home_longitude_snapshot: number } {
  return (
    schedule !== undefined &&
    schedule.home_latitude_snapshot !== null &&
    schedule.home_longitude_snapshot !== null
  );
}

function getLatestActiveTrackingRouteSchedules(schedules: VisitSchedule[]) {
  const latestSchedule = schedules
    .filter(isActiveTrackingSchedule)
    .slice()
    .sort(
      (left, right) =>
        new Date(right.scheduled_start_at).getTime() - new Date(left.scheduled_start_at).getTime() ||
        routeTimeSlotOptions.indexOf(resolveTrackingTimeSlot(right)) -
          routeTimeSlotOptions.indexOf(resolveTrackingTimeSlot(left))
    )[0];

  if (!latestSchedule) {
    return [];
  }

  const latestRouteDate = latestSchedule.scheduled_start_at.slice(0, 10);
  const latestRouteTimeSlot = resolveTrackingTimeSlot(latestSchedule);
  return sortTrackingSchedules(
    schedules.filter(
      (schedule) =>
        isActiveTrackingSchedule(schedule) &&
        schedule.scheduled_start_at.slice(0, 10) === latestRouteDate &&
        resolveTrackingTimeSlot(schedule) === latestRouteTimeSlot
    )
  );
}

function isTrackingLogNearRoute(
  log: Pick<DoctorLocationLog, "latitude" | "longitude">,
  routeSchedules: VisitSchedule[]
) {
  const referencePoints = buildTrackingReferencePoints(routeSchedules);
  const nearestDistance = referencePoints.reduce((bestDistance, point) => {
    const currentDistance = estimateDistanceKilometersBetween(
      log.latitude,
      log.longitude,
      point.latitude,
      point.longitude
    );
    return Math.min(bestDistance, currentDistance);
  }, Number.POSITIVE_INFINITY);

  return nearestDistance <= trackingLocationRouteDistanceThresholdKm;
}

function resolveTrackingLocationLogs(input: {
  routeDate: string;
  routeTimeSlot: RouteTimeSlot;
  routeSchedules: VisitSchedule[];
  routeScheduleIds: Set<string>;
  locationLogs: DoctorLocationLog[];
}) {
  const sortedLogs = input.locationLogs
    .slice()
    .sort((left, right) => new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime());

  const scheduleLinkedLogs = sortedLogs.filter(
    (log) => log.linked_visit_schedule_id !== null && input.routeScheduleIds.has(log.linked_visit_schedule_id)
  );
  if (scheduleLinkedLogs.length) {
    return scheduleLinkedLogs;
  }

  const nearRouteLogs = (logs: DoctorLocationLog[]) =>
    logs.filter((log) => isTrackingLogNearRoute(log, input.routeSchedules));

  const routeStartAtCandidates = input.routeSchedules
    .map((schedule) => new Date(schedule.scheduled_start_at).getTime())
    .filter((value) => Number.isFinite(value));
  if (routeStartAtCandidates.length) {
    const earliestStartAt = Math.min(...routeStartAtCandidates);
    const latestStartAt = Math.max(...routeStartAtCandidates);
    const routeWindowStartAt = earliestStartAt - 2 * 60 * 60 * 1000;
    const routeWindowEndAt = latestStartAt + 4 * 60 * 60 * 1000;
    const routeWindowLogs = sortedLogs.filter((log) => {
      const recordedAt = new Date(log.recorded_at).getTime();
      return recordedAt >= routeWindowStartAt && recordedAt <= routeWindowEndAt;
    });
    const routeWindowNearLogs = nearRouteLogs(routeWindowLogs);
    if (routeWindowNearLogs.length) {
      return routeWindowNearLogs;
    }
  }

  const timeSlotLogs = sortedLogs.filter((log) => {
    if (resolveTrackingLogDate(log) !== input.routeDate) {
      return false;
    }
    return resolveTrackingLogTimeSlot(log) === input.routeTimeSlot;
  });
  const timeSlotNearLogs = nearRouteLogs(timeSlotLogs);
  if (timeSlotNearLogs.length) {
    return timeSlotNearLogs;
  }

  const sameDateLogs = sortedLogs.filter((log) => resolveTrackingLogDate(log) === input.routeDate);
  const sameDateNearLogs = nearRouteLogs(sameDateLogs);
  if (sameDateNearLogs.length) {
    return sameDateNearLogs;
  }

  return [];
}

function buildDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPatientDraft(patient?: Patient): Patient {
  const now = new Date().toISOString();
  return (
    patient ?? {
      id: `pat-${Date.now()}`,
      chart_number: `NEW-${Date.now().toString().slice(-4)}`,
      name: "",
      service_needs: [],
      preferred_service_slot: "",
      gender: "未填",
      date_of_birth: "1950-01-01",
      phone: "",
      address: "",
      home_address: "",
      location_keyword: sameAddressLocationKeyword,
      home_latitude: null,
      home_longitude: null,
      geocoding_status: "missing",
      google_maps_link: mapsLink("台北市", sameAddressLocationKeyword),
      patient_tag: "新案照護",
      primary_diagnosis: "",
      preferred_doctor_id: "doc-001",
      important_medical_history: "",
      precautions: "",
      medication_summary: "",
      last_visit_summary: "",
      next_follow_up_focus: "",
      reminder_tags: [],
      status: "active",
      notes: "",
      created_at: now,
      updated_at: now
    }
  );
}

export function AdminDashboardPage() {
  const { repositories, db } = useAppContext();
  const dashboard = repositories.staffingRepository.getAdminDashboard();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="執行人次" value={dashboard.executedVisitCount} hint="已出發、治療中或已完成的案件" />
        <StatCard label="暫停人次" value={dashboard.pausedCount} hint="目前標記為暫停的案件" />
        <StatCard label="緊急處置人次" value={dashboard.urgentCount} hint="醫師回覆緊急處置或緊急異常通知" />
        <StatCard
          label="上月總計"
          value={`${dashboard.previousMonth.executedVisitCount}/${dashboard.previousMonth.pausedCount}/${dashboard.previousMonth.urgentCount}`}
          hint={`${dashboard.previousMonth.label} 執行 / 暫停 / 緊急`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="個案異常儀表板"
          action={
            <Link
              to="/admin/patients"
              className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
            >
              前往個案管理
            </Link>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">執行人次</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.executedVisitCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">暫停人次</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.pausedCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">緊急處置人次</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.urgentCount}</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {dashboard.exceptionSchedules.slice(0, 3).map((schedule) => {
              const patient = db.patients.find((item) => item.id === schedule.patient_id);
              return (
                <Link
                  key={schedule.id}
                  to={`/admin/patients/${schedule.patient_id}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{patient ? maskPatientName(patient.name) : schedule.patient_id}</p>
                    <Badge value={schedule.status} compact />
                  </div>
                  <p className="mt-2 text-slate-600">{formatDateTimeFull(schedule.scheduled_start_at)}</p>
                  <p className="mt-1 text-slate-500">{schedule.note}</p>
                </Link>
              );
            })}
            {dashboard.exceptionSchedules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                今日沒有需要特別關注的異常案件。
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="通知與任務儀表板"
          action={
            <Link
              to="/admin/reminders"
              className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
            >
              前往通知中心
            </Link>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">待審請假</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.pendingLeaveRequests.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">待重排案件</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.rescheduleCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">待補紀錄</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.unrecordedCount}</p>
              <p className="mt-1 text-xs text-slate-500">已完成但尚未建立病歷</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-3">
              {dashboard.pendingLeaveRequests.slice(0, 2).map((leave) => {
                const doctor = db.doctors.find((item) => item.id === leave.doctor_id);
                return (
                  <div key={leave.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">{doctor?.name ?? leave.doctor_id}</p>
                      <Badge value={leave.status} compact />
                    </div>
                    <p className="mt-2 text-slate-600">{leave.start_date} ~ {leave.end_date}</p>
                    <p className="mt-1 text-slate-500">{leave.reason}</p>
                  </div>
                );
              })}
              {dashboard.pendingLeaveRequests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  目前沒有待審請假。
                </div>
              ) : null}
            </div>
            <div className="space-y-3">
              {dashboard.pendingRescheduleActions.slice(0, 2).map((action) => {
                const schedule = db.visit_schedules.find((item) => item.id === action.visit_schedule_id);
                const patient = schedule
                  ? db.patients.find((item) => item.id === schedule.patient_id)
                  : undefined;
                return (
                  <div key={action.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">{patient ? maskPatientName(patient.name) : action.visit_schedule_id}</p>
                      <Badge value={action.status} compact />
                    </div>
                    <p className="mt-2 text-slate-600">{formatDateTimeFull(action.new_start_at)}</p>
                    <p className="mt-1 text-slate-500">{action.reason}</p>
                  </div>
                );
              })}
              {dashboard.pendingRescheduleActions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  目前沒有待重排案件。
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const trackingPalette = ["#0f766e", "#d97706", "#2563eb", "#be123c"] as const;

type DoctorTrackingSummary = {
  doctorId: string;
  doctorName: string;
  doctorPhone: string;
  color: string;
  latestLocation: ReturnType<typeof useAppContext>["db"]["doctor_location_logs"][number] | undefined;
  displayLocation: {
    latitude: number;
    longitude: number;
    addressLabel: string;
    markerLabel: string;
    isFallback: boolean;
  } | null;
  locationLogs: ReturnType<typeof useAppContext>["db"]["doctor_location_logs"];
  locationStatus: "live" | "stale" | "missing";
  routeSchedules: VisitSchedule[];
  activeSchedule: VisitSchedule | undefined;
  activePatientName: string | null;
  passedStops: VisitSchedule[];
  upcomingStops: VisitSchedule[];
  currentDistanceKilometers: number | null;
  routeMapUrl: string | null;
};

function resolveLocationSyncStatus(
  latestLocation: { recorded_at: string } | undefined
): "live" | "stale" | "missing" {
  if (!latestLocation) {
    return "missing";
  }

  const recordedAt = new Date(latestLocation.recorded_at).getTime();
  if (Number.isNaN(recordedAt)) {
    return "stale";
  }

  return Date.now() - recordedAt > locationStaleThresholdMs ? "stale" : "live";
}

function getLocationStatusLabel(status: "live" | "stale" | "missing") {
  if (status === "live") {
    return "定位正常";
  }
  if (status === "stale") {
    return "定位延遲";
  }
  return "未上線";
}

function getLocationStatusTone(status: "live" | "stale" | "missing") {
  if (status === "live") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (status === "stale") {
    return "bg-amber-100 text-amber-700";
  }
  return "bg-slate-100 text-slate-600";
}

function buildTrackingRouteMapInput(
  schedules: VisitSchedule[],
  label: string
): RouteMapInput | null {
  if (!schedules.length) {
    return null;
  }

  return {
    origin: trackingMapOrigin,
    destination: trackingMapDestination,
    waypoints: schedules.map((schedule) => ({
      address: schedule.address_snapshot,
      locationKeyword: schedule.location_keyword_snapshot,
      latitude: schedule.home_latitude_snapshot,
      longitude: schedule.home_longitude_snapshot
    })),
    travelMode: "driving",
    label
  };
}

function buildTrackingFallbackLocation(schedules: VisitSchedule[]) {
  const startSchedule =
    schedules.find(
      (schedule) =>
        schedule.home_latitude_snapshot !== null && schedule.home_longitude_snapshot !== null
    ) ?? null;

  if (startSchedule) {
    return {
      latitude: (startSchedule.home_latitude_snapshot as number) + 0.00022,
      longitude: (startSchedule.home_longitude_snapshot as number) + 0.00022,
      addressLabel: `${startSchedule.address_snapshot}附近`,
      markerLabel: "未上線",
      isFallback: true
    };
  }

  return {
    latitude: trackingMapOrigin.latitude + 0.00018,
    longitude: trackingMapOrigin.longitude + 0.00018,
    addressLabel: `${trackingMapOrigin.address}附近`,
    markerLabel: "未上線",
    isFallback: true
  };
}

function resolveTrackingDisplayLocation(input: {
  latestLocation: ReturnType<typeof useAppContext>["db"]["doctor_location_logs"][number] | undefined;
  routeSchedules: VisitSchedule[];
  activeSchedule: VisitSchedule | undefined;
}) {
  if (!input.latestLocation) {
    return buildTrackingFallbackLocation(input.routeSchedules);
  }

  const nearestSchedule =
    input.routeSchedules
      .filter(
        (schedule) =>
          schedule.home_latitude_snapshot !== null && schedule.home_longitude_snapshot !== null
      )
      .map((schedule) => ({
        schedule,
        distance: estimateDistanceKilometersBetween(
          input.latestLocation?.latitude,
          input.latestLocation?.longitude,
          schedule.home_latitude_snapshot,
          schedule.home_longitude_snapshot
        )
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.schedule ??
    input.activeSchedule;

  return {
    latitude: input.latestLocation.latitude,
    longitude: input.latestLocation.longitude,
    addressLabel: nearestSchedule
      ? `${nearestSchedule.address_snapshot}附近`
      : "目前已上線，位置位於本次路線周圍",
    markerLabel: "目前位置",
    isFallback: false
  };
}

function clampTrackingLatitude(latitude: number) {
  return Math.max(-85, Math.min(85, latitude));
}

function trackingLongitudeToWorld(longitude: number, zoom: number) {
  const scale = trackingMapTileSize * 2 ** zoom;
  return ((longitude + 180) / 360) * scale;
}

function trackingLatitudeToWorld(latitude: number, zoom: number) {
  const scale = trackingMapTileSize * 2 ** zoom;
  const sinLatitude = Math.sin((clampTrackingLatitude(latitude) * Math.PI) / 180);
  return (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale;
}

function trackingWorldToLongitude(worldX: number, zoom: number) {
  const scale = trackingMapTileSize * 2 ** zoom;
  return (worldX / scale) * 360 - 180;
}

function trackingWorldToLatitude(worldY: number, zoom: number) {
  const scale = trackingMapTileSize * 2 ** zoom;
  const mercatorY = Math.PI - (2 * Math.PI * worldY) / scale;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(mercatorY) - Math.exp(-mercatorY)));
}

function buildTrackingRouteLayerPoints(schedules: VisitSchedule[]) {
  return [
    {
      key: "origin",
      kind: "origin" as const,
      label: "院",
      latitude: trackingMapOrigin.latitude,
      longitude: trackingMapOrigin.longitude
    },
    ...schedules
      .filter(
        (schedule) =>
          schedule.home_latitude_snapshot !== null && schedule.home_longitude_snapshot !== null
      )
      .map((schedule) => ({
        key: schedule.id,
        kind: "stop" as const,
        label: `${schedule.route_order ?? ""}`,
        latitude: schedule.home_latitude_snapshot as number,
        longitude: schedule.home_longitude_snapshot as number,
        schedule
      })),
    {
      key: "destination",
      kind: "destination" as const,
      label: "返",
      latitude: trackingMapDestination.latitude,
      longitude: trackingMapDestination.longitude
    }
  ];
}

function buildTrackingMapPointsForFit(input: {
  doctors: DoctorTrackingSummary[];
  routeLayerPoints: Array<{ latitude: number; longitude: number }>;
  selectedDoctor?: DoctorTrackingSummary;
}) {
  return [
    ...input.routeLayerPoints.map((point) => ({
      latitude: point.latitude,
      longitude: point.longitude
    })),
    ...input.doctors
      .map((doctor) =>
        doctor.displayLocation
          ? {
              latitude: doctor.displayLocation.latitude,
              longitude: doctor.displayLocation.longitude
            }
          : null
      )
      .filter((point): point is { latitude: number; longitude: number } => Boolean(point)),
    input.selectedDoctor?.displayLocation
      ? {
          latitude: input.selectedDoctor.displayLocation.latitude,
          longitude: input.selectedDoctor.displayLocation.longitude
        }
      : null
  ].filter((point): point is { latitude: number; longitude: number } => Boolean(point));
}

function buildTrackingMapView(input: {
  doctors: DoctorTrackingSummary[];
  routeLayerPoints: Array<{ latitude: number; longitude: number }>;
  selectedDoctor?: DoctorTrackingSummary;
},
  mapSize: { width: number; height: number }
) {
  const points = buildTrackingMapPointsForFit(input);
  const focusPoint = input.selectedDoctor?.displayLocation
    ? {
        latitude: input.selectedDoctor.displayLocation.latitude,
        longitude: input.selectedDoctor.displayLocation.longitude
      }
    : input.selectedDoctor?.activeSchedule &&
        input.selectedDoctor.activeSchedule.home_latitude_snapshot !== null &&
        input.selectedDoctor.activeSchedule.home_longitude_snapshot !== null
      ? {
          latitude: input.selectedDoctor.activeSchedule.home_latitude_snapshot,
          longitude: input.selectedDoctor.activeSchedule.home_longitude_snapshot
        }
      : points[0] ?? {
          latitude: trackingMapOrigin.latitude,
          longitude: trackingMapOrigin.longitude
        };

  let zoom = 16;
  if (points.length >= 2) {
    for (let candidateZoom = 17; candidateZoom >= trackingMapMinZoom; candidateZoom -= 1) {
      const worldPoints = points.map((point) => ({
        x: trackingLongitudeToWorld(point.longitude, candidateZoom),
        y: trackingLatitudeToWorld(point.latitude, candidateZoom)
      }));
      const widthSpan = Math.max(...worldPoints.map((point) => point.x)) - Math.min(...worldPoints.map((point) => point.x));
      const heightSpan = Math.max(...worldPoints.map((point) => point.y)) - Math.min(...worldPoints.map((point) => point.y));
      if (
        widthSpan <= Math.max(mapSize.width - trackingMapPadding * 2, 120) &&
        heightSpan <= Math.max(mapSize.height - trackingMapPadding * 2, 120)
      ) {
        zoom = candidateZoom;
        break;
      }
    }
  }

  return {
    centerLatitude: focusPoint.latitude,
    centerLongitude: focusPoint.longitude,
    zoom
  };
}

function projectTrackingPointToScreen(
  latitude: number,
  longitude: number,
  mapView: { centerLatitude: number; centerLongitude: number; zoom: number },
  mapSize: { width: number; height: number }
) {
  const centerWorldX = trackingLongitudeToWorld(mapView.centerLongitude, mapView.zoom);
  const centerWorldY = trackingLatitudeToWorld(mapView.centerLatitude, mapView.zoom);
  const pointWorldX = trackingLongitudeToWorld(longitude, mapView.zoom);
  const pointWorldY = trackingLatitudeToWorld(latitude, mapView.zoom);

  return {
    x: pointWorldX - centerWorldX + mapSize.width / 2,
    y: pointWorldY - centerWorldY + mapSize.height / 2
  };
}

export function AdminDoctorTrackingPage() {
  const { repositories, db, services } = useAppContext();
  const [routeDate, setRouteDate] = useState<string>(buildDateInputValue());
  const [routeTimeSlot, setRouteTimeSlot] = useState<RouteTimeSlot>("上午");
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [selectedDistributionRouteId, setSelectedDistributionRouteId] = useState<string>("");
  const [remoteLocationLogs, setRemoteLocationLogs] = useState<DoctorLocationLog[]>([]);
  const [remoteRecentLocationLogs, setRemoteRecentLocationLogs] = useState<DoctorLocationLog[]>([]);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCenterWorldX: number;
    startCenterWorldY: number;
  } | null>(null);
  const autoCenteredDoctorKeyRef = useRef<string>("");
  const [trackingMapSize, setTrackingMapSize] = useState<{ width: number; height: number }>(
    trackingMapDefaultSize
  );
  const [trackingMapView, setTrackingMapView] = useState<{
    centerLatitude: number;
    centerLongitude: number;
    zoom: number;
  } | null>(null);
  const activeTrackingPatientIds = useMemo(
    () => new Set(db.patients.filter((patient) => patient.status === "active").map((patient) => patient.id)),
    [db.patients]
  );
  const trackingRouteOptions = useMemo<TrackingRouteOption[]>(() => {
    const routeOptionMap = new Map<
      string,
      {
        doctorIds: Set<string>;
        hasExecutingRoute: boolean;
        hasRecentLocation: boolean;
      }
    >();
    const savedRoutePlans = repositories.visitRepository.getSavedRoutePlans();
    const allSchedules = repositories.visitRepository.getSchedules();
    const schedulesById = new Map(allSchedules.map((schedule) => [schedule.id, schedule]));

    if (savedRoutePlans.length) {
      savedRoutePlans.forEach((routePlan) => {
        const scheduleIdSchedules = routePlan.schedule_ids
          .map((scheduleId) => schedulesById.get(scheduleId))
          .filter(
            (schedule): schedule is VisitSchedule =>
              schedule !== undefined &&
              isActiveTrackingSchedule(schedule) &&
              activeTrackingPatientIds.has(schedule.patient_id)
          );
        const fallbackSchedules = allSchedules.filter(
          (schedule) =>
            schedule.visit_type !== "回院病歷" &&
            isActiveTrackingSchedule(schedule) &&
            activeTrackingPatientIds.has(schedule.patient_id) &&
            schedule.assigned_doctor_id === routePlan.doctor_id &&
            schedule.scheduled_start_at.slice(0, 10) === routePlan.route_date &&
            resolveTrackingTimeSlot(schedule) === routePlan.service_time_slot
        );
        const routeSchedules = scheduleIdSchedules.length ? scheduleIdSchedules : fallbackSchedules;
        if (!routeSchedules.length) {
          return;
        }
        const routeKey = `${routePlan.route_date}|${routePlan.service_time_slot}`;
        const current = routeOptionMap.get(routeKey) ?? {
          doctorIds: new Set<string>(),
          hasExecutingRoute: false,
          hasRecentLocation: false
        };
        current.doctorIds.add(routePlan.doctor_id);
        current.hasExecutingRoute =
          current.hasExecutingRoute || routePlan.execution_status === "executing";
        routeOptionMap.set(routeKey, current);
      });
    } else {
      allSchedules
        .filter(
          (schedule) =>
            schedule.visit_type !== "回院病歷" &&
            isActiveTrackingSchedule(schedule) &&
            activeTrackingPatientIds.has(schedule.patient_id)
        )
        .forEach((schedule) => {
          const routeKey = `${schedule.scheduled_start_at.slice(0, 10)}|${resolveTrackingTimeSlot(schedule)}`;
          const current = routeOptionMap.get(routeKey) ?? {
            doctorIds: new Set<string>(),
            hasExecutingRoute: false,
            hasRecentLocation: false
          };
          current.doctorIds.add(schedule.assigned_doctor_id);
          routeOptionMap.set(routeKey, current);
        });
    }

    if (services.doctorLocationSync.mode === "api_polling") {
      remoteRecentLocationLogs.forEach((log) => {
        const linkedSchedule = log.linked_visit_schedule_id
          ? schedulesById.get(log.linked_visit_schedule_id)
          : undefined;
        if (
          linkedSchedule &&
          (linkedSchedule.visit_type === "回院病歷" ||
            !isActiveTrackingSchedule(linkedSchedule) ||
            !activeTrackingPatientIds.has(linkedSchedule.patient_id))
        ) {
          return;
        }
        const routeDateFromLog = linkedSchedule
          ? linkedSchedule.scheduled_start_at.slice(0, 10)
          : resolveTrackingLogDate(log);
        const timeSlotFromLog = linkedSchedule
          ? resolveTrackingTimeSlot(linkedSchedule)
          : resolveTrackingLogTimeSlot(log);
        const routeKey = `${routeDateFromLog}|${timeSlotFromLog}`;
        const current = routeOptionMap.get(routeKey) ?? {
          doctorIds: new Set<string>(),
          hasExecutingRoute: false,
          hasRecentLocation: false
        };
        current.doctorIds.add(linkedSchedule?.assigned_doctor_id ?? log.doctor_id);
        current.hasRecentLocation = true;
        routeOptionMap.set(routeKey, current);
      });
    }

    const todayRouteDate = buildDateInputValue();

    return [...routeOptionMap.entries()]
      .map(([routeKey, summary]) => {
        const [date, timeSlot] = routeKey.split("|");
        return {
          date,
          timeSlot: timeSlot as RouteTimeSlot,
          doctorCount: summary.doctorIds.size,
          hasExecutingRoute: summary.hasExecutingRoute,
          hasRecentLocation: summary.hasRecentLocation
        };
      })
      .sort((left, right) => {
        const leftRecentLocation = left.hasRecentLocation ? 1 : 0;
        const rightRecentLocation = right.hasRecentLocation ? 1 : 0;
        if (leftRecentLocation !== rightRecentLocation) {
          return rightRecentLocation - leftRecentLocation;
        }
        const leftExecuting = left.hasExecutingRoute ? 1 : 0;
        const rightExecuting = right.hasExecutingRoute ? 1 : 0;
        if (leftExecuting !== rightExecuting) {
          return rightExecuting - leftExecuting;
        }
        const leftIsToday = left.date === todayRouteDate ? 1 : 0;
        const rightIsToday = right.date === todayRouteDate ? 1 : 0;
        if (leftIsToday !== rightIsToday) {
          return rightIsToday - leftIsToday;
        }
        if (left.doctorCount !== right.doctorCount) {
          return right.doctorCount - left.doctorCount;
        }
        return (
          right.date.localeCompare(left.date) ||
          routeTimeSlotOptions.indexOf(left.timeSlot) - routeTimeSlotOptions.indexOf(right.timeSlot)
        );
      });
  }, [activeTrackingPatientIds, remoteRecentLocationLogs, repositories.visitRepository, services.doctorLocationSync.mode]);

  useEffect(() => {
    if (services.doctorLocationSync.mode !== "api_polling") {
      setRemoteRecentLocationLogs([]);
      return;
    }

    let cancelled = false;
    const feedPath = services.doctorLocationSync.buildAdminLatestFeedPath();

    const syncRecentRemoteLocations = async () => {
      try {
        const response = await fetch(feedPath, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { items?: DoctorLocationLog[] };
        if (!cancelled) {
          setRemoteRecentLocationLogs(Array.isArray(payload.items) ? payload.items : []);
        }
      } catch {
        if (!cancelled) {
          setRemoteRecentLocationLogs([]);
        }
      }
    };

    void syncRecentRemoteLocations();
    const intervalId = window.setInterval(syncRecentRemoteLocations, services.doctorLocationSync.pollingIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [services.doctorLocationSync]);

  useEffect(() => {
    if (services.doctorLocationSync.mode !== "api_polling") {
      setRemoteLocationLogs([]);
      return;
    }

    let cancelled = false;
    const feedPath = services.doctorLocationSync.buildAdminFeedPath({
      date: routeDate,
      timeSlot: routeTimeSlot
    });

    const syncRemoteLocations = async () => {
      try {
        const response = await fetch(feedPath, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { items?: DoctorLocationLog[] };
        if (!cancelled) {
          setRemoteLocationLogs(Array.isArray(payload.items) ? payload.items : []);
        }
      } catch {
        if (!cancelled) {
          setRemoteLocationLogs([]);
        }
      }
    };

    void syncRemoteLocations();
    const intervalId = window.setInterval(syncRemoteLocations, services.doctorLocationSync.pollingIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [routeDate, routeTimeSlot, services.doctorLocationSync]);

  const routeDistributionOptions = useMemo<TrackingRouteDistributionOption[]>(() => {
    const allSchedules = repositories.visitRepository
      .getSchedules()
      .filter((schedule) => schedule.visit_type !== "回院病歷");
    const schedulesById = new Map(allSchedules.map((schedule) => [schedule.id, schedule]));
    const savedRoutePlans = repositories.visitRepository.getSavedRoutePlans();

    const savedRouteOptions = savedRoutePlans
      .map((routePlan) => {
        const doctor = db.doctors.find((item) => item.id === routePlan.doctor_id);
        const schedules = routePlan.schedule_ids
          .map((scheduleId) => schedulesById.get(scheduleId))
          .filter(
            (schedule): schedule is VisitSchedule =>
              schedule !== undefined &&
              isActiveTrackingSchedule(schedule) &&
              activeTrackingPatientIds.has(schedule.patient_id)
          );
        const fallbackSchedules = allSchedules.filter(
          (schedule) =>
            isActiveTrackingSchedule(schedule) &&
            activeTrackingPatientIds.has(schedule.patient_id) &&
            schedule.assigned_doctor_id === routePlan.doctor_id &&
            schedule.scheduled_start_at.slice(0, 10) === routePlan.route_date &&
            resolveTrackingTimeSlot(schedule) === routePlan.service_time_slot
        );
        const routeSchedules = sortTrackingSchedules(schedules.length ? schedules : fallbackSchedules);
        if (!routeSchedules.length) {
          return null;
        }

        return {
          id: routePlan.id,
          label: `${routePlan.route_name}｜${doctor?.name ?? routePlan.doctor_id}`,
          doctorId: routePlan.doctor_id,
          doctorName: doctor?.name ?? routePlan.doctor_id,
          routeDate: routePlan.route_date,
          timeSlot: routePlan.service_time_slot,
          schedules: routeSchedules
        } satisfies TrackingRouteDistributionOption;
      })
      .filter((option): option is TrackingRouteDistributionOption => Boolean(option));

    return savedRouteOptions.sort(
      (left, right) =>
        right.routeDate.localeCompare(left.routeDate) ||
        routeTimeSlotOptions.indexOf(left.timeSlot) - routeTimeSlotOptions.indexOf(right.timeSlot) ||
        left.doctorName.localeCompare(right.doctorName, "zh-Hant")
    );
  }, [activeTrackingPatientIds, db.doctors, repositories.visitRepository]);

  useEffect(() => {
    if (!routeDistributionOptions.length) {
      setSelectedDistributionRouteId("");
      return;
    }
    if (routeDistributionOptions.some((option) => option.id === selectedDistributionRouteId)) {
      return;
    }
    const matchedOption =
      routeDistributionOptions.find(
        (option) => option.routeDate === routeDate && option.timeSlot === routeTimeSlot
      ) ?? routeDistributionOptions[0];
    setSelectedDistributionRouteId(matchedOption.id);
  }, [routeDate, routeDistributionOptions, routeTimeSlot, selectedDistributionRouteId]);

  const selectedDistributionRoute = routeDistributionOptions.find(
    (option) => option.id === selectedDistributionRouteId
  );

  const trackedDoctors = useMemo<DoctorTrackingSummary[]>(() => {
    return db.doctors
      .map<DoctorTrackingSummary>((doctor, index) => {
        const allDoctorSchedules = repositories.visitRepository
          .getSchedules({ doctorId: doctor.id })
          .filter((schedule) => schedule.visit_type !== "回院病歷");
        const activeDoctorSchedules = allDoctorSchedules.filter(
          (schedule) => isActiveTrackingSchedule(schedule) && activeTrackingPatientIds.has(schedule.patient_id)
        );
        const routeSchedules = sortTrackingSchedules(
          activeDoctorSchedules.filter(
            (schedule) =>
              schedule.scheduled_start_at.slice(0, 10) === routeDate &&
              resolveTrackingTimeSlot(schedule) === routeTimeSlot
          )
        );
        const latestActiveRouteSchedules = getLatestActiveTrackingRouteSchedules(activeDoctorSchedules);
        const displayRouteSchedules = routeSchedules.length ? routeSchedules : latestActiveRouteSchedules;

        const routeScheduleIds = new Set(displayRouteSchedules.map((schedule) => schedule.id));
        const doctorLocationLogs = (
          services.doctorLocationSync.mode === "api_polling"
            ? [...remoteRecentLocationLogs, ...remoteLocationLogs].filter((log) => log.doctor_id === doctor.id)
            : repositories.visitRepository.getDoctorLocationLogs(doctor.id)
        )
          .slice()
          .sort((left, right) => new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime());
        const locationLogs = routeSchedules.length
          ? resolveTrackingLocationLogs({
              routeDate,
              routeTimeSlot,
              routeSchedules: displayRouteSchedules,
              routeScheduleIds,
              locationLogs: doctorLocationLogs
            })
          : displayRouteSchedules.length
            ? resolveTrackingLocationLogs({
                routeDate: displayRouteSchedules[0].scheduled_start_at.slice(0, 10),
                routeTimeSlot: resolveTrackingTimeSlot(displayRouteSchedules[0]),
                routeSchedules: displayRouteSchedules,
                routeScheduleIds,
                locationLogs: doctorLocationLogs
              })
            : doctorLocationLogs;
        const latestLocation = locationLogs[0];
        const locationStatus = resolveLocationSyncStatus(latestLocation);
        const linkedActiveSchedule =
          latestLocation?.linked_visit_schedule_id && routeScheduleIds.has(latestLocation.linked_visit_schedule_id)
            ? allDoctorSchedules.find(
                (schedule) =>
                  schedule.id === latestLocation.linked_visit_schedule_id &&
                  isActiveTrackingSchedule(schedule) &&
                  activeTrackingPatientIds.has(schedule.patient_id)
              )
            : undefined;
        const activeSchedule =
          linkedActiveSchedule ??
          displayRouteSchedules.find(isCurrentTrackingSchedule) ??
          displayRouteSchedules[0];
        const activePatient = activeSchedule
          ? db.patients.find((patient) => patient.id === activeSchedule.patient_id)
          : undefined;
        const passedStops = displayRouteSchedules.filter((schedule) =>
          activeSchedule
            ? (schedule.route_order ?? 0) < (activeSchedule.route_order ?? 0)
            : false
        );
        const upcomingStops = displayRouteSchedules.filter((schedule) =>
          activeSchedule
            ? (schedule.route_order ?? 0) > (activeSchedule.route_order ?? 0)
            : true
        );
        const currentDistanceKilometers =
          latestLocation && hasScheduleCoordinates(activeSchedule)
            ? estimateDistanceKilometersBetween(
                latestLocation.latitude,
                latestLocation.longitude,
                activeSchedule.home_latitude_snapshot,
                activeSchedule.home_longitude_snapshot
              )
            : null;
        const displayLocation = resolveTrackingDisplayLocation({
          latestLocation,
          routeSchedules: displayRouteSchedules,
          activeSchedule
        });
        const routeMapDate = displayRouteSchedules[0]?.scheduled_start_at.slice(0, 10) ?? routeDate;
        const routeMapTimeSlot = displayRouteSchedules[0]
          ? resolveTrackingTimeSlot(displayRouteSchedules[0])
          : routeTimeSlot;
        const routeMapInput = buildTrackingRouteMapInput(
          displayRouteSchedules,
          `${doctor.name} ${routeMapDate} ${routeMapTimeSlot}`
        );

        return {
          doctorId: doctor.id,
          doctorName: doctor.name,
          doctorPhone: doctor.phone,
          color: trackingPalette[index % trackingPalette.length],
          latestLocation,
          displayLocation,
          locationLogs,
          locationStatus,
          routeSchedules: displayRouteSchedules,
          activeSchedule,
          activePatientName: activePatient ? maskPatientName(activePatient.name) : null,
          passedStops,
          upcomingStops,
          currentDistanceKilometers,
          routeMapUrl: routeMapInput ? services.maps.buildRouteDirectionsUrl(routeMapInput) : null
        } satisfies DoctorTrackingSummary;
      });
  }, [activeTrackingPatientIds, db.doctors, db.patients, remoteLocationLogs, remoteRecentLocationLogs, repositories, routeDate, routeTimeSlot, services.doctorLocationSync.mode, services.maps]);

  useEffect(() => {
    if (!trackingRouteOptions.length) {
      return;
    }
    const sameDateOptions = trackingRouteOptions.filter((option) => option.date === routeDate);
    if (sameDateOptions.length > 0) {
      if (!sameDateOptions.some((option) => option.timeSlot === routeTimeSlot)) {
        setRouteTimeSlot(sameDateOptions[0].timeSlot);
      }
      return;
    }
    setRouteDate(trackingRouteOptions[0].date);
    setRouteTimeSlot(trackingRouteOptions[0].timeSlot);
  }, [routeDate, routeTimeSlot, trackingRouteOptions]);

  useEffect(() => {
    if (!trackedDoctors.length) {
      setSelectedDoctorId("");
      return;
    }
    if (!trackedDoctors.some((doctor) => doctor.doctorId === selectedDoctorId)) {
      setSelectedDoctorId(trackedDoctors[0].doctorId);
    }
  }, [selectedDoctorId, trackedDoctors]);

  const selectedDoctor = trackedDoctors.find((doctor) => doctor.doctorId === selectedDoctorId) ?? trackedDoctors[0];
  const selectedRouteLayer = useMemo(
    () => (selectedDistributionRoute ? buildTrackingRouteLayerPoints(selectedDistributionRoute.schedules) : []),
    [selectedDistributionRoute]
  );
  const recenterTrackingMap = (doctor: DoctorTrackingSummary | undefined) => {
    if (!doctor && !trackedDoctors.length) {
      return;
    }
    setTrackingMapView(
      buildTrackingMapView(
        {
          doctors: trackedDoctors,
          routeLayerPoints: selectedRouteLayer,
          selectedDoctor: doctor
        },
        trackingMapSize
      )
    );
  };

  const updateTrackingMapZoom = (delta: number) => {
    setTrackingMapView((current) => {
      if (!current) {
        return current;
      }
      const nextZoom = Math.max(trackingMapMinZoom, Math.min(trackingMapMaxZoom, current.zoom + delta));
      if (nextZoom === current.zoom) {
        return current;
      }
      return {
        ...current,
        zoom: nextZoom
      };
    });
  };

  useEffect(() => {
    const mapElement = mapContainerRef.current;
    if (!mapElement) {
      return;
    }

    const syncMapSize = (rect: Pick<DOMRectReadOnly, "width" | "height">) => {
      setTrackingMapSize({
        width: Math.max(Math.round(rect.width), 1),
        height: Math.max(Math.round(rect.height), 1)
      });
    };

    syncMapSize(mapElement.getBoundingClientRect());

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => syncMapSize(mapElement.getBoundingClientRect());
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        syncMapSize(entry.contentRect);
      }
    });
    observer.observe(mapElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const mapElement = mapContainerRef.current;
    if (!mapElement) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    mapElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      mapElement.removeEventListener("wheel", handleWheel);
    };
  }, [selectedDoctor?.doctorId]);

  useEffect(() => {
    if (!trackedDoctors.length) {
      setTrackingMapView(null);
      autoCenteredDoctorKeyRef.current = "";
      return;
    }
    const doctorKey = `${selectedDoctor?.doctorId ?? "all"}|${selectedDistributionRouteId}|${routeDate}|${routeTimeSlot}`;
    if (autoCenteredDoctorKeyRef.current === doctorKey) {
      return;
    }
    setTrackingMapView(
      buildTrackingMapView(
        {
          doctors: trackedDoctors,
          routeLayerPoints: selectedRouteLayer,
          selectedDoctor
        },
        trackingMapSize
      )
    );
    autoCenteredDoctorKeyRef.current = doctorKey;
  }, [routeDate, routeTimeSlot, selectedDistributionRouteId, selectedDoctor, selectedRouteLayer, trackedDoctors, trackingMapSize]);

  const visibleMapTiles = useMemo(() => {
    if (!trackingMapView) {
      return [];
    }
    const zoom = trackingMapView.zoom;
    const tileCount = 2 ** zoom;
    const centerWorldX = trackingLongitudeToWorld(trackingMapView.centerLongitude, zoom);
    const centerWorldY = trackingLatitudeToWorld(trackingMapView.centerLatitude, zoom);
    const leftWorld = centerWorldX - trackingMapSize.width / 2;
    const topWorld = centerWorldY - trackingMapSize.height / 2;
    const startTileX = Math.floor(leftWorld / trackingMapTileSize);
    const endTileX = Math.floor((leftWorld + trackingMapSize.width) / trackingMapTileSize);
    const startTileY = Math.floor(topWorld / trackingMapTileSize);
    const endTileY = Math.floor((topWorld + trackingMapSize.height) / trackingMapTileSize);

    const tiles: Array<{ key: string; src: string; left: number; top: number }> = [];
    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
        if (tileY < 0 || tileY >= tileCount) {
          continue;
        }
        const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${zoom}-${wrappedTileX}-${tileY}-${tileX}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
          left: tileX * trackingMapTileSize - leftWorld,
          top: tileY * trackingMapTileSize - topWorld
        });
      }
    }
    return tiles;
  }, [trackingMapSize, trackingMapView]);

  const trackingMapScreenPoints = useMemo(() => {
    if (!trackingMapView) {
      return null;
    }
    const routeStops = selectedRouteLayer.map((point) => ({
      ...point,
      ...projectTrackingPointToScreen(point.latitude, point.longitude, trackingMapView, trackingMapSize)
    }));
    const doctorPoints = trackedDoctors
      .map((doctor) =>
        doctor.displayLocation
          ? {
              doctor,
              ...projectTrackingPointToScreen(
                doctor.displayLocation.latitude,
                doctor.displayLocation.longitude,
                trackingMapView,
                trackingMapSize
              )
            }
          : null
      )
      .filter(
        (
          point
        ): point is {
          doctor: DoctorTrackingSummary;
          x: number;
          y: number;
        } => Boolean(point)
      );

    return {
      routeStops,
      doctorPoints
    };
  }, [selectedRouteLayer, trackedDoctors, trackingMapSize, trackingMapView]);

  const handleTrackingDoctorFocus = (doctorId: string) => {
    const targetDoctor = trackedDoctors.find((doctor) => doctor.doctorId === doctorId);
    setSelectedDoctorId(doctorId);
    recenterTrackingMap(targetDoctor);
    autoCenteredDoctorKeyRef.current = targetDoctor ? `${targetDoctor.doctorId}|${selectedDistributionRouteId}|${routeDate}|${routeTimeSlot}` : "";
  };
  const isTrackingZoomInDisabled = !trackingMapView || trackingMapView.zoom >= trackingMapMaxZoom;
  const isTrackingZoomOutDisabled = !trackingMapView || trackingMapView.zoom <= trackingMapMinZoom;

  return (
    <div className="space-y-4">
      <Panel title="同時段醫師追蹤總覽" className="p-2.5 lg:p-3.5">
        <div className="space-y-2.5">
          <div className="grid gap-2.5 lg:grid-cols-[170px_130px_minmax(260px,1fr)_1fr]">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">路線日期</span>
              <input
                type="date"
                value={routeDate}
                onChange={(event) => setRouteDate(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-2.5"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">規劃時段</span>
              <select
                aria-label="規劃時段"
                value={routeTimeSlot}
                onChange={(event) => setRouteTimeSlot(event.target.value as RouteTimeSlot)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-2.5"
              >
                {routeTimeSlotOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">個案分布排程</span>
              <select
                aria-label="個案分布排程"
                value={selectedDistributionRouteId}
                onChange={(event) => {
                  const nextRouteId = event.target.value;
                  setSelectedDistributionRouteId(nextRouteId);
                  const nextRoute = routeDistributionOptions.find((option) => option.id === nextRouteId);
                  if (nextRoute) {
                    setRouteDate(nextRoute.routeDate);
                    setRouteTimeSlot(nextRoute.timeSlot);
                  }
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-2.5"
              >
                <option value="">不疊個案分布點</option>
                {routeDistributionOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-2xl bg-slate-50 px-4 py-2 text-sm text-slate-600">
              {trackedDoctors.length > 0
                ? `目前已載入 ${trackedDoctors.length} 位醫師位置；個案分布：${selectedDistributionRoute ? selectedDistributionRoute.label : "未選擇"}。`
                : "目前沒有醫師可顯示。"}
            </div>
          </div>

          <div className="rounded-[1.45rem] border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div>
                <p className="text-sm font-semibold text-brand-ink">
                  {selectedDoctor ? `${selectedDoctor.doctorName} 追蹤地圖` : "全部醫師追蹤地圖"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  地圖會同時顯示所有醫師最新位置；個案分布點依上方選擇的排程疊加。
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                {trackedDoctors.map((doctor) => (
                  <button
                    key={doctor.doctorId}
                    type="button"
                    onClick={() => handleTrackingDoctorFocus(doctor.doctorId)}
                    className={`rounded-full px-3 py-1.5 font-semibold ${
                      selectedDoctor?.doctorId === doctor.doctorId
                        ? "text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                    style={
                      selectedDoctor?.doctorId === doctor.doctorId
                        ? { backgroundColor: doctor.color }
                        : undefined
                    }
                  >
                    {doctor.doctorName}
                  </button>
                ))}
              </div>
            </div>

            {trackingMapView && trackingMapScreenPoints ? (
              <div
                aria-label={selectedDoctor ? `${selectedDoctor.doctorName} 追蹤地圖` : "全部醫師追蹤地圖"}
                title={selectedDoctor ? `${selectedDoctor.doctorName} Google Map 追蹤圖` : "Google Map 追蹤圖"}
                ref={mapContainerRef}
                onPointerDown={(event) => {
                  if (!trackingMapView) {
                    return;
                  }
                  const currentTarget = event.currentTarget;
                  currentTarget.setPointerCapture(event.pointerId);
                  dragStateRef.current = {
                    pointerId: event.pointerId,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startCenterWorldX: trackingLongitudeToWorld(trackingMapView.centerLongitude, trackingMapView.zoom),
                    startCenterWorldY: trackingLatitudeToWorld(trackingMapView.centerLatitude, trackingMapView.zoom)
                  };
                }}
                onPointerMove={(event) => {
                  if (!dragStateRef.current || !trackingMapView) {
                    return;
                  }
                  const dragState = dragStateRef.current;
                  const nextCenterWorldX = dragState.startCenterWorldX - (event.clientX - dragState.startClientX);
                  const nextCenterWorldY = dragState.startCenterWorldY - (event.clientY - dragState.startClientY);
                  setTrackingMapView((current) =>
                    current
                      ? {
                          ...current,
                          centerLongitude: trackingWorldToLongitude(nextCenterWorldX, current.zoom),
                          centerLatitude: trackingWorldToLatitude(nextCenterWorldY, current.zoom)
                        }
                      : current
                  );
                }}
                onPointerUp={(event) => {
                  if (dragStateRef.current?.pointerId === event.pointerId) {
                    dragStateRef.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
                onPointerCancel={(event) => {
                  if (dragStateRef.current?.pointerId === event.pointerId) {
                    dragStateRef.current = null;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
                className="relative mt-2.5 h-[340px] overflow-hidden rounded-[1.35rem] border border-slate-200 bg-slate-100 touch-none cursor-grab active:cursor-grabbing lg:h-[380px]"
              >
                <div className="absolute inset-0 z-0 bg-[#eef3ee]">
                  {visibleMapTiles.map((tile) => (
                    <img
                      key={tile.key}
                      src={tile.src}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute select-none"
                      style={{
                        left: tile.left,
                        top: tile.top,
                        width: trackingMapTileSize,
                        height: trackingMapTileSize
                      }}
                    />
                  ))}
                </div>
                <div
                  className="absolute right-3 top-3 z-20 flex flex-col gap-2"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <span
                    aria-label="目前地圖縮放層級"
                    className="rounded-full border border-white/80 bg-white/95 px-3 py-1.5 text-center text-[11px] font-semibold text-slate-600 shadow-sm backdrop-blur"
                  >
                    縮放 {trackingMapView.zoom}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      updateTrackingMapZoom(1);
                    }}
                    disabled={isTrackingZoomInDisabled}
                    className="rounded-full border border-white/80 bg-white/95 px-3 py-2 text-xs font-semibold text-brand-ink shadow-sm backdrop-blur disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    放大地圖
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      updateTrackingMapZoom(-1);
                    }}
                    disabled={isTrackingZoomOutDisabled}
                    className="rounded-full border border-white/80 bg-white/95 px-3 py-2 text-xs font-semibold text-brand-ink shadow-sm backdrop-blur disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    縮小地圖
                  </button>
                </div>
                <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.16),_transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.06),rgba(15,23,42,0.03))]" />
                <svg
                  viewBox={`0 0 ${trackingMapSize.width} ${trackingMapSize.height}`}
                  className="pointer-events-none absolute inset-0 z-10 h-full w-full select-none"
                >
                  <defs>
                    <filter id="tracking-marker-shadow" x="-50%" y="-50%" width="200%" height="200%">
                      <feDropShadow dx="0" dy="1.2" stdDeviation="1.8" floodColor="#0f172a" floodOpacity="0.28" />
                    </filter>
                  </defs>
                  <polyline
                    points={trackingMapScreenPoints.routeStops.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke={trackedDoctors.find((doctor) => doctor.doctorId === selectedDistributionRoute?.doctorId)?.color ?? "#0f766e"}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.9"
                  />
                  {trackingMapScreenPoints.routeStops.map((point) => {
                    const isActiveStop = point.kind === "stop" && point.schedule?.id === selectedDoctor?.activeSchedule?.id;
                    const isHospitalPoint = point.kind !== "stop";
                    const routeColor = trackedDoctors.find((doctor) => doctor.doctorId === selectedDistributionRoute?.doctorId)?.color ?? "#0f766e";
                    return (
                      <g key={point.key}>
                        <circle
                          cx={point.x}
                          cy={point.y}
                          r={isHospitalPoint ? 13 : 11}
                          fill={isHospitalPoint ? "#0f172a" : routeColor}
                          stroke="#ffffff"
                          strokeWidth="3"
                          opacity={point.kind === "stop" && point.schedule?.status === "completed" ? 0.7 : 1}
                        />
                        {isActiveStop ? (
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={18}
                            fill="none"
                            stroke={routeColor}
                            strokeWidth="3"
                            opacity="0.35"
                          />
                        ) : null}
                        <text
                          x={point.x}
                          y={point.y + 4}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight="700"
                          fill="#ffffff"
                        >
                          {point.label}
                        </text>
                      </g>
                    );
                  })}
                  {trackingMapScreenPoints.doctorPoints.map(({ doctor, x, y }) => {
                    const isSelectedDoctor = doctor.doctorId === selectedDoctor?.doctorId;
                    return (
                    <g key={doctor.doctorId}>
                      <circle
                        cx={x}
                        cy={y}
                        r={isSelectedDoctor ? 28 : 22}
                        fill={doctor.color}
                        opacity={isSelectedDoctor ? "0.18" : "0.1"}
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={isSelectedDoctor ? 18 : 14}
                        fill="none"
                        stroke={doctor.color}
                        strokeWidth="3"
                        opacity={isSelectedDoctor ? "0.5" : "0.32"}
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={11}
                        fill="#ffffff"
                        filter="url(#tracking-marker-shadow)"
                      />
                      <circle
                        cx={x}
                        cy={y}
                        r={7}
                        fill={doctor.color}
                      />
                      <g
                        aria-label={`${doctor.doctorName} ${doctor.displayLocation?.markerLabel ?? "目前位置"}標記`}
                        filter="url(#tracking-marker-shadow)"
                      >
                        <rect
                          x={Math.min(
                            Math.max(x - 54, 10),
                            trackingMapSize.width - 140
                          )}
                          y={Math.max(y - 52, 10)}
                          rx="12"
                          ry="12"
                          width="118"
                          height="32"
                          fill="#ffffff"
                          opacity="0.98"
                        />
                        <text
                          x={Math.min(
                            Math.max(x + 5, 69),
                            trackingMapSize.width - 81
                          )}
                          y={Math.max(y - 31, 31)}
                          textAnchor="middle"
                          fontSize="12"
                          fontWeight="700"
                          fill={doctor.color}
                        >
                          {doctor.displayLocation?.markerLabel ?? "目前位置"}
                        </text>
                      </g>
                    </g>
                    );
                  })}
                </svg>
                <div className="absolute left-3 top-3 z-20 rounded-full bg-white/92 px-3 py-1 text-[11px] font-semibold text-brand-ink shadow-sm">
                  可拖曳移動地圖，請改用右上角按鍵放大或縮小，重新點醫師姓名可回到醫師中心
                </div>
              </div>
            ) : (
              <div className="mt-2.5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                目前這個日期與時段沒有可繪製的醫師位置資料。
              </div>
            )}
          </div>

          <div className="grid gap-2.5 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="grid gap-2.5 md:grid-cols-2">
              {trackedDoctors.map((doctor) => (
                <div
                  key={doctor.doctorId}
                  className={`rounded-[1.45rem] border p-3.5 ${
                    selectedDoctor?.doctorId === doctor.doctorId
                      ? "border-brand-forest bg-emerald-50/40"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div>
                      <p className="font-semibold text-brand-ink">{doctor.doctorName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {doctor.latestLocation
                          ? `最後定位 ${formatDateTimeFull(doctor.latestLocation.recorded_at)}`
                          : "未上線，已用最近排程起點作為參考位置"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex h-3.5 w-3.5 rounded-full"
                        style={{ backgroundColor: doctor.color }}
                      />
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getLocationStatusTone(
                          doctor.locationStatus
                        )}`}
                      >
                        {getLocationStatusLabel(doctor.locationStatus)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-3 text-sm">
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">目前案件</p>
                      <p className="mt-1.5 font-semibold text-brand-ink">
                        {doctor.activePatientName ?? "待命中"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">已過站點</p>
                      <p className="mt-1.5 font-semibold text-brand-ink">{doctor.passedStops.length}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-500">未到站點</p>
                      <p className="mt-1.5 font-semibold text-brand-ink">{doctor.upcomingStops.length}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {doctor.currentDistanceKilometers !== null
                      ? `距離目前案件約 ${doctor.currentDistanceKilometers.toFixed(1)} 公里`
                      : doctor.displayLocation?.isFallback
                        ? "未上線，位置顯示在最近排程起點周圍"
                        : "等待定位或案件座標"}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {doctor.routeMapUrl ? (
                      <a
                        href={doctor.routeMapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-brand-forest px-3.5 py-2 text-xs font-semibold text-white"
                      >
                        打開 {doctor.doctorName} 路線
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleTrackingDoctorFocus(doctor.doctorId)}
                      className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-brand-ink"
                    >
                      查看細節
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {selectedDoctor ? (
              <div className="space-y-2.5">
                <div className="rounded-[1.45rem] border border-slate-200 bg-white p-3.5">
                  <div>
                    <div>
                      <p className="font-semibold text-brand-ink">{selectedDoctor.doctorName} 細節</p>
                      <p className="mt-1 text-sm text-slate-500">
                        目前對應案件：
                        {selectedDoctor.activeSchedule
                          ? ` 第 ${selectedDoctor.activeSchedule.route_order} 站 ${selectedDoctor.activePatientName ?? selectedDoctor.activeSchedule.patient_id}`
                          : " 尚無"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 grid gap-2 md:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <p className="text-xs text-slate-500">目前位置</p>
                      <p className="mt-1.5 font-semibold text-brand-ink">
                        {selectedDoctor.displayLocation?.addressLabel ?? "未上線"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <p className="text-xs text-slate-500">最新時間</p>
                      <p className="mt-1.5 font-semibold text-brand-ink">
                        {selectedDoctor.latestLocation
                          ? formatDateTimeFull(selectedDoctor.latestLocation.recorded_at)
                          : "未上線"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      <p className="text-xs text-slate-500">定位狀態</p>
                      <p className="mt-1.5 font-semibold text-brand-ink">
                        {getLocationStatusLabel(selectedDoctor.locationStatus)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2.5 md:grid-cols-2">
                  <div className="rounded-[1.45rem] border border-slate-200 bg-white p-3.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">已經過的地點</p>
                      <span className="text-xs text-slate-500">{selectedDoctor.passedStops.length} 筆</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {selectedDoctor.passedStops.length ? (
                        selectedDoctor.passedStops.map((schedule) => {
                          const patient = db.patients.find((item) => item.id === schedule.patient_id);
                          return (
                            <div key={schedule.id} className="rounded-2xl bg-slate-50 px-3 py-2">
                              <p className="font-medium text-brand-ink">
                                第 {schedule.route_order} 站 {patient ? maskPatientName(patient.name) : schedule.patient_id}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatTimeOnly(schedule.scheduled_start_at)} / {schedule.area}
                              </p>
                            </div>
                          );
                        })
                      ) : (
                        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                          目前還沒有已過站點。
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[1.45rem] border border-slate-200 bg-white p-3.5 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">尚未到的地點</p>
                      <span className="text-xs text-slate-500">{selectedDoctor.upcomingStops.length} 筆</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {selectedDoctor.upcomingStops.length ? (
                        selectedDoctor.upcomingStops.map((schedule) => {
                          const patient = db.patients.find((item) => item.id === schedule.patient_id);
                          return (
                            <div key={schedule.id} className="rounded-2xl bg-slate-50 px-3 py-2">
                              <p className="font-medium text-brand-ink">
                                第 {schedule.route_order} 站 {patient ? maskPatientName(patient.name) : schedule.patient_id}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatTimeOnly(schedule.scheduled_start_at)} / {schedule.area}
                              </p>
                            </div>
                          );
                        })
                      ) : (
                        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                          目前這位醫師沒有待前往站點。
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Panel>

    </div>
  );
}

export function AdminPatientsPage() {
  const { repositories, db, services } = useAppContext();
  const patients = repositories.patientRepository.getPatients();
  const displayPatients = useMemo(
    () =>
      [...patients].sort((left, right) => {
        if (left.status === "closed" && right.status !== "closed") {
          return 1;
        }
        if (left.status !== "closed" && right.status === "closed") {
          return -1;
        }
        return left.chart_number.localeCompare(right.chart_number, "zh-Hant");
      }),
    [patients]
  );
  const [selectedId, setSelectedId] = useState<string>(patients[0]?.id ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Patient>(() => buildPatientDraft(patients[0]));
  const [selectedPatientIds, setSelectedPatientIds] = useState<string[]>([]);
  const [recentAction, setRecentAction] = useState<string | null>(null);

  const selectedPatient = patients.find((patient) => patient.id === selectedId);
  const selectedProfile = selectedPatient
    ? repositories.patientRepository.getPatientProfile(selectedPatient.id)
    : undefined;
  const selectedDoctor =
    db.doctors.find((doctor) => doctor.id === draft.preferred_doctor_id) ?? db.doctors[0];
  const availableServiceSlots = useMemo(
    () => selectedDoctor?.available_service_slots ?? [],
    [selectedDoctor]
  );
  const syncDraft = (patient?: Patient) => {
    const next = buildPatientDraft(patient);
    if (!next.preferred_service_slot) {
      next.preferred_service_slot =
        db.doctors.find((doctor) => doctor.id === next.preferred_doctor_id)?.available_service_slots[0] ?? "";
    }
    setSelectedId(next.id);
    setDraft(next);
  };

  const openPatientEditor = (patient?: Patient) => {
    syncDraft(patient);
    setEditorOpen(true);
  };

  const closePatientEditor = () => {
    setEditorOpen(false);
  };

  const togglePatientSelection = (patientId: string, checked: boolean) => {
    setSelectedPatientIds((current) =>
      checked
        ? Array.from(new Set([...current, patientId]))
        : current.filter((id) => id !== patientId)
    );
  };

  const pausePatients = (targetIds: string[], actionLabel: string) => {
    if (targetIds.length === 0) {
      setRecentAction("請先勾選個案。");
      return;
    }

    let pausedCount = 0;
    let skippedClosedCount = 0;

    targetIds.forEach((patientId) => {
      const patient = repositories.patientRepository.getPatientById(patientId);
      if (!patient) {
        return;
      }
      if (patient.status === "closed") {
        skippedClosedCount += 1;
        return;
      }

      repositories.patientRepository.upsertPatient({
        ...patient,
        status: "paused"
      });
      pausedCount += 1;
    });

    setRecentAction(
      `${actionLabel}完成：已暫停 ${pausedCount} 位個案${
        skippedClosedCount > 0 ? `，略過 ${skippedClosedCount} 位已結案個案` : ""
      }。`
    );
  };

  const resumePatients = (targetIds: string[], actionLabel: string) => {
    if (targetIds.length === 0) {
      setRecentAction("請先勾選個案。");
      return;
    }

    let resumedCount = 0;
    let skippedClosedCount = 0;
    let skippedActiveCount = 0;
    let unsyncedCount = 0;

    targetIds.forEach((patientId) => {
      const patient = repositories.patientRepository.getPatientById(patientId);
      if (!patient) {
        return;
      }
      if (patient.status === "closed") {
        skippedClosedCount += 1;
        return;
      }
      if (patient.status === "active") {
        skippedActiveCount += 1;
        return;
      }

      const result = repositories.patientRepository.upsertPatient({
        ...patient,
        status: "active"
      });
      resumedCount += 1;
      if (!result.scheduleSynced) {
        unsyncedCount += 1;
      }
    });

    setRecentAction(
      `${actionLabel}完成：已恢復 ${resumedCount} 位個案${
        skippedClosedCount > 0 ? `，略過 ${skippedClosedCount} 位已結案個案` : ""
      }${
        skippedActiveCount > 0 ? `，略過 ${skippedActiveCount} 位原本已在服務中的個案` : ""
      }${
        unsyncedCount > 0 ? `，其中 ${unsyncedCount} 位尚未建立本次路線` : ""
      }。`
    );
  };

  const closePatients = (targetIds: string[], actionLabel: string) => {
    if (targetIds.length === 0) {
      setRecentAction("請先勾選個案。");
      return;
    }

    let closedCount = 0;
    let skippedAlreadyClosedCount = 0;

    targetIds.forEach((patientId) => {
      const patient = repositories.patientRepository.getPatientById(patientId);
      if (!patient) {
        return;
      }
      if (patient.status === "closed") {
        skippedAlreadyClosedCount += 1;
        return;
      }

      repositories.patientRepository.closePatient(patientId, actionLabel);
      closedCount += 1;
    });

    setRecentAction(
      `${actionLabel}完成：已結案 ${closedCount} 位個案${
        skippedAlreadyClosedCount > 0 ? `，略過 ${skippedAlreadyClosedCount} 位原本已結案個案` : ""
      }。`
    );
  };

  useEffect(() => {
    if (!availableServiceSlots.length) {
      if (draft.preferred_service_slot) {
        setDraft((current) => ({ ...current, preferred_service_slot: "" }));
      }
      return;
    }
    if (!availableServiceSlots.includes(draft.preferred_service_slot)) {
      setDraft((current) => ({
        ...current,
        preferred_service_slot: availableServiceSlots[0]
      }));
    }
  }, [availableServiceSlots, draft.preferred_service_slot]);

  const saveDraft = () => {
    if (draft.status === "closed" && draft.id) {
      const closeResult = repositories.patientRepository.closePatient(draft.id, "個案管理頁結案");
      setSelectedPatientIds((current) => current.filter((id) => id !== draft.id));
      const nextPatient = patients.find((patient) => patient.id !== draft.id && patient.status !== "closed");
      if (selectedPatient?.id === draft.id && nextPatient) {
        syncDraft(nextPatient);
      }
      setRecentAction(closeResult.message);
      setEditorOpen(false);
      return;
    }

    const normalizedPatientName = anonymizePatientName(draft.name);
    const result = repositories.patientRepository.upsertPatient({
      ...draft,
      name: normalizedPatientName,
      chart_number: draft.chart_number || `AUTO-${Date.now().toString().slice(-6)}`,
      address: draft.home_address || draft.address,
      home_address: draft.home_address || draft.address,
      location_keyword: normalizeLocationKeyword(draft.location_keyword),
      google_maps_link: mapsLink(
        draft.home_address || draft.address || "台北市",
        draft.location_keyword
      ),
      reminder_tags: draft.reminder_tags.filter(Boolean)
    });
    setRecentAction(
      `已儲存 ${maskPatientName(draft.name || "新個案")}。${result.skippedReason ?? "請到排程管理頁建立或實行路線。"}`
    );
    setDraft((current) => ({
      ...current,
      name: normalizedPatientName,
      chart_number: result.chartNumber,
      location_keyword: normalizeLocationKeyword(current.location_keyword),
      google_maps_link: mapsLink(
        current.home_address || current.address || "台北市",
        current.location_keyword
      )
    }));
    setEditorOpen(false);
  };

  const activeStatusOptionLabel = selectedPatient?.status === "paused" ? "恢復治療" : "服務中";

  const deletePatient = (targetPatient?: Patient) => {
    if (!targetPatient) {
      setRecentAction("請先選擇要刪除的個案。");
      return;
    }

    const confirmed = window.confirm(
      `確定要刪除 ${maskPatientName(targetPatient.name)} 嗎？相關排程、訪視紀錄與流程資料也會一併移除。`
    );
    if (!confirmed) {
      return;
    }

    const result = repositories.patientRepository.removePatient(targetPatient.id);
    if (!result.removed) {
      setRecentAction(
        `無法刪除 ${maskPatientName(targetPatient.name)}：${result.blockedReason ?? "未提供原因"}。`
      );
      return;
    }

    const nextPatient = patients.find((patient) => patient.id !== targetPatient.id);
    setSelectedPatientIds((current) => current.filter((id) => id !== targetPatient.id));
    if (selectedPatient?.id === targetPatient.id) {
      syncDraft(nextPatient);
    }
    const activeScheduleNotice =
      result.removedActiveScheduleCount > 0
        ? `，其中 ${result.removedActiveScheduleCount} 筆進行中訪視已取消並除名`
        : "";
    setRecentAction(
      `已刪除 ${maskPatientName(targetPatient.name)}，並清除 ${result.removedScheduleCount} 筆相關排程${activeScheduleNotice}。`
    );
    setEditorOpen(false);
  };

  const batchDeletePatients = (targetIds: string[]) => {
    if (targetIds.length === 0) {
      setRecentAction("請先勾選個案。");
      return;
    }

    const targetPatients = targetIds
      .map((patientId) => patients.find((patient) => patient.id === patientId))
      .filter((patient): patient is Patient => Boolean(patient));
    if (targetPatients.length === 0) {
      setRecentAction("找不到可刪除的個案。");
      setSelectedPatientIds([]);
      return;
    }

    const confirmed = window.confirm(
      `確定要批次刪除 ${targetPatients.length} 位個案嗎？相關排程、訪視紀錄與流程資料也會一併移除。`
    );
    if (!confirmed) {
      return;
    }

    const result = repositories.patientRepository.removePatients(
      targetPatients.map((patient) => patient.id)
    );
    const removedPatientIds = result.results
      .filter((item) => item.removed)
      .map((item) => item.patientId);
    const firstBlockedResult = result.results.find((item) => !item.removed);
    const firstBlockedPatient = firstBlockedResult
      ? targetPatients.find((patient) => patient.id === firstBlockedResult.patientId)
      : undefined;
    const firstBlockedReason =
      firstBlockedResult && firstBlockedPatient
        ? `${maskPatientName(firstBlockedPatient.name)}：${firstBlockedResult.blockedReason ?? "未提供原因"}`
        : "";

    setSelectedPatientIds((current) => current.filter((id) => !removedPatientIds.includes(id)));
    if (selectedPatient && removedPatientIds.includes(selectedPatient.id)) {
      syncDraft(patients.find((patient) => !removedPatientIds.includes(patient.id)));
      setEditorOpen(false);
    }
    setRecentAction(
      `批次刪除完成：已刪除 ${result.removedCount} 位個案，並清除 ${result.removedScheduleCount} 筆相關排程${
        result.removedActiveScheduleCount > 0
          ? `，其中 ${result.removedActiveScheduleCount} 筆進行中訪視已取消並除名`
          : ""
      }${
        result.blockedCount > 0 ? `，略過 ${result.blockedCount} 位。${firstBlockedReason}` : ""
      }。`
    );
  };

  const deleteSelectedPatient = () => deletePatient(selectedPatient);

  const handlePatientImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const isSpreadsheet = /\.(xlsx|xls)$/i.test(file.name) || file.type.includes("spreadsheet");
    const importRows = buildPatientImportRows(await readUploadedPatientRows(file));
    if (!importRows) {
      setRecentAction("匯入欄位不足，請確認檔案符合居家患者名單格式後再匯入。");
      event.target.value = "";
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;
    const skippedReasons: string[] = [];

    const defaultDoctor = db.doctors[0];
    let geocodedCount = 0;
    let geocodeFailedCount = 0;
    const geocodeFailureReasons: string[] = [];

    for (const [index, row] of importRows.entries()) {
      if (!row.name || !row.address || !row.serviceSlot) {
        skippedCount += 1;
        skippedReasons.push(`第 ${row.rowNumber} 列缺少姓名、地址或服務時段`);
        continue;
      }

      const doctor =
        db.doctors.find((item) => item.name === row.doctorRaw) ??
        db.doctors.find((item) => item.id === row.doctorRaw) ??
        defaultDoctor;
      if (!doctor) {
        skippedCount += 1;
        skippedReasons.push(`第 ${row.rowNumber} 列找不到可用醫師`);
        continue;
      }

      const patientToImport = buildPatientDraft();
      const patientId = `pat-import-${Date.now()}-${index}`;
      repositories.patientRepository.upsertPatient({
        ...patientToImport,
        id: patientId,
        name: anonymizePatientName(row.name),
        chart_number: row.chartNumber,
        phone: row.phone,
        service_needs: row.serviceNeeds,
        primary_diagnosis: row.diagnosis,
        address: row.address,
        home_address: row.address,
        location_keyword: sameAddressLocationKeyword,
        google_maps_link: mapsLink(row.address, sameAddressLocationKeyword),
        preferred_doctor_id: doctor.id,
        preferred_service_slot: row.serviceSlot,
        status: row.status,
        notes: row.notes,
        reminder_tags: row.reminderTags
      });

      if (row.status === "active") {
        const geocodedAddress = await services.maps.geocodeAddress({ address: row.address });
        if (geocodedAddress) {
          repositories.patientRepository.updatePatientCoordinates(patientId, {
            homeLatitude: geocodedAddress.latitude,
            homeLongitude: geocodedAddress.longitude,
            geocodingStatus: "resolved",
            googleMapsLink: services.maps.buildPatientMapUrl({
              address: geocodedAddress.formattedAddress,
              latitude: geocodedAddress.latitude,
              longitude: geocodedAddress.longitude
            })
          });
          geocodedCount += 1;
        } else {
          repositories.patientRepository.updatePatientCoordinates(patientId, {
            homeLatitude: null,
            homeLongitude: null,
            geocodingStatus: "failed"
          });
          const geocodeFailureReason = services.maps.getLastGeocodeError();
          if (geocodeFailureReason) {
            geocodeFailureReasons.push(geocodeFailureReason);
          }
          geocodeFailedCount += 1;
        }
      }

      importedCount += 1;
    }

    const geocodingText =
      geocodedCount > 0 || geocodeFailedCount > 0
        ? ` Google Map 已補上 ${geocodedCount} 筆座標${
            geocodeFailedCount > 0 ? `，${geocodeFailedCount} 筆仍找不到座標` : ""
          }${geocodeFailureReasons.length > 0 ? `，原因：${geocodeFailureReasons[0]}` : ""}。`
        : "";
    setRecentAction(
      skippedReasons.length > 0
        ? `${isSpreadsheet ? "Excel" : "CSV"} 匯入完成：成功 ${importedCount} 筆，略過 ${skippedCount} 筆。${skippedReasons[0]}${geocodingText}`
        : `${isSpreadsheet ? "Excel" : "CSV"} 匯入完成：成功 ${importedCount} 筆。${geocodingText}`
    );
    event.target.value = "";
  };

  const handleDownloadCsvTemplate = () => {
    downloadCsvFile("patient-import-template.csv", buildCsvTemplate());
  };

  return (
    <div className="space-y-6">
      <Panel
        title="個案管理頁"
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownloadCsvTemplate}
              className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
            >
              下載 CSV 範本
            </button>
            <label className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200">
              CSV / Excel 匯入
              <input
                type="file"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="sr-only"
                onChange={(event) => void handlePatientImport(event)}
              />
            </label>
            <button
              type="button"
              onClick={() => openPatientEditor()}
              className="rounded-full bg-brand-coral px-4 py-2 text-sm font-semibold text-white"
            >
              新增個案
            </button>
          </div>
        }
      >
        {recentAction ? (
          <div
            role="status"
            className="mb-4 rounded-2xl border border-brand-sand bg-brand-sand/50 px-4 py-3 text-sm text-brand-ink"
          >
            最近操作：{recentAction}
          </div>
        ) : null}
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-semibold text-brand-ink">
              批次處理區
            </p>
            <p className="text-slate-500">目前已勾選 {selectedPatientIds.length} 位個案</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => pausePatients(selectedPatientIds, "批次暫停")}
              className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
            >
              暫停
            </button>
            <button
              type="button"
              onClick={() => resumePatients(selectedPatientIds, "批次恢復")}
              className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200"
            >
              恢復
            </button>
            <button
              type="button"
              onClick={() => closePatients(selectedPatientIds, "批次結案")}
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300"
            >
              結案
            </button>
            <button
              type="button"
              onClick={() => batchDeletePatients(selectedPatientIds)}
              className="rounded-full bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 ring-1 ring-rose-200"
            >
              批次刪除
            </button>
            <button
              type="button"
              onClick={() => setSelectedPatientIds(patients.map((patient) => patient.id))}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
            >
              全選
            </button>
            <button
              type="button"
              onClick={() => setSelectedPatientIds([])}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
            >
              清除全選
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="max-h-[calc(100dvh-320px)] min-h-[320px] overflow-auto">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <caption className="sr-only">個案管理清單</caption>
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold text-slate-500 shadow-[0_1px_0_rgba(148,163,184,0.28)]">
                <tr>
                  <th scope="col" className="w-12 px-4 py-3">選取</th>
                  <th scope="col" className="px-4 py-3">個案姓名</th>
                  <th scope="col" className="px-4 py-3">狀態</th>
                  <th scope="col" className="px-4 py-3">主診斷</th>
                  <th scope="col" className="px-4 py-3">需求</th>
                  <th scope="col" className="px-4 py-3">服務時段</th>
                  <th scope="col" className="px-4 py-3">負責醫師</th>
                  <th scope="col" className="min-w-[220px] px-4 py-3">地址 / 定位</th>
                  <th scope="col" className="w-40 px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayPatients.map((patient) => {
                  const isClosedPatient = patient.status === "closed";
                  const isSelectedPatient = selectedId === patient.id;
                  const maskedName = maskPatientName(patient.name);
                  const addressLabel = patient.home_address || patient.address || "未設定";
                  const locationLabel =
                    patient.location_keyword === sameAddressLocationKeyword
                      ? `同住址（${resolveLocationKeyword(patient.location_keyword, addressLabel)}）`
                      : patient.location_keyword || "未設定";

                  return (
                    <tr
                      key={patient.id}
                      data-patient-id={patient.id}
                      data-patient-status={patient.status}
                      className={`align-top transition ${
                        isClosedPatient
                          ? "bg-slate-100 text-slate-500"
                          : isSelectedPatient
                            ? "bg-brand-sand/55"
                            : "bg-white hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedPatientIds.includes(patient.id)}
                          onChange={(event) => togglePatientSelection(patient.id, event.target.checked)}
                          aria-label={`${maskedName} 勾選`}
                        />
                      </td>
                      <th scope="row" className={`px-4 py-3 font-semibold ${isClosedPatient ? "text-slate-500" : "text-brand-ink"}`}>
                        {maskedName}
                      </th>
                      <td className="px-4 py-3">
                        <Badge value={patient.status} compact />
                      </td>
                      <td className={`px-4 py-3 ${isClosedPatient ? "text-slate-500" : "text-slate-700"}`}>
                        {patient.primary_diagnosis || "未設定"}
                      </td>
                      <td className={`px-4 py-3 ${isClosedPatient ? "text-slate-400" : "text-slate-600"}`}>
                        <p>{patient.service_needs.join("、") || "未設定"}</p>
                        {patient.reminder_tags.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {patient.reminder_tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-brand-sand px-2 py-0.5 text-[11px] font-semibold text-brand-forest"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className={`px-4 py-3 ${isClosedPatient ? "text-slate-400" : "text-slate-600"}`}>
                        {patient.preferred_service_slot || "未設定"}
                      </td>
                      <td className={`px-4 py-3 ${isClosedPatient ? "text-slate-400" : "text-slate-600"}`}>
                        {db.doctors.find((doctor) => doctor.id === patient.preferred_doctor_id)?.name ?? "未指定"}
                      </td>
                      <td className={`px-4 py-3 ${isClosedPatient ? "text-slate-400" : "text-slate-600"}`}>
                        <p className="card-clamp-2">{addressLabel}</p>
                        <p className="mt-1 text-xs text-slate-400">位置關鍵字：{locationLabel}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openPatientEditor(patient)}
                            aria-label={`編輯 ${maskedName}`}
                            className={`rounded-full px-3 py-2 text-xs font-semibold ring-1 ${
                              isClosedPatient
                                ? "bg-slate-50 text-slate-500 ring-slate-300"
                                : "bg-white text-brand-forest ring-slate-200"
                            }`}
                          >
                            編輯
                          </button>
                          <Link
                            to={`/admin/family-line?patientId=${encodeURIComponent(patient.id)}`}
                            aria-label={`${maskedName} 家屬聯繫`}
                            className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200"
                          >
                            家屬聯繫
                          </Link>
                          <button
                            type="button"
                            onClick={() => deletePatient(patient)}
                            aria-label={`刪除 ${maskedName}`}
                            className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 transition hover:bg-rose-50"
                          >
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      {editorOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedPatient ? `${maskPatientName(selectedPatient.name)} 編輯資料` : "新增個案視窗"}
            className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[2rem] border border-white/70 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-brand-ink">
                  {selectedPatient ? `${maskPatientName(selectedPatient.name)} 編輯資料` : "新增 / 編輯個案"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  編輯完畢後視窗會自動收起，不會常駐在個案管理頁。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedPatient ? (
                  <Link
                    to={`/admin/patients/${selectedPatient.id}`}
                    className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
                  >
                    查看詳細
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={closePatientEditor}
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
                >
                  關閉
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">個案姓名</span>
                <input aria-label="個案姓名" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
                <span className="mt-1 block text-xs text-slate-500">去識別化顯示：{maskPatientName(draft.name)}</span>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">主診斷</span>
                <input aria-label="主診斷" value={draft.primary_diagnosis} onChange={(event) => setDraft({ ...draft, primary_diagnosis: event.target.value })} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">地址</span>
                <input aria-label="地址" value={draft.home_address} onChange={(event) => setDraft({ ...draft, address: event.target.value, home_address: event.target.value })} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
                <span className="mt-1 block text-xs text-slate-500">
                  住家地址會作為預設定位來源，也會同步帶到排程與導航。
                </span>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">位置關鍵字</span>
                <input
                  aria-label="位置關鍵字"
                  value={draft.location_keyword}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      location_keyword: event.target.value
                    })
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  這個欄位就是 Google Maps 搜尋材料。預設值是「同住址」；若填入大樓名稱、管理室或巷口地標，系統會優先用這個文字定位。
                </span>
              </label>
              <div className="md:col-span-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                搜尋預覽：
                {resolveLocationKeyword(
                  draft.location_keyword,
                  draft.home_address || draft.address || "未設定"
                )}
              </div>
              <div className="block text-sm">
                <span className="mb-2 block font-medium text-brand-ink">需求項目</span>
                <div className="flex flex-wrap gap-3">
                  {patientServiceNeedOptions.map((option) => {
                    const checked = draft.service_needs.includes(option);
                    return (
                      <label key={option} className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              service_needs: event.target.checked
                                ? [...current.service_needs, option]
                                : current.service_needs.filter((item) => item !== option)
                            }))
                          }
                        />
                        {option}
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">指派醫師</span>
                <select
                  aria-label="指派醫師"
                  value={draft.preferred_doctor_id}
                  onChange={(event) => {
                    const nextDoctor = db.doctors.find((doctor) => doctor.id === event.target.value);
                    setDraft({
                      ...draft,
                      preferred_doctor_id: event.target.value,
                      preferred_service_slot: nextDoctor?.available_service_slots[0] ?? ""
                    });
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                >
                  {db.doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">狀態管理</span>
                <select aria-label="狀態管理" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Patient["status"] })} className="w-full rounded-2xl border border-slate-200 px-4 py-3">
                  <option value="active">{activeStatusOptionLabel}</option>
                  <option value="paused">暫停</option>
                  <option value="closed">結案</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-brand-ink">服務時段</span>
                <select
                  aria-label="服務時段"
                  value={draft.preferred_service_slot}
                  onChange={(event) => setDraft({ ...draft, preferred_service_slot: event.target.value })}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                >
                  {availableServiceSlots.length ? (
                    availableServiceSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))
                  ) : (
                    <option value="">請先到角色設置建立醫師可選時段</option>
                  )}
                </select>
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="mb-1 block font-medium text-brand-ink">特殊提醒</span>
                <textarea
                  aria-label="特殊提醒"
                  value={draft.reminder_tags.join("、")}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      reminder_tags: event.target.value
                        .split(/[、,\n]/)
                        .map((item) => item.trim())
                        .filter(Boolean)
                    })
                  }
                  rows={3}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  placeholder="例如：先電話通知、電梯較慢、巷口施工需改停車點"
                />
              </label>
            </div>

            <p className="mt-4 text-xs text-slate-500">
              儲存後會更新個案的負責醫師與服務時段；實際路線請改到排程管理頁建立、儲存與實行。
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={saveDraft} className="rounded-full bg-brand-forest px-5 py-3 text-sm font-semibold text-white">
                儲存個案設定
              </button>
              <button
                type="button"
                onClick={closePatientEditor}
                className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
              >
                取消
              </button>
              {selectedPatient ? (
                <button
                  type="button"
                  onClick={deleteSelectedPatient}
                  className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-rose-600 ring-1 ring-rose-200"
                >
                  刪除個案
                </button>
              ) : null}
            </div>

            {selectedProfile ? (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">最近訪視排程</p>
                    <span className="text-xs text-slate-500">
                      {selectedProfile.recentSchedules.length} 筆
                    </span>
                  </div>
                  <div className="mt-3 space-y-3 text-sm">
                    {selectedProfile.recentSchedules.slice(0, 4).map((schedule) => (
                      <div key={schedule.id} className="rounded-2xl border border-white bg-white p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-brand-ink">
                            {formatDateTimeFull(schedule.scheduled_start_at)}
                          </p>
                          <Badge value={schedule.status} compact />
                        </div>
                        <p className="mt-1 text-slate-600">{schedule.note || "無補充說明"}</p>
                      </div>
                    ))}
                    {selectedProfile.recentSchedules.length === 0 ? (
                      <p className="text-slate-500">目前沒有訪視排程。</p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">最近訪視紀錄</p>
                    <span className="text-xs text-slate-500">
                      {selectedProfile.visitRecords.length} 筆
                    </span>
                  </div>
                  <div className="mt-3 space-y-3 text-sm">
                    {selectedProfile.visitRecords.slice(0, 4).map((record) => (
                      <div key={record.id} className="rounded-2xl border border-white bg-white p-3">
                        <div className="grid gap-1 text-slate-600">
                          <p>出發：{formatTimeOnly(record.departure_time)}</p>
                          <p>抵達：{formatTimeOnly(record.arrival_time)}</p>
                          <p>離開：{formatTimeOnly(record.departure_from_patient_home_time)}</p>
                        </div>
                        <p className="mt-2 text-slate-600">
                          醫師摘要：{record.doctor_note || record.follow_up_note || "尚未填寫"}
                        </p>
                      </div>
                    ))}
                    {selectedProfile.visitRecords.length === 0 ? (
                      <p className="text-slate-500">目前沒有訪視紀錄。</p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminPatientDetailPage() {
  const { id } = useParams();
  const { repositories } = useAppContext();
  const profile = id ? repositories.patientRepository.getPatientProfile(id) : undefined;

  if (!profile) {
    return <Panel title="查無個案">找不到指定個案。</Panel>;
  }

  return (
    <div className="space-y-6">
      <Panel title={`${maskPatientName(profile.patient.name)} 詳細頁`}>
        <div className="grid gap-4 md:grid-cols-2 text-sm text-slate-600">
          <p>主責醫師：{repositories.patientRepository.getDoctors().find((doctor) => doctor.id === profile.patient.preferred_doctor_id)?.name ?? profile.patient.preferred_doctor_id}</p>
          <p>主要診斷：{profile.patient.primary_diagnosis}</p>
          <p>需求項目：{profile.patient.service_needs.join("、") || "未設定"}</p>
          <p>服務時段：{profile.patient.preferred_service_slot || "未設定"}</p>
          <p>住家地址：{profile.patient.home_address}</p>
          <p>
            定位關鍵字：
            {profile.patient.location_keyword === sameAddressLocationKeyword
              ? `同住址（${resolveLocationKeyword(profile.patient.location_keyword, profile.patient.home_address)}）`
              : profile.patient.location_keyword}
          </p>
          <p>狀態：{profile.patient.status}</p>
          <p className="md:col-span-2">特殊提醒：{profile.patient.reminder_tags.join("、") || "未設定"}</p>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="最近排程與流程資料">
          <div className="space-y-3">
            {profile.recentSchedules.map((schedule) => (
              <div key={schedule.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{formatDateTimeFull(schedule.scheduled_start_at)}</p>
                  <Badge value={schedule.status} compact />
                </div>
                <p className="mt-2 text-slate-600">{schedule.note}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="最近聯絡紀錄">
          <div className="space-y-3">
            {profile.contactLogs.slice(0, 8).map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{log.subject}</p>
                  <span className="text-xs text-slate-500">{formatDateTimeFull(log.contacted_at)}</span>
                </div>
                <p className="mt-2 text-slate-600">{log.content}</p>
                <p className="mt-1 text-slate-500">{log.outcome}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
