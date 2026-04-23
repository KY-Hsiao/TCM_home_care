import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { Patient, VisitSchedule } from "../../domain/models";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { StatCard } from "../../shared/ui/StatCard";
import { formatDateOnly, formatDateTimeFull, formatTimeOnly } from "../../shared/utils/format";
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
const weekdayLabels = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"] as const;

type RouteTimeSlot = (typeof routeTimeSlotOptions)[number];

function maskPatientName(name: string) {
  if (!name) {
    return "";
  }
  if (name.length <= 2) {
    return name;
  }
  return `${name[0]}${"○".repeat(Math.max(name.length - 2, 1))}${name[name.length - 1]}`;
}

function buildCsvTemplate() {
  return [
    "個案姓名,主診斷,需求項目,地址,狀態管理,負責醫師,服務時段",
    "王小明,慢性腰痛,中藥|針灸,台北市文山區示範路 1 號,服務中,蕭坤元醫師,星期三上午"
  ].join("\n");
}

function parseCsvRows(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim()));
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
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
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

function buildServiceSlotLabel(routeDate: string, routeTimeSlot: RouteTimeSlot) {
  const date = new Date(`${routeDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return routeTimeSlot;
  }
  return `${weekdayLabels[date.getDay()]}${routeTimeSlot}`;
}

function renumberRoute(route: VisitSchedule[]) {
  return route.map((schedule, index) => ({
    ...schedule,
    route_order: index + 1
  }));
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
        <StatCard label="今日訪視總數" value={dashboard.todayVisitTotal} hint="今日全部排程案件" />
        <StatCard label="待實行路線" value={dashboard.draftRouteCount} hint="已儲存但尚未實行到醫師端的路線" />
        <StatCard label="追蹤中案件數" value={dashboard.trackingCount} hint="醫師已出發或正在追蹤中的案件" />
        <StatCard label="緊急處置數" value={dashboard.urgentCount} hint="醫師回覆緊急處置的案件" />
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
              <p className="text-xs text-slate-500">異常案件</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.exceptionSchedules.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">暫停案件</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.pausedCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">待補紀錄</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.unrecordedCount}</p>
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
                    <p className="font-semibold text-brand-ink">{patient?.name ?? schedule.patient_id}</p>
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
          title="角色與任務儀表板"
          action={
            <Link
              to="/admin/staff"
              className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
            >
              前往角色設置
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
              <p className="text-xs text-slate-500">待實行路線</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">{dashboard.draftRoutePlans.length}</p>
              <p className="mt-1 text-xs text-slate-500">已儲存但尚未送到醫師端</p>
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
                      <p className="font-semibold text-brand-ink">{patient?.name ?? action.visit_schedule_id}</p>
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

      <Panel title="聯絡流程說明">
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
          目前系統不再提供家屬聯絡、綁定、外部通訊或流程紀錄；行政首頁只保留排程、定位與角色管理。
        </div>
      </Panel>
    </div>
  );
}

export function AdminGuidePage() {
  return (
    <div className="space-y-6">
      <Panel
        title="教學指引"
        action={
          <Link
            to="/admin/staff"
            className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
          >
            前往角色設置
          </Link>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            這裡集中放登入、定位授權與角色維護的操作備忘，改成左側獨立標籤後，不再占用行政首頁主畫面空間。
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">教學用途</p>
              <p className="mt-2 font-semibold text-brand-ink">登入與授權流程備忘</p>
              <p className="mt-1 text-xs text-slate-500">
                需要查看登入、網頁通知與定位授權時，再從左側標籤打開這頁。
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">角色帳號維護</p>
              <p className="mt-2 font-semibold text-brand-ink">統一前往角色設置頁</p>
              <p className="mt-1 text-xs text-slate-500">
                醫師資料與服務時段集中在角色設置頁；行政端固定共用帳號。
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-500">醫師追蹤入口</p>
              <p className="mt-2 font-semibold text-brand-ink">已獨立成左側分頁</p>
              <p className="mt-1 text-xs text-slate-500">
                追蹤地圖、目前距離、已過 / 未到站點都集中到「醫師追蹤」。
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600">
            <p className="font-semibold text-brand-ink">目前作業方式</p>
            <p className="mt-2">1. 每位行政與醫師登入時都需要輸入密碼，預設為 0000。</p>
            <p className="mt-1">2. 醫師端只要用手機開啟網頁並允許定位，行政端就能看到最新位置。</p>
            <p className="mt-1">3. 家屬聯絡、綁定、外部通訊與流程紀錄已移除，系統目前只保留個案、排程與定位。</p>
            <p className="mt-1">4. 行政端統一使用共用帳號「行政人員」；角色設置頁只需要維護醫師資料。</p>
            <p className="mt-3 text-xs text-slate-500">
              提醒：這裡只保留院內定位、路線與通知流程；個案管理頁目前不再維護家屬聯絡欄位。
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 text-sm text-slate-600">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-brand-ink">角色設定說明</p>
              <p className="mt-2">1. 醫師與行政現在都改用站內通知與帳密登入，預設密碼為 0000。</p>
              <p className="mt-1">2. 行政端固定為共用帳號「行政人員」，醫師資料與 LINE 聯絡設定都在角色設置頁集中維護。</p>
              <p className="mt-1">3. 醫師資料刪除前會先檢查是否還有案件正在使用。</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="font-semibold text-brand-ink">醫師端規則</p>
              <p className="mt-2">1. 醫師資料不用填醫師證號、專長與服務區域。</p>
              <p className="mt-1">2. 醫師會在網頁內收到出發、抵達、緊急與追蹤通知；行政端可同步查看距離、軌跡與站序。</p>
              <p className="mt-1">3. 可服務時段改為先選星期，再切換上午或下午，個案管理頁會沿用這些設定自動排班。</p>
              <p className="mt-1">4. 若要讓行政端一鍵切換 LINE 對話，請在醫師資料內填寫 LINE 搜尋關鍵字。</p>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function AdminDoctorTrackingPage() {
  const { repositories, db, services } = useAppContext();
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(db.doctors[0]?.id ?? "");
  const [routeDate, setRouteDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [routeTimeSlot, setRouteTimeSlot] = useState<RouteTimeSlot>("上午");
  const selectedDoctor = db.doctors.find((doctor) => doctor.id === selectedDoctorId) ?? db.doctors[0];
  const suggestedRoute = useMemo(
    () =>
      repositories.visitRepository.getSuggestedRoute(selectedDoctorId, {
        date: routeDate,
        serviceTimeSlot: routeTimeSlot
      }),
    [repositories, routeDate, routeTimeSlot, selectedDoctorId, db.visit_schedules, db.doctor_location_logs]
  );
  const [routeDraft, setRouteDraft] = useState<VisitSchedule[]>([]);
  const activeDoctorLocation = [...db.doctor_location_logs]
    .filter((log) => log.doctor_id === selectedDoctorId)
    .sort(
      (left, right) =>
        new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()
    )[0];
  const activeTrackedSchedule =
    (activeDoctorLocation?.linked_visit_schedule_id
      ? db.visit_schedules.find((schedule) => schedule.id === activeDoctorLocation.linked_visit_schedule_id)
      : undefined) ??
    routeDraft.find((schedule) =>
      ["tracking", "proximity_pending", "arrived", "in_treatment", "issue_pending"].includes(
        schedule.status
      )
    ) ??
    routeDraft[0];
  const activeTrackedPatient = activeTrackedSchedule
    ? db.patients.find((patient) => patient.id === activeTrackedSchedule.patient_id)
    : undefined;
  const activeMapUrl =
    (activeDoctorLocation
      ? services.maps.buildPatientMapUrl({
          address: "醫師目前位置",
          latitude: activeDoctorLocation.latitude,
          longitude: activeDoctorLocation.longitude
        })
      : undefined) ||
    selectedDoctor?.google_location_share_url ||
    (activeTrackedSchedule
      ? services.maps.buildPatientMapUrl({
          address: activeTrackedSchedule.address_snapshot,
          locationKeyword: activeTrackedSchedule.location_keyword_snapshot,
          latitude: activeTrackedSchedule.home_latitude_snapshot,
          longitude: activeTrackedSchedule.home_longitude_snapshot
        })
      : "https://www.google.com/maps");
  const activeEmbedMapUrl =
    (activeDoctorLocation
      ? services.maps.buildPatientEmbedUrl({
          address: "醫師目前位置",
          latitude: activeDoctorLocation.latitude,
          longitude: activeDoctorLocation.longitude
        })
      : undefined) ||
    (activeTrackedSchedule
      ? services.maps.buildPatientEmbedUrl({
          address: activeTrackedSchedule.address_snapshot,
          locationKeyword: activeTrackedSchedule.location_keyword_snapshot,
          latitude: activeTrackedSchedule.home_latitude_snapshot,
          longitude: activeTrackedSchedule.home_longitude_snapshot
        })
      : "https://maps.google.com/maps?q=%E5%8F%B0%E5%8C%97%E5%B8%82&z=13&output=embed");
  const routeServiceSlotLabel = useMemo(
    () => buildServiceSlotLabel(routeDate, routeTimeSlot),
    [routeDate, routeTimeSlot]
  );
  const doctorLocationLogs = useMemo(
    () =>
      repositories.visitRepository
        .getDoctorLocationLogs(selectedDoctorId)
        .slice()
        .sort(
          (left, right) =>
            new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()
        ),
    [repositories, selectedDoctorId, db.doctor_location_logs]
  );
  const currentDistanceToTrackedPatient = activeDoctorLocation && activeTrackedSchedule
    ? estimateDistanceKilometersBetween(
        activeDoctorLocation.latitude,
        activeDoctorLocation.longitude,
        activeTrackedSchedule.home_latitude_snapshot,
        activeTrackedSchedule.home_longitude_snapshot
      )
    : null;
  const passedRouteStops = useMemo(
    () =>
      routeDraft.filter((schedule) =>
        activeTrackedSchedule
          ? (schedule.route_order ?? 0) < (activeTrackedSchedule.route_order ?? 0)
          : ["completed", "cancelled"].includes(schedule.status)
      ),
    [activeTrackedSchedule, routeDraft]
  );
  const upcomingRouteStops = useMemo(
    () =>
      routeDraft.filter((schedule) =>
        activeTrackedSchedule
          ? (schedule.route_order ?? 0) > (activeTrackedSchedule.route_order ?? 0)
          : !["completed", "cancelled"].includes(schedule.status)
      ),
    [activeTrackedSchedule, routeDraft]
  );

  useEffect(() => {
    setRouteDraft(renumberRoute(suggestedRoute));
  }, [suggestedRoute, routeDate, routeTimeSlot, selectedDoctorId]);

  return (
    <div className="space-y-6">
      <Panel title="Google Map 追蹤圖">
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[220px_180px_140px_1fr]">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">查看醫師</span>
              <select
                value={selectedDoctorId}
                onChange={(event) => {
                  setSelectedDoctorId(event.target.value);
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
              <span className="mb-1 block font-medium text-brand-ink">路線日期</span>
              <input
                type="date"
                value={routeDate}
                onChange={(event) => setRouteDate(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">規劃時段</span>
              <select
                aria-label="規劃時段"
                value={routeTimeSlot}
                onChange={(event) => setRouteTimeSlot(event.target.value as RouteTimeSlot)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                {routeTimeSlotOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              目前位置：
              {activeDoctorLocation
                ? ` ${activeDoctorLocation.latitude.toFixed(4)}, ${activeDoctorLocation.longitude.toFixed(4)}`
                : " 尚未有定位紀錄"}
              {" / "}
              最後更新：
              {activeDoctorLocation
                ? ` ${formatDateTimeFull(activeDoctorLocation.recorded_at)}`
                : " 尚未回傳"}
            </div>
          </div>

          <iframe
            title="Google Map 追蹤圖"
            src={activeEmbedMapUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-[420px] w-full rounded-3xl border border-slate-200 bg-white"
          />

          <div className="flex flex-wrap gap-2">
            <a
              href={activeMapUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-brand-forest px-4 py-3 text-sm font-semibold text-white"
            >
              用 Google 地圖開啟行政追蹤圖
            </a>
          </div>

          <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <p className="font-semibold text-brand-ink">目前追蹤中的醫師位置</p>
              <p className="mt-2">
                {activeDoctorLocation
                  ? `醫師 ${selectedDoctor?.name ?? ""} 已登入手機網頁，系統正在持續接收定位。`
                  : "目前尚未收到這位醫師的即時定位，登入後會立即要求手機授權位置。"}
              </p>
              <p className="mt-1">
                {activeTrackedSchedule
                  ? `目前對應案件：第 ${activeTrackedSchedule.route_order} 站 ${activeTrackedPatient?.name ?? activeTrackedSchedule.patient_id} / ${activeTrackedSchedule.status}`
                  : `目前 ${routeServiceSlotLabel} 尚未有進行中的案件。`}
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">目前距離</p>
                  <p className="mt-2 font-semibold text-brand-ink">
                    {currentDistanceToTrackedPatient !== null
                      ? `${currentDistanceToTrackedPatient.toFixed(1)} 公里`
                      : "等待定位中"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    顯示醫師到目前案件或下一站的大約直線距離。
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">已經過的地點</p>
                  <p className="mt-2 font-semibold text-brand-ink">{passedRouteStops.length} 站</p>
                  <p className="mt-1 text-xs text-slate-500">
                    依本站序與案件狀態，自動整理已完成或已通過的站點。
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">尚未到的地點</p>
                  <p className="mt-2 font-semibold text-brand-ink">{upcomingRouteStops.length} 站</p>
                  <p className="mt-1 text-xs text-slate-500">
                    行政端可同步看到後續待走路線與預定站序。
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <p className="font-semibold text-brand-ink">最近移動軌跡</p>
              <div className="mt-3 space-y-2">
                {doctorLocationLogs.slice(0, 6).map((log, index) => (
                  <div key={log.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-brand-ink">
                        軌跡點 {doctorLocationLogs.length - index}
                      </p>
                      <p className="text-xs text-slate-500">{formatTimeOnly(log.recorded_at)}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {log.latitude.toFixed(4)}, {log.longitude.toFixed(4)}
                    </p>
                  </div>
                ))}
                {doctorLocationLogs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    醫師尚未登入或尚未允許定位，暫時沒有可顯示的移動軌跡。
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-brand-ink">已經過的地點</p>
                <span className="text-xs text-slate-500">{passedRouteStops.length} 筆</span>
              </div>
              <div className="mt-3 space-y-2">
                {passedRouteStops.slice(0, 5).map((schedule) => {
                  const patient = db.patients.find((item) => item.id === schedule.patient_id);
                  return (
                    <div key={schedule.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="font-medium text-brand-ink">
                        第 {schedule.route_order} 站 {patient?.name ?? schedule.patient_id}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatTimeOnly(schedule.scheduled_start_at)} / {schedule.area}
                      </p>
                    </div>
                  );
                })}
                {passedRouteStops.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    目前還沒有已經過的地點。
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-brand-ink">還沒有去的地點</p>
                <span className="text-xs text-slate-500">{upcomingRouteStops.length} 筆</span>
              </div>
              <div className="mt-3 space-y-2">
                {upcomingRouteStops.slice(0, 5).map((schedule) => {
                  const patient = db.patients.find((item) => item.id === schedule.patient_id);
                  return (
                    <div key={schedule.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                      <p className="font-medium text-brand-ink">
                        第 {schedule.route_order} 站 {patient?.name ?? schedule.patient_id}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatTimeOnly(schedule.scheduled_start_at)} / {schedule.area}
                      </p>
                    </div>
                  );
                })}
                {upcomingRouteStops.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    目前這個時段沒有待前往的後續地點。
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function AdminPatientsPage() {
  const { repositories, db } = useAppContext();
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
  const availableServiceSlots = selectedDoctor?.available_service_slots ?? [];
  const csvTemplateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(buildCsvTemplate())}`;

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

    const result = repositories.patientRepository.upsertPatient({
      ...draft,
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

  const deleteSelectedPatient = () => {
    if (!selectedPatient) {
      setRecentAction("請先選擇要刪除的個案。");
      return;
    }

    const confirmed = window.confirm(
      `確定要刪除 ${selectedPatient.name} 嗎？相關排程、訪視紀錄與流程資料也會一併移除。`
    );
    if (!confirmed) {
      return;
    }

    const result = repositories.patientRepository.removePatient(selectedPatient.id);
    if (!result.removed) {
      setRecentAction(
        `無法刪除 ${maskPatientName(selectedPatient.name)}：${result.blockedReason ?? "未提供原因"}。`
      );
      return;
    }

    const nextPatient = patients.find((patient) => patient.id !== selectedPatient.id);
    setSelectedPatientIds((current) => current.filter((id) => id !== selectedPatient.id));
    syncDraft(nextPatient);
    setRecentAction(
      `已刪除 ${maskPatientName(selectedPatient.name)}，並清除 ${result.removedScheduleCount} 筆相關排程。`
    );
    setEditorOpen(false);
  };

  const handleCsvImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const rows = parseCsvRows(await readUploadedFileText(file));
    const [header, ...bodyRows] = rows;
    if (!header || header.length < 7) {
      setRecentAction("CSV 欄位不足，請先下載範本後再匯入。");
      event.target.value = "";
      return;
    }

    let importedCount = 0;
    let skippedCount = 0;
    const skippedReasons: string[] = [];

    bodyRows.forEach((row, index) => {
      const [name, diagnosis, serviceNeedsRaw, address, statusRaw, doctorRaw, serviceSlot] = row;
      if (!name || !diagnosis || !address || !doctorRaw || !serviceSlot) {
        skippedCount += 1;
        skippedReasons.push(`第 ${index + 2} 列缺少必要欄位`);
        return;
      }

      const doctor =
        db.doctors.find((item) => item.name === doctorRaw) ??
        db.doctors.find((item) => item.id === doctorRaw);
      if (!doctor) {
        skippedCount += 1;
        skippedReasons.push(`第 ${index + 2} 列找不到醫師 ${doctorRaw}`);
        return;
      }

      const patientToImport = buildPatientDraft();
      const result = repositories.patientRepository.upsertPatient({
        ...patientToImport,
        id: `pat-import-${Date.now()}-${index}`,
        name,
        chart_number: "",
        service_needs: serviceNeedsRaw
          ? serviceNeedsRaw.split(/[|、,]/).map((item) => item.trim()).filter(Boolean)
          : [],
        primary_diagnosis: diagnosis,
        address,
        home_address: address,
        location_keyword: sameAddressLocationKeyword,
        google_maps_link: mapsLink(address, sameAddressLocationKeyword),
        preferred_doctor_id: doctor.id,
        preferred_service_slot: serviceSlot,
        status: normalizePatientStatus(statusRaw || "服務中")
      });

      importedCount += 1;
    });

    setRecentAction(
      skippedReasons.length > 0
        ? `CSV 匯入完成：成功 ${importedCount} 筆，略過 ${skippedCount} 筆。${skippedReasons[0]}`
        : `CSV 匯入完成：成功 ${importedCount} 筆。`
    );
    event.target.value = "";
  };

  return (
    <div className="space-y-6">
      <Panel
        title="個案管理頁"
        action={
          <div className="flex flex-wrap gap-2">
            <a
              href={csvTemplateHref}
              download="patient-import-template.csv"
              className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
            >
              下載 CSV 範本
            </a>
            <label className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200">
              CSV 匯入
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => void handleCsvImport(event)}
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
          <p className="mt-3 text-slate-600">
            家屬通知功能已移除；這裡只保留個案批次狀態調整與資料管理。
          </p>
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
        <div className="space-y-3">
          {displayPatients.map((patient) => {
            const isClosedPatient = patient.status === "closed";
            const isSelectedPatient = selectedId === patient.id;

            return (
            <div
              key={patient.id}
              data-patient-id={patient.id}
              data-patient-status={patient.status}
              className={`w-full rounded-2xl border p-4 ${
                isClosedPatient
                  ? "border-slate-300 bg-slate-100 text-slate-500"
                  : isSelectedPatient
                    ? "border-brand-forest bg-brand-sand/60"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedPatientIds.includes(patient.id)}
                    onChange={(event) => togglePatientSelection(patient.id, event.target.checked)}
                    aria-label={`${patient.name} 勾選`}
                  />
                  <p className={`font-semibold ${isClosedPatient ? "text-slate-500" : "text-brand-ink"}`}>
                    {maskPatientName(patient.name)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge value={patient.status} compact />
                  <button
                    type="button"
                    onClick={() => openPatientEditor(patient)}
                    aria-label={`編輯 ${patient.name}`}
                    className={`rounded-full px-3 py-2 text-xs font-semibold ring-1 ${
                      isClosedPatient
                        ? "bg-slate-50 text-slate-500 ring-slate-300"
                        : "bg-white text-brand-forest ring-slate-200"
                    }`}
                  >
                    編輯
                  </button>
                </div>
              </div>
              <p className={`mt-2 text-sm ${isClosedPatient ? "text-slate-500" : "text-slate-600"}`}>
                {patient.primary_diagnosis}
              </p>
              <p className={`mt-1 text-xs ${isClosedPatient ? "text-slate-400" : "text-slate-500"}`}>
                需求：{patient.service_needs.join("、") || "未設定"} / 時段：{patient.preferred_service_slot || "未設定"}
              </p>
              <p className={`mt-1 text-xs ${isClosedPatient ? "text-slate-400" : "text-slate-500"}`}>
                負責醫師：{db.doctors.find((doctor) => doctor.id === patient.preferred_doctor_id)?.name ?? "未指定"}
              </p>
              <p className={`mt-1 text-xs ${isClosedPatient ? "text-slate-400" : "text-slate-500"}`}>
                地址：{patient.home_address || patient.address || "未設定"}
              </p>
              <p className={`mt-1 text-xs ${isClosedPatient ? "text-slate-400" : "text-slate-500"}`}>
                位置關鍵字：
                {patient.location_keyword === sameAddressLocationKeyword
                  ? `同住址（${resolveLocationKeyword(
                      patient.location_keyword,
                      patient.home_address || patient.address || "未設定"
                    )}）`
                  : patient.location_keyword || "未設定"}
              </p>
            </div>
          );
          })}
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
