import { statusLabel, statusTone } from "../utils/format";

type BadgeProps = {
  value: string;
  compact?: boolean;
};

export function Badge({ value, compact = false }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusTone(value)} ${
        compact ? "px-2 py-0.5" : ""
      }`}
    >
      {statusLabel(value as never)}
    </span>
  );
}
