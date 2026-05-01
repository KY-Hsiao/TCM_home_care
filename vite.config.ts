import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
  plugins: [
    react(),
    {
      name: "local-geocode-api",
      configureServer(server) {
        server.middlewares.use("/api/maps/geocode", async (request, response) => {
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.setHeader("Allow", "POST");
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
          }

          let rawBody = "";
          request.on("data", (chunk) => {
            rawBody += chunk;
          });
          request.on("end", async () => {
            const apiKey =
              process.env.GOOGLE_MAPS_API_KEY ||
              process.env.VITE_GOOGLE_MAPS_API_KEY ||
              env.GOOGLE_MAPS_API_KEY ||
              env.VITE_GOOGLE_MAPS_API_KEY ||
              "";
            if (!apiKey.trim()) {
              response.statusCode = 503;
              response.setHeader("Content-Type", "application/json");
              response.end(
                JSON.stringify({
                  reason: "API_KEY_MISSING",
                  error: "尚未設定 GOOGLE_MAPS_API_KEY 或 VITE_GOOGLE_MAPS_API_KEY，無法補座標。"
                })
              );
              return;
            }

            const address = String(JSON.parse(rawBody || "{}")?.address ?? "").trim();
            if (!address) {
              response.statusCode = 400;
              response.setHeader("Content-Type", "application/json");
              response.end(JSON.stringify({ reason: "ADDRESS_MISSING", error: "缺少地址，無法補座標。" }));
              return;
            }

            try {
              const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
              url.searchParams.set("address", address);
              url.searchParams.set("key", apiKey);
              url.searchParams.set("language", "zh-TW");
              url.searchParams.set("region", "tw");
              const googleResponse = await fetch(url.toString());
              const payload = await googleResponse.json();
              const firstResult = payload.status === "OK" ? payload.results?.[0] : null;
              const location = firstResult?.geometry?.location;
              response.setHeader("Content-Type", "application/json");

              if (
                !googleResponse.ok ||
                typeof location?.lat !== "number" ||
                typeof location.lng !== "number" ||
                !Number.isFinite(location.lat) ||
                !Number.isFinite(location.lng)
              ) {
                const reason = payload.status || `HTTP_${googleResponse.status}`;
                response.statusCode = googleResponse.ok ? 422 : 502;
                response.end(
                  JSON.stringify({
                    reason,
                    error: `Google Geocoding API 回傳 ${reason}${
                      payload.error_message ? `：${payload.error_message}` : ""
                    }`
                  })
                );
                return;
              }

              response.statusCode = 200;
              response.end(
                JSON.stringify({
                  latitude: location.lat,
                  longitude: location.lng,
                  formattedAddress: firstResult?.formatted_address ?? address
                })
              );
            } catch (error) {
              response.statusCode = 502;
              response.setHeader("Content-Type", "application/json");
              response.end(
                JSON.stringify({
                  reason: "NETWORK_ERROR",
                  error: error instanceof Error ? error.message : "呼叫 Google Geocoding API 失敗。"
                })
              );
            }
          });
        });
      }
    }
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts"
  }
  };
});
