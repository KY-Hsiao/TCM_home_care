import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppContext, type AppContextValue } from "../../app/app-context";
import type { RouteMapInput, RouteMapPreviewState } from "../../services/types";
import { RouteMapPreviewCard } from "./RouteMapPreviewCard";

const previewState: RouteMapPreviewState = {
  embedUrl: null,
  externalUrl: "https://www.google.com/maps/dir/?api=1",
  fallbackReason: null,
  waypointCount: 1
};

const route: RouteMapInput = {
  label: "測試路線",
  travelMode: "driving",
  origin: {
    address: "高雄市政府",
    label: "醫師",
    latitude: 22.6273,
    longitude: 120.3014
  },
  destination: {
    address: "高雄車站",
    label: "終點",
    latitude: 22.6395,
    longitude: 120.3021
  },
  waypoints: [
    {
      address: "高雄市旗山區延平一路 128 號",
      label: "王○珠",
      latitude: 22.8868,
      longitude: 120.4826
    }
  ]
};

function renderRouteMapPreviewCard() {
  const contextValue = {
    services: {
      maps: {
        getRoutePreviewState: () => previewState
      }
    }
  } as unknown as AppContextValue;

  return render(
    <AppContext.Provider value={contextValue}>
      <RouteMapPreviewCard route={route} />
    </AppContext.Provider>
  );
}

describe("RouteMapPreviewCard", () => {
  it("路線預覽可以縮小到更遠的全台視野", () => {
    renderRouteMapPreviewCard();

    expect(screen.getByText("目前視野：廣域")).toBeInTheDocument();
    const zoomOutButton = screen.getByRole("button", { name: "縮小" });

    ["全域", "超全域", "縣市", "全台"].forEach((zoomLabel) => {
      fireEvent.click(zoomOutButton);
      expect(screen.getByText(`目前視野：${zoomLabel}`)).toBeInTheDocument();
    });
    expect(zoomOutButton).toBeDisabled();
    expect(screen.getByRole("img", { name: /頁內路線圖預覽/ })).toBeInTheDocument();
  });
});
