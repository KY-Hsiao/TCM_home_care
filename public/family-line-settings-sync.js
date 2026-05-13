(() => {
  const STORAGE_KEY = 'tcm-family-line-settings';
  const API_URL = '/api/admin/family-line/contacts?resource=settings';
  const DEFAULT_SETTINGS = {
    doctorLeaveAutoBroadcast: false,
    doctorArrivalReminder: true,
    afterReturnCare: true
  };
  let applyingServerSettings = false;
  let lastSyncedJson = '';
  let syncTimer = 0;

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

  function readLocalSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : DEFAULT_SETTINGS);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  function writeLocalSettings(settings) {
    const normalized = normalizeSettings(settings);
    const json = JSON.stringify(normalized);
    window.localStorage.setItem(STORAGE_KEY, json);
    lastSyncedJson = json;
    return normalized;
  }

  async function pullServerSettings() {
    try {
      const response = await fetch(API_URL, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.settings) return false;
      applyingServerSettings = true;
      writeLocalSettings(payload.settings);
      applyingServerSettings = false;
      return true;
    } catch {
      applyingServerSettings = false;
      return false;
    }
  }

  async function pushServerSettings(settings) {
    try {
      const normalized = normalizeSettings(settings);
      const json = JSON.stringify(normalized);
      if (json === lastSyncedJson) return true;
      const response = await fetch(API_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: normalized })
      });
      if (response.ok) lastSyncedJson = json;
      return response.ok;
    } catch {
      return false;
    }
  }

  function schedulePush() {
    if (applyingServerSettings) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      void pushServerSettings(readLocalSettings());
    }, 500);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) schedulePush();
  });

  const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
  window.localStorage.setItem = (key, value) => {
    originalSetItem(key, value);
    if (key === STORAGE_KEY) schedulePush();
  };

  void pullServerSettings().then((success) => {
    if (!success) void pushServerSettings(readLocalSettings());
  });
})();
