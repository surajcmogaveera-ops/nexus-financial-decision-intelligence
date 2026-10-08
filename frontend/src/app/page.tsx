import Link from "next/link";
import { Brand } from "@/components/brand";

const principles = [
  { number: "01", title: "Your inputs stay yours", detail: "Your financial profile is handled by the NEXUS application API." },
  { number: "02", title: "Calculations stay deterministic", detail: "The backend owns the financial engine and the values it produces." },
  { number: "03", title: "Context stays visible", detail: "Evidence and interpretation are designed to remain distinct." },
];

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 sm:px-8">
      <header className="flex h-20 items-center justify-between border-b border-[var(--line)]">
        <Brand />
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Account">
          <Link className="rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" href="/login">Sign in</Link>
          <Link className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" href="/register">Create account</Link>
        </nav>
      </header>

      <section className="grid min-h-[calc(100svh-5rem)] items-center gap-14 py-16 lg:grid-cols-[1.1fr_.9fr] lg:py-24">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.17em] text-[var(--accent)]">
            <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            Personal financial decision intelligence
          </p>
          <h1 className="mt-7 text-5xl font-medium leading-[1.04] tracking-[-0.055em] text-[var(--ink)] sm:text-6xl lg:text-7xl">
            See the consequences <span className="font-serif italic text-[var(--accent)]">before</span> you decide.
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-[var(--muted)] sm:text-lg sm:leading-8">
            NEXUS is being built to make financial tradeoffs easier to understand—with clear calculations, useful context, and the evidence behind them.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-6 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" href="/register">Get started</Link>
            <Link className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--line)] bg-white/70 px-6 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" href="/login">Sign in to NEXUS</Link>
          </div>
          <p className="mt-5 text-xs text-[var(--muted)]">A clear view of the decision. No invented scores or projections.</p>
        </div>

        <aside className="relative" aria-label="NEXUS product principles">
          <div className="absolute -inset-4 rounded-[2rem] border border-[var(--line)]/70" aria-hidden="true" />
          <div className="relative overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-white shadow-[0_28px_90px_-56px_rgba(23,50,40,.38)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-6 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Product principles</p>
                <p className="mt-1.5 text-sm font-semibold text-[var(--ink)]">Designed around what can be trusted</p>
              </div>
              <span className="rounded-md border border-[var(--line)] px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--muted)]">NEXUS</span>
            </div>
            <ol className="divide-y divide-[var(--line)]">
              {principles.map((principle) => (
                <li className="flex gap-5 px-6 py-6" key={principle.number}>
                  <span className="pt-0.5 font-mono text-xs text-[var(--accent)]">{principle.number}</span>
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--ink)]">{principle.title}</h2>
                    <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{principle.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-3 bg-[#f7faf7] px-6 py-4">
              <span className="size-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              <p className="text-xs text-[var(--muted)]">Your choices. Clear context. Deterministic calculations.</p>
            </div>
          </div>
        </aside>
      </section>

      <footer className="border-t border-[var(--line)] py-6 text-xs text-[var(--muted)]">NEXUS · Personal Financial Decision Intelligence</footer>
    </main>
  );
}
