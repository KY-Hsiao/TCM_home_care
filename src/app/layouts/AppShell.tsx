import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { navigationByRole } from "../../shared/constants/navigation";
import { useAppContext } from "../use-app-context";
import { formatDateTimeFull } from "../../shared/utils/format";
import { isVisitFinished, isVisitUnlocked } from "../../modules/doctor/doctor-page-helpers";
import {
  isConfiguredLineUrl,
  openExternalContactTarget,
  requestDoctorLineChat
} from "../../services/line/desktop-line-helper";
import { loadDesktopLineAutomationSettings } from "../../services/line/desktop-line-settings";

type NotificationCenterItem = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  tone: "pending" | "info";
};

type DoctorLocationSyncState = {
  status: "idle" | "requesting" | "sharing" | "denied" | "unsupported" | "error";
  message: string;
  lastUpdatedAt: string | null;
};

type ContactFeedback = {
  tone: "success" | "warning";
  message: string;
};

function sortByLatest<T extends { updated_at?: string; sent_at?: string | null; scheduled_send_at?: string; due_at?: string }>(
  items: T[]
) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(
      left.updated_at ?? left.sent_at ?? left.scheduled_send_at ?? left.due_at ?? 0
    ).getTime();
    const rightTime = new Date(
      right.updated_at ?? right.sent_at ?? right.scheduled_send_at ?? right.due_at ?? 0
    ).getTime();
    return rightTime - leftTime;
  });
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    db,
    repositories,
    session,
    logout,
    changePassword,
    isAuthenticatedForRole,
    setRole,
    setActiveDoctorId,
    resetMockData
  } = useAppContext();
  const doctors = repositories.patientRepository.getDoctors();
  const admins = repositories.patientRepository.getAdmins();
  const shellRole = location.pathname.startsWith("/admin")
    ? "admin"
    : location.pathname.startsWith("/doctor")
      ? "doctor"
      : null;
  const navItems = shellRole ? navigationByRole[shellRole] : [];
  const isAuthenticated = shellRole ? isAuthenticatedForRole(shellRole) : true;
  const shellTitle =
    shellRole === "doctor"
      ? "居家醫師操作視圖"
      : shellRole === "admin"
        ? "行政管理協作視圖"
        : "系統共用檢視";
  const currentDoctor = doctors.find((doctor) => doctor.id === session.activeDoctorId);
  const currentAdmin = admins.find((admin) => admin.id === session.activeAdminId) ?? admins[0];
  const currentUserId = shellRole === "doctor" ? session.activeDoctorId : session.activeAdminId;
  const currentUserName =
    shellRole === "doctor"
      ? currentDoctor?.name
      : shellRole === "admin"
        ? "行政人員"
        : undefined;
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    nextPassword: "",
    confirmPassword: ""
  });
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [doctorLocationSync, setDoctorLocationSync] = useState<DoctorLocationSyncState>({
    status: "idle",
    message: "尚未開始定位共享。",
    lastUpdatedAt: null
  });
  const [adminContactFeedback, setAdminContactFeedback] = useState<ContactFeedback | null>(null);
  const [doctorContactFeedback, setDoctorContactFeedback] = useState<ContactFeedback | null>(null);
  const [isContactingDoctor, setIsContactingDoctor] = useState(false);
  const repositoriesRef = useRef(repositories);
  const lastLocationWriteAtRef = useRef(0);

  repositoriesRef.current = repositories;

  useEffect(() => {
    if (shellRole && session.role !== shellRole) {
      setRole(shellRole);
    }
  }, [session.role, setRole, shellRole]);

  useEffect(() => {
    setAdminContactFeedback(null);
  }, [session.activeDoctorId]);

  useEffect(() => {
    if (shellRole !== "doctor" || !session.authenticatedDoctorId) {
      return;
    }

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setDoctorLocationSync({
        status: "unsupported",
        message: "目前裝置不支援瀏覽器定位。",
        lastUpdatedAt: null
      });
      return;
    }

    setDoctorLocationSync({
      status: "requesting",
      message: "正在向醫師端要求位置授權。",
      lastUpdatedAt: null
    });

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const recordedAt = new Date(position.timestamp || Date.now()).toISOString();
        setDoctorLocationSync({
          status: "sharing",
          message: "醫師端位置已持續共享給行政檢視。",
          lastUpdatedAt: recordedAt
        });

        const now = Date.now();
        if (now - lastLocationWriteAtRef.current < 10000) {
          return;
        }
        lastLocationWriteAtRef.current = now;

        const activeSchedule =
          repositoriesRef.current.visitRepository.getSchedules({
            doctorId: session.activeDoctorId,
            statuses: ["on_the_way", "tracking", "proximity_pending", "arrived", "in_treatment"]
          })[0] ??
          repositoriesRef.current.visitRepository.getSchedules({
            doctorId: session.activeDoctorId
          })[0];

        repositoriesRef.current.visitRepository.appendDoctorLocationLog({
          id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          doctor_id: session.activeDoctorId,
          recorded_at: recordedAt,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: position.coords.accuracy <= 50 ? "gps" : "network",
          linked_visit_schedule_id: activeSchedule?.id ?? null
        });
      },
      (error) => {
        if (error.code === 1) {
          setDoctorLocationSync({
            status: "denied",
            message: "醫師端尚未允許定位，行政端目前無法看到即時位置。",
            lastUpdatedAt: null
          });
          return;
        }
        setDoctorLocationSync({
          status: "error",
          message: "定位共享中斷，請確認手機定位與網路。",
          lastUpdatedAt: null
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [session.activeDoctorId, session.authenticatedDoctorId, shellRole]);

  const notificationItems = useMemo<NotificationCenterItem[]>(() => {
    if (!shellRole) {
      return [];
    }

    if (shellRole === "doctor") {
      const taskItems = sortByLatest(
        repositories.notificationRepository
          .getTasksByRecipientRole("doctor")
          .filter((task) => {
            const detail = task.visit_schedule_id
              ? repositories.visitRepository.getScheduleDetail(task.visit_schedule_id)
              : undefined;
            return detail?.doctor.id === session.activeDoctorId;
          })
      ).slice(0, 4);

      const reminderItems = sortByLatest(
        repositories.visitRepository.getReminders("doctor", session.activeDoctorId)
      ).slice(0, 4);

      return [
        ...taskItems.map((task) => ({
          id: `task:${task.id}`,
          title: task.recipient_name,
          detail: task.preview_payload.subject ?? task.preview_payload.body ?? "站內通知",
          timestamp: task.sent_at ?? task.scheduled_send_at,
          tone: task.status === "pending" ? ("pending" as const) : ("info" as const)
        })),
        ...reminderItems.map((reminder) => ({
          id: `reminder:${reminder.id}`,
          title: reminder.title,
          detail: reminder.detail,
          timestamp: reminder.due_at,
          tone: reminder.status === "pending" ? ("pending" as const) : ("info" as const)
        }))
      ]
        .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
        .slice(0, 6);
    }

    const reminderItems = sortByLatest(
      repositories.visitRepository.getReminders("admin", session.activeAdminId)
    ).slice(0, 4);

    return [
      ...reminderItems.map((reminder) => ({
        id: `reminder:${reminder.id}`,
        title: reminder.title,
        detail: reminder.detail,
        timestamp: reminder.due_at,
        tone: reminder.status === "pending" ? ("pending" as const) : ("info" as const)
      }))
    ]
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 6);
  }, [repositories, session.activeAdminId, session.activeDoctorId, shellRole]);

  const doctorNavigationShortcut = useMemo(() => {
    if (shellRole !== "doctor") {
      return null;
    }

    const orderedSchedules = repositories.visitRepository.getDoctorDashboard(session.activeDoctorId).todaySchedules;
    const activeSchedule = orderedSchedules.find((schedule) => {
      const record = repositories.visitRepository.getVisitRecordByScheduleId(schedule.id);
      return (
        isVisitUnlocked(orderedSchedules, schedule.id, record) &&
        Boolean(record?.departure_time) &&
        !record?.arrival_time &&
        !isVisitFinished(schedule.status)
      );
    });

    if (!activeSchedule) {
      return null;
    }

    return repositories.visitRepository.getScheduleDetail(activeSchedule.id);
  }, [repositories, session.activeDoctorId, shellRole]);

  const contactShortcut = useMemo(() => {
    if (!shellRole) {
      return null;
    }

    if (shellRole === "admin") {
      const targetDoctor = currentDoctor ?? doctors[0];
      if (!targetDoctor) {
        return null;
      }

      return {
        title: "快捷聯絡醫師",
        subtitle: "行政端可直接切換目標醫師後一鍵開啟 LINE，失敗時自動改用電話。",
        phone: targetDoctor.phone,
        lineSearchKeyword: targetDoctor.line_search_keyword,
        contactName: targetDoctor.name,
        primaryLabel: "聯絡目前醫師",
        secondaryLabel: "查看醫師位置"
      };
    }

    if (!currentAdmin) {
      return null;
    }

    return {
      title: "聯絡行政 / 緊急求救",
      subtitle: doctorNavigationShortcut
        ? `導航前往 ${doctorNavigationShortcut.patient.name} 期間會優先開啟行政 LINE，必要時立即改用電話求助。`
        : "導航期間會優先開啟行政 LINE，必要時立即改用電話求助。",
      phone: currentAdmin.phone,
      lineUrl: db.communication_settings.doctor_contact_line_url,
      contactName: "行政人員",
      primaryLabel: "聯絡行政端",
      secondaryLabel: "緊急求救"
    };
  }, [
    currentAdmin,
    currentDoctor,
    db.communication_settings.doctor_contact_line_url,
    doctorNavigationShortcut,
    doctors,
    shellRole
  ]);

  const openPhoneFallback = (phone: string) => {
    openExternalContactTarget(`tel:${phone}`);
  };

  const handleDoctorContactAdmin = () => {
    if (!contactShortcut || shellRole !== "doctor") {
      return;
    }

    const lineUrl =
      "lineUrl" in contactShortcut && typeof contactShortcut.lineUrl === "string"
        ? contactShortcut.lineUrl
        : "";

    if (!isConfiguredLineUrl(lineUrl)) {
      setDoctorContactFeedback({
        tone: "warning",
        message: "尚未設定 LINE 聯絡入口，已改用電話聯絡行政端。"
      });
      openPhoneFallback(contactShortcut.phone);
      return;
    }

    const opened = openExternalContactTarget(lineUrl, "_blank");
    if (opened) {
      setDoctorContactFeedback({
        tone: "success",
        message: "已嘗試開啟行政 LINE 對話；若未跳轉，請改用電話聯絡。"
      });
      return;
    }

    setDoctorContactFeedback({
      tone: "warning",
      message: "LINE 連結開啟失敗，已改用電話聯絡行政端。"
    });
    openPhoneFallback(contactShortcut.phone);
  };

  const handleAdminContactDoctor = async () => {
    if (!contactShortcut || shellRole !== "admin") {
      return;
    }

    const targetDoctor = currentDoctor ?? doctors[0];
    if (!targetDoctor) {
      return;
    }

    setIsContactingDoctor(true);
    const helperSettings = loadDesktopLineAutomationSettings();
    const result = await requestDoctorLineChat(
      {
        doctorId: targetDoctor.id,
        doctorName: targetDoctor.name,
        lineSearchKeyword: targetDoctor.line_search_keyword,
        phone: targetDoctor.phone
      },
      helperSettings
    );

    if (result.success) {
      setAdminContactFeedback({
        tone: "success",
        message: result.message
      });
      setIsContactingDoctor(false);
      return;
    }

    setAdminContactFeedback({
      tone: "warning",
      message: `${result.message} 已改用電話聯絡。`
    });
    openPhoneFallback(targetDoctor.phone);
    setIsContactingDoctor(false);
  };

  const handleLogout = () => {
    if (!shellRole) {
      return;
    }
    logout(shellRole);
    setIsNotificationOpen(false);
    setIsPasswordModalOpen(false);
    navigate("/");
  };

  const handleChangePassword = () => {
    if (!shellRole || !currentUserId) {
      return;
    }
    if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
      setPasswordMessage("新密碼與確認密碼不一致。");
      return;
    }

    const result = changePassword({
      role: shellRole,
      userId: currentUserId,
      currentPassword: passwordForm.currentPassword,
      nextPassword: passwordForm.nextPassword
    });
    setPasswordMessage(result.message);
    if (result.success) {
      setPasswordForm({
        currentPassword: "",
        nextPassword: "",
        confirmPassword: ""
      });
    }
  };

  if (shellRole && !isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-brand-sand text-brand-ink">
      <div className="mx-auto grid min-h-screen max-w-[1600px] gap-6 px-4 py-4 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-[2rem] border border-white/70 bg-brand-ink p-6 text-white shadow-card">
          <div>
            <p className="text-sm tracking-[0.3em] text-brand-sand/70">TCM HOME CARE</p>
            <h1 className="mt-2 text-2xl font-bold">中醫居家醫療輔助系統</h1>
            <p className="mt-2 text-sm text-brand-sand/80">
              先以假資料跑通排程、訪視、通知與行政協作流程。
            </p>
          </div>

          <nav className="mt-6 space-y-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-3xl px-4 py-3 transition ${
                    isActive ? "bg-white text-brand-ink" : "bg-white/5 hover:bg-white/10"
                  }`
                }
              >
                <div className="font-semibold">{item.label}</div>
                <div
                  className={`mt-1 text-xs ${
                    location.pathname === item.to ? "text-slate-500" : "text-brand-sand/70"
                  }`}
                >
                  {item.description}
                </div>
              </NavLink>
            ))}
          </nav>

          <div className="mt-6 space-y-3 rounded-3xl bg-white/10 p-4 text-sm">
            <p className="font-semibold">模組入口</p>
            <NavLink to="/demo-overview" className="block rounded-2xl bg-white/5 px-3 py-2">
              系統總覽與假資料說明
            </NavLink>
            <NavLink to="/maps/overview" className="block rounded-2xl bg-white/5 px-3 py-2">
              地圖與定位預留
            </NavLink>
          </div>
        </aside>

        <div className="space-y-4">
          <header className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-card backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm text-brand-moss">Web Demo Session</p>
                <h2 className="text-2xl font-bold">{shellTitle}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {shellRole === "doctor"
                    ? `目前登入醫師：${currentUserName ?? "未登入"}`
                    : shellRole === "admin"
                      ? `目前登入行政：${currentUserName ?? "未登入"}`
                      : "系統共用頁面"}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-[160px_160px_auto_auto]">
                <button
                  type="button"
                  onClick={() => setIsNotificationOpen(true)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-brand-ink"
                >
                  站內通知 {notificationItems.length > 0 ? `(${notificationItems.length})` : ""}
                </button>
                {shellRole ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordMessage(null);
                      setIsPasswordModalOpen(true);
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-brand-ink"
                  >
                    修改密碼
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={resetMockData}
                  className="rounded-2xl bg-brand-coral px-4 py-3 text-sm font-semibold text-white"
                >
                  重置假資料
                </button>
                {shellRole ? (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                  >
                    登出
                  </button>
                ) : null}
              </div>
            </div>
            {shellRole === "doctor" ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-semibold text-brand-ink">醫師手機定位共享</p>
                <p className="mt-1">{doctorLocationSync.message}</p>
                <p className="mt-1 text-xs text-slate-500">
                  最後更新：{formatDateTimeFull(doctorLocationSync.lastUpdatedAt)}
                </p>
              </div>
            ) : null}
            {shellRole === "admin" && contactShortcut ? (
              <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <label className="block min-w-[220px]">
                  <span className="mb-1 block font-medium text-brand-ink">快捷聯絡醫師</span>
                  <select
                    aria-label="快捷聯絡醫師"
                    value={session.activeDoctorId}
                    onChange={(event) => setActiveDoctorId(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  >
                    {doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void handleAdminContactDoctor();
                  }}
                  disabled={isContactingDoctor}
                  className="rounded-full bg-brand-forest px-4 py-3 text-sm font-semibold text-white"
                >
                  {isContactingDoctor ? "連線中..." : contactShortcut.primaryLabel}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/doctor/location")}
                  className="rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-brand-ink"
                >
                  {contactShortcut.secondaryLabel}
                </button>
                <p className="text-xs text-slate-500">
                  目前目標：{contactShortcut.contactName} / {contactShortcut.phone} / LINE 搜尋：
                  {"lineSearchKeyword" in contactShortcut && contactShortcut.lineSearchKeyword
                    ? contactShortcut.lineSearchKeyword
                    : "未設定"}
                </p>
                {adminContactFeedback ? (
                  <p
                    className={`text-xs ${
                      adminContactFeedback.tone === "success" ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {adminContactFeedback.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </header>
          <main>
            <Outlet />
          </main>
        </div>
      </div>

      {shellRole === "doctor" && contactShortcut && doctorNavigationShortcut ? (
        <div className="pointer-events-none fixed right-4 top-4 z-50 md:right-6 md:top-6">
          <div className="pointer-events-auto w-[260px] rounded-[28px] border border-rose-200 bg-white/95 p-4 shadow-2xl backdrop-blur">
            <p className="text-sm font-semibold text-brand-ink">{contactShortcut.title}</p>
            <p className="mt-1 text-xs text-slate-500">{contactShortcut.subtitle}</p>
            <p className="mt-2 text-xs text-slate-500">
              目前導航：{doctorNavigationShortcut.patient.name}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              連絡窗口：{contactShortcut.contactName} / {contactShortcut.phone}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleDoctorContactAdmin}
                className="flex-1 rounded-full bg-brand-forest px-3 py-2 text-center text-sm font-semibold text-white"
              >
                {contactShortcut.primaryLabel}
              </button>
              <a
                href={`tel:${contactShortcut.phone}`}
                className="flex-1 rounded-full bg-rose-600 px-3 py-2 text-center text-sm font-semibold text-white"
              >
                {contactShortcut.secondaryLabel}
              </a>
            </div>
            {doctorContactFeedback ? (
              <p
                className={`mt-2 text-[11px] ${
                  doctorContactFeedback.tone === "success" ? "text-emerald-700" : "text-amber-700"
                }`}
              >
                {doctorContactFeedback.message}
              </p>
            ) : null}
            <p className="mt-2 text-[11px] text-slate-500">
              Google Maps 會另開分頁或外部 App；系統頁面內會持續保留這個求助按鈕。
            </p>
          </div>
        </div>
      ) : null}

      {isNotificationOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4">
          <div className="w-full max-w-3xl rounded-[32px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">Web 即時通知</p>
                <h2 className="mt-1 text-2xl font-semibold text-brand-ink">站內通知中心</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsNotificationOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉
              </button>
            </div>
            <div className="mt-6 space-y-3">
              {notificationItems.length ? (
                notificationItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-2xl border px-4 py-3 text-sm ${
                      item.tone === "pending"
                        ? "border-amber-200 bg-amber-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-brand-ink">{item.title}</p>
                      <p className="text-xs text-slate-500">{formatDateTimeFull(item.timestamp)}</p>
                    </div>
                    <p className="mt-2 text-slate-600">{item.detail}</p>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  目前沒有新的站內通知。
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isPasswordModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg rounded-[32px] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">帳號安全</p>
                <h2 className="mt-1 text-2xl font-semibold text-brand-ink">修改登入密碼</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉
              </button>
            </div>

            <div className="mt-6 space-y-4 text-sm">
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">目前密碼</span>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">新密碼</span>
                <input
                  type="password"
                  value={passwordForm.nextPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      nextPassword: event.target.value
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-brand-ink">確認新密碼</span>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                />
              </label>
              {passwordMessage ? (
                <div
                  role="status"
                  className={`rounded-2xl px-4 py-3 ${
                    passwordMessage.includes("已更新")
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border border-rose-200 bg-rose-50 text-rose-700"
                  }`}
                >
                  {passwordMessage}
                </div>
              ) : null}
              <button
                type="button"
                onClick={handleChangePassword}
                className="rounded-full bg-brand-forest px-5 py-3 font-semibold text-white"
              >
                儲存新密碼
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
