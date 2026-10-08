"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardError } from "@/components/dashboard/dashboard-error";
import { DashboardLoading } from "@/components/dashboard/dashboard-loading";
import { FinancialOverview } from "@/components/dashboard/financial-overview";
import { GoalsSection } from "@/components/dashboard/goals-section";
import { RecentScenarios } from "@/components/dashboard/recent-scenarios";
import { RiskFlags } from "@/components/dashboard/risk-flags";
import { api, ApiClientError, type FinancialTwin, type SafeUser } from "@/lib/api/client";

type DashboardState =
  | { status: "loading" }
  | { status: "ready"; user: SafeUser; twin: FinancialTwin }
  | { status: "empty"; user: SafeUser }
  | { status: "error"; message: string };

const navigation = [
  ["#overview", "Overview"],
  ["#goals", "Goals"],
  ["#risk-flags", "Risk flags"],
  ["#recent-scenarios", "Scenarios"],
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      let user: SafeUser;
      try {
        const session = await api.currentUser();
        user = session.user;
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiClientError && (error.status === 401 || error.code === "AUTHENTICATION_REQUIRED" || error.code === "UNAUTHORIZED")) {
          router.replace("/login");
          return;
        }
        setState({ status: "error", message: sessionErrorMessage(error) });
        return;
      }

      try {
        const twin = await api.financialTwin();
        if (active) setState({ status: "ready", user, twin });
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiClientError && error.code === "FINANCIAL_PROFILE_NOT_FOUND") {
          setState({ status: "empty", user });
          return;
        }
        if (error instanceof ApiClientError && (error.status === 401 || error.code === "AUTHENTICATION_REQUIRED" || error.code === "UNAUTHORIZED")) {
          router.replace("/login");
          return;
        }
        setState({ status: "error", message: profileErrorMessage(error) });
      }
    }

    void loadDashboard();
    return () => { active = false; };
  }, [router, retryKey]);

  async function signOut() {
    setSigningOut(true);
    setLogoutError(null);
    try {
      await api.logout();
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("Sign out could not be completed. Check the backend connection and try again.");
      setSigningOut(false);
    }
  }

  function retry() {
    setState({ status: "loading" });
    setRetryKey((value) => value + 1);
  }

  const user = state.status === "ready" || state.status === "empty" ? state.user : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[rgba(245,247,243,.94)] backdrop-blur">
        <div className="mx-auto flex min-h-18 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Brand compact />
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Dashboard sections">
            {navigation.map(([href, label]) => (
              <a className="rounded-md px-3 py-2 text-xs font-medium text-[var(--muted)] transition hover:bg-white hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" href={href} key={href}>{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-44 truncate text-xs text-[var(--muted)] sm:inline" title={user?.email}>{user?.name || user?.email || (state.status === "error" ? "Workspace" : "Checking session")}</span>
            <button className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60" type="button" onClick={signOut} disabled={signingOut || !user}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8 sm:py-12">
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Private workspace</p>
            <h1 className="mt-2 text-3xl font-medium tracking-[-0.045em] text-[var(--ink)] sm:text-4xl">Your financial picture</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">See your current position, goals, and the signals returned by your Financial Twin.</p>
          </div>
          {state.status === "ready" && <span className="self-start rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] sm:self-auto">{state.twin.raw.currency} · Current profile</span>}
          {user && <span className="self-start rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] sm:self-auto">Session verified</span>}
        </div>

        {state.status === "loading" && <DashboardLoading />}
        {state.status === "error" && <DashboardError message={state.message} onRetry={retry} />}
        {state.status === "empty" && <DashboardEmptyState />}

        {state.status === "ready" && (
          <div className="space-y-10">
            <section id="overview" className="scroll-mt-28">
              <FinancialOverview twin={state.twin} />
            </section>

            <section id="goals" className="scroll-mt-28" aria-labelledby="goals-heading">
              <SectionHeading eyebrow="Plans in view" title="Goals" id="goals-heading" />
              <GoalsSection twin={state.twin} />
            </section>

            <section id="risk-flags" className="scroll-mt-28" aria-labelledby="risk-heading">
              <SectionHeading eyebrow="Backend-reported signals" title="Risk flags" id="risk-heading" />
              <RiskFlags flags={state.twin.riskFlags} />
            </section>

            <section id="recent-scenarios" className="scroll-mt-28" aria-labelledby="scenarios-heading">
              <SectionHeading eyebrow="Decision history" title="Recent scenarios" id="scenarios-heading" />
              <RecentScenarios />
            </section>
          </div>
        )}

        {logoutError && <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{logoutError}</p>}
        <footer className="mt-12 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">NEXUS · Your private workspace</footer>
      </main>
    </div>
  );
}

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]" id={id}>{title}</h2>
    </div>
  );
}

function sessionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "API_UNAVAILABLE") return "The NEXUS backend could not be reached. Check that it is running and try again.";
  return "Your session could not be checked. Please try again.";
}

function profileErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "API_UNAVAILABLE") return "The NEXUS backend could not be reached. Check that it is running and try again.";
  if (error instanceof ApiClientError && error.code === "FINANCIAL_PROFILE_INCOMPLETE") return "Your saved profile needs attention before NEXUS can display its calculated metrics.";
  if (error instanceof ApiClientError && error.code === "INVALID_API_RESPONSE") return "The backend returned financial data in an unexpected format. No values were displayed.";
  return "Financial information could not be loaded. Please try again.";
}
