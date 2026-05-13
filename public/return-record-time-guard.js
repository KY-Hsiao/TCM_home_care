(() => {
  const fields = ["treatment_start_time", "treatment_end_time"];
  const prefixes = ["治療日期：", "開始治療時間：", "結束治療時間："];
  let saved = {};
  let protectUntil = 0;

  function inReturnRecord() {
    return Boolean(document.querySelector('select[name="patient_id"]')) && document.body.textContent.includes("回院病歷");
  }
  function fire(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function saveTime() {
    fields.forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      saved[name] = el?.value || "";
    });
  }
  function restoreTime() {
    if (Date.now() > protectUntil) return;
    fields.forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el && name in saved && el.value !== saved[name]) {
        el.value = saved[name] || "";
        fire(el);
      }
    });
  }
  function stripOldTimeLines() {
    document.querySelectorAll('textarea[name="generated_record_text"]').forEach((el) => {
      const original = String(el.value || "");
      const next = original.split(/\r?\n/).filter((line) => {
        const t = line.trim();
        return !prefixes.some((p) => t.startsWith(p));
      }).join("\n").trim();
      if (next !== original) {
        el.value = next;
        fire(el);
      }
    });
  }
  function guard() {
    if (!inReturnRecord()) return;
    restoreTime();
    stripOldTimeLines();
  }
  function startGuard() {
    if (!inReturnRecord()) return;
    saveTime();
    protectUntil = Date.now() + 8000;
    setTimeout(guard, 150);
    setTimeout(guard, 600);
    setTimeout(guard, 1500);
  }
  document.addEventListener("change", (event) => {
    if (fields.includes(event.target?.name)) saveTime();
    if (event.target?.matches?.('select[name="patient_id"]')) startGuard();
  }, true);
  new MutationObserver(guard).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(guard, 1000);
  startGuard();
})();
