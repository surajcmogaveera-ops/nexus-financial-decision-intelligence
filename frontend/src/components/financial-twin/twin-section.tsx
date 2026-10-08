import type { ReactNode } from "react";

export function TwinSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-28" aria-labelledby={`${id}-heading`} id={id}>
      <div className="mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Financial Twin</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]" id={`${id}-heading`}>{title}</h2>
      </div>
      {children}
    </section>
  );
}
