import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import type { SavedRoutePlan } from "../../domain/models";
import { ReminderCenterPanel } from "../shared/ReminderCenterPanel";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateOnly } from "../../shared/utils/format";

type RouteTimeSlot = "上午" | "下午";
type PlannerStatus = "scheduled" | "paused" | "on_the_way" | "in_treatment" | "completed";

type PlannerRow = {
  patientId: string;
  name: string;
  address: string;
  checked: boolean;
  routeOrder: number | null;
  status: PlannerStatus;
  scheduleId: string | null;
};

const weekdayOptions = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"] as const;
const routeTimeSlotOptions: RouteTimeSlot[] = ["上午", "下午"];

function buildRoutePlanId(doctorId: string, routeDate: string, weekday: string, serviceTimeSlot: RouteTimeSlot) {
  return `route-${doctorId}-${routeDate}-${weekday}-${serviceTimeSlot}`;
}

function reindexPlannerRows(rows: PlannerRow[]) {
  let routeOrder = 1;
  return rows.map<PlannerRow>((row) =>
    row.checked
      ? {
          ...row,
          routeOrder: routeOrder++,
          status:
            row.status === "on_the_way" ||
            row.status === "in_treatment" ||
            row.status === "completed"
              ? row.status
              : ("scheduled" as PlannerStatus)
        }
      : {
          ...row,
          routeOrder: null,
          status: "paused" as PlannerStatus
        }
  );
}

function sortPlannerRows(rows: PlannerRow[]) {
  return [...rows].sort((left, right) => {
    const leftOrder = left.routeOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.routeOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.name.localeCompare(right.name, "zh-Hant");
  });
}

function parseDoctorServiceSlot(slot: string) {
  const matchedWeekday = weekdayOptions.find((weekday) => slot.startsWith(weekday));
  const matchedTimeSlot = routeTimeSlotOptions.find((timeSlot) => slot.endsWith(timeSlot));
  if (!matchedWeekday || !matchedTimeSlot) {
    return null;
  }
  return {
    weekday: matchedWeekday,
    timeSlot: matchedTimeSlot
  };
}

function buildPlannerRowsFromSlotPatients(
  patients: Array<{ id: string; name: string; address: string; home_address: string }>
): PlannerRow[] {
  return patients.map((patient, index) => ({
    patientId: patient.id,
    name: patient.name,
    address: patient.home_address || patient.address,
    checked: true,
    routeOrder: index + 1,
    status: "scheduled",
    scheduleId: null
  }));
}

function buildPlannerRowsFromRoutePlan(
  routePlan: SavedRoutePlan,
  patientsById: Map<string, { id: string; name: string; address: string; home_address: string; status: string }>
) {
  return sortPlannerRows(
    routePlan.route_items
      .map((item) => {
        const patient = patientsById.get(item.patient_id);
        if (!patient || patient.status === "closed") {
          return null;
        }
        return {
          patientId: item.patient_id,
          name: patient.name,
          address: patient.home_address || patient.address || item.address,
          checked: item.checked,
          routeOrder: item.route_order,
          status: item.status,
          scheduleId: item.schedule_id
        } satisfies PlannerRow;
      })
      .filter((row): row is PlannerRow => Boolean(row))
  );
}

export function AdminSchedulesPage() {
  const { repositories, db } = useAppContext();
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>("");
  const [selectedWeekday, setSelectedWeekday] = useState<string>("");
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<RouteTimeSlot | "">("");
  const [routeDate, setRouteDate] = useState<string>("");
  const [selectedSavedRoutePlanId, setSelectedSavedRoutePlanId] = useState<string>("");
  const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
  const [recentAction, setRecentAction] = useState<string | null>(null);

  const doctors = repositories.patientRepository.getDoctors();
  const selectedDoctor = doctors.find((doctor) => doctor.id === selectedDoctorId);
  const patientsById = useMemo(
    () => new Map(db.patients.map((patient) => [patient.id, patient])),
    [db.patients]
  );
  const savedRoutePlans = useMemo(
    () => repositories.visitRepository.getSavedRoutePlans(),
    [repositories, db.saved_route_plans]
  );
  const selectedSavedRoutePlan = selectedSavedRoutePlanId
    ? savedRoutePlans.find((routePlan) => routePlan.id === selectedSavedRoutePlanId)
    : undefined;
  const slotPatients = useMemo(
    () =>
      selectedDoctorId && selectedWeekday && selectedTimeSlot
        ? repositories.patientRepository.getPatientsByDoctorSlot({
            doctorId: selectedDoctorId,
            weekday: selectedWeekday,
            serviceTimeSlot: selectedTimeSlot
          })
        : [],
    [repositories, db.patients, selectedDoctorId, selectedTimeSlot, selectedWeekday]
  );
  const sortedPlannerRows = useMemo(() => sortPlannerRows(plannerRows), [plannerRows]);
  const checkedRows = useMemo(
    () => sortedPlannerRows.filter((row) => row.checked),
    [sortedPlannerRows]
  );
  const availableWeekdays = useMemo(() => {
    const serviceSlots = selectedDoctor?.available_service_slots ?? [];
    const matchedWeekdays = new Set(
      serviceSlots
        .map((slot) => parseDoctorServiceSlot(slot)?.weekday)
        .filter((weekday): weekday is (typeof weekdayOptions)[number] => Boolean(weekday))
    );
    return weekdayOptions.filter((weekday) => matchedWeekdays.has(weekday));
  }, [selectedDoctor]);
  const availableTimeSlots = useMemo(() => {
    if (!selectedWeekday) {
      return [];
    }
    const serviceSlots = selectedDoctor?.available_service_slots ?? [];
    const matchedTimeSlots = new Set(
      serviceSlots
        .map((slot) => parseDoctorServiceSlot(slot))
        .filter((slot) => slot?.weekday === selectedWeekday)
        .map((slot) => slot?.timeSlot)
        .filter((timeSlot): timeSlot is RouteTimeSlot => Boolean(timeSlot))
    );
    return routeTimeSlotOptions.filter((timeSlot) => matchedTimeSlots.has(timeSlot));
  }, [selectedDoctor, selectedWeekday]);

  useEffect(() => {
    if (selectedWeekday && !availableWeekdays.includes(selectedWeekday as (typeof weekdayOptions)[number])) {
      setSelectedWeekday("");
      setSelectedTimeSlot("");
    }
  }, [availableWeekdays, selectedWeekday]);

  useEffect(() => {
    if (selectedTimeSlot && !availableTimeSlots.includes(selectedTimeSlot)) {
      setSelectedTimeSlot("");
    }
  }, [availableTimeSlots, selectedTimeSlot]);

  useEffect(() => {
    if (!selectedDoctorId || !selectedWeekday || !selectedTimeSlot) {
      setPlannerRows([]);
      return;
    }
    if (selectedSavedRoutePlanId) {
      return;
    }
    setPlannerRows(buildPlannerRowsFromSlotPatients(slotPatients));
  }, [selectedDoctorId, selectedSavedRoutePlanId, selectedTimeSlot, selectedWeekday, slotPatients]);

  useEffect(() => {
    if (!selectedSavedRoutePlanId) {
      return;
    }
    if (!selectedSavedRoutePlan) {
      setSelectedSavedRoutePlanId("");
      return;
    }
    setPlannerRows(buildPlannerRowsFromRoutePlan(selectedSavedRoutePlan, patientsById));
  }, [patientsById, selectedSavedRoutePlan, selectedSavedRoutePlanId]);

  const resetPlanner = () => {
    setSelectedDoctorId("");
    setSelectedWeekday("");
    setSelectedTimeSlot("");
    setRouteDate("");
    setSelectedSavedRoutePlanId("");
    setPlannerRows([]);
    setRecentAction("已清除排程管理頁面內容。");
  };

  const togglePlannerRow = (patientId: string, checked: boolean) => {
    setPlannerRows((current) =>
      reindexPlannerRows(
        current.map((row) =>
          row.patientId === patientId
            ? {
                ...row,
                checked
              }
            : row
        )
      )
    );
  };

  const movePlannerRow = (patientId: string, direction: "up" | "down") => {
    setPlannerRows((current) => {
      const ordered = sortPlannerRows(current);
      const currentIndex = ordered.findIndex((row) => row.patientId === patientId);
      if (currentIndex < 0) {
        return current;
      }
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= ordered.length) {
        return current;
      }
      const next = [...ordered];
      const [moved] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, moved);
      return reindexPlannerRows(next);
    });
  };

  const closePatient = (patientId: string) => {
    const result = repositories.patientRepository.closePatient(patientId, "排程管理頁結案");
    setPlannerRows((current) => current.filter((row) => row.patientId !== patientId));
    setRecentAction(result.message);
  };

  const buildRoutePlanDraft = () => {
    if (!selectedDoctorId || !selectedWeekday || !selectedTimeSlot) {
      setRecentAction("請先選擇醫師、星期與上午/下午。");
      return null;
    }
    if (!routeDate) {
      setRecentAction("請先輸入此次路線日期。");
      return null;
    }
    if (plannerRows.length === 0) {
      setRecentAction("目前沒有可加入路線的個案。");
      return null;
    }

    const doctor = doctors.find((item) => item.id === selectedDoctorId);
    const routePlanId = buildRoutePlanId(
      selectedDoctorId,
      routeDate,
      selectedWeekday,
      selectedTimeSlot
    );
    const routeItems: SavedRoutePlan["route_items"] = sortPlannerRows(plannerRows).map((row) => ({
      patient_id: row.patientId,
      schedule_id: row.scheduleId,
      checked: row.checked,
      route_order: row.checked ? row.routeOrder : null,
      status: row.status,
      patient_name: row.name,
      address: row.address
    }));

    return {
      id: routePlanId,
      doctor_id: selectedDoctorId,
      route_group_id: routePlanId,
      route_name: `${formatDateOnly(routeDate)} ${doctor?.name ?? selectedDoctorId} ${selectedWeekday}${selectedTimeSlot}`,
      route_date: routeDate,
      route_weekday: selectedWeekday,
      service_time_slot: selectedTimeSlot,
      optimize_by: "time",
      schedule_ids: routeItems
        .map((item) => item.schedule_id)
        .filter((scheduleId): scheduleId is string => Boolean(scheduleId)),
      route_items: routeItems,
      execution_status: selectedSavedRoutePlan?.execution_status ?? "draft",
      executed_at: selectedSavedRoutePlan?.executed_at ?? null,
      start_address: "旗山醫院",
      start_latitude: 22.88794,
      start_longitude: 120.48341,
      end_address: "旗山醫院",
      end_latitude: 22.88794,
      end_longitude: 120.48341,
      total_minutes: checkedRows.length * 60,
      total_distance_kilometers: checkedRows.length * 2,
      saved_at: new Date().toISOString(),
      created_at: selectedSavedRoutePlan?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString()
    } satisfies SavedRoutePlan;
  };

  const saveRoutePlan = () => {
    const routePlanDraft = buildRoutePlanDraft();
    if (!routePlanDraft) {
      return null;
    }
    repositories.visitRepository.upsertSavedRoutePlan(routePlanDraft);
    setSelectedSavedRoutePlanId(routePlanDraft.id);
    setRecentAction("已儲存路線，之後可從已儲存的路線完整還原。");
    return routePlanDraft.id;
  };

  const executeRoutePlan = () => {
    const routePlanDraft = buildRoutePlanDraft();
    if (!routePlanDraft) {
      return;
    }
    const executed = repositories.visitRepository.upsertSavedRoutePlanAndExecute(routePlanDraft);
    if (!executed) {
      setRecentAction("找不到可實行的路線。");
      return;
    }
    setSelectedSavedRoutePlanId(executed.id);
    setPlannerRows(buildPlannerRowsFromRoutePlan(executed, patientsById));
    setRecentAction(`已實行 ${executed.route_name}，醫師端會以這條路線作為本次執行清單。`);
  };

  const deleteRoutePlan = () => {
    if (!selectedSavedRoutePlanId) {
      setRecentAction("目前沒有可刪除的已儲存路線。");
      return;
    }
    repositories.visitRepository.deleteSavedRoutePlan(selectedSavedRoutePlanId);
    setSelectedSavedRoutePlanId("");
    setRecentAction("已刪除已儲存路線。");
  };

  const restoreRoutePlan = (routePlanId: string) => {
    const routePlan = savedRoutePlans.find((item) => item.id === routePlanId);
    if (!routePlan) {
      setRecentAction("找不到指定的已儲存路線。");
      setSelectedSavedRoutePlanId("");
      return;
    }
    setSelectedSavedRoutePlanId(routePlan.id);
    setSelectedDoctorId(routePlan.doctor_id);
    setSelectedWeekday(routePlan.route_weekday);
    setSelectedTimeSlot(routePlan.service_time_slot);
    setRouteDate(routePlan.route_date);
    setPlannerRows(buildPlannerRowsFromRoutePlan(routePlan, patientsById));
    setRecentAction(`已還原 ${routePlan.route_name}。`);
  };

  return (
    <div className="space-y-6">
      <Panel title="排程管理頁">
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[220px_180px_140px_180px_auto]">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">先選醫師</span>
              <select
                aria-label="篩選醫師"
                value={selectedDoctorId}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId("");
                  setSelectedDoctorId(event.target.value);
                  setSelectedWeekday("");
                  setSelectedTimeSlot("");
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇醫師</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">再選星期幾</span>
              <select
                aria-label="篩選星期"
                value={selectedWeekday}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId("");
                  setSelectedWeekday(event.target.value);
                  setSelectedTimeSlot("");
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇星期</option>
                {availableWeekdays.map((weekday) => (
                  <option key={weekday} value={weekday}>
                    {weekday}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">最後選上午/下午</span>
              <select
                aria-label="篩選時段"
                value={selectedTimeSlot}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId("");
                  setSelectedTimeSlot(event.target.value as RouteTimeSlot | "");
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇時段</option>
                {availableTimeSlots.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">此次路線日期</span>
              <input
                type="date"
                aria-label="路線日期"
                value={routeDate}
                onChange={(event) => {
                  setSelectedSavedRoutePlanId("");
                  setRouteDate(event.target.value);
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={resetPlanner}
                className="w-full rounded-full bg-white px-4 py-3 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
              >
                清除
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-brand-ink">已儲存的路線</span>
              <select
                aria-label="已儲存的路線"
                value={selectedSavedRoutePlanId}
                onChange={(event) => {
                  const routePlanId = event.target.value;
                  setSelectedSavedRoutePlanId(routePlanId);
                  if (!routePlanId) {
                    return;
                  }
                  restoreRoutePlan(routePlanId);
                }}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              >
                <option value="">請選擇已儲存路線</option>
                {savedRoutePlans.map((routePlan) => (
                  <option key={routePlan.id} value={routePlan.id}>
                    {routePlan.route_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={saveRoutePlan}
              className="rounded-full bg-brand-forest px-4 py-3 text-sm font-semibold text-white"
            >
              儲存路線
            </button>
            <button
              type="button"
              onClick={executeRoutePlan}
              className="rounded-full bg-brand-coral px-4 py-3 text-sm font-semibold text-white"
            >
              實行路線
            </button>
            <button
              type="button"
              onClick={deleteRoutePlan}
              disabled={!selectedSavedRoutePlanId}
              className="rounded-full border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              刪除這條路線
            </button>
          </div>

          {recentAction ? (
            <div
              role="status"
              className="rounded-2xl border border-brand-sand bg-brand-sand/50 px-4 py-3 text-sm text-brand-ink"
            >
              最近操作：{recentAction}
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            選完醫師、星期與上午/下午後，系統會自動列出符合該時段的個案。取消勾選者會保留在名單中，但本次路線狀態會設為「暫停」，不會進入路線排序。
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-brand-ink">符合時段的個案清單</p>
                  <p className="mt-1 text-xs text-slate-500">
                    每位個案預設已勾選；取消勾選後會標記為暫停。
                  </p>
                </div>
                <p className="text-xs text-slate-500">共 {sortedPlannerRows.length} 位</p>
              </div>

              <div className="mt-4 space-y-2">
                {sortedPlannerRows.map((row) => (
                  <div
                    key={row.patientId}
                    className="grid gap-3 rounded-2xl border border-slate-200 px-4 py-3 lg:grid-cols-[auto_minmax(0,180px)_minmax(0,1fr)_auto_auto]"
                  >
                    <label className="inline-flex items-center gap-2 text-sm font-medium text-brand-ink">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={(event) => togglePlannerRow(row.patientId, event.target.checked)}
                        aria-label={`${row.name} 勾選`}
                      />
                      勾選
                    </label>
                    <p className="text-sm font-semibold text-brand-ink">{row.name}</p>
                    <p className="text-sm text-slate-600">{row.address}</p>
                    <Badge value={row.status} compact />
                    <button
                      type="button"
                      onClick={() => closePatient(row.patientId)}
                      className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      結案
                    </button>
                  </div>
                ))}
                {sortedPlannerRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    請先選擇醫師、星期與上午/下午，系統才會列出符合時段的個案。
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-brand-ink">本次路線排序</p>
                  <p className="mt-1 text-xs text-slate-500">
                    只有勾選中的個案會進入排序；暫停個案不會進入本站序。
                  </p>
                </div>
                <p className="text-xs text-slate-500">可執行 {checkedRows.length} 站</p>
              </div>

              <div className="mt-4 space-y-2">
                {checkedRows.map((row, index) => (
                  <div
                    key={row.patientId}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-brand-ink">
                          第 {row.routeOrder} 站 {row.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{row.address}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => movePlannerRow(row.patientId, "up")}
                          disabled={index === 0}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          上移
                        </button>
                        <button
                          type="button"
                          onClick={() => movePlannerRow(row.patientId, "down")}
                          disabled={index === checkedRows.length - 1}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          下移
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {checkedRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    目前沒有已勾選的個案，因此不會產生路線排序。
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function AdminContactsPage() {
  return (
    <div className="space-y-6">
      <Panel title="聯絡方式設定已整合">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
          <p className="font-semibold text-brand-ink">這個頁面已不再維護任何家屬聯絡或綁定流程。</p>
          <p className="mt-2">1. 個案管理目前只處理個案本身的診斷、地址、定位關鍵字、醫師與服務時段。</p>
          <p className="mt-1">2. 如需追蹤流程，請改看排程管理、醫師追蹤與 ContactLog。</p>
          <p className="mt-1">3. 外部通訊與家屬入口已移除，不需要另外建立綁定資料。</p>
        </div>
      </Panel>
    </div>
  );
}

export function AdminRemindersPage() {
  const { session } = useAppContext();

  return (
    <div className="space-y-6">
      <ReminderCenterPanel
        role="admin"
        ownerId={session.activeAdminId}
        title="提醒中心"
        detailBasePath="/admin/patients"
        emptyText="目前行政端沒有待處理提醒。"
      />
    </div>
  );
}
