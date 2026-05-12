import { useRef } from "react";
import { Panel } from "../../shared/ui/Panel";

export function DoctorLineQrPage() {
  const qrWrapRef = useRef<HTMLDivElement>(null);

  const handleFullscreen = async () => {
    try {
      if (qrWrapRef.current?.requestFullscreen) {
        await qrWrapRef.current.requestFullscreen();
      }
    } catch (error) {
      console.error("LINE QR fullscreen failed", error);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-2 sm:px-4">
      <Panel title="LINE QR Code">
        <div className="space-y-4">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleFullscreen}
              className="rounded-full bg-brand-forest px-5 py-2.5 text-sm font-semibold text-white"
            >
              放大顯示
            </button>
          </div>

          <div
            ref={qrWrapRef}
            className="flex min-h-[70vh] items-center justify-center rounded-3xl bg-white p-2 sm:p-4"
          >
            <img
              src="/line-qr-final.svg?v=clear-vector-20260513"
              alt="LINE QR Code"
              className="block h-auto w-full max-w-[98vw] sm:max-w-[820px]"
            />
          </div>

          <p className="text-center text-sm text-slate-500">
            請家屬直接掃描 QR Code 加入 LINE
          </p>
        </div>
      </Panel>
    </div>
  );
}
