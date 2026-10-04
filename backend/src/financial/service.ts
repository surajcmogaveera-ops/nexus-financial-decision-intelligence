import { PROVENANCE_TYPES } from "./constants.js";
import { calculateFinancialMetrics } from "./engine/financialMetrics.js";
import { calculateProfileRiskFlags } from "./engine/riskFlags.js";
import type { ParsedFinancialTwinRequest } from "./schemas.js";
import type { DerivedMetric, FinancialTwin, RawField } from "./types.js";

const ASSUMPTIONS = [
  "monthlySurplus follows the Python reference formula: income - expenses - debt payments.",
  "availableMonthlyCashFlow subtracts monthlyInvestmentContribution separately; investment contributions are not also counted as short-term goal funding.",
  "Goal projections assume no investment return. A nonzero return assumption makes return-dependent projections unavailable.",
  "If one goal omits monthlyContribution, availableMonthlyCashFlow is used as its explicit deterministic projection assumption.",
  "If multiple goals omit monthlyContribution, no cash flow is allocated to those goals; their projection remains conservative and unavailable horizons stay unavailable.",
];

export function calculateFinancialTwin(parsed: ParsedFinancialTwinRequest): FinancialTwin {
  const { profile, asOfDate } = parsed.request;
  const derived = calculateFinancialMetrics(profile, asOfDate);
  const rawProvenance: Partial<Record<RawField, (typeof PROVENANCE_TYPES)[number]>> = {};
  const rawFields: RawField[] = [
    "currency",
    "monthlyIncome",
    "monthlyExpenses",
    "monthlyDebtPayments",
    "liquidSavings",
    "investments",
    "monthlyInvestmentContribution",
    "essentialMonthlyExpenses",
    "goals",
  ];
  for (const field of rawFields) {
    if (field === "essentialMonthlyExpenses" && profile.essentialMonthlyExpenses === undefined) {
      continue;
    }
    rawProvenance[field] = parsed.suppliedFields.has(field) ? "USER" : "ASSUMPTION";
  }

  const derivedProvenance = Object.fromEntries(
    Object.keys(derived).map((key) => [key, "COMPUTED"]),
  ) as Record<DerivedMetric, "COMPUTED">;
  const result: FinancialTwin = {
    raw: profile,
    derived,
    provenance: { raw: rawProvenance, derived: derivedProvenance },
    riskFlags: [],
    assumptions: [...ASSUMPTIONS],
    calculatedAt: new Date().toISOString(),
  };
  result.riskFlags = calculateProfileRiskFlags(result);
  return result;
}

