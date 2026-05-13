(() => {
  const DB_KEY = "tcm-home-care-mvp-db";
  const SETTINGS_KEY = "tcm-family-line-settings";
  const LOCAL_CONTACTS_KEY = "tcm-family-line-managed-contacts";
  const TEMPLATE_KEY = "tcm-family-line-template-drafts";
  const SENT_KEY = "tcm-line-arrival-reminder-sent";
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
  function maskName(name) {
    const chars = Array.from(String(name || "").trim());
    if (chars.length <= 2) return chars.join("");
    return `${chars[0]}${"○".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
  }
  function enabled() {
    const settings = loadJson(SETTINGS_KEY, {});
    return settings.doctorArrivalReminder !== false;
  }
  function sentMap() {
    const sent = loadJson(SENT_KEY, {});
    return sent && typeof sent === "object" ? sent : {};
  }
  function wasSent(scheduleId) {
    return Boolean(sentMap()[scheduleId]);
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
      if (response.ok && contacts.length) return contacts;
    } catch {
      // fall back to local storage
    }
    return loadJson(LOCAL_CONTACTS_KEY, []);
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
  function clickText(target) {
    const button = target?.closest?.("button, a");
    if (!button) return "";
    const label = compact(button.textContent);
    if (!(label.includes("前往") || label.includes("出發") || label.includes("導航") || label.includes("開導航"))) return "";
    const parts = [button.textContent || ""];
    let node = button;
    for (let i = 0; i < 6 && node; i += 1) {
      node = node.parentElement;
      if (node) parts.push(node.textContent || "");
    }
    const dialog = button.closest('[role="dialog"]');
    if (dialog) parts.push(dialog.textContent || "");
    return parts.join(" ");
  }
  function findPatient(db, text) {
    const t = compact(text);
    return (db.patients || []).find((patient) => {
      const name = compact(patient.name);
      const masked = compact(maskName(patient.name));
      const chart = compact(patient.chart_number || "");
      return Boolean(name && t.includes(name)) || Boolean(masked && t.includes(masked)) || Boolean(chart && t.includes(chart));
    }) || null;
  }
  function chooseSchedule(db, patientId) {
    const activeRouteIds = new Set(
      (db.saved_route_plans || [])
        .filter((plan) => plan.execution_status === "executing")
        .flatMap((plan) => (plan.route_items || []).map((item) => item.schedule_id).filter(Boolean))
    );
    return (db.visit_schedules || [])
      .filter((schedule) => schedule.patient_id === patientId)
      .filter((schedule) => schedule.visit_type !== "回院病歷")
      .filter((schedule) => !["completed", "cancelled", "paused"].includes(schedule.status))
      .sort((a, b) => {
        const ar = activeRouteIds.has(a.id) ? 0 : 1;
        const br = activeRouteIds.has(b.id) ? 0 : 1;
        if (ar !== br) return ar - br;
        const ao = Number(a.route_order || 9999);
        const bo = Number(b.route_order || 9999);
        if (ao !== bo) return ao - bo;
        return new Date(a.scheduled_start_at || 0).getTime() - new Date(b.scheduled_start_at || 0).getTime();
      })[0] || null;
  }
  async function recipientsFor(db, schedule) {
    const contacts = await loadContacts();
    const patient = (db.patients || []).find((item) => item.id === schedule.patient_id);
    const doctor = (db.doctors || []).find((item) => item.id === schedule.assigned_doctor_id);
    return (Array.isArray(contacts) ? contacts : [])
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
  }
  async function sendForSchedule(db, schedule) {
    if (!schedule || wasSent(schedule.id)) return;
    const recipients = await recipientsFor(db, schedule);
    if (!recipients.length) return;
    const doctor = (db.doctors || []).find((item) => item.id === schedule.assigned_doctor_id);
    const message = templateFor(doctor?.name || "醫師");
    const response = await fetch("/api/admin/family-line/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: message.subject, content: message.content, recipients })
    });
    if (response.ok) markSent(schedule.id);
  }
  async function handleClick(event) {
    const text = clickText(event.target);
    if (!text || sending || !enabled()) return;
    const db = loadJson(DB_KEY, null);
    if (!db) return;
    const patient = findPatient(db, text);
    if (!patient) return;
    const schedule = chooseSchedule(db, patient.id);
    if (!schedule) return;
    sending = true;
    try {
      await sendForSchedule(db, schedule);
    } finally {
      sending = false;
    }
  }
  document.addEventListener("click", (event) => {
    void handleClick(event);
  }, true);
})();
