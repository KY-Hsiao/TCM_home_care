(() => {
  const LOGIN_KEY = "tcm-home-care-entry-visited-at";
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const path = window.location.pathname;
  const now = Date.now();

  function readLastSuccessfulLoginAt() {
    const raw = window.localStorage.getItem(LOGIN_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  }

  // 首頁只提供登入，不算通行紀錄。
  // 只有 RoleSelectPage 成功驗證密碼後，才會寫入 LOGIN_KEY。
  if (path === "/" || path === "") {
    return;
  }

  const lastSuccessfulLoginAt = readLastSuccessfulLoginAt();
  if (!lastSuccessfulLoginAt || now - lastSuccessfulLoginAt > SIX_HOURS_MS) {
    window.localStorage.removeItem(LOGIN_KEY);
    const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    window.location.replace(`/?redirect=${redirect}`);
  }
})();
