import Link from "next/link";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="inline-flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]" href="/" aria-label="NEXUS home">
      <span className="grid size-9 place-items-center rounded-lg bg-[var(--accent)] text-xs font-bold tracking-[0.1em] text-white">NX</span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-[0.17em] text-[var(--ink)]">NEXUS</span>
        {!compact && <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--muted)]">Decision intelligence</span>}
      </span>
    </Link>
  );
}
