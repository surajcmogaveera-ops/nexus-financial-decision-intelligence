export function TwinMetricCard({
  label,
  value,
  detail,
  provenance,
}: {
  label: string;
  value: string;
  detail?: string;
  provenance?: string;
}) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_14px_42px_-36px_rgba(18,39,32,.4)] sm:p-6">
      <h3 className="text-sm font-medium text-[var(--muted)]">{label}</h3>
      <p className="mt-4 break-words text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-3xl">{value}</p>
      {detail && <p className="mt-2 text-xs text-[var(--muted)]">{detail}</p>}
      {provenance && <span className="mt-3 inline-flex rounded-md bg-[#f1f6f2] px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--accent)]">{provenance}</span>}
    </article>
  );
}
