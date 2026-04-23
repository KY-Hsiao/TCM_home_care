import type { PropsWithChildren, ReactNode } from "react";

type PanelProps = PropsWithChildren<{
  title?: string;
  action?: ReactNode;
  className?: string;
}>;

export function Panel({ title, action, className = "", children }: PanelProps) {
  return (
    <section
      className={`rounded-3xl border border-white/70 bg-white/90 p-5 shadow-card backdrop-blur ${className}`}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-lg font-semibold text-brand-ink">{title}</h2> : <div />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
