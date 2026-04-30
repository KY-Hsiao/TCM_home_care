type StatCardProps = {
  label: string;
  value: string | number;
  hint: string;
};

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="flex min-h-[9.5rem] flex-col rounded-[1.5rem] border border-brand-moss/20 bg-gradient-to-br from-white to-brand-sand p-4 shadow-card lg:min-h-[10rem] lg:rounded-3xl lg:p-5">
      <p className="text-sm font-medium text-brand-moss">{label}</p>
      <p className="mt-3 text-3xl font-bold text-brand-ink">{value}</p>
      <p className="card-clamp-2 mt-2 text-sm text-slate-500">{hint}</p>
    </div>
  );
}
