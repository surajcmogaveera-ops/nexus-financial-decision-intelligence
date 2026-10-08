import Link from "next/link";

type StatusPanelProps = {
  eyebrow?: string;
  title: string;
  description: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  tone?: "default" | "warning" | "error";
};

const toneClasses = {
  default: "border-[var(--line)] bg-white",
  warning: "border-amber-200 bg-amber-50/70",
  error: "border-rose-200 bg-rose-50/70",
};

export function StatusPanel({ eyebrow, title, description, action, tone = "default" }: StatusPanelProps) {
  return (
    <section className={`rounded-2xl border p-6 shadow-[0_14px_42px_-34px_rgba(18,39,32,.32)] ${toneClasses[tone]}`} aria-live="polite">
      {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{eyebrow}</p>}
      <h2 className="mt-2 text-lg font-semibold tracking-tight text-[var(--ink)]">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action && "href" in action && (
        <Link className="mt-5 inline-flex min-h-10 items-center rounded-lg border border-[var(--line)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" href={action.href}>
          {action.label}
        </Link>
      )}
      {action && "onClick" in action && (
        <button className="mt-5 inline-flex min-h-10 items-center rounded-lg border border-[var(--line)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" onClick={action.onClick} type="button">
          {action.label}
        </button>
      )}
    </section>
  );
}

export function LoadingState({ label = "Loading securely…" }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center gap-3 rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--muted)]" role="status">
      <span className="size-2 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden="true" />
      {label}
    </div>
  );
}
