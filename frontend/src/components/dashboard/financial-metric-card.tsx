export function FinancialMetricCard({
  label,
  value,
  provenance,
  detail,
}: {
  label: string;
  value: string;
  provenance?: string;
  detail?: string;
}) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_14px_42px_-36px_rgba(18,39,32,.4)] sm:p-6">
      <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
      <p className="mt-4 break-words text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-[2rem]">{value}</p>
      <div className="mt-4 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
        {provenance && <span className="rounded-md bg-[#f1f6f2] px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--accent)]">{provenance}</span>}
        {detail && <span className="text-xs text-[var(--muted)]">{detail}</span>}
      </div>
    </article>
  );
}
