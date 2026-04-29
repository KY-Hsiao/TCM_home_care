import { useAppContext } from "../../app/use-app-context";
import type { RouteMapInput } from "../../services/types";

type RouteMapPreviewCardProps = {
  route: RouteMapInput | null;
  emptyText?: string;
};

export function RouteMapPreviewCard({
  route,
  emptyText = "目前沒有可預覽的路線。"
}: RouteMapPreviewCardProps) {
  const { services } = useAppContext();

  if (!route) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        <p className="font-semibold text-brand-ink">路線圖預覽</p>
        <p className="mt-2">{emptyText}</p>
      </div>
    );
  }

  const previewState = services.maps.getRoutePreviewState(route);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-brand-ink">路線圖預覽</p>
          <p className="mt-1 text-xs text-slate-500">{route.label}</p>
          <p className="mt-1 text-xs text-slate-500">
            起點 {route.origin.address} / 停留 {previewState.waypointCount} 站 / 終點 {route.destination.address}
          </p>
        </div>
        {previewState.externalUrl ? (
          <a
            href={previewState.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-brand-forest px-4 py-2 text-sm font-semibold text-white"
          >
            用 Google 地圖開啟完整路線
          </a>
        ) : null}
      </div>

      {previewState.embedUrl ? (
        <iframe
          title={`${route.label} 路線圖預覽`}
          src={previewState.embedUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="mt-4 h-[360px] w-full rounded-3xl border border-slate-200 bg-white"
        />
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
          <p className="font-medium text-brand-ink">頁內路線圖尚未啟用</p>
          <p className="mt-2">
            {previewState.fallbackReason ?? "目前只能從外部 Google 地圖查看整條路線。"}
          </p>
        </div>
      )}
    </div>
  );
}
