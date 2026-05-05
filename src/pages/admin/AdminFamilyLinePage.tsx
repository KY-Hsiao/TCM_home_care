import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import type { Doctor, Patient, VisitSchedule } from "../../domain/models";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull } from "../../shared/utils/format";
import { maskPatientName } from "../../shared/utils/patient-name";
import { loadAdminApiTokenSettings } from "../../shared/utils/admin-api-tokens";

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
  id: string;
  displayName: string;
  relationshipLabel: string;
  patient: Patient | null;
  linkedPatients: Patient[];
  schedule: VisitSchedule | null;
  doctor: Doctor | null;
  linkedDoctors: Doctor[];
  lineUserId: string;
};

type ManagedFamilyLineContact = {
  id: string;
  displayName: string;
  lineUserId: string;
  linkedPatientIds: string[];
  note: string;
  source: "webhook" | "official_friend";
  updatedAt: string;
};

type LineFriendProfile = {
  userId: string;
  displayName: string;
  note?: string;
  source?: "webhook" | "official_friend";
  linkedPatientIds?: string[];
  updatedAt?: string;
};

type FamilyLineTemplateDraft = {
  subject: string;
  content: string;
};

const SETTINGS_STORAGE_KEY = "tcm-family-line-settings";
const LEGACY_BINDINGS_STORAGE_KEY = "tcm-family-line-user-bindings";
const MANAGED_CONTACTS_STORAGE_KEY = "tcm-family-line-managed-contacts";
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

function loadArrayStorage<T>(key: string): T[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normalizeManagedLineContacts(
  contacts: Array<Omit<ManagedFamilyLineContact, "source"> & { source?: string }>
): ManagedFamilyLineContact[] {
  return contacts
    .filter((contact) => contact.source === "webhook" || contact.source === "official_friend")
    .map((contact) => ({
      ...contact,
      source: contact.source === "official_friend" ? "official_friend" : "webhook"
    }));
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
  const [searchParams] = useSearchParams();
  const focusedPatientId = searchParams.get("patientId");
  const [settings, setSettings] = useState<FamilyLineAutomationSettings>(() =>
    loadJsonStorage(SETTINGS_STORAGE_KEY, defaultSettings)
  );
  const [managedLineContacts, setManagedLineContacts] = useState<ManagedFamilyLineContact[]>(() =>
    normalizeManagedLineContacts(loadArrayStorage<ManagedFamilyLineContact>(MANAGED_CONTACTS_STORAGE_KEY))
  );
  const [templateDrafts, setTemplateDrafts] = useState<Record<FamilyLineTemplateKey, FamilyLineTemplateDraft>>(() =>
    loadJsonStorage<Record<FamilyLineTemplateKey, FamilyLineTemplateDraft>>(
      TEMPLATE_DRAFTS_STORAGE_KEY,
      defaultTemplateDrafts
    )
  );
  const [selectedManagedContactIds, setSelectedManagedContactIds] = useState<string[]>([]);
  const [bulkLinkPatientId, setBulkLinkPatientId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<FamilyLineTemplateKey>("custom_notice");
  const [selectedSendTypes, setSelectedSendTypes] = useState<FamilyLineTemplateKey[]>(["custom_notice"]);
  const [selectedDoctorId, setSelectedDoctorId] = useState("all");
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [instantMessageDraft, setInstantMessageDraft] = useState<FamilyLineTemplateDraft>({
    subject: "即時 LINE 群發",
    content: ""
  });
  const [isSendConfirmed, setIsSendConfirmed] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isInstantSending, setIsInstantSending] = useState(false);
  const [isSyncingLineFriends, setIsSyncingLineFriends] = useState(false);
  const [apiTokens] = useState(() => loadAdminApiTokenSettings());

  useEffect(() => {
    window.localStorage.removeItem(LEGACY_BINDINGS_STORAGE_KEY);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(MANAGED_CONTACTS_STORAGE_KEY, JSON.stringify(managedLineContacts));
  }, [managedLineContacts]);

  useEffect(() => {
    window.localStorage.setItem(TEMPLATE_DRAFTS_STORAGE_KEY, JSON.stringify(templateDrafts));
  }, [templateDrafts]);

  const recipients = useMemo<FamilyLineRecipient[]>(() => {
    const nextRecipients: FamilyLineRecipient[] = [];
    managedLineContacts.forEach((contact) => {
      const linkedPatients = contact.linkedPatientIds
        .map((patientId) => repositories.patientRepository.getPatientById(patientId))
        .filter((patient): patient is Patient => Boolean(patient));
      const primaryPatient = linkedPatients[0] ?? null;
      const schedules = primaryPatient
        ? repositories.visitRepository.getSchedules({ patientId: primaryPatient.id })
        : [];
      const schedule = resolveLatestSchedule(schedules);
      const linkedDoctorIds = linkedPatients
        .flatMap((patient) => {
          const latestSchedule = resolveLatestSchedule(
            repositories.visitRepository.getSchedules({ patientId: patient.id })
          );
          return [patient.preferred_doctor_id, latestSchedule?.assigned_doctor_id];
        })
        .filter((doctorId): doctorId is string => Boolean(doctorId));
      const linkedDoctors = db.doctors.filter(
        (doctor) => linkedDoctorIds.includes(doctor.id)
      );
      const doctor =
        schedule
          ? db.doctors.find((item) => item.id === schedule.assigned_doctor_id) ?? null
          : primaryPatient
            ? db.doctors.find((item) => item.id === primaryPatient.preferred_doctor_id) ?? null
            : null;
      nextRecipients.push({
        id: `line-contact:${contact.id}`,
        displayName: contact.displayName,
        relationshipLabel: contact.note || "LINE 名單",
        patient: primaryPatient,
        linkedPatients,
        schedule,
        doctor,
        linkedDoctors,
        lineUserId: contact.lineUserId
      });
    });
    return nextRecipients;
  }, [db.doctors, managedLineContacts, repositories]);

  const filteredRecipients = useMemo(() => {
    if (selectedDoctorId === "all") {
      return recipients;
    }
    return recipients.filter((recipient) =>
      recipient.linkedDoctors.some((doctor) => doctor.id === selectedDoctorId)
    );
  }, [recipients, selectedDoctorId]);

  const selectedRecipients = filteredRecipients.filter((recipient) =>
    selectedRecipientIds.includes(recipient.id)
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
  const filteredRecipientByContactId = useMemo(
    () =>
      new Map(
        filteredRecipients.map((recipient) => [
          recipient.id.replace(/^line-contact:/, ""),
          recipient
        ])
      ),
    [filteredRecipients]
  );
  const visibleManagedLineContacts = useMemo(
    () =>
      selectedDoctorId === "all"
        ? managedLineContacts
        : managedLineContacts.filter((contact) => filteredRecipientByContactId.has(contact.id)),
    [filteredRecipientByContactId, managedLineContacts, selectedDoctorId]
  );

  const buildLineSendRecipients = (targetRecipients: FamilyLineRecipient[]) =>
    targetRecipients.map((recipient) => ({
      caregiverId: recipient.id,
      caregiverName: recipient.displayName,
      patientId: recipient.patient?.id ?? "",
      patientName: recipient.patient?.name ?? "",
      doctorId: resolveRecipientDoctor(recipient)?.id ?? "",
      doctorName: resolveRecipientDoctor(recipient)?.name ?? "",
      lineUserId: recipient.lineUserId
    }));

  const createLineContactLogs = (
    targetRecipients: FamilyLineRecipient[],
    subject: string,
    content: string,
    outcome: string
  ) => {
    const now = new Date().toISOString();
    targetRecipients.forEach((recipient) => {
      repositories.contactRepository.createContactLog({
        id: `line-${Date.now()}-${recipient.id}`,
        patient_id: recipient.patient?.id ?? null,
        visit_schedule_id: recipient.schedule?.id ?? null,
        caregiver_id: null,
        doctor_id: resolveRecipientDoctor(recipient)?.id ?? null,
        admin_user_id: null,
        channel: "line",
        subject,
        content,
        outcome,
        contacted_at: now,
        created_at: now,
        updated_at: now
      });
    });
  };

  const buildLineSendFailureMessage = (payload: {
    error?: string;
    results?: Array<{ ok: boolean; status: number; error: string | null }>;
  }) => {
    const firstFailure = payload.results?.find((result) => !result.ok);
    const detail = firstFailure
      ? `（LINE 狀態 ${firstFailure.status}${firstFailure.error ? `：${firstFailure.error}` : ""}）`
      : "";
    return `${payload.error ?? "LINE 發送失敗，請稍後再試。"}${detail}`;
  };

  useEffect(() => {
    setSelectedRecipientIds((current) =>
      current.filter((recipientId) =>
        filteredRecipients.some((recipient) => recipient.id === recipientId)
      )
    );
  }, [filteredRecipients]);

  useEffect(() => {
    if (!focusedPatientId) {
      return;
    }

    const focusedRecipients = recipients.filter(
      (recipient) => recipient.linkedPatients.some((patient) => patient.id === focusedPatientId)
    );
    const focusedDoctor = focusedRecipients[0]?.doctor;
    if (focusedDoctor) {
      setSelectedDoctorId(focusedDoctor.id);
    }
    setSelectedRecipientIds(focusedRecipients.map((recipient) => recipient.id));
  }, [focusedPatientId, recipients]);

  const resolveRecipientDoctor = (recipient: FamilyLineRecipient) =>
    selectedDoctorId === "all"
      ? recipient.doctor
      : recipient.linkedDoctors.find((doctor) => doctor.id === selectedDoctorId) ??
        recipient.doctor;

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

  const toggleRecipient = (recipientId: string) => {
    setSelectedRecipientIds((current) =>
      current.includes(recipientId)
        ? current.filter((id) => id !== recipientId)
        : [...current, recipientId]
    );
  };

  const selectAllFilteredRecipients = () => {
    setSelectedRecipientIds(filteredRecipients.map((recipient) => recipient.id));
  };

  const clearSelectedRecipients = () => {
    setSelectedRecipientIds([]);
  };

  const persistManagedLineContact = async (contact: ManagedFamilyLineContact) => {
    try {
      const response = await fetch("/api/admin/family-line/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineUserId: contact.lineUserId,
          linkedPatientIds: contact.linkedPatientIds,
          note: contact.note
        })
      });
      return response.ok;
    } catch {
      // 線上 API 失敗時仍保留本機畫面狀態，避免管理操作被中斷。
      return false;
    }
  };

  const updateManagedContactNote = (contactId: string, note: string) => {
    let updatedContact: ManagedFamilyLineContact | null = null;
    setManagedLineContacts((current) =>
      current.map((contact) => {
        if (contact.id !== contactId) {
          return contact;
        }
        updatedContact = {
          ...contact,
          note,
          updatedAt: new Date().toISOString()
        };
        return updatedContact;
      })
    );
    if (updatedContact) {
      void persistManagedLineContact(updatedContact);
    }
  };

  const toggleManagedContactSelection = (contactId: string) => {
    setSelectedManagedContactIds((current) =>
      current.includes(contactId) ? current.filter((id) => id !== contactId) : [...current, contactId]
    );
  };

  const selectAllManagedContacts = () => {
    setSelectedManagedContactIds(managedLineContacts.map((contact) => contact.id));
  };

  const invertManagedContactSelection = () => {
    setSelectedManagedContactIds((current) =>
      managedLineContacts
        .map((contact) => contact.id)
        .filter((contactId) => !current.includes(contactId))
    );
  };

  const linkSelectedContactsToPatient = async () => {
    if (!selectedManagedContactIds.length || !bulkLinkPatientId) {
      setSendFeedback({ tone: "error", message: "請先選擇 LINE 好友名單與要關聯的居家個案。" });
      return;
    }

    const targetPatient = db.patients.find((patient) => patient.id === bulkLinkPatientId);
    const now = new Date().toISOString();
    const contactsToPersist = managedLineContacts
      .filter((contact) => selectedManagedContactIds.includes(contact.id))
      .map((contact) => ({
        ...contact,
        linkedPatientIds: contact.linkedPatientIds.includes(bulkLinkPatientId)
          ? contact.linkedPatientIds
          : [...contact.linkedPatientIds, bulkLinkPatientId],
        updatedAt: now
      }));
    const contactToPersistById = new Map(contactsToPersist.map((contact) => [contact.id, contact]));
    setManagedLineContacts((current) =>
      current.map((contact) => {
        return contactToPersistById.get(contact.id) ?? contact;
      })
    );
    const persistedResults = await Promise.all(
      contactsToPersist.map((contact) => persistManagedLineContact(contact))
    );
    const failedPersistCount = persistedResults.filter((isPersisted) => !isPersisted).length;
    setSendFeedback({
      tone: failedPersistCount > 0 ? "error" : "success",
      message: `已將 ${selectedManagedContactIds.length} 位 LINE 好友關聯到 ${
        targetPatient ? maskPatientName(targetPatient.name) : "指定個案"
      }，下次開啟會自動帶入。${
        failedPersistCount > 0
          ? ` 其中 ${failedPersistCount} 位暫時只保存在本機，後端名單同步失敗時請稍後再按一次關聯。`
          : " 已同步保存到 LINE 名單資料庫。"
      }`
    });
  };

  const unlinkSelectedContactsFromPatient = async () => {
    if (!selectedManagedContactIds.length || !bulkLinkPatientId) {
      setSendFeedback({ tone: "error", message: "請先選擇 LINE 好友名單與要取消關聯的居家個案。" });
      return;
    }

    const targetPatient = db.patients.find((patient) => patient.id === bulkLinkPatientId);
    const now = new Date().toISOString();
    const contactsToPersist = managedLineContacts
      .filter(
        (contact) =>
          selectedManagedContactIds.includes(contact.id) &&
          contact.linkedPatientIds.includes(bulkLinkPatientId)
      )
      .map((contact) => ({
        ...contact,
        linkedPatientIds: contact.linkedPatientIds.filter((patientId) => patientId !== bulkLinkPatientId),
        updatedAt: now
      }));
    if (contactsToPersist.length === 0) {
      setSendFeedback({
        tone: "error",
        message: `所選 LINE 好友目前沒有關聯到 ${targetPatient ? maskPatientName(targetPatient.name) : "指定個案"}。`
      });
      return;
    }

    const contactToPersistById = new Map(contactsToPersist.map((contact) => [contact.id, contact]));
    setManagedLineContacts((current) =>
      current.map((contact) => {
        return contactToPersistById.get(contact.id) ?? contact;
      })
    );
    const persistedResults = await Promise.all(
      contactsToPersist.map((contact) => persistManagedLineContact(contact))
    );
    const failedPersistCount = persistedResults.filter((isPersisted) => !isPersisted).length;
    setSendFeedback({
      tone: failedPersistCount > 0 ? "error" : "success",
      message: `已將 ${contactsToPersist.length} 位 LINE 好友取消與 ${
        targetPatient ? maskPatientName(targetPatient.name) : "指定個案"
      } 的關聯，下次開啟會自動帶入。${
        failedPersistCount > 0
          ? ` 其中 ${failedPersistCount} 位暫時只保存在本機，後端名單同步失敗時請稍後再按一次取消關聯。`
          : " 已同步保存到 LINE 名單資料庫。"
      }`
    });
  };

  const syncLineOfficialAccountFriends = async (options: { silent?: boolean } = {}) => {
    const isSilent = Boolean(options.silent);
    setIsSyncingLineFriends(true);
    if (!isSilent) {
      setSendFeedback(null);
    }
    try {
      const response = await fetch("/api/admin/family-line/friends", {
        cache: "no-store",
        headers: apiTokens.lineChannelAccessToken.trim()
          ? {
              "X-Line-Channel-Access-Token": apiTokens.lineChannelAccessToken.trim()
            }
          : undefined
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        warning?: string;
        friends?: LineFriendProfile[];
        contacts?: LineFriendProfile[];
        databaseConnected?: boolean;
        savedContactCount?: number;
        officialFetchedCount?: number;
        returnedCount?: number;
      };
      if (!response.ok) {
        if (!isSilent) {
          setSendFeedback({
            tone: "error",
            message:
              payload.error ??
              "無法同步 LINE 官方帳號好友，請確認 LINE_CHANNEL_ACCESS_TOKEN 與官方帳號等級。"
          });
        }
        return;
      }
      const friends = Array.isArray(payload.friends)
        ? payload.friends
        : Array.isArray(payload.contacts)
          ? payload.contacts
          : [];
      const now = new Date().toISOString();
      setManagedLineContacts((current) => {
        const contactByUserId = new Map(current.map((contact) => [contact.lineUserId, contact]));
        friends.forEach((friend) => {
          const existing = contactByUserId.get(friend.userId);
          contactByUserId.set(friend.userId, {
            id: existing?.id ?? `line-contact-${friend.userId}`,
            displayName: friend.displayName || existing?.displayName || friend.userId,
            lineUserId: friend.userId,
            linkedPatientIds: friend.linkedPatientIds ?? existing?.linkedPatientIds ?? [],
            note: friend.note ?? existing?.note ?? "",
            source: friend.source === "official_friend" ? "official_friend" : "webhook",
            updatedAt: friend.updatedAt ?? now
          });
        });
        return Array.from(contactByUserId.values());
      });
      if (!isSilent) {
        const savedCount = payload.savedContactCount ?? friends.length;
        const returnedCount = payload.returnedCount ?? friends.length;
        if (friends.length === 0) {
          setSendFeedback({
            tone: "error",
            message:
              "已連到 LINE 名單同步端點，但目前資料庫沒有任何 LINE 好友。請確認 LINE Developers 的 Use webhook 已啟用、Webhook URL 指向目前 Vercel 網址，並請家屬傳送一則新訊息後再重新整理。"
          });
          return;
        }
        setSendFeedback({
          tone: "success",
          message:
            payload.warning
              ? `${payload.warning} 已從資料庫載入 ${returnedCount} 位 LINE 好友。`
              : `已載入 LINE 好友 ${returnedCount} 位；資料庫目前保存 ${savedCount} 位，請再於名單管理中關聯居家個案。`
        });
      }
    } catch {
      if (!isSilent) {
        setSendFeedback({
          tone: "error",
          message: "無法連線到 LINE 好友同步端點，請確認部署與網路狀態。"
        });
      }
    } finally {
      setIsSyncingLineFriends(false);
    }
  };

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      return;
    }
    void syncLineOfficialAccountFriends({ silent: true });
  }, []);

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
          lineChannelAccessToken: apiTokens.lineChannelAccessToken.trim(),
          subject: outboundSubject,
          content: outboundContent,
          recipients: buildLineSendRecipients(sendableRecipients)
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        sentCount?: number;
        failedCount?: number;
        attemptedCount?: number;
        results?: Array<{ ok: boolean; status: number; error: string | null }>;
      };
      if (!response.ok) {
        setSendFeedback({
          tone: "error",
          message: buildLineSendFailureMessage(payload)
        });
        return;
      }

      createLineContactLogs(sendableRecipients, outboundSubject, outboundContent, "LINE 訊息已送出");
      setSendFeedback({
        tone: "success",
        message: `LINE 群發已送出 ${payload.sentCount ?? sendableRecipients.length} 位家屬${
          typeof payload.attemptedCount === "number" ? `（本次送出 ${payload.attemptedCount} 位）` : ""
        }。${
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

  const sendInstantLineMessage = async () => {
    setSendFeedback(null);
    const subject = instantMessageDraft.subject.trim() || "即時 LINE 群發";
    const content = instantMessageDraft.content.trim();
    if (!content) {
      setSendFeedback({ tone: "error", message: "請先填寫即時群發訊息內容。" });
      return;
    }
    if (!selectedRecipients.length) {
      setSendFeedback({ tone: "error", message: "請先勾選要即時群發的收件人。" });
      return;
    }
    if (!sendableRecipients.length) {
      setSendFeedback({ tone: "error", message: "已選收件人尚未有 LINE userId，無法即時群發。" });
      return;
    }

    setIsInstantSending(true);
    try {
      const response = await fetch("/api/admin/family-line/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          lineChannelAccessToken: apiTokens.lineChannelAccessToken.trim(),
          subject,
          content,
          recipients: buildLineSendRecipients(sendableRecipients)
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        sentCount?: number;
        failedCount?: number;
        attemptedCount?: number;
        results?: Array<{ ok: boolean; status: number; error: string | null }>;
      };
      if (!response.ok) {
        setSendFeedback({
          tone: "error",
          message: buildLineSendFailureMessage(payload)
        });
        return;
      }

      createLineContactLogs(sendableRecipients, subject, content, "LINE 即時群發已送出");
      setSendFeedback({
        tone: "success",
        message: `LINE 即時群發已送出 ${payload.sentCount ?? sendableRecipients.length} 位家屬${
          typeof payload.attemptedCount === "number" ? `（本次送出 ${payload.attemptedCount} 位）` : ""
        }。${missingLineIdCount > 0 ? `另有 ${missingLineIdCount} 位缺 LINE userId 已略過。` : ""}`
      });
    } catch {
      setSendFeedback({
        tone: "error",
        message: "無法連線到 LINE 發送端點，請確認部署與網路狀態。"
      });
    } finally {
      setIsInstantSending(false);
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.95fr)] xl:items-start">
        <div className="space-y-4">
          <Panel title="即時群發訊息">
            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">即時群發標題</span>
                <input
                  aria-label="即時群發標題"
                  value={instantMessageDraft.subject}
                  onChange={(event) =>
                    setInstantMessageDraft((current) => ({
                      ...current,
                      subject: event.target.value
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">即時群發內容</span>
                <textarea
                  aria-label="即時群發內容"
                  value={instantMessageDraft.content}
                  onChange={(event) =>
                    setInstantMessageDraft((current) => ({
                      ...current,
                      content: event.target.value
                    }))
                  }
                  rows={6}
                  placeholder="輸入要立刻推播給所選 LINE 家屬的訊息"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
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
                  onClick={sendInstantLineMessage}
                  disabled={isInstantSending}
                  className="rounded-full bg-brand-forest px-5 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {isInstantSending ? "即時發送中" : "即時發送 LINE 群發"}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                已選 {selectedRecipients.length} 位；可即時發送 {sendableRecipients.length} 位。
                {missingLineIdCount > 0 ? ` ${missingLineIdCount} 位缺 LINE userId 會略過。` : ""}
              </p>
            </div>
          </Panel>

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
                  detail: "醫師離開前一站後，自動提醒下一站家屬準備。"
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

          <Panel title="範本群發">
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
                  <span className="mb-1 block font-medium text-brand-ink">範本套用醫師</span>
                  <select
                    aria-label="範本套用醫師"
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

        <div className="space-y-4 xl:sticky xl:top-4">
          <Panel title="個案關聯操作">
            <div className="space-y-3 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                名單來源為 LINE webhook；家屬加入官方帳號並傳送訊息後，按下重新整理即可帶入右側名單。
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void syncLineOfficialAccountFriends()}
                  disabled={isSyncingLineFriends}
                  className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSyncingLineFriends ? "重新整理中" : "重新整理 LINE 好友名單"}
                </button>
                <button
                  type="button"
                  onClick={selectAllManagedContacts}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-brand-ink"
                >
                  全選好友
                </button>
                <button
                  type="button"
                  onClick={invertManagedContactSelection}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-brand-ink"
                >
                  反選好友
                </button>
              </div>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">批次關聯到個案</span>
                <select
                  aria-label="批次關聯居家個案"
                  value={bulkLinkPatientId}
                  onChange={(event) => setBulkLinkPatientId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5"
                >
                  <option value="">請選擇個案</option>
                  {db.patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {maskPatientName(patient.name)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void linkSelectedContactsToPatient()}
                  className="rounded-full bg-brand-forest px-4 py-2 text-xs font-semibold text-white"
                >
                  關聯所選好友
                </button>
                <button
                  type="button"
                  onClick={() => void unlinkSelectedContactsFromPatient()}
                  className="rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700"
                >
                  取消所選關聯
                </button>
              </div>
              <p className="text-xs text-slate-500">
                已選 {selectedManagedContactIds.length} 位 LINE 好友；右側名單可同時勾選發送對象與關聯對象。
              </p>
            </div>
          </Panel>

          <Panel title="LINE 名單與個案關聯">
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                <label className="block text-sm">
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
              </div>

              {managedLineContacts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  目前尚未收到 LINE 好友互動；請家屬加入官方帳號並傳送任一訊息後，再按「重新整理 LINE 好友名單」。
                </div>
              ) : visibleManagedLineContacts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  目前篩選醫師沒有可發送的 LINE 好友。請確認右上方個案關聯是否已連到該醫師的居家個案。
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleManagedLineContacts.map((contact) => {
                    const recipient = filteredRecipientByContactId.get(contact.id);
                    const isSendSelected = recipient ? selectedRecipientIds.includes(recipient.id) : false;
                    const linkedNames = contact.linkedPatientIds
                      .map((patientId) => db.patients.find((patient) => patient.id === patientId))
                      .filter((patient): patient is Patient => Boolean(patient))
                      .map((patient) => maskPatientName(patient.name));
                    return (
                      <div
                        key={contact.id}
                        className={`rounded-2xl border p-4 text-sm ${
                          isSendSelected ? "border-brand-forest bg-emerald-50/70" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-2">
                            <label className="flex min-w-0 items-start gap-3">
                              <input
                                type="checkbox"
                                aria-label={`${contact.displayName} 發送勾選`}
                                checked={isSendSelected}
                                disabled={!recipient}
                                onChange={() => {
                                  if (recipient) {
                                    toggleRecipient(recipient.id);
                                  }
                                }}
                                className="mt-1 h-4 w-4 disabled:opacity-40"
                              />
                              <span className="min-w-0">
                                <span className="block font-semibold text-brand-ink">{contact.displayName}</span>
                                <span className="mt-1 block text-xs text-slate-500">
                                  發送對象：{recipient ? resolveRecipientLineStatus(recipient.lineUserId) : "不符合目前醫師篩選"}
                                </span>
                              </span>
                            </label>
                            <label className="flex min-w-0 items-start gap-3">
                              <input
                                type="checkbox"
                                aria-label={`${contact.displayName} 批次關聯勾選`}
                                checked={selectedManagedContactIds.includes(contact.id)}
                                onChange={() => toggleManagedContactSelection(contact.id)}
                                className="mt-1 h-4 w-4"
                              />
                              <span className="min-w-0 text-xs text-slate-600">選入右上方個案關聯操作</span>
                            </label>
                          </div>
                          <Badge
                            value={contact.source === "official_friend" ? "官方好友" : "Webhook 收到"}
                            compact
                          />
                        </div>
                        <p className="mt-3 text-slate-600">
                          關聯個案：{linkedNames.length ? linkedNames.join("、") : "尚未關聯"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          關聯醫師：{recipient?.linkedDoctors.length
                            ? recipient.linkedDoctors.map((doctor) => doctor.name).join("、")
                            : "未指定醫師"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          最近排程：{recipient?.schedule ? formatDateTimeFull(recipient.schedule.scheduled_start_at) : "尚無排程"}
                        </p>
                        <div className="mt-3 break-all rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700">
                          {contact.lineUserId}
                        </div>
                        <label className="mt-3 block">
                          <span className="mb-1 block text-xs font-medium text-brand-ink">好友註記</span>
                          <input
                            aria-label={`${contact.displayName} 好友註記`}
                            value={contact.note}
                            onChange={(event) => updateManagedContactNote(contact.id, event.target.value)}
                            placeholder="例如：主要照顧者、可接收公告"
                            className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>

    </div>
  );
}
