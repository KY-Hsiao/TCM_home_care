import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { Panel } from "../../shared/ui/Panel";
import { getDefaultPassword } from "../../app/auth-storage";

type LoginRole = "doctor" | "admin";

type AccountOption = {
  key: string;
  role: LoginRole;
  userId: string;
  label: string;
  description: string;
  to: string;
};

function buildAccountKey(role: LoginRole, userId: string) {
  return `${role}:${userId}`;
}

function parseAccountKey(key: string): { role: LoginRole; userId: string } {
  const [role, userId] = key.split(":");
  return {
    role: role === "admin" ? "admin" : "doctor",
    userId: userId ?? ""
  };
}

export function RoleSelectPage() {
  const navigate = useNavigate();
  const { repositories, session, login } = useAppContext();
  const doctors = repositories.patientRepository.getDoctors();
  const admins = repositories.patientRepository.getAdmins();
  const primaryAdmin = admins[0];
  const accountOptions: AccountOption[] = [
    ...doctors.map((doctor) => ({
      key: buildAccountKey("doctor", doctor.id),
      role: "doctor" as const,
      userId: doctor.id,
      label: `醫師 - ${doctor.name}`,
      description: "進入醫師端導航、今日路線、定位與治療流程。",
      to: "/doctor/navigation"
    })),
    ...(primaryAdmin
      ? [
          {
            key: buildAccountKey("admin", primaryAdmin.id),
            role: "admin" as const,
            userId: primaryAdmin.id,
            label: "行政人員",
            description: "進入行政端通知中心、追蹤地圖、排程管理與行政協作。",
            to: "/admin/dashboard"
          }
        ]
      : [])
  ];
  const defaultAccountKey =
    session.role === "admin"
      ? buildAccountKey("admin", primaryAdmin?.id || "admin-001")
      : buildAccountKey("doctor", session.activeDoctorId || doctors[0]?.id || "");
  const [selectedAccountKey, setSelectedAccountKey] = useState(
    accountOptions.some((account) => account.key === defaultAccountKey)
      ? defaultAccountKey
      : accountOptions[0]?.key ?? ""
  );
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const selectedAccount =
    accountOptions.find((account) => account.key === selectedAccountKey) ?? accountOptions[0];
  const selectedUnreadCount = selectedAccount
    ? repositories.notificationRepository
        .getNotificationCenterItems(selectedAccount.role, selectedAccount.userId)
        .filter((item) => item.is_unread && item.role === selectedAccount.role).length
    : 0;
  const authenticated =
    selectedAccount?.role === "doctor"
      ? session.authenticatedDoctorId === selectedAccount.userId
      : session.authenticatedAdminId === selectedAccount?.userId;

  const handleLogin = () => {
    if (!selectedAccount) {
      setMessage("找不到可登入的帳號，請先建立醫師或行政帳號。");
      return;
    }
    const { role, userId } = parseAccountKey(selectedAccount.key);
    const result = login({
      role,
      userId,
      password
    });

    if (!result.success) {
      setMessage(result.message);
      return;
    }

    setMessage(
      role === "doctor"
        ? "登入成功，正在前往醫師首頁並要求定位分享。"
        : "登入成功，正在前往行政首頁。"
    );
    setPassword("");
    navigate(role === "doctor" ? "/doctor/navigation" : "/admin/dashboard");
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl items-center px-3 py-4 sm:px-4 lg:px-6">
      <Panel
        title="登入系統"
        className="w-full"
        action={
          authenticated ? (
            <Link
              to={selectedAccount?.to ?? "/doctor/navigation"}
              className="rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
            >
              直接進入
            </Link>
          ) : null
        }
      >
        <div className="grid gap-0 overflow-hidden rounded-[1.35rem] lg:grid-cols-[0.85fr_1.15fr] lg:rounded-[1.75rem]">
          <div className="bg-[linear-gradient(140deg,#0f172a_0%,#1e293b_62%,#14532d_100%)] px-5 py-5 text-white lg:px-6 lg:py-6">
            <p className="text-xs font-semibold tracking-[0.18em] text-brand-sand/70">
              中醫居家輔助系統
            </p>
            <h1 className="mt-2 text-2xl font-bold leading-tight lg:text-3xl">帳號登入</h1>
            <p className="mt-3 text-sm leading-6 text-brand-sand/80">
              選擇帳號後輸入密碼，即可進入對應工作頁。
            </p>
            <div className="mt-4 rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
              <p className="text-xs text-brand-sand/70">目前帳號</p>
              <p className="mt-1 text-base font-semibold">{selectedAccount?.label ?? "尚無帳號"}</p>
              <p className="mt-2 text-xs leading-5 text-brand-sand/75">
                {selectedAccount?.description ?? "請先建立可登入帳號。"}
              </p>
            </div>
          </div>

          <div className="space-y-3 px-5 py-5 text-sm text-slate-600 lg:px-6 lg:py-6">
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">選擇帳號</span>
              <select
                value={selectedAccountKey}
                onChange={(event) => {
                  setSelectedAccountKey(event.target.value);
                  setMessage(null);
                }}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                {accountOptions.map((account) => (
                  <option key={account.key} value={account.key}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-brand-ink">登入密碼</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                placeholder={`預設密碼 ${getDefaultPassword()}`}
              />
            </label>
            <p className="text-xs text-slate-500">
              預設密碼為 `{getDefaultPassword()}`，登入後可在頁面右上角修改密碼。
            </p>
            {selectedAccount?.role === "doctor" ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                醫師登入後會立即要求手機瀏覽器定位分享。若未允許或未取得定位，系統會明確顯示目前未取得定位分享，行政端也無法看到即時位置。
              </div>
            ) : null}
            {selectedUnreadCount > 0 && selectedAccount ? (
              <div className="rounded-2xl border border-brand-coral/30 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {selectedAccount.label} 目前有 {selectedUnreadCount} 則未讀通知，登入後請先查看通知中心。
              </div>
            ) : null}
            {message ? (
              <div
                role="status"
                className={`rounded-2xl px-4 py-3 text-sm ${
                  message.includes("成功")
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {message}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleLogin}
              disabled={!selectedAccount}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"
            >
              登入並進入
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
