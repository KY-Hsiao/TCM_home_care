(() => {
  const CHIEF_OPTIONS = ["中風", "腦傷", "脊隨損傷", "癌症", "失智", "老化衰弱"];
  const TRACKED_FIELDS = [
    "chief_complaint_option",
    "chief_complaint_other",
    "inspection_tags",
    "inspection_other",
    "listening_tags",
    "listening_other",
    "inquiry_tags",
    "inquiry_other",
    "palpation_tags",
    "palpation_other",
    "medical_history_tags",
    "medical_history_other",
    "treatment_chinese_medicine_checked",
    "treatment_chinese_medicine_note",
    "treatment_acupuncture_checked",
    "treatment_acupuncture_note",
    "treatment_topical_medication_checked",
    "treatment_topical_medication_note",
    "add_to_reminders",
    "reminder_note"
  ];
  let lastKey = "";
  let loading = false;
  let timer = 0;

  function isReturnRecordScreen() {
    return Boolean(document.querySelector('select[name="patient_id"]')) &&
      document.body.textContent.includes("回院病歷");
  }

  function patientKey() {
    const select = document.querySelector('select[name="patient_id"]');
    if (!select || !select.value) return "";
    const label = select.options[select.selectedIndex]?.textContent || "";
    return `${select.value} ${label}`;
  }

  function norm(value) {
    return String(value || "").replace(/[\s()（）｜|:：,，。\-_/]/g, "").trim();
  }

  function fire(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setValue(name, value) {
    const element = document.querySelector(`[name="${name}"]`);
    if (!element) return;
    element.value = value || "";
    fire(element);
  }

  function setSingleCheckbox(name, checked) {
    const element = document.querySelector(`input[type="checkbox"][name="${name}"]`);
    if (!element) return;
    element.checked = Boolean(checked);
    fire(element);
  }

  function setCheckboxGroup(name, values) {
    const set = new Set(values.filter(Boolean));
    document.querySelectorAll(`input[type="checkbox"][name="${name}"]`).forEach((element) => {
      element.checked = set.has(element.value);
      fire(element);
    });
  }

  function clearFields() {
    TRACKED_FIELDS.forEach((name) => {
      document.querySelectorAll(`[name="${name}"]`).forEach((element) => {
        if (element.type === "checkbox") element.checked = false;
        else element.value = "";
        fire(element);
      });
    });
  }

  function textOfSection(card, title, selector = "p") {
    const section = Array.from(card.querySelectorAll("section")).find(
      (item) => item.querySelector("h3")?.textContent?.trim() === title
    );
    return section?.querySelector(selector)?.textContent?.trim() || "";
  }

  function textOfMeta(card, title) {
    const group = Array.from(card.querySelectorAll(".meta-grid > div")).find(
      (item) => item.querySelector("dt")?.textContent?.trim() === title
    );
    return group?.querySelector("dd")?.textContent?.trim() || "";
  }

  function splitItems(value) {
    return String(value || "")
      .replace(/^四診：/, "")
      .split(/[、,，;；\n]/)
      .map((item) => item.trim())
      .filter((item) => item && item !== "未勾選" && item !== "未填寫" && item !== "無");
  }

  function parseFourDiagnosis(summary) {
    const values = { inspection: [], listening: [], inquiry: [], palpation: [] };
    String(summary || "")
      .replace(/^四診：/, "")
      .split("；")
      .map((item) => item.trim())
      .forEach((part) => {
        if (part.startsWith("望")) values.inspection = splitItems(part.replace(/^望\s*/, ""));
        if (part.startsWith("聞")) values.listening = splitItems(part.replace(/^聞\s*/, ""));
        if (part.startsWith("問")) values.inquiry = splitItems(part.replace(/^問\s*/, ""));
        if (part.startsWith("切")) values.palpation = splitItems(part.replace(/^切\s*/, ""));
      });
    return values;
  }

  function extractLine(text, label) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith(`${label}：`))
      ?.replace(`${label}：`, "")
      .trim() || "";
  }

  function parseTreatment(text) {
    const parsed = {
      treatment_chinese_medicine_checked: false,
      treatment_chinese_medicine_note: "",
      treatment_acupuncture_checked: false,
      treatment_acupuncture_note: "",
      treatment_topical_medication_checked: false,
      treatment_topical_medication_note: ""
    };
    String(text || "")
      .split("；")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => {
        if (item === "中藥" || item.startsWith("中藥：")) {
          parsed.treatment_chinese_medicine_checked = true;
          parsed.treatment_chinese_medicine_note = item.replace(/^中藥：?/, "").trim();
        }
        if (item === "針灸" || item.startsWith("針灸：")) {
          parsed.treatment_acupuncture_checked = true;
          parsed.treatment_acupuncture_note = item.replace(/^針灸：?/, "").trim();
        }
        if (item === "外用藥" || item.startsWith("外用藥：")) {
          parsed.treatment_topical_medication_checked = true;
          parsed.treatment_topical_medication_note = item.replace(/^外用藥：?/, "").trim();
        }
      });
    return parsed;
  }

  function findMatchingCard(html, key) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const wanted = norm(key);
    return Array.from(doc.querySelectorAll(".record-card")).find((card) => {
      const title = norm(card.querySelector("h2")?.textContent || "");
      const chart = norm(card.querySelector("h2 span")?.textContent || "");
      return (chart && wanted.includes(chart)) || (title && wanted.includes(title));
    }) || null;
  }

  function useful(card) {
    const generated = textOfSection(card, "病歷全文", "pre");
    const chief = textOfMeta(card, "主訴");
    const four = textOfSection(card, "四診摘要");
    const history = textOfSection(card, "病史");
    return [generated, chief, four, history].some((text) => {
      const v = String(text || "").trim();
      return v && v !== "未填寫" && v !== "未勾選" && !v.includes("望 未勾選；聞 未勾選；問 未勾選；切 未勾選");
    });
  }

  function applyCard(card) {
    clearFields();
    const generated = textOfSection(card, "病歷全文", "pre");
    const chief = textOfMeta(card, "主訴") || extractLine(generated, "主訴");
    const four = textOfSection(card, "四診摘要") || extractLine(generated, "四診");
    const history = textOfSection(card, "病史") || extractLine(generated, "病史");
    const reminder = textOfSection(card, "提醒內容") || extractLine(generated, "提醒");
    const treatment = extractLine(generated, "處置");
    const fourValues = parseFourDiagnosis(four.startsWith("四診") ? four : `四診：${four}`);
    const historyItems = splitItems(history);
    const treatmentValues = parseTreatment(treatment);

    if (chief && chief !== "未填寫") {
      if (CHIEF_OPTIONS.includes(chief)) {
        setValue("chief_complaint_option", chief);
        setValue("chief_complaint_other", "");
      } else {
        setValue("chief_complaint_option", "其他");
        setValue("chief_complaint_other", chief);
      }
    }
    setCheckboxGroup("inspection_tags", fourValues.inspection);
    setCheckboxGroup("listening_tags", fourValues.listening);
    setCheckboxGroup("inquiry_tags", fourValues.inquiry);
    setCheckboxGroup("palpation_tags", fourValues.palpation);
    setCheckboxGroup("medical_history_tags", historyItems);
    Object.entries(treatmentValues).forEach(([name, value]) => {
      if (typeof value === "boolean") setSingleCheckbox(name, value);
      else setValue(name, value);
    });
    if (reminder && reminder !== "未填寫") {
      setSingleCheckbox("add_to_reminders", true);
      setValue("reminder_note", reminder);
    }
  }

  async function autoload() {
    if (!isReturnRecordScreen()) return;
    const key = patientKey();
    if (!key || loading || key === lastKey) return;
    lastKey = key;
    loading = true;
    try {
      clearFields();
      const listResponse = await fetch("/api/admin/google-drive?action=records", { cache: "no-store" });
      const listPayload = await listResponse.json().catch(() => ({}));
      const files = Array.isArray(listPayload.files) ? listPayload.files : [];
      for (const file of files) {
        if (!file?.id) continue;
        const fileResponse = await fetch(`/api/admin/google-drive?action=records&fileId=${encodeURIComponent(file.id)}`, { cache: "no-store" });
        const filePayload = await fileResponse.json().catch(() => ({}));
        const card = filePayload.html ? findMatchingCard(filePayload.html, key) : null;
        if (card && useful(card)) {
          applyCard(card);
          return;
        }
      }
    } catch (error) {
      console.warn("return record autoload failed", error);
    } finally {
      loading = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(autoload, 600);
  }

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.('select[name="patient_id"]')) {
      lastKey = "";
      schedule();
    }
  }, true);

  new MutationObserver(() => {
    if (document.querySelector('select[name="patient_id"]')) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  schedule();
})();
