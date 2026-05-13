(() => {
  const SETTINGS_STORAGE_KEY = 'tcm-family-line-settings';
  const TEMPLATES_STORAGE_KEY = 'tcm-family-line-template-drafts';
  const SETTINGS_API_URL = '/api/admin/family-line/contacts?resource=settings';
  const TEMPLATES_API_URL = '/api/admin/family-line/contacts?resource=templates';
  const DEFAULT_SETTINGS = {
    doctorLeaveAutoBroadcast: false,
    doctorArrivalReminder: true,
    afterReturnCare: true
  };
  const DEFAULT_TEMPLATES = {
    doctor_leave: {
      subject: '醫師請假公告',
      content: '您好，{醫師} 因請假需調整部分居家訪視安排。行政人員會再與您確認後續改派或改期時間，造成不便敬請見諒。'
    },
    arrival_reminder: {
      subject: '醫師即將抵達提醒',
      content: '您好，{醫師} 預計稍後抵達，請協助家中環境與個案狀態準備。若臨時不便，請盡快回覆行政人員。'
    },
    after_return: {
      subject: '訪視後關心',
      content: '您好，今日居家訪視已完成，請持續觀察個案狀態、補充水分並依醫師建議照護。若有不適或疑問，請回覆此 LINE 訊息。'
    },
    custom_notice: {
      subject: '居家照護公告',
      content: '您好，這裡是中醫居家照護團隊，提醒您留意今日照護安排。'
    }
  };
  let applyingServerValues = false;
  let lastSyncedSettingsJson = '';
  let lastSyncedTemplatesJson = '';
  let settingsSyncTimer = 0;
  let templatesSyncTimer = 0;

  function normalizeSettings(value = {}) {
    return {
      doctorLeaveAutoBroadcast:
        typeof value.doctorLeaveAutoBroadcast === 'boolean'
          ? value.doctorLeaveAutoBroadcast
          : DEFAULT_SETTINGS.doctorLeaveAutoBroadcast,
      doctorArrivalReminder:
        typeof value.doctorArrivalReminder === 'boolean'
          ? value.doctorArrivalReminder
          : DEFAULT_SETTINGS.doctorArrivalReminder,
      afterReturnCare:
        typeof value.afterReturnCare === 'boolean'
          ? value.afterReturnCare
          : DEFAULT_SETTINGS.afterReturnCare
    };
  }

  function normalizeTemplateDraft(value = {}, fallback) {
    return {
      subject:
        typeof value.subject === 'string' && value.subject.trim()
          ? value.subject
          : fallback.subject,
      content:
        typeof value.content === 'string' && value.content.trim()
          ? value.content
          : fallback.content
    };
  }

  function normalizeTemplates(value = {}) {
    return {
      doctor_leave: normalizeTemplateDraft(value.doctor_leave, DEFAULT_TEMPLATES.doctor_leave),
      arrival_reminder: normalizeTemplateDraft(value.arrival_reminder, DEFAULT_TEMPLATES.arrival_reminder),
      after_return: normalizeTemplateDraft(value.after_return, DEFAULT_TEMPLATES.after_return),
      custom_notice: normalizeTemplateDraft(value.custom_notice, DEFAULT_TEMPLATES.custom_notice)
    };
  }

  function readLocalJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function readLocalSettings() {
    return normalizeSettings(readLocalJson(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS));
  }

  function readLocalTemplates() {
    return normalizeTemplates(readLocalJson(TEMPLATES_STORAGE_KEY, DEFAULT_TEMPLATES));
  }

  function writeLocalSettings(settings) {
    const normalized = normalizeSettings(settings);
    const json = JSON.stringify(normalized);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, json);
    lastSyncedSettingsJson = json;
    return normalized;
  }

  function writeLocalTemplates(templates) {
    const normalized = normalizeTemplates(templates);
    const json = JSON.stringify(normalized);
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, json);
    lastSyncedTemplatesJson = json;
    return normalized;
  }

  async function pullServerSettings() {
    try {
      const response = await fetch(SETTINGS_API_URL, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.settings) return false;
      applyingServerValues = true;
      writeLocalSettings(payload.settings);
      applyingServerValues = false;
      return true;
    } catch {
      applyingServerValues = false;
      return false;
    }
  }

  async function pullServerTemplates() {
    try {
      const response = await fetch(TEMPLATES_API_URL, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.templates) return false;
      applyingServerValues = true;
      writeLocalTemplates(payload.templates);
      applyingServerValues = false;
      return true;
    } catch {
      applyingServerValues = false;
      return false;
    }
  }

  async function pushServerSettings(settings) {
    try {
      const normalized = normalizeSettings(settings);
      const json = JSON.stringify(normalized);
      if (json === lastSyncedSettingsJson) return true;
      const response = await fetch(SETTINGS_API_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: normalized })
      });
      if (response.ok) lastSyncedSettingsJson = json;
      return response.ok;
    } catch {
      return false;
    }
  }

  async function pushServerTemplates(templates) {
    try {
      const normalized = normalizeTemplates(templates);
      const json = JSON.stringify(normalized);
      if (json === lastSyncedTemplatesJson) return true;
      const response = await fetch(TEMPLATES_API_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: normalized })
      });
      if (response.ok) lastSyncedTemplatesJson = json;
      return response.ok;
    } catch {
      return false;
    }
  }

  function scheduleSettingsPush() {
    if (applyingServerValues) return;
    clearTimeout(settingsSyncTimer);
    settingsSyncTimer = setTimeout(() => {
      void pushServerSettings(readLocalSettings());
    }, 500);
  }

  function scheduleTemplatesPush() {
    if (applyingServerValues) return;
    clearTimeout(templatesSyncTimer);
    templatesSyncTimer = setTimeout(() => {
      void pushServerTemplates(readLocalTemplates());
    }, 500);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === SETTINGS_STORAGE_KEY) scheduleSettingsPush();
    if (event.key === TEMPLATES_STORAGE_KEY) scheduleTemplatesPush();
  });

  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  window.localStorage.setItem = (key, value) => {
    originalSetItem(key, value);
    if (key === SETTINGS_STORAGE_KEY) scheduleSettingsPush();
    if (key === TEMPLATES_STORAGE_KEY) scheduleTemplatesPush();
  };

  void pullServerSettings().then((success) => {
    if (!success) void pushServerSettings(readLocalSettings());
  });
  void pullServerTemplates().then((success) => {
    if (!success) void pushServerTemplates(readLocalTemplates());
  });
})();
