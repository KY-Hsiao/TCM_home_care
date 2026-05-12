(() => {
  const EXTRA_HINT_PATTERNS = [
    '已載入此個案暫存內容',
    '切換個案或關閉視窗後',
    '已對應剛完成案件',
    '當日網頁檔名稱',
    '網頁檔會以單次巡診為單位',
    '檔名使用日期、醫師姓名、上午或下午',
    '居家個案病例紀錄.html'
  ];

  function onReturnRecordPage() {
    return Boolean(document.querySelector('select[name="patient_id"]')) && document.body.textContent.includes('回院病歷');
  }

  function shouldHideManualDriveBlock(text) {
    const drive = text.includes('Google Drive') || text.includes('雲端病歷') || text.includes('歷史病歷') || text.includes('病歷檔') || text.includes('Drive 病歷');
    const manual = text.includes('載入') || text.includes('讀取') || text.includes('選擇') || text.includes('檔案清單') || text.includes('重新整理');
    return drive && manual;
  }

  function shouldHideExtraHint(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    if (EXTRA_HINT_PATTERNS.some((pattern) => value.includes(pattern))) return true;
    return /^\d{8}_.+_居家個案病例紀錄\.html$/.test(value);
  }

  function hideNode(node) {
    node.style.display = 'none';
    node.setAttribute('data-return-record-hidden', 'true');
  }

  function hideExtraHints() {
    document.querySelectorAll('p, small, span, label, code, pre, div').forEach((node) => {
      if (node.closest?.('[data-return-record-hidden="true"]')) return;
      if (node.querySelector?.('select[name="patient_id"]')) return;
      const text = node.textContent || '';
      if (!shouldHideExtraHint(text)) return;
      const hasInput = Boolean(node.querySelector?.('input, textarea, select, button'));
      const target = hasInput ? node : node.closest('p, small, label, code, pre, div') || node;
      const targetText = target.textContent || '';
      if (targetText.length <= 360 && !target.querySelector?.('select[name="patient_id"]')) {
        hideNode(target);
      } else {
        hideNode(node);
      }
    });
  }

  function hideManualDriveLoaders() {
    if (!onReturnRecordPage()) return;
    document.querySelectorAll('section, article, div').forEach((node) => {
      if (node.querySelector?.('select[name="patient_id"]')) return;
      if (node.closest?.('[data-return-record-hidden="true"]')) return;
      if (shouldHideManualDriveBlock(node.textContent || '')) hideNode(node);
    });
    hideExtraHints();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(hideManualDriveLoaders, 250);
  }

  document.addEventListener('DOMContentLoaded', schedule);
  document.addEventListener('change', schedule, true);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
