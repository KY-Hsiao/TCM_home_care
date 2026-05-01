import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import type { Caregiver, Doctor, Patient, VisitSchedule } from "../../domain/models";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";

type FamilyLineAutomationSettings = {
  doctorLeaveAutoBroadcast: boolean;
  doctorArrivalReminder: boolean;
  afterReturnCare: boolean;
};

type FamilyLineTemplateKey =
  | "doctor_leave"
  | "arrival_reminder"
  | "after_return"
  | "custom_notice";

type FamilyLineRecipient = {
  caregiver: Caregiver;
  patient: Patient;
  schedule: VisitSchedule | null;
  doctor: Doctor | null;
  lineUserId: string;
};

type FamilyLineTemplateDraft = {
  subject: string;
  content: string;
};

const SETTINGS_STORAGE_KEY = "tcm-family-line-settings";
const BINDINGS_STORAGE_KEY = "tcm-family-line-user-bindings";
const TEMPLATE_DRAFTS_STORAGE_KEY = "tcm-family-line-template-drafts";

const defaultSettings: FamilyLineAutomationSettings = {
  doctorLeaveAutoBroadcast: false,
  doctorArrivalReminder: true,
  afterReturnCare: true
};

const templateLabels: Record<FamilyLineTemplateKey, string> = {
  doctor_leave: "醫師請假公告群發",
  arrival_reminder: "醫師抵達前提醒",
  after_return: "結束後關心",
  custom_notice: "自設定公告群發"
};

const defaultTemplateDrafts: Record<FamilyLineTemplateKey, FamilyLineTemplateDraft> = {
  doctor_leave: {
    subject: "醫師請假公告",
    content: "您好，{醫師} 因請假需調整部分居家訪視安排。行政人員會再與您確認後續改派或改期時間，造成不便敬請見諒。"
  },
  arrival_reminder: {
    subject: "醫師即將抵達提醒",
    content: "您好，{醫師} 預計稍後抵達，請協助家中環境與個案狀態準備。若臨時不便，請盡快回覆行政人員。"
  },
  after_return: {
    subject: "訪視後關心",
    content: "您好，今日居家訪視已完成，請持續觀察個案狀態、補充水分並依醫師建議照護。若有不適或疑問，請回覆此 LINE 訊息。"
  },
  custom_notice: {
    subject: "居家照護公告",
    content: "您好，這裡是中醫居家照護團隊，提醒您留意今日照護安排。"
  }
};

function loadJsonStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function renderTemplateDraft(draft: FamilyLineTemplateDraft, selectedDoctorName: string) {
  return {
    subject: draft.subject.trim() || "LINE 家屬通知",
    content: draft.content.replaceAll("{醫師}", selectedDoctorName).trim()
  };
}

function resolveLatestSchedule(schedules: VisitSchedule[]) {
  return schedules
    .slice()
    .sort(
      (left, right) =>
        new Date(right.scheduled_start_at).getTime() -
        new Date(left.scheduled_start_at).getTime()
    )[0] ?? null;
}

function resolveRecipientLineStatus(lineUserId: string) {
  return lineUserId.trim() ? "已綁定" : "缺 LINE userId";
}

export function AdminFamilyLinePage() {
  const { db, repositories } = useAppContext();
  const [settings, setSettings] = useState<FamilyLineAutomationSettings>(() =>
    loadJsonStorage(SETTINGS_STORAGE_KEY, defaultSettings)
  );
  const [lineBindings, setLineBindings] = useState<Record<string, string>>(() =>
    loadJsonStorage<Record<string, string>>(BINDINGS_STORAGE_KEY, {})
  );
  const [templateDrafts, setTemplateDrafts] = useState<Record<FamilyLineTemplateKey, FamilyLineTemplateDraft>>(() =>
    loadJsonStorage<Record<FamilyLineTemplateKey, FamilyLineTemplateDraft>>(
      TEMPLATE_DRAFTS_STORAGE_KEY,
      defaultTemplateDrafts
    )
  );
  const [selectedTemplate, setSelectedTemplate] = useState<FamilyLineTemplateKey>("custom_notice");
  const [selectedSendTypes, setSelectedSendTypes] = useState<FamilyLineTemplateKey[]>(["custom_notice"]);
  const [selectedDoctorId, setSelectedDoctorId] = useState("all");
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [isSendConfirmed, setIsSendConfirmed] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(lineBindings));
  }, [lineBindings]);

  useEffect(() => {
    window.localStorage.setItem(TEMPLATE_DRAFTS_STORAGE_KEY, JSON.stringify(templateDrafts));
  }, [templateDrafts]);

  const recipients = useMemo<FamilyLineRecipient[]>(() => {
    const nextRecipients: FamilyLineRecipient[] = [];
    db.caregivers
      .filter((caregiver) => caregiver.receives_notifications)
      .forEach((caregiver) => {
        const patient = repositories.patientRepository.getPatientById(caregiver.patient_id);
        if (!patient) {
          return;
        }
        const schedules = repositories.visitRepository.getSchedules({ patientId: patient.id });
        const schedule = resolveLatestSchedule(schedules);
        const doctor =
          schedule
            ? db.doctors.find((item) => item.id === schedule.assigned_doctor_id) ?? null
            : db.doctors.find((item) => item.id === patient.preferred_doctor_id) ?? null;
        nextRecipients.push({
          caregiver,
          patient,
          schedule,
          doctor,
          lineUserId: lineBindings[caregiver.id] ?? ""
        });
      });
    return nextRecipients;
  }, [db.caregivers, db.doctors, lineBindings, repositories]);

  const filteredRecipients = useMemo(() => {
    if (selectedDoctorId === "all") {
      return recipients;
    }
    return recipients.filter((recipient) => recipient.doctor?.id === selectedDoctorId);
  }, [recipients, selectedDoctorId]);

  const selectedRecipients = filteredRecipients.filter((recipient) =>
    selectedRecipientIds.includes(recipient.caregiver.id)
  );
  const selectedDoctorName =
    selectedDoctorId === "all"
      ? "負責醫師"
      : db.doctors.find((doctor) => doctor.id === selectedDoctorId)?.name ?? "負責醫師";
  const selectedTemplateDraft = templateDrafts[selectedTemplate];
  const templateContent = renderTemplateDraft(selectedTemplateDraft, selectedDoctorName);
  const selectedSendContents = selectedSendTypes.map((templateKey) => ({
    templateKey,
    label: templateLabels[templateKey],
    ...renderTemplateDraft(templateDrafts[templateKey], selectedDoctorName)
  }));
  const outboundSubject =
    selectedSendContents.length === 1
      ? selectedSendContents[0].subject
      : "LINE 家屬通知";
  const outboundContent =
    selectedSendContents.length === 1
      ? selectedSendContents[0].content
      : selectedSendContents
          .map((item) => `【${item.label}】\n${item.content}`)
          .join("\n\n");
  const sendableRecipients = selectedRecipients.filter((recipient) => recipient.lineUserId.trim());
  const missingLineIdCount = selectedRecipients.length - sendableRecipients.length;

  useEffect(() => {
    setSelectedRecipientIds((current) =>
      current.filter((recipientId) =>
        filteredRecipients.some((recipient) => recipient.caregiver.id === recipientId)
      )
    );
  }, [filteredRecipients]);

  const toggleSetting = (key: keyof FamilyLineAutomationSettings) => {
    setSettings((current) => ({
      ...current,
      [key]: !current[key]
    }));
  };

  const toggleSendType = (templateKey: FamilyLineTemplateKey) => {
    setSelectedSendTypes((current) =>
      current.includes(templateKey)
        ? current.filter((key) => key !== templateKey)
        : [...current, templateKey]
    );
    setIsSendConfirmed(false);
  };

  const updateTemplateDraft = (patch: Partial<FamilyLineTemplateDraft>) => {
    setTemplateDrafts((current) => ({
      ...current,
      [selectedTemplate]: {
        ...current[selectedTemplate],
        ...patch
      }
    }));
    setIsSendConfirmed(false);
  };

  const toggleRecipient = (caregiverId: string) => {
    setSelectedRecipientIds((current) =>
      current.includes(caregiverId)
        ? current.filter((id) => id !== caregiverId)
        : [...current, caregiverId]
    );
  };

  const selectAllFilteredRecipients = () => {
    setSelectedRecipientIds(filteredRecipients.map((recipient) => recipient.caregiver.id));
  };

  const clearSelectedRecipients = () => {
    setSelectedRecipientIds([]);
  };

  const updateLineBinding = (caregiverId: string, lineUserId: string) => {
    setLineBindings((current) => ({
      ...current,
      [caregiverId]: lineUserId.trim()
    }));
  };

  const sendLineMessages = async () => {
    setSendFeedback(null);
    if (!selectedSendTypes.length) {
      setSendFeedback({ tone: "error", message: "請先勾選至少一種本次發送項目。" });
      return;
    }
    if (!outboundContent.trim()) {
      setSendFeedback({ tone: "error", message: "請先填寫已勾選項目的範本內容。" });
      return;
    }
    if (!selectedRecipients.length) {
      setSendFeedback({ tone: "error", message: "請先選擇至少一位發送人員。" });
      return;
    }
    if (!sendableRecipients.length) {
      setSendFeedback({ tone: "error", message: "已選家屬尚未填入 LINE userId，無法推播。" });
      return;
    }
    if (!isSendConfirmed) {
      setSendFeedback({ tone: "error", message: "送出前請先勾選確認本次發送內容與對象。" });
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch("/api/admin/family-line/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          subject: outboundSubject,
          content: outboundContent,
          recipients: sendableRecipients.map((recipient) => ({
            caregiverId: recipient.caregiver.id,
            caregiverName: recipient.caregiver.name,
            patientId: recipient.patient.id,
            patientName: recipient.patient.name,
            lineUserId: recipient.lineUserId
          }))
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        sentCount?: number;
      };
      if (!response.ok) {
        setSendFeedback({
          tone: "error",
          message: payload.error ?? "LINE 發送失敗，請稍後再試。"
        });
        return;
      }

      const now = new Date().toISOString();
      sendableRecipients.forEach((recipient) => {
        repositories.contactRepository.createContactLog({
          id: `line-${Date.now()}-${recipient.caregiver.id}`,
          patient_id: recipient.patient.id,
          visit_schedule_id: recipient.schedule?.id ?? null,
          caregiver_id: recipient.caregiver.id,
          doctor_id: recipient.doctor?.id ?? null,
          admin_user_id: null,
          channel: "line",
          subject: outboundSubject,
          content: outboundContent,
          outcome: "LINE 訊息已送出",
          contacted_at: now,
          created_at: now,
          updated_at: now
        });
      });
      setSendFeedback({
        tone: "success",
        message: `LINE 已送出 ${payload.sentCount ?? sendableRecipients.length} 位家屬。${
          missingLineIdCount > 0 ? `另有 ${missingLineIdCount} 位缺 LINE userId 已略過。` : ""
        }`
      });
      setIsSendConfirmed(false);
    } catch {
      setSendFeedback({
        tone: "error",
        message: "無法連線到 LINE 發送端點，請確認部署與網路狀態。"
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-[1.25rem] border border-white/70 bg-white/90 p-4 shadow-card">
          <p className="text-xs text-slate-500">可通知家屬</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">{recipients.length}</p>
        </div>
        <div className="rounded-[1.25rem] border border-white/70 bg-white/90 p-4 shadow-card">
          <p className="text-xs text-slate-500">已綁 LINE userId</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">
            {recipients.filter((recipient) => recipient.lineUserId.trim()).length}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-white/70 bg-white/90 p-4 shadow-card">
          <p className="text-xs text-slate-500">本次選擇</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">{selectedRecipients.length}</p>
        </div>
        <div className="rounded-[1.25rem] border border-white/70 bg-white/90 p-4 shadow-card">
          <p className="text-xs text-slate-500">可立即發送</p>
          <p className="mt-2 text-2xl font-semibold text-brand-ink">{sendableRecipients.length}</p>
        </div>
      </div>

      {sendFeedback ? (
        <div
          role="status"
          className={`rounded-2xl border px-4 py-3 text-sm ${
            sendFeedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {sendFeedback.message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="LINE 自動發送設定">
          <div className="space-y-3 text-sm">
            {[
              {
                key: "doctorLeaveAutoBroadcast" as const,
                title: "醫師請假時自動發",
                detail: "核准或建立醫師請假後，可依選定家屬發出公告。"
              },
              {
                key: "doctorArrivalReminder" as const,
                title: "醫師抵達前提醒",
                detail: "醫師接近個案地址或即將出發時，提醒家屬準備。"
              },
              {
                key: "afterReturnCare" as const,
                title: "結束後關心",
                detail: "訪視完成後發送照護提醒與回覆入口。"
              }
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleSetting(item.key)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left"
              >
                <span>
                  <span className="block font-semibold text-brand-ink">{item.title}</span>
                  <span className="mt-1 block text-xs text-slate-500">{item.detail}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                    settings[item.key]
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {settings[item.key] ? "啟用" : "停用"}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="公告內容">
          <div className="space-y-3 text-sm">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-brand-ink">本次發送項目</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {(Object.keys(templateLabels) as FamilyLineTemplateKey[]).map((templateKey) => (
                  <label
                    key={templateKey}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`${templateLabels[templateKey]} 本次發送勾選`}
                        checked={selectedSendTypes.includes(templateKey)}
                        onChange={() => toggleSendType(templateKey)}
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 break-words">{templateLabels[templateKey]}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedTemplate(templateKey)}
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-brand-ink"
                    >
                      編輯範本
                    </button>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">目前編輯範本</span>
                <select
                  aria-label="目前編輯範本"
                  value={selectedTemplate}
                  onChange={(event) => setSelectedTemplate(event.target.value as FamilyLineTemplateKey)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  {Object.entries(templateLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">篩選醫師</span>
                <select
                  aria-label="篩選醫師"
                  value={selectedDoctorId}
                  onChange={(event) => setSelectedDoctorId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <option value="all">全部醫師</option>
                  {db.doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">範本標題</span>
              <input
                aria-label="範本標題"
                value={selectedTemplateDraft.subject}
                onChange={(event) => updateTemplateDraft({ subject: event.target.value })}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
              />
            </label>

            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">範本內容</span>
              <textarea
                aria-label="範本內容"
                value={selectedTemplateDraft.content}
                onChange={(event) => updateTemplateDraft({ content: event.target.value })}
                rows={5}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              />
            </label>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <p className="font-semibold">本次預覽</p>
              <p className="mt-1 whitespace-pre-wrap">{templateContent.content || "尚未填寫內容。"}</p>
            </div>

            <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <input
                type="checkbox"
                aria-label="確認本次 LINE 發送"
                checked={isSendConfirmed}
                onChange={(event) => setIsSendConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                我已確認本次勾選項目、範本內容與發送人員，送出後會透過 LINE 推播給可發送的家屬。
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllFilteredRecipients}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
              >
                全選目前名單
              </button>
              <button
                type="button"
                onClick={clearSelectedRecipients}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink"
              >
                清除選擇
              </button>
              <button
                type="button"
                onClick={sendLineMessages}
                disabled={isSending}
                className="rounded-full bg-brand-forest px-5 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {isSending ? "發送中" : "送出 LINE 群發"}
              </button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="發送人員">
        <div className="grid gap-3 lg:grid-cols-2">
          {filteredRecipients.map((recipient) => {
            const isSelected = selectedRecipientIds.includes(recipient.caregiver.id);
            return (
              <div
                key={recipient.caregiver.id}
                className={`rounded-2xl border p-4 ${
                  isSelected ? "border-brand-forest bg-emerald-50/70" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`${recipient.caregiver.name} 發送勾選`}
                      checked={isSelected}
                      onChange={() => toggleRecipient(recipient.caregiver.id)}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-brand-ink">
                        {recipient.caregiver.name} / {recipient.caregiver.relationship}
                      </span>
                      <span className="mt-1 block text-sm text-slate-600">
                        {maskPatientName(recipient.patient.name)}｜{recipient.doctor?.name ?? "未指定醫師"}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        最近排程：{recipient.schedule ? formatDateTimeFull(recipient.schedule.scheduled_start_at) : "尚無排程"}
                      </span>
                    </span>
                  </label>
                  <Badge value={resolveRecipientLineStatus(recipient.lineUserId)} compact />
                </div>
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block font-medium text-brand-ink">LINE userId</span>
                  <input
                    aria-label={`${recipient.caregiver.name} LINE userId`}
                    value={recipient.lineUserId}
                    onChange={(event) => updateLineBinding(recipient.caregiver.id, event.target.value)}
                    placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-2.5"
                  />
                </label>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
