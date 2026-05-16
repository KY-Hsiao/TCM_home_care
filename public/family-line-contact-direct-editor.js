(() => {
  const DB_KEY = 'tcm-home-care-mvp-db';
  const CONTACTS_KEY = 'tcm-family-line-managed-contacts';
  const API_URL = '/api/admin/family-line/contacts';
  const PANEL_ID = 'tcm-family-line-direct-editor';
  let renderTimer = 0;
  let isPersisting = false;
  let isUserEditingPanel = false;
  let lastRenderedSignature = '';

  function clean(text) {
    return String(text || '').replace(/\s+/g, '').trim();
  }

  function isLinePage() {
    const path = `${window.location.pathname}${window.location.hash}`.toLowerCase();
    const text = document.body?.textContent || '';
    return path.includes('family-line') || text.includes('LINE 好友') || text.includes('LINE 名單') || text.includes('家屬聯繫');
  }

  function loadJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeContact(contact) {
    const lineUserId = String(contact?.lineUserId || contact?.userId || '').trim();
    return {
      id: String(contact?.id || `line-contact-${lineUserId}`),
      displayName: String(contact?.displayName || lineUserId || 'LINE 名單'),
      lineUserId,
      linkedPatientIds: Array.isArray(contact?.linkedPatientIds)
        ? contact.linkedPatientIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [],
      contactRole: contact?.contactRole === 'admin' ? 'admin' : 'family',
      note: String(contact?.note || ''),
      source: contact?.source === 'official_friend' ? 'official_friend' : 'webhook',
      updatedAt: String(contact?.updatedAt || new Date().toISOString())
    };
  }

  function loadContacts() {
    const contacts = loadJson(CONTACTS_KEY, []);
    return Array.isArray(contacts) ? contacts.map(normalizeContact).filter((contact) => contact.lineUserId) : [];
  }

  function loadPatients() {
    const db = loadJson(DB_KEY, {});
    const patients = Array.isArray(db.patients) ? db.patients : [];
    return patients
      .filter((patient) => patient && patient.id && patient.name && patient.status !== 'closed')
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hant'));
  }

  function buildSignature(contacts, patients) {
    return JSON.stringify({
      contacts: contacts.map((contact) => ({
        id: contact.id,
        lineUserId: contact.lineUserId,
        patientId: contact.linkedPatientIds[0] || '',
        role: contact.contactRole,
        updatedAt: contact.updatedAt
      })),
      patients: patients.map((patient) => ({ id: patient.id, name: patient.name, status: patient.status }))
    });
  }

  function persistContact(contact) {
    if (!contact.lineUserId || isPersisting) return;
    window.fetch(API_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineUserId: contact.lineUserId,
        linkedPatientIds: contact.linkedPatientIds,
        contactRole: contact.contactRole,
        note: contact.note
      })
    }).catch(() => undefined);
  }

  function updateContact(contactId, patch) {
    const now = new Date().toISOString();
    const contacts = loadContacts();
    let updatedContact = null;
    const nextContacts = contacts.map((contact) => {
      if (contact.id !== contactId) return contact;
      updatedContact = { ...contact, ...patch, updatedAt: now };
      return updatedContact;
    });
    isPersisting = true;
    saveJson(CONTACTS_KEY, nextContacts);
    isPersisting = false;
    if (updatedContact) persistContact(updatedContact);
    lastRenderedSignature = buildSignature(nextContacts, loadPatients());
  }

  function makeStyles() {
    if (document.getElementById(`${PANEL_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${PANEL_ID}-style`;
    style.textContent = `
      #${PANEL_ID} {
        margin: 12px auto;
        max-width: 1120px;
        border: 1px solid #dbe3ef;
        border-radius: 22px;
        background: #ffffff;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.10);
        padding: 14px;
        color: #172033;
      }
      #${PANEL_ID} .line-direct-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
      }
      #${PANEL_ID} h3 {
        margin: 0;
        font-size: 17px;
        font-weight: 800;
      }
      #${PANEL_ID} .line-direct-help {
        margin: 4px 0 0;
        color: #64748b;
        font-size: 13px;
        line-height: 1.55;
      }
      #${PANEL_ID} .line-direct-refresh {
        border: 1px solid #dbe3ef;
        border-radius: 999px;
        background: #fff;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }
      #${PANEL_ID} .line-direct-list {
        display: grid;
        gap: 8px;
      }
      #${PANEL_ID} .line-direct-row {
        display: grid;
        grid-template-columns: minmax(150px, 1fr) minmax(180px, 1.1fr) auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #e5edf6;
        border-radius: 16px;
        background: #f8fafc;
        padding: 10px;
      }
      #${PANEL_ID} .line-direct-name {
        min-width: 0;
      }
      #${PANEL_ID} .line-direct-name strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
      }
      #${PANEL_ID} .line-direct-name small {
        display: block;
        margin-top: 3px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #64748b;
        font-size: 12px;
      }
      #${PANEL_ID} select {
        width: 100%;
        min-height: 42px;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        background: #fff;
        padding: 8px 10px;
        color: #172033;
        font-size: 14px;
      }
      #${PANEL_ID} label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        color: #334155;
        font-size: 13px;
        font-weight: 700;
      }
      #${PANEL_ID} input[type="checkbox"] {
        width: 18px;
        height: 18px;
      }
      #${PANEL_ID} .line-direct-empty {
        border: 1px dashed #cbd5e1;
        border-radius: 16px;
        padding: 14px;
        color: #64748b;
        font-size: 14px;
      }
      .tcm-hide-complex-line-association,
      .tcm-hide-original-line-contact-row {
        display: none !important;
      }
      @media (max-width: 760px) {
        #${PANEL_ID} .line-direct-row {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function shouldPreserveOriginalTool(text) {
    return [
      'LINE 快速功能',
      '即時群發訊息',
      '單獨發訊息',
      'LINE 自動發送設定',
      '範本群發',
      '重新整理好友名單',
      '全選好友',
      '反選好友',
      '操作名單',
      '目前顯示好友'
    ].some((label) => text.includes(clean(label)));
  }

  function isProtectedLineQuickFunction(element) {
    return Boolean(
      element?.closest?.('[data-line-quick-functions="true"]') ||
        element?.closest?.('[role="dialog"][aria-label="即時群發訊息"]') ||
        element?.closest?.('[role="dialog"][aria-label="單獨發訊息"]') ||
        element?.closest?.('[role="dialog"][aria-label="LINE 自動發送設定"]') ||
        element?.closest?.('[role="dialog"][aria-label="範本群發"]')
    );
  }

  function isOriginalContactRowElement(element, contacts) {
    if (!element || element.id === PANEL_ID || element.closest?.(`#${PANEL_ID}`)) return false;
    if (isProtectedLineQuickFunction(element)) return false;
    const text = clean(element.textContent);
    if (!text || shouldPreserveOriginalTool(text)) return false;
    const matchedContact = contacts.some((contact) =>
      (contact.lineUserId && text.includes(clean(contact.lineUserId))) ||
      (contact.displayName && clean(contact.displayName).length >= 2 && text.includes(clean(contact.displayName)))
    );
    if (!matchedContact) return false;
    const hasOriginalAssociationCue = [
      '已綁定',
      '缺LINEuserId',
      'LINE名單',
      '行政人員',
      '家屬聯繫',
      '關聯',
      '取消關聯',
      '設為',
      '備註'
    ].some((cue) => text.includes(clean(cue)));
    return hasOriginalAssociationCue;
  }

  function hideOriginalContactRows(contacts) {
    if (!contacts.length) return;
    const candidates = Array.from(document.querySelectorAll('li, tr, article, section, div'))
      .filter((node) => {
        if (node.id === PANEL_ID || node.closest?.(`#${PANEL_ID}`)) return false;
        if (isProtectedLineQuickFunction(node)) return false;
        const text = clean(node.textContent);
        if (!text) return false;
        if (shouldPreserveOriginalTool(text)) return false;
        const childContactRows = Array.from(node.children || []).filter((child) =>
          isOriginalContactRowElement(child, contacts)
        );
        if (childContactRows.length >= 2) return true;
        return isOriginalContactRowElement(node, contacts);
      })
      .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length);

    candidates.forEach((node) => {
      const text = clean(node.textContent);
      if (shouldPreserveOriginalTool(text)) return;
      if (node.querySelector?.('button') && shouldPreserveOriginalTool(node.textContent)) return;
      node.classList.add('tcm-hide-original-line-contact-row');
    });
  }

  function hideOriginalComplexAssociationUi() {
    if (!isLinePage()) return;
    const panel = document.getElementById(PANEL_ID);
    const hideLabels = [
      '批次關聯',
      '批次取消',
      '取消關聯',
      '設為行政人員',
      '設為家屬',
      '家屬聯繫角色',
      '關聯到指定個案',
      '關聯到居家個案',
      '要關聯的居家個案',
      '取消與指定個案'
    ];

    Array.from(document.querySelectorAll('button, label, select')).forEach((element) => {
      if (panel?.contains(element)) return;
      if (isProtectedLineQuickFunction(element)) return;
      const text = clean(element.textContent);
      const parentText = clean(element.closest('div, label, section, fieldset')?.textContent || '');
      if (shouldPreserveOriginalTool(text) || shouldPreserveOriginalTool(parentText)) return;
      if (hideLabels.some((label) => text.includes(clean(label)) || parentText.includes(clean(label)))) {
        const target = element.closest('label') || element.closest('button') || element;
        target.classList.add('tcm-hide-complex-line-association');
      }
    });
    hideOriginalContactRows(loadContacts());
  }

  function renderPanel(options = {}) {
    if (!isLinePage()) return;
    const force = Boolean(options.force);
    const activeElement = document.activeElement;
    const existingPanel = document.getElementById(PANEL_ID);
    if (!force && isUserEditingPanel && existingPanel?.contains(activeElement)) return;

    makeStyles();
    hideOriginalComplexAssociationUi();
    const contacts = loadContacts();
    const patients = loadPatients();
    const signature = buildSignature(contacts, patients);
    if (!force && existingPanel && signature === lastRenderedSignature) return;
    lastRenderedSignature = signature;

    let panel = existingPanel;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      const root = document.getElementById('root');
      if (root?.parentElement) {
        root.parentElement.insertBefore(panel, root.nextSibling);
      } else {
        document.body.prepend(panel);
      }
      panel.addEventListener('focusin', () => {
        isUserEditingPanel = true;
      });
      panel.addEventListener('focusout', () => {
        window.setTimeout(() => {
          if (!panel.contains(document.activeElement)) isUserEditingPanel = false;
        }, 250);
      });
      panel.addEventListener('pointerdown', () => {
        isUserEditingPanel = true;
      });
    }

    panel.innerHTML = `
      <div class="line-direct-head">
        <div>
          <h3>簡易 LINE 名單關聯</h3>
          <p class="line-direct-help">每位 LINE 好友直接選擇所屬患者；勾選「行政人員」後，該名單不作為家屬提醒對象。</p>
        </div>
        <button type="button" class="line-direct-refresh">重新整理本區</button>
      </div>
      <div class="line-direct-list"></div>
    `;

    const list = panel.querySelector('.line-direct-list');
    const refresh = panel.querySelector('.line-direct-refresh');
    refresh?.addEventListener('click', () => renderPanel({ force: true }));

    if (!contacts.length) {
      list.innerHTML = '<div class="line-direct-empty">目前尚未有 LINE 好友名單。請先使用上方「重新整理好友名單」同步 LINE 官方帳號好友。</div>';
      return;
    }

    contacts.forEach((contact) => {
      const row = document.createElement('div');
      row.className = 'line-direct-row';
      row.dataset.contactId = contact.id;

      const nameCell = document.createElement('div');
      nameCell.className = 'line-direct-name';
      nameCell.innerHTML = `<strong></strong><small></small>`;
      nameCell.querySelector('strong').textContent = contact.displayName;
      nameCell.querySelector('small').textContent = contact.lineUserId;

      const select = document.createElement('select');
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '未指定患者';
      select.appendChild(emptyOption);
      patients.forEach((patient) => {
        const option = document.createElement('option');
        option.value = String(patient.id);
        option.textContent = `${patient.name}${patient.primary_diagnosis ? `｜${patient.primary_diagnosis}` : ''}`;
        select.appendChild(option);
      });
      select.value = contact.linkedPatientIds[0] || '';
      select.addEventListener('focus', () => {
        isUserEditingPanel = true;
      });
      select.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!panel.contains(document.activeElement)) isUserEditingPanel = false;
        }, 250);
      });
      select.addEventListener('change', () => {
        updateContact(contact.id, {
          linkedPatientIds: select.value ? [select.value] : []
        });
      });

      const adminLabel = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = contact.contactRole === 'admin';
      checkbox.addEventListener('change', () => {
        updateContact(contact.id, {
          contactRole: checkbox.checked ? 'admin' : 'family'
        });
      });
      adminLabel.appendChild(checkbox);
      adminLabel.appendChild(document.createTextNode('行政人員'));

      row.appendChild(nameCell);
      row.appendChild(select);
      row.appendChild(adminLabel);
      list.appendChild(row);
    });
    hideOriginalContactRows(contacts);
  }

  function scheduleRender(options = {}) {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => renderPanel(options), options.delay ?? 350);
  }

  function installNavigationHooks() {
    const rerender = () => scheduleRender({ force: false, delay: 450 });
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      rerender();
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      rerender();
      return result;
    };
    window.addEventListener('popstate', rerender);
    window.addEventListener('hashchange', rerender);
  }

  document.addEventListener('DOMContentLoaded', () => scheduleRender({ delay: 250 }));
  window.addEventListener('storage', (event) => {
    if (event.key === CONTACTS_KEY || event.key === DB_KEY) scheduleRender({ force: true, delay: 250 });
  });
  installNavigationHooks();
  scheduleRender({ delay: 350 });
  window.setTimeout(() => scheduleRender({ force: false }), 1200);
  window.setTimeout(() => scheduleRender({ force: false }), 2500);
  window.setInterval(() => {
    hideOriginalComplexAssociationUi();
    const panel = document.getElementById(PANEL_ID);
    if (!panel && isLinePage()) renderPanel({ force: false });
  }, 1800);
})();
