import { useAppContext } from "../../app/use-app-context";
import type { Patient, VisitSchedule } from "../../domain/models";

type LocationSummaryCardProps = {
  patient: Patient;
  schedule: VisitSchedule;
  latestOrigin?: {
    latitude: number | null;
    longitude: number | null;
  };
};

export function LocationSummaryCard({
  patient,
  schedule,
  latestOrigin
}: LocationSummaryCardProps) {
  const { services } = useAppContext();
  const mapUrl = services.maps.buildPatientMapUrl({
    address: patient.home_address,
    locationKeyword: patient.location_keyword,
    latitude: patient.home_latitude,
    longitude: patient.home_longitude
  });
  const navigationUrl = services.maps.buildNavigationUrl({
    destinationAddress: patient.home_address,
    destinationKeyword: schedule.location_keyword_snapshot,
    destinationLatitude: schedule.home_latitude_snapshot,
    destinationLongitude: schedule.home_longitude_snapshot,
    originLatitude: latestOrigin?.latitude ?? null,
    originLongitude: latestOrigin?.longitude ?? null
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <p className="font-semibold text-brand-ink">地址與定位資訊</p>
      <p className="mt-2 text-slate-600">{patient.home_address}</p>
      <p className="mt-1 text-slate-500">定位關鍵字：{patient.location_keyword}</p>
      <p className="mt-1 text-slate-500">
        座標：{services.maps.buildCoordinateLabel(schedule.home_latitude_snapshot, schedule.home_longitude_snapshot)}
      </p>
      <p className="mt-1 text-slate-500">
        geocoding：{patient.geocoding_status} / geofence 半徑：{schedule.arrival_radius_meters}m
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={mapUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-full bg-white px-3 py-2 font-medium text-brand-forest ring-1 ring-slate-200"
        >
          個案地圖連結
        </a>
        <a
          href={navigationUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-full bg-white px-3 py-2 font-medium text-brand-forest ring-1 ring-slate-200"
        >
          從目前位置導航
        </a>
      </div>
    </div>
  );
}
