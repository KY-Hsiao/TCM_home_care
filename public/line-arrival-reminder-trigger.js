(() => {
  const DB_KEY = "tcm-home-care-mvp-db";
  const SETTINGS_KEY = "tcm-family-line-settings";
  const CONTACTS_KEY = "tcm-family-line-managed-contacts";
  const SENT_KEY = "tcm-line-arrival-reminder-sent";
  const TEMPLATE_KEY = "tcm-family-line-template-drafts";
  const ON_THE_WAY_STATUSES = new Set(["on_the_way", "tracking", "proximity_pending"]);
  const DEFAULT_TEMPLATE = {
    subject: "醫師即將抵達提醒",
    content: "您好，{醫師} 已出發前往個案住處，請協助家中環境與個案狀態準備。若臨時不便，請盡快回覆行政人員。"
  };
  let lastSignature = "";
  let isSending = false;

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

  function getSettings() {
    const settings = loadJson(SETTINGS_KEY, {});
    return {
      doctorArrivalReminder: settings.doctorArrivalReminder !== false
    };
  }

  function getTemplate() {
    const templates = loadJson(TEMPLATE_KEY, {});
    return templates.arrival_reminder || DEFAULT_TEMPLATE;
  }

  function renderTemplate(template, doctorName) {
    return {
      subject: String(template.subject || DEFAULT_TEMPLATE.subject).trim() || DEFAULT_TEMPLATE.subject,
      content: String(template.content || DEFAULT_TEMPLATE.content).replaceAll("{醫師}", doctorName || "醫師").trim()
    };
  }

  function getSentMap() {
    const sent = loadJson(SENT_KEY, {});
    return sent && typeof sent === "object" ? sent : {};
  }

  function markSent(scheduleId) {
    const sent = getSentMap();
    sent[scheduleId] = new Date().toISOString();
    saveJson(SENT_KEY, sent);
  }

  function cleanupSentMap(db) {
    const schedules = Array.isArray(db.visit_schedules) ? db.visit_schedules : [];
    const validIds = new Set(schedules.map((schedule) => schedule.id));
    const sent = getSentMap();
    const next = {};
    Object.entries(sent).forEach(([scheduleId, sentAt]) => {
      if (validIds.has(scheduleId)) next[scheduleId] = sentAt;
    });
    saveJson(SENT_KEY, next);
  }

  function buildRecipients(db, schedule) {
    const contacts = loadJson(CONTACTS_KEY, []);
    if (!Array.isArray(contacts)) return [];
    const patient = (db.patients || []).find((item) => item.id === schedule.patient_id);
    const doctor = (db.doctors || []).find((item) => item.id === schedule.assigned_doctor_id);
    return contacts
      .filter((contact) => contact.contactRole !== "admin")
      .filter((contact) => String(contact.lineUserId || "").trim())
      .filter((contact) => Array.isArray(contact.linkedPatientIds) && contact.linkedPatientIds.includes(schedule.patient_id))
      .map((contact) => ({
        caregiverId: contact.id || `line-contact-${contact.lineUserId}`,
        caregiverName: contact.displayName || "LINE 家屬",
        patientId: patient?.id || schedule.patient_id,
        patientName: patient?.name || "",
        doctorId: doctor?.id || schedule.assigned_doctor_id,
        doctorName: doctor?.name || "醫師",
        lineUserId: String(contact.lineUserId || "").trim()
      }));
  }

  async function sendArrivalReminder(db, schedule) {
    const recipients = buildRecipients(db, schedule);
    if (!recipients.length) return false;
    const doctor = (db.doctors || []).find((item) => item.id === schedule.assigned_doctor_id);
    const template = renderTemplate(getTemplate(), doctor?.name || "醫師");
    const response = await fetch("/api/admin/family-line/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: template.subject,
        content: template.content,
        recipients
      })
    });
    return response.ok;
  }

  function getCandidateSchedules(db) {
    const sent = getSentMap();
    return (db.visit_schedules || [])
      .filter((schedule) => ON_THE_WAY_STATUSES.has(schedule.status))
      .filter((schedule) => schedule.visit_type !== "回院病歷")
      .filter((schedule) => !sent[schedule.id])
      .sort((left, right) => {
        const leftTime = new Date(left.updated_at || left.scheduled_start_at || 0).getTime();
        const rightTime = new Date(right.updated_at || right.scheduled_start_at || 0).getTime();
        return leftTime - rightTime;
      });
  }

  async function scanAndSend() {
    if (isSending || !getSettings().doctorArrivalReminder) return;
    const db = loadJson(DB_KEY, null);
    if (!db || !Array.isArray(db.visit_schedules)) return;
    const signature = db.visit_schedules
      .map((schedule) => `${schedule.id}:${schedule.status}:${schedule.updated_at}`)
      .join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;
    cleanupSentMap(db);
    const candidates = getCandidateSchedules(db);
    if (!candidates.length) return;
    isSending = true;
    try {
      for (const schedule of candidates) {
        const ok = await sendArrivalReminder(db, schedule);
        if (ok) markSent(schedule.id);
      }
    } finally {
      isSending = false;
    }
  }

  window.addEventListener("storage", (event) => {
    if (event.key === DB_KEY || event.key === CONTACTS_KEY || event.key === SETTINGS_KEY) {
      void scanAndSend();
    }
  });
  setInterval(() => void scanAndSend(), 1500);
  setTimeout(() => void scanAndSend(), 800);
})();
