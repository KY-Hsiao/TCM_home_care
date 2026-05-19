import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

const CHUNK_RELOAD_KEY = "tcm-home-care-chunk-reload-attempted";

function getErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return `${error.status} ${error.statusText}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "系統暫時無法載入此頁。";
}

function isDynamicImportError(message: string) {
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Loading chunk") ||
    message.includes("ChunkLoadError")
  );
}

export function RouteErrorFallback() {
  const error = useRouteError();
  const message = getErrorMessage(error);
  const isChunkError = isDynamicImportError(message);

  useEffect(() => {
    if (!isChunkError || typeof window === "undefined") {
      return;
    }
    const alreadyReloaded = window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === "true";
    if (alreadyReloaded) {
      return;
    }
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, "true");
    window.location.reload();
  }, [isChunkError]);

  const handleReload = () => {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.reload();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-sand px-4 py-8 text-brand-ink">
      <section className="w-full max-w-xl rounded-[2rem] border border-white/70 bg-white p-6 shadow-card">
        <p className="text-sm font-semibold text-brand-coral">頁面需要重新載入</p>
        <h1 className="mt-2 text-2xl font-bold">
          {isChunkError ? "系統已更新，請重新載入新版頁面" : "此頁暫時無法載入"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {isChunkError
            ? "剛部署新版後，瀏覽器可能仍保留舊頁面，導致舊版檔案連結失效。重新載入後會取得最新版本。"
            : "請重新載入頁面；若仍無法使用，請回到首頁再重新進入。"}
        </p>
        <p className="mt-3 break-words rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
          {message}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleReload}
            className="rounded-full bg-brand-forest px-5 py-3 text-sm font-semibold text-white"
          >
            重新載入新版頁面
          </button>
          <a
            href="/"
            className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-brand-forest ring-1 ring-slate-200"
          >
            回到登入頁
          </a>
        </div>
      </section>
    </main>
  );
}
