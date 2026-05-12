import { Panel } from "../../shared/ui/Panel";

export function DoctorLineQrPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Panel title="LINE QR Code">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
            <img
              src="/line-qr-final.svg?v=exact-final-20260513"
              alt="LINE QR Code"
              className="h-auto w-full max-w-[420px]"
            />
          </div>
          <p className="text-sm text-slate-500">請掃描 QR Code 加入 LINE。</p>
        </div>
      </Panel>
    </div>
  );
}
