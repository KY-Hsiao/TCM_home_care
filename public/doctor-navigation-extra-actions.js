(() => {
  function clean(text) {
    return String(text || '').replace(/\s+/g, '').trim();
  }

  function findButton(root, label) {
    return Array.from(root.querySelectorAll('button')).find((button) => clean(button.textContent).includes(clean(label)));
  }

  function makeButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = className;
    button.addEventListener('click', onClick);
    return button;
  }

  function markNotHome() {
    try {
      const key = 'tcm-home-care-mvp-db';
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const db = JSON.parse(raw);
      const now = new Date().toISOString();
      const active = new Set(['on_the_way', 'tracking', 'proximity_pending']);
      const schedules = Array.isArray(db.visit_schedules) ? db.visit_schedules : [];
      const target = schedules
        .filter((schedule) => active.has(schedule.status) && schedule.visit_type !== '回院病歷')
        .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())[0];
      if (!target) return;
      db.visit_schedules = schedules.map((schedule) => {
        if (schedule.id !== target.id) return schedule;
        const originalNote = String(schedule.note || '').trim();
        const note = originalNote.includes('患者不在家') ? originalNote : `${originalNote}${originalNote ? '／' : ''}患者不在家`;
        return { ...schedule, status: 'paused', note, updated_at: now };
      });
      if (Array.isArray(db.saved_route_plans)) {
        db.saved_route_plans = db.saved_route_plans.map((plan) => ({
          ...plan,
          route_items: Array.isArray(plan.route_items)
            ? plan.route_items.map((item) => item.schedule_id === target.id ? { ...item, checked: false, status: 'paused' } : item)
            : plan.route_items,
          updated_at: now
        }));
      }
      window.localStorage.setItem(key, JSON.stringify(db));
    } catch (error) {
      console.warn('mark patient not home failed', error);
    }
  }

  function enhance(dialog) {
    if (!dialog || dialog.dataset.navigationExtraActions === 'true') return;
    const containers = Array.from(dialog.querySelectorAll('div')).filter((node) => {
      const text = node.textContent || '';
      return text.includes('外部 Google 地圖') && (text.includes('已抵達') || text.includes('關閉導航'));
    });
    const container = containers[0];
    if (!container) return;
    dialog.dataset.navigationExtraActions = 'true';

    const normalClass = 'rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-ink';
    const alertClass = 'rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800';

    container.insertBefore(makeButton('返回前頁', normalClass, () => {
      if (window.history.length > 1) window.history.back();
      else window.location.assign('/doctor/navigation');
    }), container.firstChild);

    const pauseButton = findButton(dialog, '目前患者暫停');
    if (pauseButton) {
      const notHomeButton = makeButton('註記患者不在家', alertClass, () => {
        markNotHome();
        pauseButton.click();
      });
      container.insertBefore(notHomeButton, pauseButton);
      pauseButton.style.display = 'none';
    }
  }

  function scan() {
    document.querySelectorAll('[role="dialog"][aria-label="Google 導航視窗"]').forEach(enhance);
  }

  document.addEventListener('DOMContentLoaded', scan);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
