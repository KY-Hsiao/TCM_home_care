import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppContext } from "../../app/use-app-context";
import { Panel } from "../../shared/ui/Panel";
import { getDefaultPassword } from "../../app/auth-storage";

const roles = [
  {
    title: "居家醫師",
    to: "/doctor/navigation",
    role: "doctor" as const,
    description: "直接進入即時導航、查看今日路線、定位與治療流程。"
  },
  {
    title: "行政管理",
    to: "/admin/dashboard",
    role: "admin" as const,
    description: "以清單、篩選與批次處理為主，查看路線、角色設置、個案資料與行政協作。"
  }
];

export function RoleSelectPage() {
  const navigate = useNavigate();
  const {
    repositories,
    session,
    login,
    isAuthenticatedForRole
  } = useAppContext();
  const doctors = repositories.patientRepository.getDoctors();
  const admins = repositories.patientRepository.getAdmins();
  const sharedAdminId = admins[0]?.id ?? "admin-001";
  const [doctorId, setDoctorId] = useState(session.activeDoctorId || doctors[0]?.id || "");
  const [doctorPassword, setDoctorPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [doctorMessage, setDoctorMessage] = useState<string | null>(null);
  const [adminMessage, setAdminMessage] = useState<string | null>(null);

  const handleLogin = (role: "doctor" | "admin") => {
    const result = login({
      role,
      userId: role === "doctor" ? doctorId : sharedAdminId,
      password: role === "doctor" ? doctorPassword : adminPassword
    });

    if (!result.success) {
      if (role === "doctor") {
        setDoctorMessage(result.message);
      } else {
        setAdminMessage(result.message);
      }
      return;
    }

    if (role === "doctor") {
      setDoctorMessage("登入成功，正在前往醫師首頁並要求定位分享。");
      setDoctorPassword("");
    } else {
      setAdminMessage("登入成功，正在前往行政首頁。");
      setAdminPassword("");
    }
    navigate(role === "doctor" ? "/doctor/navigation" : "/admin/dashboard");
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10 lg:px-6">
      <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="overflow-hidden rounded-[2rem] bg-[linear-gradient(140deg,#0f172a_0%,#1e293b_58%,#14532d_100%)] p-10 text-white shadow-card">
          <p className="text-sm tracking-[0.28em] text-brand-sand/70">TCM HOME CARE</p>
          <h1 className="mt-4 text-4xl font-bold leading-tight lg:text-5xl">
            中醫居家醫療
            <br />
            輔助系統
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-brand-sand/80">
            直接依角色登入，進入醫師端導航與回院病歷，或行政端通知中心、追蹤地圖與排程管理。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-4">
              <p className="text-xs text-brand-sand/70">醫師端</p>
              <p className="mt-2 font-semibold">導航與病歷</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-4">
              <p className="text-xs text-brand-sand/70">行政端</p>
              <p className="mt-2 font-semibold">通知與追蹤</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-4">
              <p className="text-xs text-brand-sand/70">登入方式</p>
              <p className="mt-2 font-semibold">帳密直達角色</p>
            </div>
          </div>
        </div>
        <div className="grid gap-4">
          {roles.map((role) => {
            const isDoctor = role.role === "doctor";
            const message = isDoctor ? doctorMessage : adminMessage;
            const authenticated = isAuthenticatedForRole(role.role);

            return (
            <Panel
              key={role.to}
              title={role.title}
              action={
                authenticated ? (
                  <Link
                    to={role.to}
                    className="rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
                  >
                    直接進入
                  </Link>
                ) : null
              }
            >
              <div className="space-y-3 text-sm text-slate-600">
                <p>{role.description}</p>
                {isDoctor ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block font-medium text-brand-ink">選擇醫師帳號</span>
                      <select
                        value={doctorId}
                        onChange={(event) => setDoctorId(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                      >
                        {doctors.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                      醫師登入後會立即要求手機瀏覽器定位分享。若未允許或未取得定位，系統會明確顯示目前未取得定位分享，行政端也無法看到即時位置。
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="font-medium text-brand-ink">共用行政帳號</p>
                    <p className="mt-1 text-slate-600">行政人員</p>
                  </div>
                )}
                <label className="block">
                  <span className="mb-1 block font-medium text-brand-ink">登入密碼</span>
                  <input
                    type="password"
                    value={isDoctor ? doctorPassword : adminPassword}
                    onChange={(event) =>
                      isDoctor
                        ? setDoctorPassword(event.target.value)
                        : setAdminPassword(event.target.value)
                    }
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3"
                    placeholder={`預設密碼 ${getDefaultPassword()}`}
                  />
                </label>
                <p className="text-xs text-slate-500">
                  預設密碼為 `{getDefaultPassword()}`，登入後可在頁面右上角修改密碼。
                </p>
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
                  onClick={() => handleLogin(role.role)}
                  className="rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
                >
                  登入並進入
                </button>
              </div>
            </Panel>
            );
          })}
        </div>
      </div>
    </div>
  );
}
