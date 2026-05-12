(() => {
  const ENTRY_KEY = "tcm-home-care-entry-visited-at";
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const path = window.location.pathname;
  const now = Date.now();

  function readLastEntryAt() {
    const raw = window.localStorage.getItem(ENTRY_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  }

  if (path === "/" || path === "") {
    window.localStorage.setItem(ENTRY_KEY, String(now));
    return;
  }

  const lastEntryAt = readLastEntryAt();
  if (!lastEntryAt || now - lastEntryAt > SIX_HOURS_MS) {
    const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    window.location.replace(`/?redirect=${redirect}`);
  }
})();
