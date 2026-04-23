import { buildScenarioSamples } from "./scenarios";
import type {
  GeolocationProviderAdapter,
  GeolocationProviderEvent,
  GeolocationScenarioId,
  ProviderPermissionState
} from "../types";

type Listener = (event: GeolocationProviderEvent) => void;

type WatchState = {
  input: Parameters<GeolocationProviderAdapter["startWatch"]>[0];
  samples: ReturnType<typeof buildScenarioSamples>;
  cursor: number;
  intervalId: ReturnType<typeof setInterval> | null;
  paused: boolean;
};

export class MockGeolocationProvider implements GeolocationProviderAdapter {
  private listeners = new Set<Listener>();

  private watches = new Map<string, WatchState>();

  private emit(event: GeolocationProviderEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  private run(watchId: string) {
    const state = this.watches.get(watchId);
    if (!state || state.intervalId) {
      return;
    }

    state.intervalId = setInterval(() => {
      const current = this.watches.get(watchId);
      if (!current || current.paused) {
        return;
      }

      const nextSample = current.samples[current.cursor];
      if (!nextSample) {
        this.stopWatch(watchId);
        this.emit({
          type: "completed",
          watchId,
          scheduleId: current.input.scheduleId
        });
        return;
      }

      this.emit({
        type: "sample",
        watchId,
        scheduleId: current.input.scheduleId,
        sample: nextSample
      });
      current.cursor += 1;
    }, 300);
  }

  startWatch(input: Parameters<GeolocationProviderAdapter["startWatch"]>[0]) {
    if (input.scenarioId === "permission_denied") {
      this.emit({
        type: "permission_denied",
        watchId: input.watchId,
        scheduleId: input.scheduleId,
        message: "模擬定位權限未開啟。"
      });
      return;
    }

    const samples = buildScenarioSamples({
      patient: input.patient,
      schedule: input.schedule,
      scenarioId: input.scenarioId
    });

    this.stopWatch(input.watchId);
    this.watches.set(input.watchId, {
      input,
      samples,
      cursor: 0,
      intervalId: null,
      paused: false
    });
    this.run(input.watchId);
  }

  pauseWatch(watchId: string) {
    const state = this.watches.get(watchId);
    if (!state) {
      return;
    }
    state.paused = true;
  }

  resumeWatch(watchId: string) {
    const state = this.watches.get(watchId);
    if (!state) {
      return;
    }
    state.paused = false;
    this.run(watchId);
  }

  stopWatch(watchId: string) {
    const state = this.watches.get(watchId);
    if (!state) {
      return;
    }
    if (state.intervalId) {
      clearInterval(state.intervalId);
    }
    this.watches.delete(watchId);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getPermissionState(scenarioId?: GeolocationScenarioId): ProviderPermissionState {
    if (scenarioId === "permission_denied") {
      return "denied";
    }
    return "granted";
  }
}
