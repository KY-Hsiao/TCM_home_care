import { useEffect, useMemo, useState } from "react";
import { getDefaultPassword } from "../../app/auth-storage";
import { useAppContext } from "../../app/use-app-context";
import type { Doctor } from "../../domain/models";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { clearLegacyAdminApiTokenSettings } from "../../shared/utils/admin-api-tokens";
import { maskPatientName } from "../../shared/utils/patient-name";

type StaffDraft = {
  sourceId: string | null;
  originalRole: "doctor" | null;
  name: string;
  phone: string;
  serviceSlotsText: string;
};

type StaffListItem = {
  key: string;
  id: string;
  role: "doctor";
  name: string;
  phone: string;
  accountLabel: string;
  secondaryLabel: string;
};

type ManagedFamilyLineContactSnapshot = {
  id?: string;
  userId?: string;
  displayName?: string;
  lineUserId?: string;
  linkedPatientIds?: string[];
  contactRole?: "family" | "admin" | "doctor";
};

type DataIntegrityIssue = {
  id: string;
  title: string;
  detail: string;
  linkText: string;
  href: string;
};

type DataIntegrityCheck = {
  key: string;
  title: string;
  description: string;
  issues: DataIntegrityIssue[];
};

type EnvVariableName =
  | "LINE_CHANNEL_ACCESS_TOKEN"
  | "LINE_CHANNEL_SECRET"
  | "OPENAI_API_KEY"
  | "GOOGLE_MAPS_API_KEY"
  | "GOOGLE_CALENDAR_ID"
  | "GOOGLE_DRIVE_ACCESS_TOKEN"
  | "GOOGLE_DRIVE_REFRESH_TOKEN"
  | "GOOGLE_DRIVE_CLIENT_ID"
  | "GOOGLE_DRIVE_CLIENT_SECRET"
  | "GOOGLE_DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL"
  | "GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY"
  | "GOOGLE_DRIVE_FOLDER_ID";

type EnvStatus = {
  ok: boolean;
  variables: Record<EnvVariableName, boolean>;
};

type ConnectionTestService = "google-maps" | "gpt" | "google-drive";

type EnvSetupItem = {
  key: EnvVariableName;
  label: string;
  note: string;
  source: string;
};

type EnvServiceGroup = {
  title: string;
  description: string;
  requiredKeys: EnvVariableName[];
  readyText: string;
  pendingText: string;
  items: EnvSetupItem[];
};

const envServiceGroups: EnvServiceGroup[] = [
  {
    title: "LINE 家屬通知",
    description: "用於家屬 LINE 推播與 webhook 驗證。",
    requiredKeys: ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"],
    readyText: "LINE 可用",
    pendingText: "LINE 尚未完成",
    items: [
      {
        key: "LINE_CHANNEL_ACCESS_TOKEN",
        label: "LINE Channel Access Token",
        note: "發送家屬通知需要這個 token。",
        source: "LINE Developers > Messaging API channel > Messaging API > Channel access token，按 Issue/Reissue 取得。"
      },
      {
        key: "LINE_CHANNEL_SECRET",
        label: "LINE Channel Secret",
        note: "驗證 LINE webhook 來源需要這個 secret。",
        source: "LINE Developers > Messaging API channel > Basic settings > Channel secret。"
      }
    ]
  },
  {
    title: "GPT / OpenAI",
    description: "用於 GPT 連線測試與後續 AI 功能。",
    requiredKeys: ["OPENAI_API_KEY"],
    readyText: "GPT 可用",
    pendingText: "GPT 尚未完成",
    items: [
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI API Key",
        note: "後端呼叫 GPT 時使用，不會傳到瀏覽器。",
        source: "OpenAI Platform > API keys 建立 Project key，再貼到 Vercel。"
      }
    ]
  },
  {
    title: "Google Maps / Calendar",
    description: "用於補座標、路線地點解析與排程日期行程檢查。",
    requiredKeys: ["GOOGLE_MAPS_API_KEY", "GOOGLE_CALENDAR_ID"],
    readyText: "Maps / Calendar 可用",
    pendingText: "Maps / Calendar 尚未完成",
    items: [
      {
        key: "GOOGLE_MAPS_API_KEY",
        label: "Google Maps API Key",
        note: "補座標會用到，Google Cloud 專案需啟用 Geocoding API。",
        source: "Google Cloud Console > APIs & Services > Credentials 建立 API key，建議限制可用 API。"
      },
      {
        key: "GOOGLE_CALENDAR_ID",
        label: "Google Calendar ID",
        note: "排程日期檢查會讀取這個日曆。",
        source: "Google Calendar > 日曆設定 > 整合日曆 > 日曆 ID。"
      }
    ]
  },
  {
    title: "Google Drive 回院病歷",
    description: "用於上傳 HTML 病歷、列出 Drive 既有病歷，並讓使用者選擇前次紀錄。",
    requiredKeys: ["GOOGLE_DRIVE_FOLDER_ID"],
    readyText: "Drive 可用",
    pendingText: "Drive 尚未完成",
    items: [
      {
        key: "GOOGLE_DRIVE_FOLDER_ID",
        label: "Google Drive Folder ID",
        note: "回院病歷儲存的資料夾。",
        source: "開啟 Google Drive 資料夾，網址 /folders/ 後面的字串就是 Folder ID。"
      },
      {
        key: "GOOGLE_DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL",
        label: "Google Drive Service Account Client Email",
        note: "正式環境建議使用；需分享 Drive 資料夾。",
        source: "Google Cloud Console > IAM & Admin > Service Accounts 建立服務帳號後取得 client_email。"
      },
      {
        key: "GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY",
        label: "Google Drive Service Account Private Key",
        note: "搭配服務帳號換 token；只放 Vercel。",
        source: "同一個 Service Account > Keys > Add key > JSON，使用 private_key 欄位。"
      },
      {
        key: "GOOGLE_DRIVE_REFRESH_TOKEN",
        label: "Google Drive Refresh Token",
        note: "可自動換新 access token。",
        source: "Google Cloud OAuth Client 搭配 Drive API scope 取得 refresh_token。"
      },
      {
        key: "GOOGLE_DRIVE_CLIENT_ID",
        label: "Google Drive Client ID",
        note: "Refresh Token 換取 Drive access token 需要。",
        source: "Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client IDs。"
      },
      {
        key: "GOOGLE_DRIVE_CLIENT_SECRET",
        label: "Google Drive Client Secret",
        note: "Refresh Token 換取 Drive access token 需要。",
        source: "同一個 OAuth Client 的 Client secret。"
      },
      {
        key: "GOOGLE_DRIVE_ACCESS_TOKEN",
        label: "Google Drive Access Token",
        note: "短效備援；正式環境不建議只靠它。",
        source: "OAuth Playground 或 OAuth 流程可臨時換取，但過期後必須更新 Vercel 再重新部署。"
      }
    ]
  }
];

const serviceDayOptions = [
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六"
] as const;

const servicePartOptions = ["上午", "下午"] as const;

const serviceDayOrder = Object.fromEntries(
  serviceDayOptions.map((day, index) => [day, index])
) as Record<(typeof serviceDayOptions)[number], number>;

const servicePartOrder = Object.fromEntries(
  servicePartOptions.map((part, index) => [part, index])
) as Record<(typeof servicePartOptions)[number], number>;

const familyLineManagedContactsStorageKey = "tcm-family-line-managed-contacts";

type ServiceDay = (typeof serviceDayOptions)[number];
type ServicePart = (typeof servicePartOptions)[number];

function parseServiceSlotSelections(serviceSlotsText: string) {
  return serviceSlotsText
    .split(/\r?\n|,/)
    .map((slot) => slot.trim())
    .filter(Boolean);
}

function parseSupportedServiceSlotLabel(slot: string): { label: string; day: ServiceDay; part: ServicePart } | null {
  const normalizedSlot = slot.trim();
  const match = normalizedSlot.match(/^(星期[一二三四五六])(上午|下午)$/);
  if (!match) {
    return null;
  }

  return {
    label: normalizedSlot,
    day: match[1] as ServiceDay,
    part: match[2] as ServicePart
  };
}

function sortServiceSlots(slots: string[]) {
  return [...new Set(slots)]
    .map((slot) => parseSupportedServiceSlotLabel(slot))
    .filter((slot): slot is NonNullable<ReturnType<typeof parseSupportedServiceSlotLabel>> => Boolean(slot))
    .sort((left, right) => {
      const dayDelta = serviceDayOrder[left.day] - serviceDayOrder[right.day];
      if (dayDelta !== 0) {
        return dayDelta;
      }
      return servicePartOrder[left.part] - servicePartOrder[right.part];
    })
    .map((slot) => slot.label);
}

function getSupportedServiceSlots(serviceSlotsText: string) {
  return sortServiceSlots(parseServiceSlotSelections(serviceSlotsText));
}

function getLegacyServiceSlotWarnings(serviceSlotsText: string) {
  return parseServiceSlotSelections(serviceSlotsText).filter(
    (slot) => !parseSupportedServiceSlotLabel(slot)
  );
}

function buildServiceSlotsText(slots: string[]) {
  return sortServiceSlots(slots).join("\n");
}

function getInitialActiveServiceDay(serviceSlotsText: string): ServiceDay {
  const firstSlot = parseServiceSlotSelections(serviceSlotsText)
    .map((slot) => parseSupportedServiceSlotLabel(slot))
    .find((slot): slot is NonNullable<ReturnType<typeof parseSupportedServiceSlotLabel>> => Boolean(slot));

  return firstSlot?.day ?? serviceDayOptions[0];
}

function hasServiceSlot(serviceSlotsText: string, day: ServiceDay, part: ServicePart) {
  return getSupportedServiceSlots(serviceSlotsText).includes(`${day}${part}`);
}

function toggleServiceSlot(
  serviceSlotsText: string,
  day: ServiceDay,
  part: ServicePart,
  checked: boolean
) {
  const slotLabel = `${day}${part}`;
  const currentSlots = getSupportedServiceSlots(serviceSlotsText);
  const nextSlots = checked
    ? [...currentSlots, slotLabel]
    : currentSlots.filter((slot) => slot !== slotLabel);

  return buildServiceSlotsText(nextSlots);
}

function buildDoctorDraft(doctor?: Doctor): StaffDraft {
  return {
    sourceId: doctor?.id ?? null,
    originalRole: doctor ? "doctor" : null,
    name: doctor?.name ?? "",
    phone: doctor?.phone ?? "",
    serviceSlotsText: doctor?.available_service_slots.join("\n") ?? ""
  };
}

function buildEmptyStaffDraft(): StaffDraft {
  return buildDoctorDraft();
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

function isBlank(value: string | null | undefined) {
  return !value || value.trim().length === 0;
}

function loadFamilyLineArray<T>(key: string): T[] {
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

function normalizeManagedFamilyLineContacts(
  contacts: ManagedFamilyLineContactSnapshot[]
): Required<Pick<ManagedFamilyLineContactSnapshot, "displayName" | "lineUserId" | "linkedPatientIds" | "contactRole">>[] {
  return contacts
    .map((contact) => {
      const lineUserId = String(contact.lineUserId ?? contact.userId ?? "").trim();
      const normalizedContact: Required<
        Pick<ManagedFamilyLineContactSnapshot, "displayName" | "lineUserId" | "linkedPatientIds" | "contactRole">
      > = {
        displayName: String(contact.displayName ?? lineUserId),
        lineUserId,
        linkedPatientIds: Array.isArray(contact.linkedPatientIds)
          ? contact.linkedPatientIds.map((patientId) => String(patientId ?? "").trim()).filter(Boolean)
          : [],
        contactRole:
          contact.contactRole === "admin" || contact.contactRole === "doctor"
            ? contact.contactRole
            : "family"
      };
      return normalizedContact;
    })
    .filter((contact) => contact.lineUserId);
}

function loadManagedFamilyLineContacts() {
  return normalizeManagedFamilyLineContacts(
    loadFamilyLineArray<ManagedFamilyLineContactSnapshot>(familyLineManagedContactsStorageKey)
  );
}

function buildDataIntegrityChecks(
  db: ReturnType<typeof useAppContext>["db"],
  lineContacts: ReturnType<typeof loadManagedFamilyLineContacts>
): DataIntegrityCheck[] {
  const activePatients = db.patients.filter((patient) => patient.status === "active");
  const doctorsById = new Map(db.doctors.map((doctor) => [doctor.id, doctor]));
  const patientsById = new Map(db.patients.map((patient) => [patient.id, patient]));
  const caregiversByPatientId = new Map(
    db.caregivers.reduce<Array<[string, typeof db.caregivers]>>((items, caregiver) => {
      const currentCaregivers = items.find(([patientId]) => patientId === caregiver.patient_id)?.[1];
      if (currentCaregivers) {
        currentCaregivers.push(caregiver);
      } else {
        items.push([caregiver.patient_id, [caregiver]]);
      }
      return items;
    }, [])
  );
  const patientIdsWithLineUserId = new Set(
    lineContacts
      .filter((contact) => contact.contactRole === "family")
      .flatMap((contact) => contact.linkedPatientIds)
  );

  const missingGoogleAccountIssues: DataIntegrityIssue[] = [
    ...db.doctors
      .filter((doctor) => isBlank(doctor.google_account_email) || !doctor.google_account_logged_in)
      .map((doctor) => ({
        id: `doctor-google-${doctor.id}`,
        title: doctor.name || "未命名醫師",
        detail: isBlank(doctor.google_account_email)
          ? "醫師缺 Google 帳號 email。"
          : "醫師 Google 帳號尚未標記為已登入。",
        linkText: "到角色設置",
        href: "/admin/staff"
      })),
    ...db.admin_users
      .filter((admin) => isBlank(admin.google_account_email) || !admin.google_account_logged_in)
      .map((admin) => ({
        id: `admin-google-${admin.id}`,
        title: admin.name || "未命名行政",
        detail: isBlank(admin.google_account_email)
          ? "行政人員缺 Google 帳號 email。"
          : "行政人員 Google 帳號尚未標記為已登入。",
        linkText: "到角色設置",
        href: "/admin/staff"
      }))
  ];

  const missingLineUserIdIssues = activePatients
    .filter((patient) => {
      const caregivers = caregiversByPatientId.get(patient.id) ?? [];
      return caregivers.some((caregiver) => caregiver.is_primary && caregiver.receives_notifications) &&
        !patientIdsWithLineUserId.has(patient.id);
    })
    .map((patient) => ({
      id: `patient-line-${patient.id}`,
      title: maskPatientName(patient.name),
      detail: "主要家屬尚未在 LINE 聯繫名單關聯 lineUserId。",
      linkText: "到 LINE 聯繫",
      href: `/admin/family-line?patientId=${encodeURIComponent(patient.id)}`
    }));

  const missingCoordinateIssues = activePatients
    .filter(
      (patient) =>
        patient.home_latitude === null ||
        patient.home_longitude === null ||
        patient.geocoding_status === "missing" ||
        patient.geocoding_status === "pending"
    )
    .map((patient) => ({
      id: `patient-coordinate-${patient.id}`,
      title: maskPatientName(patient.name),
      detail:
        patient.home_latitude === null || patient.home_longitude === null
          ? "個案缺住家座標，導航與路線排序會改用地址近似。"
          : `座標狀態仍為 ${patient.geocoding_status}，請確認定位結果。`,
      linkText: "到個案管理",
      href: `/admin/patients/${encodeURIComponent(patient.id)}`
    }));

  const missingPrimaryCaregiverIssues = activePatients
    .filter((patient) => !(caregiversByPatientId.get(patient.id) ?? []).some((caregiver) => caregiver.is_primary))
    .map((patient) => ({
      id: `patient-primary-caregiver-${patient.id}`,
      title: maskPatientName(patient.name),
      detail: "個案沒有主照顧者，家屬通知與到訪確認會缺少主要對象。",
      linkText: "到個案管理",
      href: `/admin/patients/${encodeURIComponent(patient.id)}`
    }));

  const missingScheduleDoctorIssues = db.visit_schedules
    .filter(
      (schedule) =>
        !["completed", "cancelled"].includes(schedule.status) &&
        (isBlank(schedule.assigned_doctor_id) || !doctorsById.has(schedule.assigned_doctor_id))
    )
    .map((schedule) => {
      const patient = patientsById.get(schedule.patient_id);
      return {
        id: `schedule-doctor-${schedule.id}`,
        title: `排程 ${schedule.id}`,
        detail: `${patient ? maskPatientName(patient.name) : "未知個案"} 的排程沒有有效醫師。`,
        linkText: "到排程管理",
        href: "/admin/schedules"
      };
    });

  const missingRecordUploadIssues = db.visit_schedules
    .filter((schedule) => ["completed", "followup_pending"].includes(schedule.status))
    .filter((schedule) => {
      const record = db.visit_records.find((item) => item.visit_schedule_id === schedule.id);
      return !record || isBlank(record.generated_record_text);
    })
    .map((schedule) => {
      const patient = patientsById.get(schedule.patient_id);
      return {
        id: `record-upload-${schedule.id}`,
        title: patient ? maskPatientName(patient.name) : `排程 ${schedule.id}`,
        detail: "完成排程尚未有可上傳病歷文字。",
        linkText: "到回院病歷",
        href: "/doctor/return-records"
      };
    });

  return [
    {
      key: "google-account",
      title: "缺 Google 帳號",
      description: "檢查人員 Google 帳號與登入標記。",
      issues: missingGoogleAccountIssues
    },
    {
      key: "line-user-id",
      title: "缺 LINE userId",
      description: "檢查需通知個案是否已關聯 LINE userId。",
      issues: missingLineUserIdIssues
    },
    {
      key: "coordinates",
      title: "缺座標",
      description: "檢查住家座標與 geocoding 狀態。",
      issues: missingCoordinateIssues
    },
    {
      key: "primary-caregiver",
      title: "缺主照顧者",
      description: "檢查是否已有主照顧者。",
      issues: missingPrimaryCaregiverIssues
    },
    {
      key: "schedule-doctor",
      title: "排程沒有醫師",
      description: "檢查排程是否指派有效醫師。",
      issues: missingScheduleDoctorIssues
    },
    {
      key: "record-upload",
      title: "病歷未上傳",
      description: "檢查是否已有可上傳病歷文字。",
      issues: missingRecordUploadIssues
    }
  ];
}

export function AdminStaffPage() {
  const { repositories, db, setActiveDoctorId } = useAppContext();
  const defaultDoctorKey = db.doctors[0] ? `doctor:${db.doctors[0].id}` : "new:doctor";
  const [selectedStaffKey, setSelectedStaffKey] = useState<string>(defaultDoctorKey);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [activeServiceDay, setActiveServiceDay] = useState<ServiceDay>(serviceDayOptions[0]);
  const [recentAction, setRecentAction] = useState<string | null>(null);
  const [isSecretManagementOpen, setIsSecretManagementOpen] = useState(false);
  const [isDataIntegrityOpen, setIsDataIntegrityOpen] = useState(false);
  const [testingConnectionService, setTestingConnectionService] =
    useState<ConnectionTestService | null>(null);
  const [isLoadingEnvStatus, setIsLoadingEnvStatus] = useState(false);
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [secretManagementMessage, setSecretManagementMessage] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);
  const [integrityCheckedAt, setIntegrityCheckedAt] = useState(() => new Date().toISOString());
  const [managedLineContacts, setManagedLineContacts] = useState(() => loadManagedFamilyLineContacts());
  const staffList = useMemo<StaffListItem[]>(
    () =>
      [
        ...db.doctors.map((doctor) => ({
          key: `doctor:${doctor.id}`,
          id: doctor.id,
          role: "doctor" as const,
          name: doctor.name,
          phone: doctor.phone,
          accountLabel: "站內通知 / 手機定位",
          secondaryLabel: doctor.available_service_slots.join("、") || "未設定可服務時段"
        }))
      ].sort((left, right) => left.name.localeCompare(right.name, "zh-Hant")),
    [db.doctors]
  );
  const resolveDraftByKey = (staffKey: string): StaffDraft => {
    if (staffKey.startsWith("doctor:")) {
      return buildDoctorDraft(db.doctors.find((doctor) => doctor.id === staffKey.replace("doctor:", "")));
    }
    return buildEmptyStaffDraft();
  };
  const [draft, setDraft] = useState<StaffDraft>(() =>
    defaultDoctorKey.startsWith("doctor:")
      ? resolveDraftByKey(defaultDoctorKey)
      : buildEmptyStaffDraft()
  );
  const supportedServiceSlots = useMemo(
    () => getSupportedServiceSlots(draft.serviceSlotsText),
    [draft.serviceSlotsText]
  );
  const legacyServiceSlotWarnings = useMemo(
    () => getLegacyServiceSlotWarnings(draft.serviceSlotsText),
    [draft.serviceSlotsText]
  );
  const currentDoctorAssignments = draft.originalRole === "doctor" && draft.sourceId
    ? db.visit_schedules.filter((schedule) => schedule.assigned_doctor_id === draft.sourceId).length
    : 0;
  const dataIntegrityChecks = useMemo(
    () => buildDataIntegrityChecks(db, managedLineContacts),
    [db, managedLineContacts]
  );
  const dataIntegrityIssueCount = dataIntegrityChecks.reduce(
    (total, check) => total + check.issues.length,
    0
  );

  const loadEnvStatus = async () => {
    setIsLoadingEnvStatus(true);
    setSecretManagementMessage(null);
    try {
      const response = await fetch("/api/admin/system?resource=env-status", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as EnvStatus | null;
      if (!response.ok || !payload?.variables) {
        throw new Error("環境變數狀態讀取失敗。");
      }
      setEnvStatus(payload);
    } catch {
      setSecretManagementMessage({
        tone: "error",
        message: "無法讀取 Vercel 環境變數設定狀態，請確認部署 API 是否可用。"
      });
    } finally {
      setIsLoadingEnvStatus(false);
    }
  };

  useEffect(() => {
    clearLegacyAdminApiTokenSettings();
  }, []);

  useEffect(() => {
    if (!isSecretManagementOpen || envStatus) {
      return;
    }
    void loadEnvStatus();
  }, [envStatus, isSecretManagementOpen]);

  const testConnection = async (service: ConnectionTestService) => {
    setTestingConnectionService(service);
    setSecretManagementMessage(null);
    try {
      const response =
        service === "google-maps"
          ? await fetch("/api/maps/geocode", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                address: "旗山醫院"
              })
            })
          : await fetch(`/api/admin/system?resource=connection-test&service=${service}`, {
              cache: "no-store"
            });
      const payload = (await response.json().catch(() => ({}))) as {
        latitude?: number;
        longitude?: number;
        formattedAddress?: string;
        service?: string;
        message?: string;
        reason?: string;
        error?: string;
      };
      if (!response.ok) {
        const serviceLabel =
          service === "google-maps"
            ? "Google Maps"
            : service === "gpt"
              ? "GPT"
              : "Google Drive";
        setSecretManagementMessage({
          tone: "error",
          message:
            payload.error ??
            (payload.reason
              ? `${serviceLabel} 連線失敗：${payload.reason}`
              : `${serviceLabel} 連線失敗：HTTP ${response.status}`)
        });
        return;
      }
      if (service !== "google-maps") {
        setSecretManagementMessage({
          tone: "success",
          message: payload.message ?? (service === "gpt" ? "GPT 連線正常。" : "Google Drive 連線正常。")
        });
        return;
      }
      setSecretManagementMessage({
        tone: "success",
        message: `Google Maps Geocoding 連線正常，測試座標：${payload.latitude}, ${payload.longitude}（${payload.formattedAddress ?? "旗山醫院"}）`
      });
    } catch {
      const serviceLabel =
        service === "google-maps"
          ? "Google Maps"
          : service === "gpt"
            ? "GPT"
            : "Google Drive";
      setSecretManagementMessage({
        tone: "error",
        message: `無法連線到 ${serviceLabel} 測試端點，請確認部署與網路狀態。`
      });
    } finally {
      setTestingConnectionService(null);
    }
  };

  const syncDraftFromSelection = (staffKey: string) => {
    const nextDraft = staffKey.startsWith("new:")
      ? buildEmptyStaffDraft()
      : resolveDraftByKey(staffKey);
    setDraft(nextDraft);
    setActiveServiceDay(getInitialActiveServiceDay(nextDraft.serviceSlotsText));
  };

  const openStaffEditor = (staffKey: string) => {
    setSelectedStaffKey(staffKey);
    syncDraftFromSelection(staffKey);
    setIsEditorOpen(true);
  };

  const startCreateStaff = () => {
    const staffKey = "new:doctor";
    setSelectedStaffKey(staffKey);
    syncDraftFromSelection(staffKey);
    setIsEditorOpen(true);
  };

  const closeStaffEditor = () => {
    syncDraftFromSelection(selectedStaffKey);
    setIsEditorOpen(false);
  };

  const updateDraftServiceSlot = (part: ServicePart, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      serviceSlotsText: toggleServiceSlot(current.serviceSlotsText, activeServiceDay, part, checked)
    }));
  };

  const removeDraftServiceSlot = (slotToRemove: string) => {
    setDraft((current) => ({
      ...current,
      serviceSlotsText: buildServiceSlotsText(
        getSupportedServiceSlots(current.serviceSlotsText).filter((slot) => slot !== slotToRemove)
      )
    }));
  };

  const saveStaffRoleSetting = () => {
    const now = new Date().toISOString();
    const normalizedName = draft.name.trim();
    const normalizedPhone = draft.phone.trim();
    const isCreatingDoctor = !(draft.originalRole === "doctor" && draft.sourceId);

    if (!normalizedName) {
      setRecentAction("請先填寫醫師姓名。");
      return;
    }

    const selectedServiceSlots = getSupportedServiceSlots(draft.serviceSlotsText);
    const doctorIdToSave =
      draft.originalRole === "doctor" && draft.sourceId
        ? draft.sourceId
        : createId("doc");
    const existingDoctor =
      draft.originalRole === "doctor" && draft.sourceId
        ? db.doctors.find((doctor) => doctor.id === draft.sourceId)
        : null;
    const doctorToSave: Doctor = {
      id: doctorIdToSave,
      name: normalizedName,
      phone: normalizedPhone,
      license_number: "",
      specialty: "",
      service_area: "",
      google_chat_user_id: existingDoctor?.google_chat_user_id ?? "",
      google_account_email: existingDoctor?.google_account_email ?? null,
      google_account_logged_in: existingDoctor?.google_account_logged_in ?? false,
      google_location_share_url: existingDoctor?.google_location_share_url ?? null,
      google_location_share_enabled: existingDoctor?.google_location_share_enabled ?? false,
      available_service_slots: selectedServiceSlots,
      status: "active",
      created_at: now,
      updated_at: now
    };
    repositories.patientRepository.upsertDoctor(doctorToSave);
    setActiveDoctorId(doctorIdToSave);
    setSelectedStaffKey(`doctor:${doctorIdToSave}`);
    setDraft(buildDoctorDraft(doctorToSave));
    setActiveServiceDay(getInitialActiveServiceDay(doctorToSave.available_service_slots.join("\n")));
    if (isCreatingDoctor) {
      setIsEditorOpen(false);
    }
    setRecentAction(
      legacyServiceSlotWarnings.length > 0
        ? `已將 ${normalizedName} 設為醫師，並移除不支援的舊時段：${legacyServiceSlotWarnings.join("、")}。`
        : isCreatingDoctor
          ? selectedServiceSlots.length > 0
            ? `已建立 ${normalizedName} 醫師帳號，可在登入頁選擇該醫師並使用預設密碼 ${getDefaultPassword()} 登入。`
            : `已建立 ${normalizedName} 醫師帳號，可在登入頁選擇該醫師並使用預設密碼 ${getDefaultPassword()} 登入；尚未設定可服務時段，之後可回到角色設置補上。`
          : selectedServiceSlots.length > 0
            ? `已將 ${normalizedName} 設為醫師。`
            : `已將 ${normalizedName} 設為醫師；尚未設定可服務時段，之後可回到角色設置補上。`
    );
  };

  const removeStaffRole = () => {
    if (!draft.sourceId || !draft.originalRole) {
      setRecentAction("請先選擇既有人員，新增中的資料不能直接移除。");
      return;
    }

    if (db.doctors.length <= 1) {
      setRecentAction("目前至少要保留一位醫師。");
      return;
    }
    if (currentDoctorAssignments > 0) {
      const confirmed = window.confirm(
        `${draft.name || "此醫師"} 目前仍有 ${currentDoctorAssignments} 筆排程案件。確定移除此角色嗎？相關排程、已儲存路線、定位紀錄與請假通知也會一併清除。`
      );
      if (!confirmed) {
        setRecentAction("已取消移除此角色。");
        return;
      }
    }

    repositories.patientRepository.removeDoctor(draft.sourceId);
    const fallbackDoctor = db.doctors.find((doctor) => doctor.id !== draft.sourceId);
    if (fallbackDoctor) {
      setSelectedStaffKey(`doctor:${fallbackDoctor.id}`);
      setDraft(buildDoctorDraft(fallbackDoctor));
      setActiveServiceDay(getInitialActiveServiceDay(fallbackDoctor.available_service_slots.join("\n")));
    } else {
      setSelectedStaffKey("new:doctor");
      setDraft(buildEmptyStaffDraft());
      setActiveServiceDay(serviceDayOptions[0]);
    }
    setIsEditorOpen(false);
    setRecentAction(`已移除 ${draft.name || "該角色"}。`);
  };

  const getEnvVariableStatus = (key: EnvVariableName) => envStatus?.variables?.[key];
  const resolveEnvGroupStatus = (group: EnvServiceGroup) => {
    if (!envStatus) {
      return {
        ready: false,
        label: isLoadingEnvStatus ? "讀取中" : "尚未讀取",
        detail: "重新整理後讀取 Vercel 狀態，不顯示 token。",
        missingKeys: [] as EnvVariableName[]
      };
    }

    if (group.title === "Google Drive 回院病歷") {
      const hasFolder = Boolean(getEnvVariableStatus("GOOGLE_DRIVE_FOLDER_ID"));
      const hasRefreshToken = Boolean(getEnvVariableStatus("GOOGLE_DRIVE_REFRESH_TOKEN"));
      const hasClientId = Boolean(getEnvVariableStatus("GOOGLE_DRIVE_CLIENT_ID"));
      const hasClientSecret = Boolean(getEnvVariableStatus("GOOGLE_DRIVE_CLIENT_SECRET"));
      const hasServiceAccountClientEmail = Boolean(getEnvVariableStatus("GOOGLE_DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL"));
      const hasServiceAccountPrivateKey = Boolean(getEnvVariableStatus("GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY"));
      const hasAccessToken = Boolean(getEnvVariableStatus("GOOGLE_DRIVE_ACCESS_TOKEN"));
      const serviceAccountReady = hasServiceAccountClientEmail && hasServiceAccountPrivateKey;
      const refreshTokenReady = hasRefreshToken && hasClientId && hasClientSecret;
      const ready = hasFolder && (serviceAccountReady || refreshTokenReady || hasAccessToken);
      const missingKeys: EnvVariableName[] = [];
      if (!hasFolder) {
        missingKeys.push("GOOGLE_DRIVE_FOLDER_ID");
      }
      if (!serviceAccountReady && !refreshTokenReady && !hasAccessToken) {
        missingKeys.push(
          "GOOGLE_DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL",
          "GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY"
        );
      }

      return {
        ready,
        label: ready ? group.readyText : group.pendingText,
        detail: serviceAccountReady
          ? "使用 Service Account；請確認資料夾已分享。"
          : refreshTokenReady
          ? "使用 Refresh Token，授權可自動更新。"
          : hasAccessToken
            ? "使用短效 Access Token，建議改補 Refresh Token。"
            : "需要 Folder ID，並設定 Service Account 或 Refresh Token。",
        missingKeys
      };
    }

    const missingKeys = group.requiredKeys.filter((key) => !getEnvVariableStatus(key));
    const ready = missingKeys.length === 0;
    return {
      ready,
      label: ready ? group.readyText : group.pendingText,
      detail: ready ? "必要設定已存在，可測試連線。" : "請補齊缺少的 Vercel 環境變數。",
      missingKeys
    };
  };

  return (
    <div className="space-y-6">
      {recentAction ? (
        <div
          role="status"
          className="rounded-2xl border border-brand-sand bg-brand-sand/50 px-4 py-3 text-sm text-brand-ink"
        >
          最近操作：{recentAction}
        </div>
      ) : null}

      <div className="grid gap-6">
        <Panel
          title="機密管理區"
          action={
            <button
              type="button"
              onClick={() => setIsSecretManagementOpen((current) => !current)}
              aria-expanded={isSecretManagementOpen}
              className="rounded-full border border-brand-sand bg-white px-4 py-2 text-sm font-semibold text-brand-forest"
            >
              {isSecretManagementOpen ? "收起機密管理" : "顯示機密管理"}
            </button>
          }
        >
          {isSecretManagementOpen ? (
            <>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-semibold text-brand-ink">外部服務設定狀態</p>
                <p className="mt-1">
                  Token 由 Vercel 環境變數管理；此畫面只顯示設定狀態，不顯示 token。
                </p>
              </div>
              <div className="mt-4 grid gap-4 text-sm xl:grid-cols-2">
                {envServiceGroups.map((group) => {
                  const groupStatus = resolveEnvGroupStatus(group);
                  return (
                    <div key={group.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-brand-ink">{group.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{group.description}</p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            groupStatus.ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {groupStatus.label}
                        </span>
                      </div>
                      <p className="mt-3 text-xs font-semibold text-slate-600">{groupStatus.detail}</p>
                      {groupStatus.missingKeys.length > 0 ? (
                        <p className="mt-2 text-xs text-amber-700">
                          缺少：{groupStatus.missingKeys.join("、")}
                        </p>
                      ) : null}
                      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                        {group.items.map((item) => {
                          const configured = getEnvVariableStatus(item.key);
                          return (
                            <div key={item.key} className="rounded-xl bg-slate-50 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-semibold text-brand-ink">{item.label}</p>
                                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">{item.key}</p>
                                </div>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                    configured === undefined
                                      ? "bg-slate-200 text-slate-600"
                                      : configured
                                        ? "bg-emerald-100 text-emerald-800"
                                        : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {configured === undefined ? "待讀取" : configured ? "已設定" : "未設定"}
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-slate-600">{item.note}</p>
                              <p className="mt-1 text-xs text-slate-500">取得方式：{item.source}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                <p className="font-semibold">Google Drive 建議設定方式</p>
                <p className="mt-1">
                  正式環境建議用 Service Account + Folder ID，或 Refresh Token；Access Token 只作短效備援。
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadEnvStatus()}
                  disabled={isLoadingEnvStatus}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoadingEnvStatus ? "重新整理中" : "重新整理狀態"}
                </button>
                <button
                  type="button"
                  onClick={() => void testConnection("google-maps")}
                  disabled={testingConnectionService !== null}
                  className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testingConnectionService === "google-maps" ? "測試中" : "測試 Google Maps 連線"}
                </button>
                <button
                  type="button"
                  onClick={() => void testConnection("gpt")}
                  disabled={testingConnectionService !== null}
                  className="rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testingConnectionService === "gpt" ? "測試中" : "測試 GPT 連線"}
                </button>
                <button
                  type="button"
                  onClick={() => void testConnection("google-drive")}
                  disabled={testingConnectionService !== null}
                  className="rounded-full border border-amber-200 bg-white px-4 py-2 text-xs font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testingConnectionService === "google-drive" ? "測試中" : "測試 Google Drive 連線"}
                </button>
                {secretManagementMessage ? (
                  <span
                    role="status"
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      secretManagementMessage.tone === "success"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {secretManagementMessage.message}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              API Token 由 Vercel 管理；需檢查或測試時再展開。
            </p>
          )}
        </Panel>

        <Panel
          title="資料完整性檢查"
          action={
            <div className="flex flex-wrap gap-2">
              {isDataIntegrityOpen ? (
                <button
                  type="button"
                  onClick={() => {
                    setManagedLineContacts(loadManagedFamilyLineContacts());
                    setIntegrityCheckedAt(new Date().toISOString());
                  }}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  重新檢查
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setIsDataIntegrityOpen((current) => !current)}
                aria-expanded={isDataIntegrityOpen}
                className="rounded-full border border-brand-sand bg-white px-4 py-2 text-sm font-semibold text-brand-forest"
              >
                {isDataIntegrityOpen ? "收起完整性檢查" : "顯示完整性檢查"}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-brand-ink">
                {dataIntegrityIssueCount === 0
                  ? "目前沒有資料完整性異常"
                  : `目前共有 ${dataIntegrityIssueCount} 筆待補資料`}
              </p>
              <p className="mt-1 text-xs">
                範圍：Google 帳號、LINE、座標、照顧者、排程醫師、病歷。
              </p>
            </div>
            <p className="text-xs text-slate-500">最後檢查：{new Date(integrityCheckedAt).toLocaleString("zh-TW")}</p>
          </div>

          {isDataIntegrityOpen ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {dataIntegrityChecks.map((check) => (
                <div key={check.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-brand-ink">{check.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{check.description}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        check.issues.length === 0
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {check.issues.length === 0 ? "通過" : `${check.issues.length} 筆`}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {check.issues.length > 0 ? (
                      check.issues.slice(0, 5).map((issue) => (
                        <div key={issue.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-brand-ink">{issue.title}</p>
                              <p className="mt-1 text-xs text-slate-600">{issue.detail}</p>
                            </div>
                            <a
                              href={issue.href}
                              className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-brand-forest ring-1 ring-slate-200"
                            >
                              {issue.linkText}
                            </a>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        此項目目前沒有缺漏。
                      </p>
                    )}
                    {check.issues.length > 5 ? (
                      <p className="text-xs text-slate-500">另有 {check.issues.length - 5} 筆，請先處理上方項目後重新檢查。</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              需要查看缺漏明細或重新檢查時再展開。
            </p>
          )}
        </Panel>

        <Panel
          title="角色設置 / 人員管理"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={startCreateStaff}
                className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
              >
                新增醫師
              </button>
            </div>
          }
        >
          <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <span className="font-semibold text-brand-ink">醫師名單目前共 {staffList.length} 位。</span>
            <span className="ml-2">新增或儲存後會立即更新在下方名單，醫師登入後使用完整醫師端選單。</span>
          </div>
          <div className="space-y-3">
            {staffList.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => openStaffEditor(item.key)}
                className={`w-full rounded-2xl border p-4 text-left ${
                  selectedStaffKey === item.key
                    ? "border-brand-forest bg-brand-sand/50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{item.name}</p>
                  <Badge value={item.role === "doctor" ? "醫師" : "行政"} compact />
                </div>
                <p className="mt-2 text-sm text-slate-600">{item.secondaryLabel}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.phone || "未填電話"} / {item.accountLabel}
                </p>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {isEditorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-editor-title"
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">
                  {draft.sourceId ? "醫師資料視窗" : "新增醫師資料"}
                </p>
                <h2 id="staff-editor-title" className="mt-1 text-2xl font-semibold text-brand-ink">
                  {draft.sourceId
                    ? `${draft.name || "未命名"} 醫師資料`
                    : "新增醫師資料"}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  醫師手機端接收通知並可分享位置。
                </p>
              </div>
              <button
                type="button"
                onClick={closeStaffEditor}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉視窗
              </button>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              醫師資料維護姓名、電話與服務時段。
            </div>

            {legacyServiceSlotWarnings.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                偵測到舊版時段資料：{legacyServiceSlotWarnings.join("、")}。依新規則，星期日不再提供編輯，儲存後會自動移除。
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="mb-1 block font-medium text-brand-ink">系統角色</span>
                <p className="text-slate-600">醫師</p>
              </div>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">姓名</span>
                <input
                  aria-label="角色姓名"
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">聯絡電話</span>
                <input
                  aria-label="聯絡電話"
                  value={draft.phone}
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                允許定位後，行政端可看位置與路線進度。
              </div>

              <div className="md:col-span-2 rounded-3xl border border-slate-200 p-4">
                <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-brand-ink">星期一到星期六</p>
                      <p className="mt-1 text-xs text-slate-500">先選星期，再切換時段。</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {serviceDayOptions.map((day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setActiveServiceDay(day)}
                          className={`rounded-full px-4 py-2 text-sm font-medium ${
                            activeServiceDay === day
                              ? "bg-brand-forest text-white"
                              : "bg-white text-slate-600 ring-1 ring-slate-200"
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-brand-ink">上午 / 下午</p>
                      <p className="mt-1 text-xs text-slate-500">目前編輯：{activeServiceDay}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {servicePartOptions.map((part) => (
                        <label
                          key={part}
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3"
                        >
                          <div>
                            <p className="font-medium text-brand-ink">{part}</p>
                            <p className="text-xs text-slate-500">{activeServiceDay}{part}</p>
                          </div>
                          <input
                            type="checkbox"
                            aria-label={`${activeServiceDay}${part}`}
                            checked={hasServiceSlot(draft.serviceSlotsText, activeServiceDay, part)}
                            onChange={(event) => updateDraftServiceSlot(part, event.target.checked)}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500">已選服務時段</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {supportedServiceSlots.length > 0 ? (
                      supportedServiceSlots.map((slot) => (
                        <span
                          key={slot}
                          className="inline-flex items-center gap-2 rounded-full bg-brand-sand px-3 py-1 text-xs font-semibold text-brand-forest"
                        >
                          <span>{slot}</span>
                          <button
                            type="button"
                            aria-label={`刪除 ${slot}`}
                            onClick={() => removeDraftServiceSlot(slot)}
                            className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-100 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300"
                          >
                            刪除
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">尚未設定可服務時段</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {currentDoctorAssignments > 0 ? (
              <p className="mt-4 text-xs text-rose-600">
                此醫師目前仍有 {currentDoctorAssignments} 筆排程案件；若移除此角色，相關排程、已儲存路線、定位紀錄與請假通知會一併清除。
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveStaffRoleSetting}
                className="rounded-full bg-brand-forest px-5 py-3 font-semibold text-white"
              >
                儲存角色設置
              </button>
              <button
                type="button"
                onClick={closeStaffEditor}
                className="rounded-full bg-white px-5 py-3 font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                取消
              </button>
              {draft.sourceId ? (
                <button
                  type="button"
                  onClick={removeStaffRole}
                  className="rounded-full bg-white px-5 py-3 font-semibold text-rose-600 ring-1 ring-rose-200"
                >
                  移除此角色
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
