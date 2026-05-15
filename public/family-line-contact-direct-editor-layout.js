(() => {
  const STYLE_ID = 'tcm-family-line-direct-editor-layout-style';
  const PANEL_ID = 'tcm-family-line-direct-editor';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        width: min(820px, calc(100% - 32px)) !important;
        max-width: 820px !important;
        margin: 10px auto !important;
        padding: 12px !important;
      }
      #${PANEL_ID} .line-direct-head {
        width: min(760px, 100%) !important;
        margin: 0 auto 8px !important;
        padding: 0 2px 4px !important;
        align-items: flex-start !important;
      }
      #${PANEL_ID} h3 {
        font-size: 16px !important;
      }
      #${PANEL_ID} .line-direct-help {
        max-width: 560px !important;
        margin-top: 3px !important;
        font-size: 12.5px !important;
        line-height: 1.45 !important;
      }
      #${PANEL_ID} .line-direct-refresh {
        padding: 7px 11px !important;
        font-size: 12.5px !important;
      }
      #${PANEL_ID} .line-direct-list {
        max-width: 760px !important;
        margin: 0 auto !important;
        gap: 6px !important;
      }
      #${PANEL_ID} .line-direct-row {
        grid-template-columns: minmax(128px, 180px) minmax(220px, 1fr) 92px !important;
        gap: 8px !important;
        padding: 8px 10px !important;
        border-radius: 14px !important;
      }
      #${PANEL_ID} .line-direct-name strong {
        font-size: 13.5px !important;
      }
      #${PANEL_ID} .line-direct-name small {
        margin-top: 2px !important;
        font-size: 11.5px !important;
      }
      #${PANEL_ID} select {
        min-height: 38px !important;
        padding: 7px 9px !important;
        font-size: 13.5px !important;
      }
      #${PANEL_ID} label {
        justify-content: flex-start !important;
        font-size: 12.5px !important;
      }
      #${PANEL_ID} input[type="checkbox"] {
        width: 17px !important;
        height: 17px !important;
      }
      @media (max-width: 760px) {
        #${PANEL_ID} {
          width: calc(100% - 20px) !important;
          margin: 10px auto !important;
          padding: 10px !important;
        }
        #${PANEL_ID} .line-direct-head,
        #${PANEL_ID} .line-direct-list {
          width: 100% !important;
          max-width: 100% !important;
        }
        #${PANEL_ID} .line-direct-row {
          grid-template-columns: 1fr !important;
          gap: 7px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded', installStyle);
  installStyle();
})();
