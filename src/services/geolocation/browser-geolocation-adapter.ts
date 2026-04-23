import type {
  GeolocationProviderAdapter,
  GeolocationProviderEvent,
  ProviderPermissionState
} from "../types";

type Listener = (event: GeolocationProviderEvent) => void;

type BrowserWatchState = {
  input: Parameters<GeolocationProviderAdapter["startWatch"]>[0];
  browserWatchId: number | null;
  paused: boolean;
};

export class BrowserGeolocationAdapter implements GeolocationProviderAdapter {
  private listeners = new Set<Listener>();

  private watches = new Map<string, BrowserWatchState>();

  private lastPermissionState: ProviderPermissionState =
    typeof navigator !== "undefined" && "geolocation" in navigator ? "prompt" : "unsupported";

  private emit(event: GeolocationProviderEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  private clearBrowserWatch(watchId: string) {
    const state = this.watches.get(watchId);
    if (!state?.browserWatchId || typeof navigator === "undefined" || !("geolocation" in navigator)) {
      return;
    }
    navigator.geolocation.clearWatch(state.browserWatchId);
    state.browserWatchId = null;
  }

  private attachWatch(watchId: string) {
    const state = this.watches.get(watchId);
    if (
      !state ||
      state.paused ||
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    ) {
      return;
    }

    state.browserWatchId = navigator.geolocation.watchPosition(
      (position) => {
        this.lastPermissionState = "granted";
        this.emit({
          type: "sample",
          watchId,
          scheduleId: state.input.scheduleId,
          sample: {
            kind: "sample",
            recorded_at: new Date(position.timestamp).toISOString(),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            source: position.coords.accuracy <= 30 ? "gps" : "network",
            linked_visit_schedule_id: state.input.scheduleId
          }
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          this.lastPermissionState = "denied";
          this.emit({
            type: "permission_denied",
            watchId,
            scheduleId: state.input.scheduleId,
            message: "醫師端尚未允許定位權限，請在手機瀏覽器開啟位置分享。"
          });
          return;
        }

        this.emit({
          type: "sample",
          watchId,
          scheduleId: state.input.scheduleId,
          sample: {
            kind: "signal_lost",
            recorded_at: new Date().toISOString(),
            latitude: 0,
            longitude: 0,
            accuracy: Number.MAX_SAFE_INTEGER,
            source: "network",
            linked_visit_schedule_id: state.input.scheduleId,
            note: error.message
          }
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
      }
    );
  }

  startWatch(input: Parameters<GeolocationProviderAdapter["startWatch"]>[0]) {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      this.lastPermissionState = "unsupported";
      this.emit({
        type: "permission_denied",
        watchId: input.watchId,
        scheduleId: input.scheduleId,
        message: "目前裝置或瀏覽器不支援定位功能。"
      });
      return;
    }

    this.stopWatch(input.watchId);
    this.watches.set(input.watchId, {
      input,
      browserWatchId: null,
      paused: false
    });
    this.attachWatch(input.watchId);
  }

  pauseWatch(watchId: string) {
    const state = this.watches.get(watchId);
    if (!state) {
      return;
    }
    state.paused = true;
    this.clearBrowserWatch(watchId);
  }

  resumeWatch(watchId: string) {
    const state = this.watches.get(watchId);
    if (!state) {
      return;
    }
    state.paused = false;
    this.attachWatch(watchId);
  }

  stopWatch(watchId: string) {
    this.clearBrowserWatch(watchId);
    this.watches.delete(watchId);
  }

  subscribe(listener: (event: GeolocationProviderEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getPermissionState(): ProviderPermissionState {
    return this.lastPermissionState;
  }
}
