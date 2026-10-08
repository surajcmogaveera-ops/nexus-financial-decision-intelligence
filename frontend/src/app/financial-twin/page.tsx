"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FinancialTwinEmptyState } from "@/components/financial-twin/financial-twin-empty-state";
import { FinancialTwinError } from "@/components/financial-twin/financial-twin-error";
import { FinancialTwinHeader } from "@/components/financial-twin/financial-twin-header";
import { FinancialTwinLoading } from "@/components/financial-twin/financial-twin-loading";
import { TwinSection } from "@/components/financial-twin/twin-section";
import {
  CashFlowSection,
  DebtSection,
  ExpensesSection,
  IncomeSection,
  InvestmentsSection,
  RiskIndicators,
  SavingsSection,
} from "@/components/financial-twin/financial-twin-sections";
import { EmergencyCoverage } from "@/components/dashboard/emergency-coverage";
import { GoalsSection } from "@/components/dashboard/goals-section";
import { api, ApiClientError, type FinancialTwin, type SafeUser } from "@/lib/api/client";
import { formatDate } from "@/lib/formatting/financial";

type PageState =
  | { status: "loading" }
  | { status: "ready"; user: SafeUser; twin: FinancialTwin }
  | { status: "empty"; user: SafeUser }
  | { status: "error"; message: string };

export default function FinancialTwinPage() {
  const router = useRouter();
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadFinancialTwin() {
      let user: SafeUser;
      try {
        const session = await api.currentUser();
        user = session.user;
      } catch (error) {
        if (!active) return;
        if (isAuthenticationFailure(error)) {
          router.replace("/login");
          return;
        }
        setState({ status: "error", message: errorMessage(error, "session") });
        return;
      }

      try {
        const twin = await api.financialTwin();
        if (active) setState({ status: "ready", user, twin });
      } catch (error) {
        if (!active) return;
        if (isAuthenticationFailure(error)) {
          router.replace("/login");
          return;
        }
        if (error instanceof ApiClientError && error.code === "FINANCIAL_PROFILE_NOT_FOUND") {
          setState({ status: "empty", user });
          return;
        }
        setState({ status: "error", message: errorMessage(error, "financial") });
      }
    }

    void loadFinancialTwin();
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
  const twin = state.status === "ready" ? state.twin : null;

  return (
    <div className="min-h-screen">
      <FinancialTwinHeader userName={user?.name ?? null} email={user?.email ?? null} onSignOut={signOut} signingOut={signingOut} />
      <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8 sm:py-12">
        <div className="mb-8 flex flex-col justify-between gap-4 border-b border-[var(--line)] pb-7 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Authoritative financial state</p>
            <h1 className="mt-2 text-3xl font-medium tracking-[-0.045em] text-[var(--ink)] sm:text-4xl">Financial Twin</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">A transparent view of the financial state used by NEXUS for decision simulations.</p>
          </div>
          {twin && <span className="self-start rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--muted)] sm:self-auto">{twin.raw.currency} · Calculated {formatDate(twin.calculatedAt)}</span>}
        </div>

        {state.status === "loading" && <FinancialTwinLoading />}
        {state.status === "error" && <FinancialTwinError message={state.message} onRetry={retry} />}
        {state.status === "empty" && <FinancialTwinEmptyState />}

        {twin && (
          <div className="space-y-10">
            <div className="grid gap-10 lg:grid-cols-2">
              <TwinSection id="income" title="Income"><IncomeSection twin={twin} /></TwinSection>
              <TwinSection id="expenses" title="Expenses"><ExpensesSection twin={twin} /></TwinSection>
              <TwinSection id="savings" title="Savings"><SavingsSection twin={twin} /></TwinSection>
              <TwinSection id="debt" title="Debt"><DebtSection twin={twin} /></TwinSection>
              <TwinSection id="investments" title="Investments"><InvestmentsSection twin={twin} /></TwinSection>
              <TwinSection id="emergency-coverage" title="Emergency coverage">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <EmergencyCoverage value={twin.derived.emergencyCoverageMonths} provenance={twin.provenance.derived.emergencyCoverageMonths} />
                </div>
              </TwinSection>
            </div>

            <TwinSection id="cash-flow" title="Cash flow"><CashFlowSection twin={twin} /></TwinSection>
            <TwinSection id="goals" title="Goals"><GoalsSection twin={twin} /></TwinSection>
            <TwinSection id="risk-indicators" title="Risk indicators"><RiskIndicators flags={twin.riskFlags} /></TwinSection>
          </div>
        )}

        {logoutError && <p className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{logoutError}</p>}
        <footer className="mt-12 border-t border-[var(--line)] pt-5 text-xs text-[var(--muted)]">Read-only view · Values and calculations supplied by the NEXUS Financial Twin</footer>
      </main>
    </div>
  );
}

function isAuthenticationFailure(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 401 || error.code === "AUTHENTICATION_REQUIRED" || error.code === "UNAUTHORIZED");
}

function errorMessage(error: unknown, context: "session" | "financial"): string {
  if (error instanceof ApiClientError && error.code === "API_UNAVAILABLE") return "The NEXUS backend could not be reached. Check that it is running and try again.";
  if (error instanceof ApiClientError && error.code === "INVALID_API_RESPONSE") return "The backend returned data in an unexpected format. No financial values were displayed.";
  if (context === "financial" && error instanceof ApiClientError && error.code === "FINANCIAL_PROFILE_INCOMPLETE") return "Your saved profile needs attention before NEXUS can display its calculated metrics.";
  if (context === "session") return "Your session could not be checked. Please try again.";
  return "Financial information could not be loaded. Please try again.";
}
