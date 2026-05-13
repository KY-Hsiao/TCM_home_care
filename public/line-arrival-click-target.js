(() => {
  const DB_KEY = "tcm-home-care-mvp-db";
  const SESSION_KEY = "tcm-home-care-mvp-session";
  const SETTINGS_KEY = "tcm-family-line-settings";
  const LOCAL_CONTACTS_KEY = "tcm-family-line-managed-contacts";
  const TEMPLATE_KEY = "tcm-family-line-template-drafts";
  const SENT_KEY = "tcm-line-arrival-reminder-sent";
  const LAST_RESULT_KEY = "tcm-line-arrival-reminder-last-result";
  const COOLDOWN_MS = 5 * 60 * 1000;
  const DEFAULT_TEMPLATE = {
    subject: "醫師即將抵達提醒",
    content: "您好，{醫師} 已出發前往個案住處，請協助家中環境與個案狀態準備。若臨時不便，請盡快回覆行政人員。"
  };
  let sending = false;

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

  function compact(value) {
    return String(value || "").replace(/[\s()（）｜|:：,，。\-_/]/g, "").trim();
  }

  function recordResult(payload) {
    const value = { ...payload, at: new Date().toISOString() };
    saveJson(LAST_RESULT_KEY, value);
    if (payload.ok) console.info("arrival reminder", value);
    else console.warn("arrival reminder", value);
  }

  function enabled() {
    const settings = loadJson(SETTINGS_KEY, {});
    return settings.doctorArrivalReminder !== false;
  }

  function sentMap() {
    const sent = loadJson(SENT_KEY, {});
    return sent && typeof sent === "object" ? sent : {};
  }

  function sentRecently(scheduleId) {
    const value = sentMap()[scheduleId];
    if (!value) return false;
    const time = new Date(value).getTime();
    return Number.isFinite(time) && Date.now() - time < COOLDOWN_MS;
  }

  function markSent(scheduleId) {
    const sent = sentMap();
    sent[scheduleId] = new Date().toISOString();
    saveJson(SENT_KEY, sent);
  }

  function templateFor(doctorName) {
    const templates = loadJson(TEMPLATE_KEY, {});
    const template = templates.arrival_reminder || DEFAULT_TEMPLATE;
    return {
      subject: String(template.subject || DEFAULT_TEMPLATE.subject).trim() || DEFAULT_TEMPLATE.subject,
      content: String(template.content || DEFAULT_TEMPLATE.content).replaceAll("{醫師}", doctorName || "醫師").trim()
    };
  }

  async function loadContacts() {
    try {
      const response = await fetch("/api/admin/family-line/contacts", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const contacts = Array.isArray(payload.contacts) ? payload.contacts : Array.isArray(payload.friends) ? payload.friends : [];
      if (response.ok && contacts.length) return { contacts, source: "server" };
    } catch {
      // fall back to local storage
    }
    return { contacts: loadJson(LOCAL_CONTACTS_KEY, []), source: "local" };
  }

  function normalizeContact(contact) {
    const lineUserId = String(contact.lineUserId || contact.userId || "").trim();
    return {
      id: contact.id || `line-contact-${lineUserId}`,
      displayName: contact.displayName || lineUserId || "LINE 家屬",
      lineUserId,
      linkedPatientIds: Array.isArray(contact.linkedPatientIds) ? contact.linkedPatientIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
      contactRole: contact.contactRole === "admin" ? "admin" : "family"
    };
  }

  function getActiveRoutePlan(db) {
    const session = loadJson(SESSION_KEY, {});
    const routePlans = Array.isArray(db.saved_route_plans) ? db.saved_route_plans : [];
    if (session.activeRoutePlanId) {
      const selected = routePlans.find((plan) => plan.id === session.activeRoutePlanId);
      if (selected) return selected;
    }
    const activeDoctorId = session.activeDoctorId || session.authenticatedDoctorId;
    return routePlans
      .filter((plan) => !activeDoctorId || plan.doctor_id === activeDoctorId)
      .filter((plan) => plan.execution_status === "executing")
      .sort((a, b) => new Date(b.updated_at || b.saved_at || 0).getTime() - new Date(a.updated_at || a.saved_at || 0).getTime())[0] || null;
  }

  function routeOrder(routePlan, schedule) {
    const item = (routePlan?.route_items || []).find((routeItem) => routeItem.schedule_id === schedule.id);
    const order = Number(item?.route_order || schedule.route_order || 9999);
    return Number.isFinite(order) ? order : 9999;
  }

  function activeRouteSchedules(db, routePlan) {
    const routeScheduleIds = new Set((routePlan?.route_items || []).map((item) => item.schedule_id).filter(Boolean));
    return (db.visit_schedules || [])
      .filter((schedule) => schedule.visit_type !== "回院病歷")
      .filter((schedule) => !["cancelled", "paused"].includes(schedule.status))
      .filter((schedule) => !routePlan || schedule.route_group_id === routePlan.id || routeScheduleIds.has(schedule.id))
      .sort((a, b) => routeOrder(routePlan, a) - routeOrder(routePlan, b));
  }

  function chooseNextRouteSchedule(db, clickLabel) {
    const routePlan = getActiveRoutePlan(db);
    const schedules = activeRouteSchedules(db, routePlan);
    const unsent = schedules.filter((schedule) => !sentRecently(schedule.id));

    const onWay = unsent.find((schedule) => ["on_the_way", "tracking", "proximity_pending"].includes(schedule.status));
    if (onWay) return { schedule: onWay, reason: "current_on_the_way" };

    const currentIndex = schedules.findIndex((schedule) => ["arrived", "in_treatment", "issue_pending"].includes(schedule.status));
    if (currentIndex >= 0) {
      const next = schedules.slice(currentIndex + 1).find((schedule) =>
        !["completed", "cancelled", "paused"].includes(schedule.status) && !sentRecently(schedule.id)
      );
      if (next) return { schedule: next, reason: "next_after_current" };
    }

    const label = compact(clickLabel);
    if (label.includes("下一") || label.includes("前往") || label.includes("出發") || label.includes("導航")) {
      const firstPending = unsent.find((schedule) => ["waiting_departure", "preparing", "scheduled"].includes(schedule.status));
      if (firstPending) return { schedule: firstPending, reason: "first_pending_in_route" };
    }

    return { schedule: null, reason: "no_route_target" };
  }

  async function recipientsFor(db, schedule) {
    const { contacts, source } = await loadContacts();
    const patient = (db.patients || []).find((item) => item.id === schedule.patient_id);
    const doctor = (db.doctors || []).find((item) => item.id === schedule.assigned_doctor_id);
    const recipients = (Array.isArray(contacts) ? contacts : [])
      .map(normalizeContact)
      .filter((contact) => contact.contactRole !== "admin")
      .filter((contact) => contact.lineUserId)
      .filter((contact) => contact.linkedPatientIds.includes(schedule.patient_id))
      .map((contact) => ({
        caregiverId: contact.id,
        caregiverName: contact.displayName,
        patientId: patient?.id || schedule.patient_id,
        patientName: patient?.name || "",
        doctorId: doctor?.id || schedule.assigned_doctor_id,
        doctorName: doctor?.name || "醫師",
        lineUserId: contact.lineUserId
      }));
    return { recipients, source, patient, doctor, contactCount: Array.isArray(contacts) ? contacts.length : 0 };
  }

  async function sendForSchedule(db, schedule, reason) {
    if (!schedule) {
      recordResult({ ok: false, reason, error: "no_schedule" });
      return;
    }
    if (sentRecently(schedule.id)) {
      recordResult({ ok: false, reason, scheduleId: schedule.id, error: "cooldown" });
      return;
    }
    const { recipients, source, patient, doctor, contactCount } = await recipientsFor(db, schedule);
    if (!recipients.length) {
      recordResult({ ok: false, reason, scheduleId: schedule.id, patientId: schedule.patient_id, patientName: patient?.name || "", source, contactCount, error: "no_recipients" });
      return;
    }
    const message = templateFor(doctor?.name || "醫師");
    const response = await fetch("/api/admin/family-line/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: message.subject, content: message.content, recipients })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) markSent(schedule.id);
    recordResult({ ok: response.ok, reason, scheduleId: schedule.id, patientId: schedule.patient_id, patientName: patient?.name || "", source, recipientCount: recipients.length, status: response.status, payload });
  }

  async function dispatch(clickLabel) {
    if (sending || !enabled()) return;
    const db = loadJson(DB_KEY, null);
    if (!db) return;
    const target = chooseNextRouteSchedule(db, clickLabel || "");
    sending = true;
    try {
      await sendForSchedule(db, target.schedule, target.reason);
    } finally {
      sending = false;
    }
  }

  function clickLabel(target) {
    const button = target?.closest?.("button, a");
    if (!button) return "";
    const text = button.textContent || "";
    const label = compact(text);
    if (!(label.includes("前往") || label.includes("出發") || label.includes("導航") || label.includes("開導航") || label.includes("外部地圖") || label.includes("下一"))) return "";
    return text;
  }

  document.addEventListener("click", (event) => {
    const label = clickLabel(event.target);
    if (!label) return;
    void dispatch(label);
    setTimeout(() => void dispatch(label), 450);
    setTimeout(() => void dispatch(label), 1200);
  }, true);
})();
