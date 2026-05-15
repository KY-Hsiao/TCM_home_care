(() => {
  const STYLE_ID = 'tcm-family-line-direct-editor-layout-style';
  const PANEL_ID = 'tcm-family-line-direct-editor';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        width: min(920px, calc(100% - 32px)) !important;
        max-width: 920px !important;
        margin: 12px auto !important;
        padding: 14px !important;
      }
      #${PANEL_ID} .line-direct-head {
        padding: 2px 2px 8px !important;
      }
      #${PANEL_ID} .line-direct-list {
        max-width: 860px !important;
        margin: 0 auto !important;
      }
      #${PANEL_ID} .line-direct-row {
        grid-template-columns: minmax(145px, 0.95fr) minmax(220px, 1fr) 108px !important;
        gap: 10px !important;
        padding: 10px 12px !important;
      }
      #${PANEL_ID} .line-direct-name strong {
        font-size: 14px !important;
      }
      #${PANEL_ID} select {
        min-height: 40px !important;
      }
      @media (max-width: 760px) {
        #${PANEL_ID} {
          width: calc(100% - 20px) !important;
          margin: 10px auto !important;
          padding: 12px !important;
        }
        #${PANEL_ID} .line-direct-list {
          max-width: 100% !important;
        }
        #${PANEL_ID} .line-direct-row {
          grid-template-columns: 1fr !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener('DOMContentLoaded', installStyle);
  installStyle();
})();
