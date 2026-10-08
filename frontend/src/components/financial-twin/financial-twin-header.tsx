import Link from "next/link";
import { Brand } from "@/components/brand";

export function FinancialTwinHeader({
  userName,
  email,
  onSignOut,
  signingOut,
}: {
  userName: string | null;
  email: string | null;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[rgba(245,247,243,.94)] backdrop-blur">
      <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Brand compact />
        <nav className="hidden items-center gap-1 sm:flex" aria-label="Workspace">
          <Link className="rounded-md px-3 py-2 text-xs font-medium text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" href="/dashboard">Dashboard</Link>
          <span className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)]" aria-current="page">Financial Twin</span>
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-44 truncate text-xs text-[var(--muted)] md:inline" title={email ?? undefined}>{userName || email || "Checking session"}</span>
          <button className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60" type="button" onClick={onSignOut} disabled={signingOut || !email}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}
