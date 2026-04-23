import type { PropsWithChildren, ReactNode } from "react";

type PanelProps = PropsWithChildren<{
  title?: string;
  action?: ReactNode;
  className?: string;
}>;

export function Panel({ title, action, className = "", children }: PanelProps) {
  return (
    <section
      className={`rounded-[1.75rem] border border-white/70 bg-white/90 p-4 shadow-card backdrop-blur lg:rounded-3xl lg:p-5 ${className}`}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3 lg:mb-4">
          {title ? <h2 className="text-base font-semibold text-brand-ink lg:text-lg">{title}</h2> : <div />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
