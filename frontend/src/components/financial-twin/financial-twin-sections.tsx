import type { FinancialTwin, FinancialRiskFlag } from "@/lib/api/client";
import type { ReactNode } from "react";
import { formatMoney, formatPercentage, humanizeCode } from "@/lib/formatting/financial";
import { TwinMetricCard } from "@/components/financial-twin/twin-metric-card";
import { StatusPanel } from "@/components/status-panel";

export function IncomeSection({ twin }: { twin: FinancialTwin }) {
  return <MetricGrid>
    <TwinMetricCard label="Monthly income" value={formatMoney(twin.raw.monthlyIncome, twin.raw.currency)} detail="Per month" provenance={twin.provenance.raw.monthlyIncome} />
  </MetricGrid>;
}

export function ExpensesSection({ twin }: { twin: FinancialTwin }) {
  return <MetricGrid>
    <TwinMetricCard label="Monthly expenses" value={formatMoney(twin.raw.monthlyExpenses, twin.raw.currency)} detail="Per month" provenance={twin.provenance.raw.monthlyExpenses} />
    {twin.raw.essentialMonthlyExpenses !== undefined && <TwinMetricCard label="Essential monthly expenses" value={formatMoney(twin.raw.essentialMonthlyExpenses, twin.raw.currency)} detail="Backend-provided essential expenses" provenance={twin.provenance.raw.essentialMonthlyExpenses} />}
  </MetricGrid>;
}

export function SavingsSection({ twin }: { twin: FinancialTwin }) {
  return <MetricGrid>
    <TwinMetricCard label="Liquid savings" value={formatMoney(twin.raw.liquidSavings, twin.raw.currency)} detail="Current liquid savings" provenance={twin.provenance.raw.liquidSavings} />
    <TwinMetricCard label="Savings rate" value={formatPercentage(twin.derived.savingsRate)} detail="Financial Twin derived value" provenance={twin.provenance.derived.savingsRate} />
  </MetricGrid>;
}

export function DebtSection({ twin }: { twin: FinancialTwin }) {
  return <MetricGrid>
    <TwinMetricCard label="Monthly debt payments" value={formatMoney(twin.raw.monthlyDebtPayments, twin.raw.currency)} detail="Per month" provenance={twin.provenance.raw.monthlyDebtPayments} />
    <TwinMetricCard label="Debt-to-income" value={formatPercentage(twin.derived.debtToIncome)} detail="Financial Twin derived value" provenance={twin.provenance.derived.debtToIncome} />
  </MetricGrid>;
}

export function InvestmentsSection({ twin }: { twin: FinancialTwin }) {
  return <MetricGrid>
    <TwinMetricCard label="Current investments" value={formatMoney(twin.raw.investments, twin.raw.currency)} provenance={twin.provenance.raw.investments} />
    <TwinMetricCard label="Monthly investment contribution" value={formatMoney(twin.raw.monthlyInvestmentContribution, twin.raw.currency)} detail="Per month" provenance={twin.provenance.raw.monthlyInvestmentContribution} />
  </MetricGrid>;
}

export function CashFlowSection({ twin }: { twin: FinancialTwin }) {
  const rows: Array<{ label: string; value: string; provenance?: string }> = [
    { label: "Monthly income", value: formatMoney(twin.raw.monthlyIncome, twin.raw.currency), provenance: twin.provenance.raw.monthlyIncome },
    { label: "Monthly expenses", value: formatMoney(twin.raw.monthlyExpenses, twin.raw.currency), provenance: twin.provenance.raw.monthlyExpenses },
    { label: "Monthly debt payments", value: formatMoney(twin.raw.monthlyDebtPayments, twin.raw.currency), provenance: twin.provenance.raw.monthlyDebtPayments },
    { label: "Monthly surplus", value: formatMoney(twin.derived.monthlySurplus, twin.raw.currency), provenance: twin.provenance.derived.monthlySurplus },
    { label: "Available monthly cash flow", value: formatMoney(twin.derived.availableMonthlyCashFlow, twin.raw.currency), provenance: twin.provenance.derived.availableMonthlyCashFlow },
  ];
  return (
    <dl className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-white px-5 sm:px-6">
      {rows.map(({ label, value, provenance }) => (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-4" key={label}>
          <dt className="text-sm text-[var(--muted)]">{label}</dt>
          <dd className="text-right">
            <span className="font-semibold text-[var(--ink)]">{value}</span>
            {provenance && <span className="ml-2 text-[10px] font-semibold tracking-wide text-[var(--accent)]">{provenance}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function RiskIndicators({ flags }: { flags: FinancialRiskFlag[] }) {
  if (flags.length === 0) {
    return <StatusPanel title="No active risk flags" description="The Financial Twin returned an empty risk flag list for this calculation." />;
  }
  return (
    <ul className="space-y-3">
      {flags.map((flag, index) => (
        <li className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" key={`${flag.type}-${index}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">{riskTitle(flag.type)}</h3>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]">{humanizeCode(flag.severity)}</span>
          </div>
          <p className="mt-3 break-words text-sm leading-6 text-[var(--muted)]">Backend trigger: <code className="text-xs">{flag.trigger}</code></p>
          {Object.keys(flag.details).length > 0 && (
            <dl className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
              {Object.entries(flag.details).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-[var(--muted)]">{humanizeCode(key)}</dt>
                  <dd className="mt-1 break-words text-sm font-medium text-[var(--ink)]">{value === null ? "Unavailable" : String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

function riskTitle(type: string): string {
  const titles: Record<string, string> = {
    NEGATIVE_SURPLUS: "Negative monthly surplus",
    GOAL_SHORTFALL: "Goal shortfall",
    LIQUIDITY_REDUCTION: "Liquidity reduction",
    HIGHER_DEBT_BURDEN: "Higher debt burden",
    EMERGENCY_COVERAGE_REDUCTION: "Emergency coverage reduction",
    MISSING_DATA: "Missing financial data",
  };
  return titles[type] ?? humanizeCode(type);
}
