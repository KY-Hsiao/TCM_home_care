(() => {
  const DB_KEY = "tcm-home-care-mvp-db";
  const SNAPSHOT_KEY = "tcm-patient-status-snapshot";
  let internalWrite = false;

  function loadJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function patientStatusSnapshot(db) {
    const snapshot = {};
    (Array.isArray(db?.patients) ? db.patients : []).forEach((patient) => {
      snapshot[patient.id] = patient.status;
    });
    return snapshot;
  }

  function orderValue(value) {
    const number = Number(value ?? 9999);
    return Number.isFinite(number) ? number : 9999;
  }

  function reindexRouteItems(items) {
    let order = 1;
    return (Array.isArray(items) ? items : [])
      .slice()
      .sort((a, b) => orderValue(a.route_order) - orderValue(b.route_order))
      .map((item) => {
        if (!item.checked || item.status === "paused") {
          return { ...item, route_order: null };
        }
        return { ...item, route_order: order++ };
      });
  }

  function restorePatientSchedules(db, patientId) {
    const now = new Date().toISOString();
    let changed = false;
    const restoredScheduleIds = new Set();

    let visitSchedules = (Array.isArray(db.visit_schedules) ? db.visit_schedules : []).map((schedule) => {
      if (schedule.patient_id !== patientId) return schedule;
      if (["completed", "followup_pending"].includes(schedule.status)) return schedule;
      if (!["paused", "cancelled", "rescheduled"].includes(schedule.status)) return schedule;
      changed = true;
      restoredScheduleIds.add(schedule.id);
      const hasRoute = Boolean(schedule.route_group_id) || orderValue(schedule.route_order) < 9999;
      const noteText = String(schedule.note || "").trim();
      const note = noteText.includes("恢復正常訪視") ? noteText : `${noteText}${noteText ? "｜" : ""}恢復正常訪視`;
      return {
        ...schedule,
        status: hasRoute ? "waiting_departure" : "scheduled",
        geofence_status: "idle",
        note,
        updated_at: now
      };
    });

    let routePlans = (Array.isArray(db.saved_route_plans) ? db.saved_route_plans : []).map((plan) => {
      if (["completed", "archived"].includes(plan.execution_status)) return plan;
      let planChanged = false;
      const routeItems = (Array.isArray(plan.route_items) ? plan.route_items : []).map((item) => {
        const belongs = item.patient_id === patientId || (item.schedule_id && restoredScheduleIds.has(item.schedule_id));
        if (!belongs) return item;
        if (item.checked && item.status !== "paused") return item;
        planChanged = true;
        changed = true;
        if (item.schedule_id) restoredScheduleIds.add(item.schedule_id);
        return { ...item, checked: true, status: "scheduled" };
      });
      if (!planChanged) return plan;
      const nextRouteItems = reindexRouteItems(routeItems);
      return {
        ...plan,
        route_items: nextRouteItems,
        schedule_ids: Array.from(new Set([
          ...(Array.isArray(plan.schedule_ids) ? plan.schedule_ids : []),
          ...nextRouteItems.map((item) => item.schedule_id).filter(Boolean)
        ])),
        updated_at: now
      };
    });

    const routeOrderByScheduleId = new Map();
    routePlans.forEach((plan) => {
      (Array.isArray(plan.route_items) ? plan.route_items : []).forEach((item) => {
        if (item.schedule_id && item.checked && item.status !== "paused") {
          routeOrderByScheduleId.set(item.schedule_id, item.route_order);
        }
      });
    });

    visitSchedules = visitSchedules.map((schedule) => {
      if (!restoredScheduleIds.has(schedule.id)) return schedule;
      return {
        ...schedule,
        route_order: routeOrderByScheduleId.get(schedule.id) ?? schedule.route_order,
        updated_at: now
      };
    });

    return changed ? { ...db, visit_schedules: visitSchedules, saved_route_plans: routePlans } : db;
  }

  function reconcile(nextDb) {
    if (!nextDb || !Array.isArray(nextDb.patients)) return nextDb;
    const previous = loadJson(SNAPSHOT_KEY, {});
    let db = nextDb;
    nextDb.patients.forEach((patient) => {
      if (previous[patient.id] === "paused" && patient.status === "active") {
        db = restorePatientSchedules(db, patient.id);
      }
    });
    saveJson(SNAPSHOT_KEY, patientStatusSnapshot(db));
    return db;
  }

  function dispatchDbStorage(newValue) {
    try {
      window.dispatchEvent(new StorageEvent("storage", { key: DB_KEY, newValue }));
    } catch {
      window.dispatchEvent(new Event("storage"));
    }
  }

  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  window.localStorage.setItem = (key, value) => {
    if (key === DB_KEY && !internalWrite) {
      try {
        const parsed = JSON.parse(String(value));
        const reconciled = reconcile(parsed);
        const nextValue = JSON.stringify(reconciled);
        internalWrite = true;
        originalSetItem(key, nextValue);
        internalWrite = false;
        if (nextValue !== value) dispatchDbStorage(nextValue);
        return;
      } catch {
        internalWrite = false;
      }
    }
    originalSetItem(key, value);
  };

  const initialDb = loadJson(DB_KEY, null);
  if (initialDb && Array.isArray(initialDb.patients) && !window.localStorage.getItem(SNAPSHOT_KEY)) {
    saveJson(SNAPSHOT_KEY, patientStatusSnapshot(initialDb));
  }
})();
