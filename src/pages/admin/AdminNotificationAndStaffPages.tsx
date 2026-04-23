import { addHours, format } from "date-fns";
import { useMemo, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import type {
  AdminUser,
  CommunicationSettings,
  Doctor,
  VisitSchedule
} from "../../domain/models";
import {
  loadDesktopLineAutomationSettings,
  persistDesktopLineAutomationSettings
} from "../../services/line/desktop-line-settings";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTimeFull } from "../../shared/utils/format";

type ManageableRole = "doctor" | "admin";

type StaffDraft = {
  sourceId: string | null;
  originalRole: ManageableRole | null;
  role: ManageableRole;
  name: string;
  phone: string;
  lineSearchKeyword: string;
  jobTitle: string;
  googleChatUserId: string;
  googleAccountEmail: string;
  googleAccountLoggedIn: boolean;
  googleLocationShareUrl: string;
  googleLocationShareEnabled: boolean;
  serviceSlotsText: string;
};

type StaffListItem = {
  key: string;
  id: string;
  role: ManageableRole;
  name: string;
  phone: string;
  accountLabel: string;
  secondaryLabel: string;
};

type LineSettingsDraft = {
  doctorContactLineUrl: string;
  helperEnabled: boolean;
  helperBaseUrl: string;
  launchLineIfNeeded: boolean;
  lineWindowHint: string;
};

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
    role: "doctor",
    name: doctor?.name ?? "",
    phone: doctor?.phone ?? "",
    lineSearchKeyword: doctor?.line_search_keyword ?? "",
    jobTitle: "",
    googleChatUserId: doctor?.google_chat_user_id ?? "",
    googleAccountEmail: doctor?.google_account_email ?? "",
    googleAccountLoggedIn: doctor?.google_account_logged_in ?? false,
    googleLocationShareUrl: doctor?.google_location_share_url ?? "",
    googleLocationShareEnabled: doctor?.google_location_share_enabled ?? false,
    serviceSlotsText: doctor?.available_service_slots.join("\n") ?? ""
  };
}

function buildAdminDraft(admin?: AdminUser): StaffDraft {
  return {
    sourceId: admin?.id ?? null,
    originalRole: admin ? "admin" : null,
    role: "admin",
    name: admin?.name ?? "",
    phone: admin?.phone ?? "",
    lineSearchKeyword: "",
    jobTitle: admin?.job_title ?? "",
    googleChatUserId: admin?.google_chat_user_id ?? "",
    googleAccountEmail: admin?.google_account_email ?? admin?.email ?? "",
    googleAccountLoggedIn: admin?.google_account_logged_in ?? false,
    googleLocationShareUrl: "",
    googleLocationShareEnabled: false,
    serviceSlotsText: ""
  };
}

function buildEmptyStaffDraft(role: ManageableRole = "doctor"): StaffDraft {
  return role === "doctor" ? buildDoctorDraft() : buildAdminDraft();
}

function buildLineSettingsDraft(
  communicationSettings: CommunicationSettings
): LineSettingsDraft {
  const helperSettings = loadDesktopLineAutomationSettings();
  return {
    doctorContactLineUrl: communicationSettings.doctor_contact_line_url ?? "",
    helperEnabled: helperSettings.enabled,
    helperBaseUrl: helperSettings.helper_base_url,
    launchLineIfNeeded: helperSettings.launch_line_if_needed,
    lineWindowHint: helperSettings.line_window_hint
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

export function AdminNotificationsPage() {
  const { db } = useAppContext();
  const relatedLogs = [...db.contact_logs]
    .sort(
      (left, right) =>
        new Date(right.contacted_at).getTime() - new Date(left.contacted_at).getTime()
    )
    .slice(0, 12);

  return (
    <div className="space-y-6">
      <Panel title="通知任務已停用">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          目前系統不再建立家屬聯絡、外部綁定或任何通訊軟體通知任務，流程統一改由排程、定位與 ContactLog 管理。
        </div>
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          出發、抵達、治療完成與路線調整目前都直接記錄在排程、定位與訪視資料內，不另外建立通知任務。
        </div>
      </Panel>

      <Panel title="ContactLog 回寫預覽與紀錄">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          外部 webhook、互動按鈕與家屬表單提交流程已移除；但 ContactLog 的流程紀錄仍保留，方便行政追蹤。
        </div>
        <div className="space-y-3">
          <div className="space-y-3">
            {relatedLogs.slice(0, 6).map((log) => (
              <div key={log.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{log.subject}</p>
                  <Badge value={log.channel} compact />
                </div>
                <p className="mt-2 text-slate-600">{log.content}</p>
                <p className="mt-1 text-slate-500">{log.outcome}</p>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function AdminStaffPage() {
  const { repositories, db } = useAppContext();
  const defaultDoctorKey = db.doctors[0] ? `doctor:${db.doctors[0].id}` : "new:doctor";
  const [selectedStaffKey, setSelectedStaffKey] = useState<string>(defaultDoctorKey);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isLineSettingsOpen, setIsLineSettingsOpen] = useState(false);
  const [activeServiceDay, setActiveServiceDay] = useState<ServiceDay>(serviceDayOptions[0]);
  const [showLeaveConsole, setShowLeaveConsole] = useState(false);
  const [recentAction, setRecentAction] = useState<string | null>(null);
  const [lineSettingsDraft, setLineSettingsDraft] = useState<LineSettingsDraft>(() =>
    buildLineSettingsDraft(db.communication_settings)
  );
  const staffList = useMemo<StaffListItem[]>(
    () =>
      [
        ...db.doctors.map((doctor) => ({
          key: `doctor:${doctor.id}`,
          id: doctor.id,
          role: "doctor" as const,
          name: doctor.name,
          phone: doctor.phone,
          accountLabel: "密碼登入 / 站內通知 / 手機定位",
          secondaryLabel: doctor.available_service_slots.join("、") || "未設定可服務時段"
        }))
      ].sort((left, right) => left.name.localeCompare(right.name, "zh-Hant")),
    [db.doctors]
  );
  const resolveDraftByKey = (staffKey: string): StaffDraft => {
    if (staffKey.startsWith("doctor:")) {
      return buildDoctorDraft(db.doctors.find((doctor) => doctor.id === staffKey.replace("doctor:", "")));
    }
    return buildAdminDraft(db.admin_users.find((admin) => admin.id === staffKey.replace("admin:", "")));
  };
  const [draft, setDraft] = useState<StaffDraft>(() =>
    defaultDoctorKey.startsWith("doctor:")
      ? resolveDraftByKey(defaultDoctorKey)
      : buildEmptyStaffDraft("doctor")
  );
  const [doctorId, setDoctorId] = useState<string>(db.doctors[0]?.id ?? "");
  const [startDate, setStartDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState<string>(format(addHours(new Date(), 24), "yyyy-MM-dd"));
  const [reason, setReason] = useState<string>("請假登記");
  const [handoffNote, setHandoffNote] = useState<string>("請協助檢查受影響個案");
  const supportedServiceSlots = useMemo(
    () => getSupportedServiceSlots(draft.serviceSlotsText),
    [draft.serviceSlotsText]
  );
  const legacyServiceSlotWarnings = useMemo(
    () => getLegacyServiceSlotWarnings(draft.serviceSlotsText),
    [draft.serviceSlotsText]
  );
  const impactedSchedules = repositories.staffingRepository.getImpactedSchedules(
    doctorId,
    startDate,
    endDate
  );
  const pendingDoctorTaskCount = repositories.notificationRepository
    .getTasksByRecipientRole("doctor")
    .filter((task) => ["pending", "awaiting_reply", "replied"].includes(task.status)).length;
  const pendingLeaveCount = repositories.staffingRepository
    .getLeaveRequests()
    .filter((leave) => leave.status === "pending").length;
  const currentDoctorAssignments = draft.originalRole === "doctor" && draft.sourceId
    ? db.visit_schedules.filter((schedule) => schedule.assigned_doctor_id === draft.sourceId).length
    : 0;

  const syncDraftFromSelection = (staffKey: string) => {
    const nextDraft = staffKey.startsWith("new:")
      ? buildEmptyStaffDraft(staffKey.replace("new:", "") as ManageableRole)
      : resolveDraftByKey(staffKey);
    setDraft(nextDraft);
    setActiveServiceDay(getInitialActiveServiceDay(nextDraft.serviceSlotsText));
  };

  const openStaffEditor = (staffKey: string) => {
    setSelectedStaffKey(staffKey);
    syncDraftFromSelection(staffKey);
    setIsEditorOpen(true);
  };

  const startCreateStaff = (role: ManageableRole) => {
    const staffKey = `new:${role}`;
    setSelectedStaffKey(staffKey);
    syncDraftFromSelection(staffKey);
    setIsEditorOpen(true);
  };

  const closeStaffEditor = () => {
    syncDraftFromSelection(selectedStaffKey);
    setIsEditorOpen(false);
  };

  const openLineSettingsEditor = () => {
    setLineSettingsDraft(buildLineSettingsDraft(db.communication_settings));
    setIsLineSettingsOpen(true);
  };

  const closeLineSettingsEditor = () => {
    setLineSettingsDraft(buildLineSettingsDraft(db.communication_settings));
    setIsLineSettingsOpen(false);
  };

  const updateDraftServiceSlot = (part: ServicePart, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      serviceSlotsText: toggleServiceSlot(current.serviceSlotsText, activeServiceDay, part, checked)
    }));
  };

  const saveStaffRoleSetting = () => {
    const now = new Date().toISOString();
    const normalizedName = draft.name.trim();
    const normalizedPhone = draft.phone.trim();
    const normalizedLineSearchKeyword = draft.lineSearchKeyword.trim();
    const normalizedGoogleChatId = draft.googleChatUserId.trim();
    const normalizedGoogleAccount = draft.googleAccountEmail.trim();
    const normalizedGoogleLocationShareUrl = draft.googleLocationShareUrl.trim();

    if (!normalizedName || !normalizedPhone) {
      setRecentAction("請先填寫姓名與聯絡電話。");
      return;
    }

    if (draft.originalRole === "doctor" && draft.role === "admin" && currentDoctorAssignments > 0) {
      setRecentAction(`${normalizedName} 目前仍有排程案件，暫不允許改為行政身分。`);
      return;
    }

    if (draft.role === "doctor") {
      const selectedServiceSlots = getSupportedServiceSlots(draft.serviceSlotsText);
      if (selectedServiceSlots.length === 0) {
        setRecentAction("請至少勾選一個醫師可服務時段。");
        return;
      }
      const doctorIdToSave =
        draft.originalRole === "doctor" && draft.sourceId
          ? draft.sourceId
          : createId("doc");
      const doctorToSave: Doctor = {
        id: doctorIdToSave,
        name: normalizedName,
        license_number: "",
        phone: normalizedPhone,
        line_search_keyword: normalizedLineSearchKeyword,
        specialty: "",
        service_area: "",
        google_chat_user_id: normalizedGoogleChatId,
        google_account_email: normalizedGoogleAccount || null,
        google_account_logged_in: draft.googleAccountLoggedIn,
        google_location_share_url: normalizedGoogleLocationShareUrl || null,
        google_location_share_enabled: Boolean(normalizedGoogleLocationShareUrl),
        available_service_slots: selectedServiceSlots,
        status: "active",
        created_at: now,
        updated_at: now
      };
      repositories.patientRepository.upsertDoctor(doctorToSave);
      if (draft.originalRole === "admin" && draft.sourceId) {
        repositories.patientRepository.removeAdmin(draft.sourceId);
      }
      setSelectedStaffKey(`doctor:${doctorIdToSave}`);
      setDraft(buildDoctorDraft(doctorToSave));
      setActiveServiceDay(getInitialActiveServiceDay(doctorToSave.available_service_slots.join("\n")));
      setRecentAction(
        legacyServiceSlotWarnings.length > 0
          ? `已將 ${normalizedName} 設為醫師，並移除不支援的舊時段：${legacyServiceSlotWarnings.join("、")}。`
          : `已將 ${normalizedName} 設為醫師。`
      );
      return;
    }

    const adminIdToSave =
      draft.originalRole === "admin" && draft.sourceId
        ? draft.sourceId
        : createId("admin");
    const adminToSave: AdminUser = {
      id: adminIdToSave,
      name: normalizedName,
      job_title: draft.jobTitle.trim() || "行政協作人員",
      email: normalizedGoogleAccount || `${adminIdToSave}@example.local`,
      google_chat_user_id: normalizedGoogleChatId,
      google_account_email: normalizedGoogleAccount,
      google_account_logged_in: draft.googleAccountLoggedIn,
      phone: normalizedPhone,
      created_at: now,
      updated_at: now
    };
    repositories.patientRepository.upsertAdmin(adminToSave);
    if (draft.originalRole === "doctor" && draft.sourceId) {
      repositories.patientRepository.removeDoctor(draft.sourceId);
    }
    setSelectedStaffKey(`admin:${adminIdToSave}`);
    setDraft(buildAdminDraft(adminToSave));
    setRecentAction(`已將 ${normalizedName} 設為行政。`);
  };

  const saveLineSettings = () => {
    repositories.patientRepository.upsertCommunicationSettings({
      ...db.communication_settings,
      doctor_contact_line_url: lineSettingsDraft.doctorContactLineUrl.trim()
    });
    persistDesktopLineAutomationSettings({
      enabled: lineSettingsDraft.helperEnabled,
      helper_base_url: lineSettingsDraft.helperBaseUrl,
      launch_line_if_needed: lineSettingsDraft.launchLineIfNeeded,
      line_window_hint: lineSettingsDraft.lineWindowHint
    });
    setIsLineSettingsOpen(false);
    setRecentAction("已儲存 LINE 聯絡設定。");
  };

  const removeStaffRole = () => {
    if (!draft.sourceId || !draft.originalRole) {
      setRecentAction("請先選擇既有人員，新增中的資料不能直接移除。");
      return;
    }

    if (draft.originalRole === "doctor") {
      if (db.doctors.length <= 1) {
        setRecentAction("目前至少要保留一位醫師。");
        return;
      }
      if (currentDoctorAssignments > 0) {
        setRecentAction(`${draft.name || "此醫師"} 目前仍有排程案件，暫不允許移除。`);
        return;
      }

      repositories.patientRepository.removeDoctor(draft.sourceId);
      const fallbackDoctor = db.doctors.find((doctor) => doctor.id !== draft.sourceId);
      if (fallbackDoctor) {
        setSelectedStaffKey(`doctor:${fallbackDoctor.id}`);
        setDraft(buildDoctorDraft(fallbackDoctor));
        setActiveServiceDay(getInitialActiveServiceDay(fallbackDoctor.available_service_slots.join("\n")));
      } else {
        setSelectedStaffKey("new:doctor");
        setDraft(buildEmptyStaffDraft("doctor"));
        setActiveServiceDay(serviceDayOptions[0]);
      }
    } else {
      repositories.patientRepository.removeAdmin(draft.sourceId);
      const fallbackAdmin = db.admin_users.find((admin) => admin.id !== draft.sourceId);
      if (fallbackAdmin) {
        setSelectedStaffKey(`admin:${fallbackAdmin.id}`);
        setDraft(buildAdminDraft(fallbackAdmin));
      } else {
        setSelectedStaffKey(defaultDoctorKey);
        syncDraftFromSelection(defaultDoctorKey);
      }
    }
    setIsEditorOpen(false);
    setRecentAction(`已移除 ${draft.name || "該角色"}。`);
  };

  const createLeave = () => {
    repositories.staffingRepository.createLeaveRequest({
      doctorId,
      startDate,
      endDate,
      reason,
      handoffNote,
      status: "pending"
    });
    setRecentAction("請假申請已建立。");
  };

  const applyImpactAction = (
    schedule: VisitSchedule,
    action: "reschedule" | "coverage" | "notify_only" | "pause_visit"
  ) => {
    const caregiver = db.caregivers.find((item) => item.id === schedule.primary_caregiver_id);
    if (action === "reschedule") {
      repositories.visitRepository.rescheduleVisit({
        visitScheduleId: schedule.id,
        requestedByRole: "admin",
        newStartAt: addHours(new Date(schedule.scheduled_start_at), 24).toISOString(),
        newEndAt: addHours(new Date(schedule.scheduled_end_at), 24).toISOString(),
        reason: "醫師請假改期",
        changeSummary: "由請假與異動處理頁模擬改期"
      });
    }
    if (action === "coverage") {
      const backupDoctor = db.doctors.find((item) => item.id !== schedule.assigned_doctor_id);
      if (backupDoctor) {
        repositories.visitRepository.coverVisit({
          visitScheduleId: schedule.id,
          requestedByRole: "admin",
          newDoctorId: backupDoctor.id,
          reason: "醫師請假改由代班處理",
          changeSummary: "由請假與異動處理頁模擬代班"
        });
      }
    }
    if (action === "pause_visit") {
      repositories.visitRepository.pauseVisit(
        schedule.id,
        "醫師請假，本次先暫停",
        "由請假與異動處理頁模擬暫停"
      );
    }
    setRecentAction("受影響案件已套用異動。");
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
          title="角色設置 / 人員管理"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => startCreateStaff("doctor")}
                className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
              >
                新增醫師
              </button>
              <button
                type="button"
                onClick={openLineSettingsEditor}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-ink ring-1 ring-slate-200"
              >
                LINE 聯絡設定
              </button>
            </div>
          }
        >
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
                  {item.phone} / {item.accountLabel}
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
                  醫師端會在網頁內收到出發、抵達、緊急與追蹤通知；登入後請用手機允許位置分享。
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
              醫師資料只維護姓名、電話、LINE 搜尋關鍵字與可服務時段。登入後使用手機網頁接收站內提示並回傳即時位置，行政端可同步查看路線與進度。
            </div>

            {legacyServiceSlotWarnings.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                偵測到舊版時段資料：{legacyServiceSlotWarnings.join("、")}。依新規則，星期日不再提供編輯，儲存後會自動移除。
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="mb-1 block font-medium text-brand-ink">系統角色</span>
                <p className="text-slate-600">{draft.role === "doctor" ? "醫師" : "行政"}</p>
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
              {draft.role === "doctor" ? (
                <label className="block md:col-span-2">
                  <span className="mb-1 block font-medium text-brand-ink">LINE 搜尋關鍵字</span>
                  <input
                    aria-label="LINE 搜尋關鍵字"
                    value={draft.lineSearchKeyword}
                    onChange={(event) => setDraft({ ...draft, lineSearchKeyword: event.target.value })}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    供行政端固定 Windows 管理電腦上的 LINE 桌面版搜尋這位醫師時使用。
                  </p>
                </label>
              ) : null}
              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                醫師端改用手機網頁即時定位。醫師登入後若允許位置分享，行政端會直接看到最新位置、距離、軌跡與已過 / 未到站點。
              </div>

              {draft.role === "doctor" ? (
              <div className="md:col-span-2 rounded-3xl border border-slate-200 p-4">
                <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-brand-ink">星期一到星期六</p>
                      <p className="mt-1 text-xs text-slate-500">先選擇要編輯的星期，再切換上午或下午。</p>
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
                          className="rounded-full bg-brand-sand px-3 py-1 text-xs font-semibold text-brand-forest"
                        >
                          {slot}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">尚未設定可服務時段</span>
                    )}
                  </div>
                </div>
              </div>
              ) : null}
            </div>

            {currentDoctorAssignments > 0 ? (
              <p className="mt-4 text-xs text-rose-600">
                此醫師目前仍有 {currentDoctorAssignments} 筆排程案件，暫不允許直接移除。
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

      {isLineSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="line-settings-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">共享聯絡入口</p>
                <h2 id="line-settings-title" className="mt-1 text-2xl font-semibold text-brand-ink">
                  LINE 聯絡設定
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  醫師端會使用這裡設定的行政 LINE 入口；行政端則會透過固定 Windows 管理電腦上的 localhost helper 嘗試切換到指定醫師的 LINE 對話。
                </p>
              </div>
              <button
                type="button"
                onClick={closeLineSettingsEditor}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉視窗
              </button>
            </div>

            <div className="mt-6 grid gap-4 text-sm">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600">
                這組設定只保證固定 Windows 管理電腦上的桌面 LINE 自動化流程；若 helper 無法連線、視窗聚焦失敗或醫師尚未填搜尋關鍵字，系統會回退到電話聯絡。
              </div>

              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">行政 LINE 入口連結</span>
                <input
                  aria-label="行政 LINE 入口連結"
                  value={lineSettingsDraft.doctorContactLineUrl}
                  onChange={(event) =>
                    setLineSettingsDraft((current) => ({
                      ...current,
                      doctorContactLineUrl: event.target.value
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
                <p className="mt-1 text-xs text-slate-500">
                  醫師端的「聯絡行政端」會優先開啟這個連結。請貼上你已實測可用的 LINE 連結或 URI。
                </p>
              </label>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-brand-ink">桌面 LINE helper</p>
                    <p className="mt-1 text-xs text-slate-500">固定 Windows 管理電腦使用，預設呼叫 localhost API。</p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-brand-ink">
                    <input
                      type="checkbox"
                      aria-label="啟用桌面 LINE 自動化"
                      checked={lineSettingsDraft.helperEnabled}
                      onChange={(event) =>
                        setLineSettingsDraft((current) => ({
                          ...current,
                          helperEnabled: event.target.checked
                        }))
                      }
                    />
                    啟用桌面 LINE 自動化
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="block md:col-span-2">
                    <span className="mb-1 block font-medium text-brand-ink">LINE helper 位址</span>
                    <input
                      aria-label="LINE helper 位址"
                      value={lineSettingsDraft.helperBaseUrl}
                      onChange={(event) =>
                        setLineSettingsDraft((current) => ({
                          ...current,
                          helperBaseUrl: event.target.value
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block font-medium text-brand-ink">LINE 視窗標題提示</span>
                    <input
                      aria-label="LINE 視窗標題提示"
                      value={lineSettingsDraft.lineWindowHint}
                      onChange={(event) =>
                        setLineSettingsDraft((current) => ({
                          ...current,
                          lineWindowHint: event.target.value
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="LINE 未開啟時自動喚起"
                      checked={lineSettingsDraft.launchLineIfNeeded}
                      onChange={(event) =>
                        setLineSettingsDraft((current) => ({
                          ...current,
                          launchLineIfNeeded: event.target.checked
                        }))
                      }
                    />
                    <span className="text-sm font-medium text-brand-ink">LINE 未開啟時自動喚起</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveLineSettings}
                className="rounded-full bg-brand-forest px-5 py-3 font-semibold text-white"
              >
                儲存 LINE 設定
              </button>
              <button
                type="button"
                onClick={closeLineSettingsEditor}
                className="rounded-full bg-white px-5 py-3 font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Panel
        title="請假與任務摘要"
        action={
          <button
            type="button"
            onClick={() => setShowLeaveConsole((current) => !current)}
            className="rounded-full bg-brand-sand px-4 py-2 text-sm font-semibold text-brand-forest"
          >
            {showLeaveConsole ? "收合請假處理" : "展開請假處理"}
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">待審請假</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">{pendingLeaveCount}</p>
            <p className="mt-1 text-xs text-slate-500">近期請假衝突已整合到角色設置頁統一查看。</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">待處理院內任務</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">{pendingDoctorTaskCount}</p>
            <p className="mt-1 text-xs text-slate-500">醫師出發、抵達與異常通知都由同頁面接手。</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">受影響案件</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">{impactedSchedules.length}</p>
            <p className="mt-1 text-xs text-slate-500">需要改期、代班或暫停的案件可在展開後直接處理。</p>
          </div>
        </div>
      </Panel>

      {showLeaveConsole ? (
        <>
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel title="請假與異動處理">
          <div className="grid gap-4 md:grid-cols-2 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">醫師請假登記</span>
              <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3">
                {db.doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">開始日期</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">結束日期</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1 block font-medium text-brand-ink">原因與交接</span>
              <textarea value={`${reason}\n${handoffNote}`} onChange={(event) => {
                const [reasonLine, ...noteLines] = event.target.value.split("\n");
                setReason(reasonLine);
                setHandoffNote(noteLines.join("\n"));
              }} rows={4} className="w-full rounded-2xl border border-slate-200 px-4 py-3" />
            </label>
          </div>
          <button type="button" onClick={createLeave} className="mt-4 rounded-full bg-brand-coral px-5 py-3 font-semibold text-white">
            建立請假申請
          </button>
        </Panel>

        <Panel title="受影響案件">
          <div className="space-y-3">
            {impactedSchedules.map((schedule) => {
              const patient = db.patients.find((item) => item.id === schedule.patient_id);
              return (
                <div key={schedule.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-brand-ink">{patient?.name ?? schedule.patient_id}</p>
                    <Badge value={schedule.status} compact />
                  </div>
                  <p className="mt-2 text-slate-600">{formatDateTimeFull(schedule.scheduled_start_at)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => applyImpactAction(schedule, "reschedule")} className="rounded-full bg-brand-sand px-3 py-2 text-xs font-semibold text-brand-forest">
                      改期
                    </button>
                    <button type="button" onClick={() => applyImpactAction(schedule, "coverage")} className="rounded-full bg-brand-sand px-3 py-2 text-xs font-semibold text-brand-forest">
                      代班
                    </button>
                    <button type="button" onClick={() => applyImpactAction(schedule, "pause_visit")} className="rounded-full bg-brand-sand px-3 py-2 text-xs font-semibold text-brand-forest">
                      暫停本次訪視
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="請假申請歷程">
          <div className="space-y-3">
            {repositories.staffingRepository.getLeaveRequests().map((leave) => (
              <div key={leave.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{db.doctors.find((item) => item.id === leave.doctor_id)?.name ?? leave.doctor_id}</p>
                  <Badge value={leave.status} compact />
                </div>
                <p className="mt-2 text-slate-600">
                  {leave.start_date} ~ {leave.end_date}
                </p>
                <p className="mt-1 text-slate-500">{leave.handoff_note}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="異動歷程">
          <div className="space-y-3">
            {repositories.staffingRepository.getRescheduleActions().map((action) => (
              <div key={action.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-brand-ink">{action.action_type}</p>
                  <span className="text-xs text-slate-500">{action.status}</span>
                </div>
                <p className="mt-2 text-slate-600">{formatDateTimeFull(action.original_start_at)} → {formatDateTimeFull(action.new_start_at)}</p>
                <p className="mt-1 text-slate-500">{action.change_summary}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
        </>
      ) : null}
    </div>
  );
}
