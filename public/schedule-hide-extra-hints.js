(() => {
  const HINT_PATTERNS = [
    '說明',
    '提示',
    '請先',
    '請選擇',
    '按下',
    '送出後',
    '系統會',
    '系統將',
    '自動',
    'Google',
    'LINE',
    '地圖預覽',
    '路線預覽',
    '最短路線',
    '導航接力',
    '資料來源',
    '若未',
    '如果',
    '可在',
    '可用於',
    '用於',
    '此功能',
    '此頁',
    '目前僅',
    '目前只',
    '建議',
    '提醒家屬',
    '行政人員可',
    '醫師端會'
  ];

  function onSchedulePage() {
    return window.location.pathname === '/admin/schedules';
  }

  function hasInteractiveElement(node) {
    return Boolean(node.querySelector?.('input, textarea, select, button, a'));
  }

  function looksLikeEssentialValue(text) {
    const value = String(text || '').trim();
    if (!value) return true;
    if (/^\d+\s*筆$/.test(value)) return true;
    if (/^\d{4}\/\d{2}\/\d{2}/.test(value)) return true;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;
    if (['上午', '下午', '服務中', '草稿', '執行中', '已完成', '已封存', '暫停', '排程中'].includes(value)) return true;
    return false;
  }

  function shouldHideTextNode(node) {
    const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 18 || looksLikeEssentialValue(text)) return false;
    if (hasInteractiveElement(node)) return false;
    if (HINT_PATTERNS.some((pattern) => text.includes(pattern))) return true;
    return text.length > 42 && /[，。；、]/.test(text);
  }

  function hideNode(node) {
    node.style.display = 'none';
    node.setAttribute('data-schedule-hint-hidden', 'true');
  }

  function hideExtraScheduleHints() {
    if (!onSchedulePage()) return;
    document.querySelectorAll('p, small, span, div').forEach((node) => {
      if (node.closest?.('[data-schedule-hint-hidden="true"]')) return;
      if (node.closest?.('table')) return;
      if (node.closest?.('[role="dialog"]')) return;
      if (node.querySelector?.('input, textarea, select, button, a')) return;
      if (shouldHideTextNode(node)) hideNode(node);
    });
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(hideExtraScheduleHints, 200);
  }

  document.addEventListener('DOMContentLoaded', schedule);
  document.addEventListener('change', schedule, true);
  window.addEventListener('popstate', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
