(() => {
  function clean(text) {
    return String(text || '').replace(/\s+/g, '').trim();
  }

  function buttonClass(kind) {
    if (kind === 'primary') return 'rounded-full bg-brand-coral px-3 py-2 text-sm font-semibold text-white';
    if (kind === 'warn') return 'rounded-full border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800';
    return 'rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-brand-ink';
  }

  function makeButton(label, kind, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = buttonClass(kind);
    button.addEventListener('click', onClick);
    return button;
  }

  function makeLink(label, href) {
    const link = document.createElement('a');
    link.textContent = label;
    link.href = href || '#';
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.className = buttonClass('normal');
    return link;
  }

  function markNotHome() {
    try {
      const key = 'tcm-home-care-mvp-db';
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const db = JSON.parse(raw);
      const now = new Date().toISOString();
      const active = new Set(['on_the_way', 'tracking', 'proximity_pending', 'paused']);
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

  function findElementByText(dialog, selector, labels) {
    return Array.from(dialog.querySelectorAll(selector)).find((element) => {
      const label = clean(element.textContent);
      return labels.some((text) => label.includes(clean(text)));
    }) || null;
  }

  function hideOriginalActions(dialog) {
    Array.from(dialog.querySelectorAll('a, button')).forEach((element) => {
      if (element.closest('[data-unified-nav-actions="true"]')) return;
      const label = clean(element.textContent);
      const isNavAction =
        label.includes(clean('外部 Google 地圖')) ||
        label.includes(clean('外部地圖')) ||
        label.includes(clean('開啟 Google 導航')) ||
        label.includes(clean('開導航')) ||
        label.includes(clean('目前患者暫停')) ||
        label.includes(clean('註記患者不在家')) ||
        label.includes(clean('患者不在家／暫停')) ||
        label.includes(clean('不在家')) ||
        label.includes(clean('已抵達，回到即時導航')) ||
        label.includes(clean('已抵達')) ||
        label.includes(clean('關閉導航')) ||
        label.includes(clean('關閉'));
      if (isNavAction) element.style.display = 'none';
    });
  }

  function getHeader(dialog) {
    return dialog.querySelector('.border-b') || dialog.querySelector('div');
  }

  function createUnifiedBar(dialog) {
    const existing = dialog.querySelector('[data-unified-nav-actions="true"]');
    if (existing) return existing;

    const external = findElementByText(dialog, 'a', ['外部 Google 地圖', '外部地圖', '開啟 Google 導航', '開導航']);
    const pause = findElementByText(dialog, 'button', ['目前患者暫停', '註記患者不在家', '患者不在家／暫停', '不在家']);
    const arrive = findElementByText(dialog, 'button', ['已抵達，回到即時導航', '已抵達', '關閉導航', '關閉']);

    const bar = document.createElement('div');
    bar.dataset.unifiedNavActions = 'true';
    bar.className = 'flex w-full flex-wrap gap-2 pt-2 sm:w-auto sm:pt-0';

    bar.appendChild(makeButton('返回', 'normal', () => {
      if (window.history.length > 1) window.history.back();
      else window.location.assign('/doctor/navigation');
    }));

    if (pause) {
      bar.appendChild(makeButton('不在家', 'warn', () => {
        markNotHome();
        pause.click();
      }));
    }

    if (external && external.getAttribute('href')) {
      bar.appendChild(makeLink('外部地圖', external.getAttribute('href')));
    }

    if (arrive) {
      const arriveLabel = clean(arrive.textContent).includes(clean('關閉')) ? '關閉' : '已抵達';
      bar.appendChild(makeButton(arriveLabel, 'primary', () => arrive.click()));
    }

    const header = getHeader(dialog);
    if (header) header.appendChild(bar);
    return bar;
  }

  function trimFallbackText(dialog) {
    Array.from(dialog.querySelectorAll('p')).forEach((p) => {
      const text = p.textContent || '';
      if (text.includes('這通常是 Google Maps Embed API key') || text.includes('抵達後回到本頁')) {
        p.style.display = 'none';
      }
    });
  }

  function enhance(dialog) {
    if (!dialog) return;
    createUnifiedBar(dialog);
    hideOriginalActions(dialog);
    trimFallbackText(dialog);
  }

  function scan() {
    document.querySelectorAll('[role="dialog"][aria-label="Google 導航視窗"]').forEach(enhance);
  }

  document.addEventListener('DOMContentLoaded', scan);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
