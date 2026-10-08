import type { FinancialRiskFlag } from "@/lib/api/client";
import { humanizeCode } from "@/lib/formatting/financial";
import { StatusPanel } from "@/components/status-panel";

const riskLabels: Record<string, string> = {
  NEGATIVE_SURPLUS: "Negative monthly surplus",
  GOAL_SHORTFALL: "Goal shortfall",
  LIQUIDITY_REDUCTION: "Liquidity reduction",
  HIGHER_DEBT_BURDEN: "Higher debt burden",
  EMERGENCY_COVERAGE_REDUCTION: "Emergency coverage reduction",
  MISSING_DATA: "Missing financial data",
};

export function RiskFlags({ flags }: { flags: FinancialRiskFlag[] }) {
  if (flags.length === 0) {
    return <StatusPanel title="No risk flags reported." description="No flags were returned for this Financial Twin calculation." />;
  }

  return (
    <ul className="space-y-3">
      {flags.map((flag, index) => (
        <li className="rounded-xl border border-[var(--line)] bg-white p-4 sm:p-5" key={`${flag.type}-${index}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">{riskLabels[flag.type] ?? humanizeCode(flag.type)}</h3>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]">Severity: {humanizeCode(flag.severity)}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{flag.trigger}</p>
        </li>
      ))}
    </ul>
  );
}
