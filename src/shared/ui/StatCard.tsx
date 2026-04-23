type StatCardProps = {
  label: string;
  value: string | number;
  hint: string;
};

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-3xl border border-brand-moss/20 bg-gradient-to-br from-white to-brand-sand p-5 shadow-card">
      <p className="text-sm font-medium text-brand-moss">{label}</p>
      <p className="mt-3 text-3xl font-bold text-brand-ink">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{hint}</p>
    </div>
  );
}
