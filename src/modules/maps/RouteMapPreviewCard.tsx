import type { ReactNode } from "react";
import { useAppContext } from "../../app/use-app-context";
import type { RouteMapInput } from "../../services/types";

function buildPreviewPoints(route: RouteMapInput) {
  return [
    {
      key: "origin",
      label: "起",
      pointName: route.origin.label ?? route.origin.address,
      address: route.origin.address,
      latitude: route.origin.latitude,
      longitude: route.origin.longitude
    },
    ...route.waypoints.map((waypoint, index) => ({
      key: `waypoint-${index}`,
      label: `${index + 1}`,
      pointName: waypoint.label ?? waypoint.address,
      address: waypoint.address,
      latitude: waypoint.latitude,
      longitude: waypoint.longitude
    })),
    {
      key: "destination",
      label: "終",
      pointName: route.destination.label ?? route.destination.address,
      address: route.destination.address,
      latitude: route.destination.latitude,
      longitude: route.destination.longitude
    }
  ].filter(
    (point): point is {
      key: string;
      label: string;
      pointName: string;
      address: string;
      latitude: number;
      longitude: number;
    } => point.latitude !== null && point.longitude !== null
  );
}

function buildPreviewCanvasPoints(route: RouteMapInput) {
  const points = buildPreviewPoints(route);
  if (points.length < 2) {
    return [];
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.001);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.001);
  const padding = 56;
  const width = 640;
  const height = 480;

  return points.map((point) => ({
    ...point,
    x: padding + ((point.longitude - minLongitude) / longitudeSpan) * (width - padding * 2),
    y: height - padding - ((point.latitude - minLatitude) / latitudeSpan) * (height - padding * 2)
  }));
}

function buildUnresolvedPreviewPoints(route: RouteMapInput) {
  return route.waypoints
    .map((waypoint, index) => ({
      key: `waypoint-${index}`,
      label: `${index + 1}`,
      pointName: waypoint.label ?? waypoint.address,
      address: waypoint.address,
      latitude: waypoint.latitude,
      longitude: waypoint.longitude
    }))
    .filter((point) => point.latitude === null || point.longitude === null);
}

function resolvePreviewMapZoom(points: Array<{ latitude: number; longitude: number }>) {
  if (!points.length) {
    return 15;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const maxSpan = Math.max(
    Math.max(...latitudes) - Math.min(...latitudes),
    Math.max(...longitudes) - Math.min(...longitudes)
  );

  if (maxSpan > 0.5) {
    return 10;
  }
  if (maxSpan > 0.2) {
    return 11;
  }
  if (maxSpan > 0.1) {
    return 12;
  }
  if (maxSpan > 0.05) {
    return 13;
  }
  if (maxSpan > 0.02) {
    return 14;
  }
  if (maxSpan > 0.01) {
    return 15;
  }
  return 16;
}

function buildPreviewMapBackgroundUrl(points: Array<{ latitude: number; longitude: number }>) {
  if (!points.length) {
    return null;
  }

  const centerLatitude =
    points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const centerLongitude =
    points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
  const zoom = resolvePreviewMapZoom(points);

  return `https://maps.google.com/maps?q=${encodeURIComponent(
    `${centerLatitude},${centerLongitude}`
  )}&z=${zoom}&output=embed`;
}

type RouteMapPreviewCardProps = {
  route: RouteMapInput | null;
  emptyText?: string;
  compact?: boolean;
  hidePointLegend?: boolean;
  headerActions?: ReactNode;
};

export function RouteMapPreviewCard({
  route,
  emptyText = "目前沒有可預覽的路線。",
  compact = false,
  hidePointLegend = false,
  headerActions
}: RouteMapPreviewCardProps) {
  const { services } = useAppContext();

  if (!route) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-brand-ink">路線圖預覽</p>
            <p className="mt-2">{emptyText}</p>
          </div>
          {headerActions ? <div className="flex flex-wrap justify-end gap-2">{headerActions}</div> : null}
        </div>
      </div>
    );
  }

  const previewState = services.maps.getRoutePreviewState(route);
  const previewCanvasPoints = buildPreviewCanvasPoints(route);
  const unresolvedPreviewPoints = buildUnresolvedPreviewPoints(route);
  const hasCanvasPreview = previewCanvasPoints.length >= 2;
  const previewBackgroundMapUrl = buildPreviewMapBackgroundUrl(previewCanvasPoints);
  const mediaHeightClass = compact
    ? "mt-3 aspect-[4/3] w-full min-h-[360px] max-h-[62vh] rounded-3xl border border-slate-200 bg-white"
    : "mt-4 aspect-[4/3] w-full min-h-[420px] max-h-[76vh] rounded-3xl border border-slate-200 bg-white";
  const canvasHeightClass = compact
    ? "mt-3 aspect-[4/3] w-full min-h-[360px] max-h-[62vh] rounded-2xl bg-white/70"
    : "mt-3 aspect-[4/3] w-full min-h-[420px] max-h-[76vh] rounded-2xl bg-white/70";

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-3 lg:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-brand-ink">路線圖預覽</p>
          <p className="mt-1 text-xs text-slate-500">{route.label}</p>
          <p className="mt-1 text-xs text-slate-500">
            起點 {route.origin.address} / 停留 {previewState.waypointCount} 站 / 終點 {route.destination.address}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {headerActions}
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
      </div>

      {hasCanvasPreview ? (
        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(209,213,219,0.65),_transparent_42%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f2_100%)] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-brand-ink">頁內示意路線預覽</p>
            <span className="text-xs text-slate-500">依個案座標繪製，不需額外 API key</span>
          </div>
          <div className={`${canvasHeightClass} relative overflow-hidden border border-slate-200`}>
            {previewBackgroundMapUrl ? (
              <iframe
                title={`${route.label} 頁內路線底圖`}
                src={previewBackgroundMapUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="absolute inset-0 h-full w-full bg-white"
              />
            ) : null}
            <svg
              viewBox="0 0 640 480"
              role="img"
              aria-label={`${route.label} 頁內路線圖預覽`}
              className="absolute inset-0 h-full w-full"
            >
              <defs>
                <filter id="route-preview-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0f172a" floodOpacity="0.18" />
                </filter>
              </defs>
              <polyline
                fill="none"
                stroke="#2f6f5e"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#route-preview-shadow)"
                points={previewCanvasPoints.map((point) => `${point.x},${point.y}`).join(" ")}
              />
              {previewCanvasPoints.map((point, index) => (
                <g key={point.key} filter="url(#route-preview-shadow)">
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={index === 0 || index === previewCanvasPoints.length - 1 ? 12 : 10}
                    fill={index === 0 ? "#d97706" : index === previewCanvasPoints.length - 1 ? "#111827" : "#ef4444"}
                    stroke="#ffffff"
                    strokeWidth="3"
                  />
                  <text
                    x={point.x}
                    y={point.y + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="#ffffff"
                  >
                    {point.label}
                  </text>
                  <text
                    x={Math.min(Math.max(point.x + 16, 80), 560)}
                    y={Math.max(point.y - 14, 22)}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="700"
                    fill="#0f172a"
                    stroke="#ffffff"
                    strokeWidth="4"
                    paintOrder="stroke"
                  >
                    {point.pointName}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          {hidePointLegend ? null : (
            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              {previewCanvasPoints.map((point) => (
                <div key={`${point.key}-legend`} className="rounded-2xl bg-white/80 px-3 py-2">
                  <span className="font-semibold text-brand-ink">{point.label}</span>
                  <span className="ml-2 font-semibold text-brand-ink">{point.pointName}</span>
                  <span className="ml-2">{point.address}</span>
                </div>
              ))}
              {unresolvedPreviewPoints.map((point) => (
                <div key={`${point.key}-legend-missing`} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  <span className="font-semibold">{point.label}</span>
                  <span className="ml-2 font-semibold">{point.pointName}</span>
                  <span className="ml-2">缺少座標，未畫入預覽圖，需補座標後重新排程。</span>
                </div>
              ))}
            </div>
          )}
          {previewState.externalUrl ? (
            <p className="mt-3 text-xs text-slate-500">需要實際導航時，請使用上方 Google 地圖完整路線連結。</p>
          ) : null}
        </div>
      ) : previewState.embedUrl ? (
        <iframe
          title={`${route.label} 路線圖預覽`}
          src={previewState.embedUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className={mediaHeightClass}
        />
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
          <p className="font-medium text-brand-ink">頁內路線圖暫時無法產生</p>
          <p className="mt-2">
            {previewState.fallbackReason ?? "目前只能從外部 Google 地圖查看整條路線。"}
          </p>
        </div>
      )}
    </div>
  );
}
