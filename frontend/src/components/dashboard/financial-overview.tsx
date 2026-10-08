import type { FinancialTwin } from "@/lib/api/client";
import { formatMoney } from "@/lib/formatting/financial";
import { FinancialMetricCard } from "@/components/dashboard/financial-metric-card";
import { EmergencyCoverage } from "@/components/dashboard/emergency-coverage";

export function FinancialOverview({ twin }: { twin: FinancialTwin }) {
  const currency = twin.raw.currency;
  const metric = twin.provenance.derived;
  const raw = twin.provenance.raw;

  return (
    <div className="space-y-8">
      <section aria-labelledby="financial-overview-heading">
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Financial overview</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]" id="financial-overview-heading">Monthly position</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <FinancialMetricCard label="Monthly income" value={formatMoney(twin.raw.monthlyIncome, currency)} provenance={raw.monthlyIncome} />
          <FinancialMetricCard label="Monthly expenses" value={formatMoney(twin.raw.monthlyExpenses, currency)} provenance={raw.monthlyExpenses} />
          <FinancialMetricCard label="Monthly surplus" value={formatMoney(twin.derived.monthlySurplus, currency)} provenance={metric.monthlySurplus} detail="Authoritative Financial Twin output" />
        </div>
      </section>

      <section aria-labelledby="financial-position-heading">
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Financial position</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--ink)]" id="financial-position-heading">Liquidity and coverage</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FinancialMetricCard label="Liquid savings" value={formatMoney(twin.raw.liquidSavings, currency)} provenance={raw.liquidSavings} />
          <EmergencyCoverage value={twin.derived.emergencyCoverageMonths} provenance={metric.emergencyCoverageMonths} />
        </div>
      </section>
    </div>
  );
}
