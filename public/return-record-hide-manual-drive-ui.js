(() => {
  function onReturnRecordPage() {
    return Boolean(document.querySelector('select[name="patient_id"]')) && document.body.textContent.includes('回院病歷');
  }

  function shouldHide(text) {
    const drive = text.includes('Google Drive') || text.includes('雲端病歷') || text.includes('歷史病歷') || text.includes('病歷檔') || text.includes('Drive 病歷');
    const manual = text.includes('載入') || text.includes('讀取') || text.includes('選擇') || text.includes('檔案清單') || text.includes('重新整理');
    return drive && manual;
  }

  function hideManualDriveLoaders() {
    if (!onReturnRecordPage()) return;
    document.querySelectorAll('section, article, div').forEach((node) => {
      if (node.querySelector?.('select[name="patient_id"]')) return;
      if (node.closest?.('[data-return-record-hidden="true"]')) return;
      if (shouldHide(node.textContent || '')) {
        node.style.display = 'none';
        node.setAttribute('data-return-record-hidden', 'true');
      }
    });
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
