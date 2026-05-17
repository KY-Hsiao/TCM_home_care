import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

const ignoredWatchSegments = new Set([
  ".codex",
  ".git",
  ".vercel",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "run_logs"
]);

function shouldIgnoreWatchPath(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return normalizedPath
    .split("/")
    .filter(Boolean)
    .some((segment) => ignoredWatchSegments.has(segment));
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function sendRequestBodyError(response: ServerResponse, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "INVALID_JSON") {
    sendJson(response, 400, { reason: "INVALID_JSON", error: "請求內容不是有效的 JSON。" });
    return;
  }
  if (message === "REQUEST_BODY_TOO_LARGE") {
    sendJson(response, 413, { reason: "REQUEST_BODY_TOO_LARGE", error: "請求內容過大。" });
    return;
  }
  sendJson(response, 400, {
    reason: "REQUEST_ERROR",
    error: error instanceof Error ? error.message : "讀取請求內容失敗。"
  });
}

function readJsonBody(request: IncomingMessage, maxBytes = 1024 * 1024) {
  return new Promise<unknown>((resolve, reject) => {
    let rawBody = "";
    let receivedBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    request.on("data", (chunk: Buffer | string) => {
      if (settled) {
        return;
      }
      const chunkText = chunk.toString();
      receivedBytes += Buffer.byteLength(chunkText);
      if (receivedBytes > maxBytes) {
        fail(new Error("REQUEST_BODY_TOO_LARGE"));
        return;
      }
      rawBody += chunkText;
    });

    request.on("error", fail);
    request.on("end", () => {
      if (settled) {
        return;
      }
      try {
        const parsedBody = rawBody.trim() ? JSON.parse(rawBody) : {};
        settled = true;
        resolve(parsedBody);
      } catch {
        fail(new Error("INVALID_JSON"));
      }
    });
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      watch: {
        ignored: shouldIgnoreWatchPath
      }
    },
    plugins: [
      react(),
      {
        name: "local-geocode-api",
        configureServer(server) {
          server.middlewares.use("/api/maps/geocode", async (request, response) => {
            if (request.method !== "POST") {
              response.setHeader("Allow", "POST");
              sendJson(response, 405, { error: "Method Not Allowed" });
              return;
            }

            const apiKey =
              process.env.GOOGLE_MAPS_API_KEY ||
              process.env.VITE_GOOGLE_MAPS_API_KEY ||
              env.GOOGLE_MAPS_API_KEY ||
              env.VITE_GOOGLE_MAPS_API_KEY ||
              "";
            if (!apiKey.trim()) {
              sendJson(response, 503, {
                reason: "API_KEY_MISSING",
                error: "尚未設定 GOOGLE_MAPS_API_KEY 或 VITE_GOOGLE_MAPS_API_KEY，無法補座標。"
              });
              return;
            }

            let body: unknown;
            try {
              body = await readJsonBody(request);
            } catch (error) {
              sendRequestBodyError(response, error);
              return;
            }

            const address = String((body as { address?: unknown })?.address ?? "").trim();
            if (!address) {
              sendJson(response, 400, { reason: "ADDRESS_MISSING", error: "缺少地址，無法補座標。" });
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

              if (
                !googleResponse.ok ||
                typeof location?.lat !== "number" ||
                typeof location.lng !== "number" ||
                !Number.isFinite(location.lat) ||
                !Number.isFinite(location.lng)
              ) {
                const reason = payload.status || `HTTP_${googleResponse.status}`;
                sendJson(response, googleResponse.ok ? 422 : 502, {
                  reason,
                  error: `Google Geocoding API 回傳 ${reason}${
                    payload.error_message ? `：${payload.error_message}` : ""
                  }`
                });
                return;
              }

              sendJson(response, 200, {
                latitude: location.lat,
                longitude: location.lng,
                formattedAddress: firstResult?.formatted_address ?? address
              });
            } catch (error) {
              sendJson(response, 502, {
                reason: "NETWORK_ERROR",
                error: error instanceof Error ? error.message : "呼叫 Google Geocoding API 失敗。"
              });
            }
          });
        }
      }
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom", "react-router-dom"],
            xlsx: ["xlsx"]
          }
        }
      }
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts"
    }
  };
});
