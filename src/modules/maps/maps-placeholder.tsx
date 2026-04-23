import type { DoctorLocationLog } from "../../domain/models";
import { Panel } from "../../shared/ui/Panel";
import { formatDateTime } from "../../shared/utils/format";

type MapsPlaceholderProps = {
  title: string;
  logs?: DoctorLocationLog[];
};

export function MapsPlaceholder({ title, logs = [] }: MapsPlaceholderProps) {
  return (
    <Panel title={title}>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="min-h-72 rounded-3xl border border-dashed border-brand-moss/40 bg-gradient-to-br from-brand-sand to-white p-6">
          <p className="text-sm text-slate-500">地圖區塊預留</p>
          <p className="mt-3 max-w-lg text-sm text-slate-600">
            未來可串接 Google Maps、Geolocation 與醫師到離定位判斷。MVP 先保留地圖卡與座標清單。
          </p>
        </div>
        <div className="space-y-3">
          {logs.slice(0, 6).map((log) => (
            <div key={log.id} className="rounded-2xl bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-brand-ink">{formatDateTime(log.recorded_at)}</p>
              <p className="mt-1 text-slate-600">
                {log.latitude.toFixed(4)}, {log.longitude.toFixed(4)} / 精度 {log.accuracy}m
              </p>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
