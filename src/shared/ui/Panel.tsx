import type { PropsWithChildren, ReactNode } from "react";

type PanelProps = PropsWithChildren<{
  title?: string;
  action?: ReactNode;
  className?: string;
}>;

export function Panel({ title, action, className = "", children }: PanelProps) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-[1.35rem] border border-white/70 bg-white/90 p-3 shadow-card backdrop-blur lg:rounded-[1.75rem] lg:p-4 ${className}`}
    >
      {(title || action) && (
        <div className="mb-2.5 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between lg:mb-3">
          {title ? <h2 className="min-w-0 break-words text-base font-semibold text-brand-ink lg:text-lg">{title}</h2> : <div />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
