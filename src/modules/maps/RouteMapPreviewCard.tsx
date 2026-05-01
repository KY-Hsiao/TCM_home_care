import { type PointerEvent, type ReactNode, useState } from "react";
import { useAppContext } from "../../app/use-app-context";
import type { RouteMapInput } from "../../services/types";

const previewCanvasWidth = 640;
const previewCanvasHeight = 480;
const previewCanvasPadding = 56;
const previewDrawableWidth = previewCanvasWidth - previewCanvasPadding * 2;
const previewDrawableHeight = previewCanvasHeight - previewCanvasPadding * 2;
const defaultPreviewZoomIndex = 1;

const previewZoomPresets = [
  { label: "廣域", scale: 1.8, zoomOffset: -1 },
  { label: "標準", scale: 1, zoomOffset: 0 },
  { label: "近距", scale: 0.72, zoomOffset: 1 },
  { label: "細節", scale: 0.52, zoomOffset: 2 }
] as const;

type PreviewPanOffset = {
  x: number;
  y: number;
};

type PreviewDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: PreviewPanOffset;
};

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

function buildPreviewBounds(route: RouteMapInput, rangeScale: number) {
  const points = buildPreviewPoints(route);
  if (points.length < 2) {
    return null;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeCenter = (minLatitude + maxLatitude) / 2;
  const longitudeCenter = (minLongitude + maxLongitude) / 2;
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.001) * rangeScale;
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.001) * rangeScale;

  return {
    points,
    latitudeCenter,
    longitudeCenter,
    latitudeSpan,
    longitudeSpan
  };
}

function buildPreviewCanvasState(route: RouteMapInput, rangeScale: number, panOffset: PreviewPanOffset) {
  const bounds = buildPreviewBounds(route, rangeScale);
  if (!bounds) {
    return null;
  }

  const centerLongitude =
    bounds.longitudeCenter - (panOffset.x / previewDrawableWidth) * bounds.longitudeSpan;
  const centerLatitude =
    bounds.latitudeCenter + (panOffset.y / previewDrawableHeight) * bounds.latitudeSpan;
  const scaledMinLatitude = centerLatitude - bounds.latitudeSpan / 2;
  const scaledMinLongitude = centerLongitude - bounds.longitudeSpan / 2;

  return {
    centerLatitude,
    centerLongitude,
    points: bounds.points.map((point) => ({
      ...point,
      x:
        previewCanvasPadding +
        ((point.longitude - scaledMinLongitude) / bounds.longitudeSpan) * previewDrawableWidth,
      y:
        previewCanvasHeight -
        previewCanvasPadding -
        ((point.latitude - scaledMinLatitude) / bounds.latitudeSpan) * previewDrawableHeight
    }))
  };
}

function buildCenterOffsetForPoint(route: RouteMapInput, rangeScale: number, target: { latitude: number; longitude: number }) {
  const bounds = buildPreviewBounds(route, rangeScale);
  if (!bounds) {
    return { x: 0, y: 0 };
  }

  return {
    x: ((bounds.longitudeCenter - target.longitude) / bounds.longitudeSpan) * previewDrawableWidth,
    y: ((target.latitude - bounds.latitudeCenter) / bounds.latitudeSpan) * previewDrawableHeight
  };
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

function buildPreviewMapBackgroundUrl(input: {
  centerLatitude: number;
  centerLongitude: number;
  points: Array<{ latitude: number; longitude: number }>;
  zoomOffset: number;
}) {
  if (!input.points.length) {
    return null;
  }

  const zoom = Math.min(18, Math.max(3, resolvePreviewMapZoom(input.points) + input.zoomOffset));

  return `https://maps.google.com/maps?q=${encodeURIComponent(
    `${input.centerLatitude},${input.centerLongitude}`
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
  const [previewZoomIndex, setPreviewZoomIndex] = useState(defaultPreviewZoomIndex);
  const [previewPanOffset, setPreviewPanOffset] = useState<PreviewPanOffset>({ x: 0, y: 0 });
  const [previewDragState, setPreviewDragState] = useState<PreviewDragState | null>(null);

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
  const previewZoom = previewZoomPresets[previewZoomIndex];
  const previewCanvasState = buildPreviewCanvasState(route, previewZoom.scale, previewPanOffset);
  const previewCanvasPoints = previewCanvasState?.points ?? [];
  const unresolvedPreviewPoints = buildUnresolvedPreviewPoints(route);
  const hasCanvasPreview = previewCanvasPoints.length >= 2;
  const previewBackgroundMapUrl = previewCanvasState
    ? buildPreviewMapBackgroundUrl({
        centerLatitude: previewCanvasState.centerLatitude,
        centerLongitude: previewCanvasState.centerLongitude,
        points: previewCanvasPoints,
        zoomOffset: previewZoom.zoomOffset
      })
    : null;
  const doctorCenterAvailable = route.origin.latitude !== null && route.origin.longitude !== null;
  const resetPreviewView = () => {
    setPreviewZoomIndex(defaultPreviewZoomIndex);
    setPreviewPanOffset({ x: 0, y: 0 });
  };
  const centerPreviewOnDoctor = () => {
    if (route.origin.latitude === null || route.origin.longitude === null) {
      return;
    }
    setPreviewPanOffset(
      buildCenterOffsetForPoint(route, previewZoom.scale, {
        latitude: route.origin.latitude,
        longitude: route.origin.longitude
      })
    );
  };
  const handlePreviewPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreviewDragState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset: previewPanOffset
    });
  };
  const handlePreviewPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!previewDragState || previewDragState.pointerId !== event.pointerId) {
      return;
    }
    setPreviewPanOffset({
      x: previewDragState.startOffset.x + event.clientX - previewDragState.startClientX,
      y: previewDragState.startOffset.y + event.clientY - previewDragState.startClientY
    });
  };
  const handlePreviewPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (previewDragState?.pointerId === event.pointerId) {
      setPreviewDragState(null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
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

      {previewState.embedUrl ? (
        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-brand-ink">Google 路徑預覽</p>
              <p className="mt-1 text-xs text-slate-500">依目前站序產生 Directions embed，供排程前確認實際路徑。</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              已啟用 Maps API
            </span>
          </div>
          <iframe
            title={`${route.label} Google 路徑預覽`}
            src={previewState.embedUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className={mediaHeightClass}
          />
        </div>
      ) : null}

      {hasCanvasPreview ? (
        <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(209,213,219,0.65),_transparent_42%),linear-gradient(180deg,_#f8fafc_0%,_#eef6f2_100%)] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-brand-ink">頁內示意路線預覽</p>
              <p className="mt-1 text-xs text-slate-500">依個案座標繪製，明確標示個案位置</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-xs text-slate-500">目前視野：{previewZoom.label}</span>
              <button
                type="button"
                onClick={() => setPreviewZoomIndex((current) => Math.min(current + 1, previewZoomPresets.length - 1))}
                disabled={previewZoomIndex === previewZoomPresets.length - 1}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                放大
              </button>
              <button
                type="button"
                onClick={() => setPreviewZoomIndex((current) => Math.max(current - 1, 0))}
                disabled={previewZoomIndex === 0}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                縮小
              </button>
              <button
                type="button"
                onClick={centerPreviewOnDoctor}
                disabled={!doctorCenterAvailable}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                醫師置中
              </button>
              <button
                type="button"
                onClick={resetPreviewView}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink"
              >
                回預設
              </button>
            </div>
          </div>
          <div
            className={`${canvasHeightClass} relative touch-none overflow-hidden border border-slate-200 ${
              previewDragState ? "cursor-grabbing" : "cursor-grab"
            }`}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onPointerUp={handlePreviewPointerUp}
            onPointerCancel={handlePreviewPointerUp}
          >
            {previewBackgroundMapUrl ? (
              <iframe
                title={`${route.label} 頁內路線底圖`}
                src={previewBackgroundMapUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="pointer-events-none absolute inset-0 h-full w-full bg-white"
              />
            ) : null}
            <svg
              viewBox="0 0 640 480"
              role="img"
              aria-label={`${route.label} 頁內路線圖預覽`}
              className="pointer-events-none absolute inset-0 h-full w-full"
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
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm">
              可拖曳移動視野
            </div>
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
        null
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
