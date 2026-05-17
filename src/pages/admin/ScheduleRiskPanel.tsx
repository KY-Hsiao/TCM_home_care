import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { ScheduleRiskItem } from "../../domain/schedule-risk";
import { Panel } from "../../shared/ui/Panel";

const severityStyles: Record<ScheduleRiskItem["severity"], string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-50 text-slate-600"
};

const severityLabels: Record<ScheduleRiskItem["severity"], string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export function ScheduleRiskPanel({
  risks,
  title = "今日行程風險提示",
  emptyText = "目前沒有偵測到今日行程風險。",
  collapsible = false,
  defaultCollapsed = false
}: {
  risks: ScheduleRiskItem[];
  title?: string;
  emptyText?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const highestSeverity = risks.some((risk) => risk.severity === "high")
    ? "high"
    : risks.some((risk) => risk.severity === "medium")
      ? "medium"
      : risks.some((risk) => risk.severity === "low")
      ? "low"
      : null;
  const detailId = useId();

  return (
    <Panel
      title={title}
      className={collapsible && isCollapsed ? "lg:p-3" : ""}
      action={
        collapsible ? (
          <div className="flex flex-wrap items-center gap-2">
            {highestSeverity ? (
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${severityStyles[highestSeverity]}`}>
                {severityLabels[highestSeverity]}
              </span>
            ) : null}
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {risks.length} 項
            </span>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              aria-controls={detailId}
              onClick={() => setIsCollapsed((current) => !current)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink"
            >
              {isCollapsed ? "展開" : "收合"}
            </button>
          </div>
        ) : undefined
      }
    >
      <div id={detailId} className={isCollapsed ? "hidden" : "space-y-3"}>
        {!collapsible ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-brand-ink">MVP 規則檢查</p>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              {risks.length} 項
            </span>
          </div>
        ) : null}
        {collapsible && risks.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            {emptyText}
          </p>
        ) : null}
        {collapsible && risks.length > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            點選個案可前往個案管理頁處理。
          </div>
        ) : null}
        {risks.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {risks.map((risk) => {
              const content = (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-brand-ink">{risk.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{risk.summary}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${severityStyles[risk.severity]}`}
                    >
                      {severityLabels[risk.severity]}
                    </span>
                  </div>
                </>
              );

              if (risk.patientId) {
                return (
                  <Link
                    key={risk.id}
                    to={`/admin/patients/${risk.patientId}`}
                    className="block rounded-2xl border border-slate-200 bg-white p-4 text-sm transition hover:border-brand-forest/40"
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <div key={risk.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  {content}
                </div>
              );
            })}
          </div>
        ) : !collapsible ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            {emptyText}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
