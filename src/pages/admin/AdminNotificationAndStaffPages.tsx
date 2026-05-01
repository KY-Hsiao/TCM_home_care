import { useMemo, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import type { AdminUser, Doctor } from "../../domain/models";
import { Badge } from "../../shared/ui/Badge";
import { Panel } from "../../shared/ui/Panel";

type ManageableRole = "doctor" | "admin";

type StaffDraft = {
  sourceId: string | null;
  originalRole: ManageableRole | null;
  role: ManageableRole;
  name: string;
  phone: string;
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

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

export function AdminStaffPage() {
  const { repositories, db } = useAppContext();
  const defaultDoctorKey = db.doctors[0] ? `doctor:${db.doctors[0].id}` : "new:doctor";
  const [selectedStaffKey, setSelectedStaffKey] = useState<string>(defaultDoctorKey);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [activeServiceDay, setActiveServiceDay] = useState<ServiceDay>(serviceDayOptions[0]);
  const [recentAction, setRecentAction] = useState<string | null>(null);
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
              醫師資料只維護姓名、電話與可服務時段。登入後使用手機網頁接收站內提示並回傳即時位置，行政端可同步查看路線與進度。
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
              ) : null}
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
