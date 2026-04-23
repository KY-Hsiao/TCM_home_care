import type { Patient, VisitSchedule } from "../../domain/models";
import type { GeolocationSample, GeolocationScenario, GeolocationScenarioId } from "../types";

export const geolocationScenarios: GeolocationScenario[] = [
  {
    id: "normal_arrival_complete",
    label: "正常到達完成",
    description: "依序進入住家範圍、停留、再離開並完成訪視。"
  },
  {
    id: "gps_drift",
    label: "GPS 漂移",
    description: "先出現邊界漂移，再穩定進入範圍，測試防抖。"
  },
  {
    id: "low_accuracy",
    label: "低精度",
    description: "定位持續回傳，但 accuracy 過大，不應觸發到離判定。"
  },
  {
    id: "permission_denied",
    label: "權限拒絕",
    description: "模擬未開啟定位權限。"
  },
  {
    id: "signal_lost",
    label: "定位中斷",
    description: "前段正常，途中訊號中斷並停留在 fallback 狀態。"
  },
  {
    id: "coordinate_missing",
    label: "住家座標缺失",
    description: "病家沒有精確座標，只能顯示地址與 fallback。"
  }
];

function offsetCoordinate(
  latitude: number,
  longitude: number,
  latOffset: number,
  lngOffset: number
) {
  return {
    latitude: latitude + latOffset,
    longitude: longitude + lngOffset
  };
}

function toSample(
  scheduleId: string,
  secondOffset: number,
  coordinates: { latitude: number; longitude: number },
  accuracy: number,
  note?: string,
  kind: GeolocationSample["kind"] = "sample"
): GeolocationSample {
  const base = new Date();
  const recordedAt = new Date(base.getTime() + secondOffset * 1000).toISOString();
  return {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    accuracy,
    recorded_at: recordedAt,
    source: "gps",
    linked_visit_schedule_id: scheduleId,
    note,
    kind
  };
}

export function buildScenarioSamples(input: {
  patient: Patient;
  schedule: VisitSchedule;
  scenarioId: GeolocationScenarioId;
}): GeolocationSample[] {
  const { patient, schedule, scenarioId } = input;
  const latitude = patient.home_latitude ?? schedule.home_latitude_snapshot;
  const longitude = patient.home_longitude ?? schedule.home_longitude_snapshot;

  if (latitude === null || longitude === null) {
    return [];
  }

  const outsideFar = offsetCoordinate(latitude, longitude, 0.0012, 0.0012);
  const outsideNear = offsetCoordinate(latitude, longitude, 0.00095, 0.00095);
  const edge = offsetCoordinate(latitude, longitude, 0.0007, 0.0006);
  const insideA = offsetCoordinate(latitude, longitude, 0.00018, 0.00012);
  const insideB = offsetCoordinate(latitude, longitude, 0.0001, 0.00008);
  const insideC = offsetCoordinate(latitude, longitude, 0.00004, 0.00003);
  const completeOutA = offsetCoordinate(latitude, longitude, 0.0011, 0.001);
  const completeOutB = offsetCoordinate(latitude, longitude, 0.00125, 0.00115);
  const completeOutC = offsetCoordinate(latitude, longitude, 0.00135, 0.00125);

  switch (scenarioId) {
    case "gps_drift":
      return [
        toSample(schedule.id, 0, outsideFar, 18, "出發後定位穩定"),
        toSample(schedule.id, 5, edge, 22, "接近住家邊界"),
        toSample(schedule.id, 10, outsideNear, 19, "GPS 漂移暫時跳出"),
        toSample(schedule.id, 15, insideA, 16, "重新回到範圍"),
        toSample(schedule.id, 23, insideB, 14, "連續範圍內樣本"),
        toSample(schedule.id, 31, insideC, 13, "可確認抵達"),
        toSample(schedule.id, 95, completeOutA, 18, "離開住家"),
        toSample(schedule.id, 125, completeOutB, 16, "持續離開"),
        toSample(schedule.id, 155, completeOutC, 14, "可確認完成")
      ];
    case "low_accuracy":
      return [
        toSample(schedule.id, 0, outsideNear, 90, "精度過差"),
        toSample(schedule.id, 5, insideA, 88, "即使接近仍不可判定"),
        toSample(schedule.id, 10, insideB, 92, "持續低精度"),
        toSample(schedule.id, 15, insideC, 85, "不應觸發 arrived")
      ];
    case "signal_lost":
      return [
        toSample(schedule.id, 0, outsideFar, 18, "開始移動"),
        toSample(schedule.id, 5, outsideNear, 18, "接近住家"),
        toSample(schedule.id, 10, insideA, 15, "第一次進入"),
        {
          ...toSample(schedule.id, 15, insideA, 18, "定位中斷", "signal_lost"),
          accuracy: 999
        }
      ];
    case "normal_arrival_complete":
      return [
        toSample(schedule.id, 0, outsideFar, 18, "出發"),
        toSample(schedule.id, 5, outsideNear, 16, "接近住家"),
        toSample(schedule.id, 10, insideA, 14, "進入住家範圍"),
        toSample(schedule.id, 18, insideB, 13, "持續在範圍內"),
        toSample(schedule.id, 26, insideC, 12, "可確認抵達"),
        toSample(schedule.id, 90, completeOutA, 16, "開始離開"),
        toSample(schedule.id, 120, completeOutB, 15, "持續離開"),
        toSample(schedule.id, 150, completeOutC, 14, "可確認完成")
      ];
    case "coordinate_missing":
    case "permission_denied":
    default:
      return [];
  }
}
