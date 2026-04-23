import type {
  GeolocationProviderAdapter,
  GeolocationProviderEvent,
  GeolocationScenarioId,
  ProviderPermissionState
} from "../types";

export class HybridGeolocationProvider implements GeolocationProviderAdapter {
  constructor(
    private readonly browserProvider: GeolocationProviderAdapter,
    private readonly fallbackProvider: GeolocationProviderAdapter
  ) {}

  private get activeProvider() {
    if (
      typeof navigator !== "undefined" &&
      "geolocation" in navigator &&
      this.browserProvider.getPermissionState() !== "unsupported"
    ) {
      return this.browserProvider;
    }
    return this.fallbackProvider;
  }

  startWatch(input: Parameters<GeolocationProviderAdapter["startWatch"]>[0]) {
    this.activeProvider.startWatch(input);
  }

  pauseWatch(watchId: string) {
    this.browserProvider.pauseWatch(watchId);
    this.fallbackProvider.pauseWatch(watchId);
  }

  resumeWatch(watchId: string) {
    this.activeProvider.resumeWatch(watchId);
  }

  stopWatch(watchId: string) {
    this.browserProvider.stopWatch(watchId);
    this.fallbackProvider.stopWatch(watchId);
  }

  subscribe(listener: (event: GeolocationProviderEvent) => void): () => void {
    const unsubscribeBrowser = this.browserProvider.subscribe(listener);
    const unsubscribeFallback = this.fallbackProvider.subscribe(listener);
    return () => {
      unsubscribeBrowser();
      unsubscribeFallback();
    };
  }

  getPermissionState(scenarioId?: GeolocationScenarioId): ProviderPermissionState {
    return this.activeProvider.getPermissionState(scenarioId);
  }
}
