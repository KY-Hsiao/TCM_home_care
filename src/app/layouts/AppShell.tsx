import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { navigationByRole } from "../../shared/constants/navigation";
import { useAppContext } from "../use-app-context";
import { formatDateTimeFull } from "../../shared/utils/format";
import { isVisitFinished, isVisitUnlocked } from "../../modules/doctor/doctor-page-helpers";
import { StaffCommunicationDialog } from "../../shared/components/StaffCommunicationDialog";
import { maskPatientName } from "../../shared/utils/patient-name";
import {
  useTeamCommunicationConversation,
  useTeamCommunicationUnreadCount
} from "../../services/team-communication/use-team-communication";

type DoctorLocationSyncState = {
  status: "idle" | "requesting" | "sharing" | "denied" | "unsupported" | "error";
  message: string;
  lastUpdatedAt: string | null;
};

function resolveDoctorLocationBannerTone(status: DoctorLocationSyncState["status"]) {
  if (status === "sharing") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (status === "requesting" || status === "idle") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
}

function resolveDoctorLocationLinkedScheduleId(input: {
  doctorId: string;
  routePlanId: string | null;
  repositories: ReturnType<typeof useAppContext>["repositories"];
}) {
  const orderedSchedules = input.repositories.visitRepository.getDoctorRouteSchedules(
    input.doctorId,
    input.routePlanId
  );
  const routeEntries = orderedSchedules.map((schedule) => ({
    schedule,
    record: input.repositories.visitRepository.getVisitRecordByScheduleId(schedule.id)
  }));
  const activeEntry =
    routeEntries.find((entry) => {
      const unlocked = isVisitUnlocked(orderedSchedules, entry.schedule.id, entry.record);
      return (
        unlocked &&
        Boolean(entry.record?.departure_time) &&
        !entry.record?.arrival_time &&
        !isVisitFinished(entry.schedule.status)
      );
    }) ??
    routeEntries.find((entry) => {
      const unlocked = isVisitUnlocked(orderedSchedules, entry.schedule.id, entry.record);
      return (
        unlocked &&
        Boolean(entry.record?.arrival_time) &&
        !entry.record?.departure_from_patient_home_time &&
        !isVisitFinished(entry.schedule.status)
      );
    }) ??
    routeEntries.find((entry) => {
      const unlocked = isVisitUnlocked(orderedSchedules, entry.schedule.id, entry.record);
      return (
        unlocked &&
        !entry.record?.departure_time &&
        !entry.record?.arrival_time &&
        !isVisitFinished(entry.schedule.status)
      );
    }) ??
    routeEntries.find((entry) =>
      ["on_the_way", "tracking", "proximity_pending", "arrived", "in_treatment", "issue_pending"].includes(
        entry.schedule.status
      )
    ) ??
    null;

  return activeEntry?.schedule.id ?? null;
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    db,
    repositories,
    services,
    session,
    logout,
    changePassword,
    isAuthenticatedForRole,
    setRole
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
  const currentDoctor = doctors.find((doctor) => doctor.id === session.activeDoctorId);
  const currentAdmin =
    admins.find((admin) => admin.id === session.activeAdminId) ?? admins[0];
  const currentUserId = shellRole === "doctor" ? session.activeDoctorId : session.activeAdminId;
  const currentUserName =
    shellRole === "doctor"
      ? currentDoctor?.name
      : shellRole === "admin"
        ? "行政人員"
        : undefined;
  const activeDoctorRoutePlan =
    shellRole === "doctor"
      ? session.activeRoutePlanId
        ? repositories.visitRepository.getSavedRoutePlanById(session.activeRoutePlanId)
        : repositories.visitRepository.getActiveRoutePlan(session.activeDoctorId)
      : undefined;
  const doctorRouteSchedules =
    shellRole === "doctor"
      ? repositories.visitRepository.getDoctorRouteSchedules(
          session.activeDoctorId,
          activeDoctorRoutePlan?.id ?? null
        )
      : [];
  const activeDoctorSchedule =
    shellRole === "doctor"
      ? doctorRouteSchedules.find((schedule) =>
          ["on_the_way", "tracking", "proximity_pending", "arrived", "in_treatment"].includes(schedule.status)
        ) ??
        doctorRouteSchedules.find((schedule) => {
          const record = repositories.visitRepository.getVisitRecordByScheduleId(schedule.id);
          return isVisitUnlocked(doctorRouteSchedules, schedule.id, record) && !isVisitFinished(schedule.status);
        }) ??
        null
      : null;
  const activeDoctorScheduleDetail =
    activeDoctorSchedule && shellRole === "doctor"
      ? repositories.visitRepository.getScheduleDetail(activeDoctorSchedule.id)
      : undefined;
  const latestDoctorLocation =
    shellRole === "doctor"
      ? repositories.visitRepository
          .getDoctorLocationLogs(session.activeDoctorId)
          .sort((left, right) => new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime())[0]
      : undefined;
  const doctorNavigationSummaryItems =
    shellRole === "doctor" && location.pathname.startsWith("/doctor/navigation")
      ? [
          `目前帳號：${currentDoctor?.name ?? "未指定醫師"}`,
          `定位座標：${
            latestDoctorLocation
              ? services.maps.buildCoordinateLabel(latestDoctorLocation.latitude, latestDoctorLocation.longitude)
              : "尚未取得精確座標"
          }`,
          `最後更新：${
            latestDoctorLocation ? formatDateTimeFull(latestDoctorLocation.recorded_at) : "尚未回傳"
          }`,
          `定位精度：${latestDoctorLocation ? `${Math.round(latestDoctorLocation.accuracy)} 公尺` : "尚未回傳"}`,
          `資料來源：${latestDoctorLocation?.source ?? "等待定位中"}`,
          activeDoctorSchedule && activeDoctorScheduleDetail
            ? `同步案件：第 ${activeDoctorSchedule.route_order} 站 / ${maskPatientName(activeDoctorScheduleDetail.patient.name)}`
            : activeDoctorRoutePlan && doctorRouteSchedules.every((schedule) => isVisitFinished(schedule.status))
              ? "同步案件：返院導航"
              : "同步案件：等待路線"
        ]
      : [];
  const isDoctorShell = shellRole === "doctor";
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isDoctorQuickSummaryOpen, setIsDoctorQuickSummaryOpen] = useState(false);
  const [isStaffCommunicationOpen, setIsStaffCommunicationOpen] = useState(false);
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
  const repositoriesRef = useRef(repositories);
  const lastLocationWriteAtRef = useRef(0);

  repositoriesRef.current = repositories;

  useEffect(() => {
    if (shellRole && session.role !== shellRole) {
      setRole(shellRole);
    }
  }, [session.role, setRole, shellRole]);

  useEffect(() => {
    if (shellRole !== "doctor" || !session.authenticatedDoctorId) {
      return;
    }

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setDoctorLocationSync({
        status: "unsupported",
        message: "目前未取得定位分享：這台裝置不支援瀏覽器定位，行政端無法看到即時位置。",
        lastUpdatedAt: null
      });
      return;
    }

    setDoctorLocationSync({
      status: "requesting",
      message: "醫師登入後正在要求定位授權；若未允許定位，行政端將無法看到即時位置。",
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
        const linkedScheduleId = resolveDoctorLocationLinkedScheduleId({
          doctorId: session.activeDoctorId,
          routePlanId: session.activeRoutePlanId,
          repositories: repositoriesRef.current
        });
        const locationSample = {
          doctor_id: session.activeDoctorId,
          recorded_at: recordedAt,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: position.coords.accuracy <= 50 ? "gps" : "network",
          linked_visit_schedule_id: linkedScheduleId
        } as const;

        if (services.doctorLocationSync.mode === "api_polling") {
          repositoriesRef.current.visitRepository.appendDoctorLocationLog({
            id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ...locationSample
          });
          Promise.resolve(services.doctorLocationSync.pushSample(locationSample)).catch(() => {
            setDoctorLocationSync({
              status: "error",
              message: "定位已取得，但同步到行政追蹤頁失敗，請確認網路或稍後重試。",
              lastUpdatedAt: recordedAt
            });
          });
        } else {
          services.doctorLocationSync.pushSample(locationSample);
        }
      },
      (error) => {
        if (error.code === 1) {
          setDoctorLocationSync({
            status: "denied",
            message: "目前未取得定位分享：醫師端尚未允許定位，行政端目前無法看到即時位置。",
            lastUpdatedAt: null
          });
          return;
        }
        setDoctorLocationSync({
          status: "error",
          message: "目前未取得定位分享：定位共享中斷，請確認手機定位與網路。",
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
  }, [session.activeDoctorId, session.activeRoutePlanId, session.authenticatedDoctorId, shellRole]);

  const doctorCommunicationContextLabel =
    activeDoctorScheduleDetail
      ? `第 ${activeDoctorScheduleDetail.schedule.route_order} 站 ${maskPatientName(activeDoctorScheduleDetail.patient.name)}`
      : activeDoctorRoutePlan
        ? `${activeDoctorRoutePlan.route_name} / 返院或待命`
        : "院內行政協調";

  const createDoctorAdminContactLog = async (input: {
    channel: "phone" | "web_notice";
    subject: string;
    content: string;
    outcome: string;
  }) => {
    if (!currentDoctor || !currentAdmin) {
      return;
    }
    const now = new Date().toISOString();
    await shellConversation.createMessage({
      id: `staff-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      doctorId: currentDoctor.id,
      adminUserId: currentAdmin.id,
      senderRole: "doctor",
      senderUserId: currentDoctor.id,
      receiverRole: "admin",
      receiverUserId: currentAdmin.id,
      patientId: activeDoctorScheduleDetail?.patient.id ?? null,
      visitScheduleId: activeDoctorScheduleDetail?.schedule.id ?? null,
      channel: input.channel,
      subject: input.subject,
      content: input.content,
      outcome: input.outcome,
      messageType: "text",
      callStatus: null,
      contactedAt: now
    });
  };

  const notificationCenterPath =
    shellRole === "doctor" ? "/doctor/reminders" : shellRole === "admin" ? "/admin/reminders" : null;
  const unreadNotificationCount = useMemo(() => {
    if (!shellRole || !currentUserId) {
      return 0;
    }
    return repositories.notificationRepository
      .getNotificationCenterItems(shellRole, currentUserId)
      .filter((item) => item.is_unread && item.role === shellRole).length;
  }, [currentUserId, repositories, shellRole]);
  const notificationSummaryLabel =
    unreadNotificationCount > 0 ? `通知中心（未讀 ${unreadNotificationCount}）` : "通知中心";
  const isTeamCommunicationRoute =
    location.pathname === "/doctor/team-communication" || location.pathname === "/admin/team-communication";
  const teamCommunicationUnread = useTeamCommunicationUnreadCount({
    db,
    repositories,
    role: shellRole === "admin" ? "admin" : "doctor",
    userId: currentUserId ?? "",
    enabled: Boolean(shellRole && currentUserId),
    doctorId: shellRole === "doctor" ? currentUserId ?? undefined : undefined,
    adminUserId: shellRole === "admin" ? currentUserId ?? undefined : currentAdmin?.id
  });
  const shellConversation = useTeamCommunicationConversation({
    db,
    repositories,
    doctorId: currentDoctor?.id ?? "",
    adminUserId: currentAdmin?.id ?? "",
    viewerRole: "doctor",
    viewerUserId: currentDoctor?.id ?? "",
    enabled: Boolean(shellRole === "doctor" && currentDoctor && currentAdmin)
  });
  const doctorTeamCommunicationUnreadCount = isTeamCommunicationRoute ? 0 : teamCommunicationUnread.count;

  useEffect(() => {
    if (!isTeamCommunicationRoute || !shellRole || !currentUserId) {
      return;
    }

    void teamCommunicationUnread.refresh();
    const timeoutId = window.setTimeout(() => {
      void teamCommunicationUnread.refresh();
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [currentUserId, isTeamCommunicationRoute, shellRole]);

  useEffect(() => {
    if (isTeamCommunicationRoute || !shellRole || !currentUserId) {
      return;
    }

    // 離開團隊通訊頁後再補抓一次全域未讀數，避免頁內已讀同步完成較慢時，
    // 左側標籤仍被舊的未讀值短暫蓋回去。
    void teamCommunicationUnread.refresh();
  }, [currentUserId, isTeamCommunicationRoute, location.pathname, shellRole]);

  const handleLogout = () => {
    if (!shellRole) {
      return;
    }
    logout(shellRole);
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
    <div
      className={`bg-brand-sand text-brand-ink ${
        isDoctorShell ? "min-h-dvh overflow-x-hidden" : "h-dvh overflow-hidden"
      }`}
    >
      <div
        className={`mx-auto grid max-w-[1600px] min-w-0 overflow-x-hidden ${
            isDoctorShell
              ? "min-h-dvh items-start gap-2 px-2 py-2 lg:grid-cols-[260px_1fr] lg:gap-3 lg:px-3 lg:py-3"
              : "h-dvh min-h-0 items-stretch gap-4 px-3 py-3 lg:grid-cols-[260px_1fr] lg:px-4"
        }`}
      >
        <aside
          className={`min-w-0 overflow-hidden border border-white/70 bg-brand-ink text-white shadow-card ${
            isDoctorShell
              ? "rounded-[1.35rem] p-3 pb-2.5 lg:rounded-[2rem] lg:p-6"
              : "h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[1.75rem] p-4 lg:p-5"
          }`}
        >
          <div>
            <p className={`tracking-[0.18em] text-brand-sand/70 ${isDoctorShell ? "text-xs" : "text-sm"}`}>
              中醫居家輔助系統
            </p>
            <h1 className={`mt-1.5 font-bold ${isDoctorShell ? "text-lg leading-tight lg:mt-2 lg:text-2xl" : "text-2xl"}`}>
              中醫居家輔助系統
            </h1>
            <p className={`mt-1.5 text-brand-sand/80 ${isDoctorShell ? "text-[11px] lg:mt-2 lg:text-sm" : "text-sm"}`}>
              {shellRole === "doctor"
                ? "這是醫師端介面。"
                : shellRole === "admin"
                  ? "這是行政端介面。"
                  : "這是系統共用介面。"}
            </p>
          </div>

          <nav
            className={
              isDoctorShell
                ? "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:mt-5 lg:block lg:space-y-2"
                : "mt-4 space-y-2"
            }
          >
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `${isDoctorShell ? "block min-w-0 rounded-2xl px-3 py-2 text-sm lg:rounded-3xl lg:px-4 lg:py-3" : "block rounded-3xl px-4 py-3"} transition ${
                    isActive ? "bg-white text-brand-ink" : "bg-white/5 hover:bg-white/10"
                  }`
                }
              >
                <div className="flex items-center justify-between gap-2 font-semibold">
                  <span className="min-w-0 break-words">{item.label}</span>
                  {item.to === notificationCenterPath && unreadNotificationCount > 0 ? (
                    <span className="rounded-full bg-brand-coral px-2 py-0.5 text-[11px] font-semibold text-white">
                      {unreadNotificationCount}
                    </span>
                  ) : shellRole === "doctor" &&
                    item.to === "/doctor/team-communication" &&
                    doctorTeamCommunicationUnreadCount > 0 ? (
                    <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {doctorTeamCommunicationUnreadCount}
                    </span>
                  ) : null}
                </div>
                <div
                  className={`${isDoctorShell ? "mt-1 hidden min-w-0 break-words text-[11px] lg:block" : "mt-1 text-xs"} ${
                    location.pathname === item.to ? "text-slate-500" : "text-brand-sand/70"
                  }`}
                >
                  {item.description}
                </div>
              </NavLink>
            ))}
          </nav>
          {shellRole === "doctor" ? (
            <div className="mt-3 space-y-2.5 lg:mt-6 lg:space-y-3">
              <div className="rounded-2xl bg-white/10 p-2.5 text-sm lg:rounded-3xl lg:p-4">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full rounded-2xl bg-white px-4 py-2 font-semibold text-brand-ink lg:py-2.5"
                >
                  登出
                </button>
              </div>
              <div className="rounded-[1.35rem] bg-white/95 p-3 pb-2.5 text-brand-ink shadow-sm lg:rounded-[1.75rem] lg:p-5">
                <div className="text-[13px] text-slate-500 lg:text-sm">
                  目前登入醫師：{currentUserName ?? "未登入"}
                </div>
                <div className="mt-2.5 grid grid-cols-1 gap-2">
                  <Link
                    to="/doctor/reminders"
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-center text-sm font-semibold text-brand-ink lg:py-2.5"
                  >
                    {notificationSummaryLabel}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordMessage(null);
                      setIsPasswordModalOpen(true);
                    }}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-ink lg:py-2.5"
                  >
                    修改密碼
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsStaffCommunicationOpen(true)}
                    className={`rounded-2xl border px-4 py-2 text-sm font-semibold lg:py-2.5 ${
                      doctorTeamCommunicationUnreadCount > 0
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-slate-200 bg-white text-brand-ink"
                    }`}
                  >
                    {doctorTeamCommunicationUnreadCount > 0
                      ? `團隊通訊（新訊息 ${doctorTeamCommunicationUnreadCount}）`
                      : "團隊通訊"}
                  </button>
                </div>
                {doctorNavigationSummaryItems.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setIsDoctorQuickSummaryOpen(true)}
                    className="mt-2.5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-brand-ink lg:mt-3 lg:py-2.5"
                  >
                    快捷摘要
                  </button>
                ) : null}
                <div
                  className={`mt-2.5 rounded-2xl border px-4 py-2 text-sm ${resolveDoctorLocationBannerTone(
                    doctorLocationSync.status
                  )} lg:mt-3 lg:py-2.5`}
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-1">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-ink">醫師手機定位共享</p>
                      <p className="mt-0.5 text-xs leading-4 lg:leading-5">{doctorLocationSync.message}</p>
                    </div>
                    <p className="text-[11px] text-slate-500 sm:shrink-0">
                      最後更新：{formatDateTimeFull(doctorLocationSync.lastUpdatedAt)}
                    </p>
                  </div>
                </div>
                {unreadNotificationCount > 0 ? (
                  <Link
                    to="/doctor/reminders"
                    className="mt-2.5 block rounded-2xl border border-brand-coral/30 bg-rose-50 px-4 py-3 text-sm text-rose-700 lg:mt-3"
                  >
                    目前有 {unreadNotificationCount} 則未讀通知，請先查看通知中心。
                  </Link>
                ) : null}
                {doctorTeamCommunicationUnreadCount > 0 ? (
                  <Link
                    to="/doctor/team-communication"
                    className="mt-2.5 block rounded-2xl border border-rose-300 bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-700 lg:mt-3"
                  >
                    行政人員剛送來 {doctorTeamCommunicationUnreadCount} 則未讀團隊通訊，請立即查看。
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </aside>

        <div
          className={`min-w-0 ${
            isDoctorShell ? "space-y-3 lg:space-y-4" : "h-[calc(100dvh-1.5rem)] min-h-0 space-y-4 overflow-y-auto pr-1"
          }`}
        >
          {shellRole !== "doctor" ? (
            <header className="rounded-[1.5rem] border border-white/70 bg-white/90 p-3 shadow-card backdrop-blur lg:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-start">
                <div className="grid gap-2 md:grid-cols-[160px_160px_auto]">
                  <Link
                    to="/admin/reminders"
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-brand-ink"
                  >
                    {notificationSummaryLabel}
                  </Link>
                  {shellRole ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordMessage(null);
                        setIsPasswordModalOpen(true);
                      }}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-ink"
                    >
                      修改密碼
                    </button>
                  ) : null}
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
              {unreadNotificationCount > 0 ? (
                <Link
                  to="/admin/reminders"
                  className="rounded-2xl border border-brand-coral/30 bg-rose-50 px-4 py-3 text-sm text-rose-700"
                >
                  目前有 {unreadNotificationCount} 則未讀通知，請先查看通知中心。
                </Link>
              ) : null}
            </header>
          ) : null}
          <main className="min-w-0 pb-1">
            <Outlet />
          </main>
        </div>
      </div>

      {shellRole === "doctor" && isDoctorQuickSummaryOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg rounded-[1.5rem] bg-white p-5 shadow-2xl lg:rounded-[2rem] lg:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-coral">快捷摘要</p>
                <h2 className="mt-1 text-xl font-semibold text-brand-ink">導航同步摘要</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDoctorQuickSummaryOpen(false)}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200"
              >
                關閉
              </button>
            </div>
            <div className="mt-4 space-y-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              {doctorNavigationSummaryItems.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {shellRole === "doctor" && isStaffCommunicationOpen && currentDoctor && currentAdmin ? (
        <StaffCommunicationDialog
          counterpartLabel="行政人員"
          currentUserLabel={currentDoctor.name}
          contextLabel={doctorCommunicationContextLabel}
          doctorId={currentDoctor.id}
          adminUserId={currentAdmin.id}
          logs={shellConversation.messages}
          unreadConversationCount={shellConversation.unreadCount}
          syncError={shellConversation.syncError}
          lastSyncedAt={shellConversation.lastSyncedAt}
          onConversationViewed={() => {
            void shellConversation.markConversationRead();
            void teamCommunicationUnread.refresh();
          }}
          onClose={() => setIsStaffCommunicationOpen(false)}
          onCreateLog={createDoctorAdminContactLog}
        />
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
