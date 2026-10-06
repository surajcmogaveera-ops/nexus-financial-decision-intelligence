import { Provenance } from "../constants.js";
import { domainCalculationEvidenceId } from "./evidenceIdentity.js";
import type { CalculationEvidence, DerivedFinancialMetrics, FinancialProfile } from "../types.js";

/** Wrap authoritative engine outputs; this module contains no financial calculations. */
export function createFinancialCalculationEvidence(
  profile: FinancialProfile,
  derived: DerivedFinancialMetrics,
  timestamp: string,
): CalculationEvidence[] {
  const records: CalculationEvidence[] = [];
  const add = (metric: string, inputs: Record<string, unknown>, formula: string, output: unknown) => {
    const provenance = Provenance.COMPUTED;
    const evidenceId = domainCalculationEvidenceId({ metric, inputs, formula, output, provenance });
    records.push({
      metric, expression: formula, baselineValue: null,
      scenarioValue: typeof output === "number" || typeof output === "string" ? output : null,
      result: true, provenance, evidenceId, type: "CALCULATION", id: evidenceId,
      calculationId: evidenceId, inputs, formula, output, timestamp,
    });
  };

  add("monthlySurplus", {
    monthlyIncome: profile.monthlyIncome,
    monthlyExpenses: profile.monthlyExpenses,
    monthlyDebtPayments: profile.monthlyDebtPayments,
  }, "monthlySurplus = monthlyIncome - monthlyExpenses - monthlyDebtPayments", derived.monthlySurplus);
  add("availableMonthlyCashFlow", {
    monthlySurplus: derived.monthlySurplus,
    monthlyInvestmentContribution: profile.monthlyInvestmentContribution,
  }, "availableMonthlyCashFlow = monthlySurplus - monthlyInvestmentContribution", derived.availableMonthlyCashFlow);
  add("savingsRate", { monthlySurplus: derived.monthlySurplus, monthlyIncome: profile.monthlyIncome },
    "savingsRate = monthlySurplus / monthlyIncome", derived.savingsRate);
  add("debtToIncome", { monthlyDebtPayments: profile.monthlyDebtPayments, monthlyIncome: profile.monthlyIncome },
    "debtToIncome = monthlyDebtPayments / monthlyIncome", derived.debtToIncome);
  add("emergencyCoverageMonths", {
    liquidSavings: profile.liquidSavings,
    essentialMonthlyExpenses: profile.essentialMonthlyExpenses ?? null,
  }, "emergencyCoverageMonths = liquidSavings / essentialMonthlyExpenses", derived.emergencyCoverageMonths);
  add("currentFundingGap", { goals: profile.goals.map(({ targetAmount, currentAllocatedAmount }) => ({ targetAmount, currentAllocatedAmount })) },
    "currentFundingGap = sum(max(targetAmount - currentAllocatedAmount, 0))", derived.currentFundingGap);
  add("requiredMonthlyContribution", {
    goalRequiredMonthlyContributions: derived.goals.map(({ name, requiredMonthlyContribution }) => ({ name, requiredMonthlyContribution })),
  }, "requiredMonthlyContribution = sum(goal.requiredMonthlyContribution)", derived.requiredMonthlyContribution);

  derived.goals.forEach((goal, index) => {
    const source = profile.goals[index]!;
    const inputs = {
      targetAmount: source.targetAmount,
      currentAllocatedAmount: source.currentAllocatedAmount,
      monthlyContribution: goal.monthlyContributionUsed,
      monthsRemaining: goal.monthsRemaining,
      returnAssumption: source.returnAssumption,
    };
    add(`goals[${index}].currentFundingGap`, { targetAmount: source.targetAmount, currentAllocatedAmount: source.currentAllocatedAmount },
      "currentFundingGap = max(targetAmount - currentAllocatedAmount, 0)", goal.currentFundingGap);
    add(`goals[${index}].requiredMonthlyContribution`, { ...inputs, currentFundingGap: goal.currentFundingGap },
      "requiredMonthlyContribution = currentFundingGap / monthsRemaining (when horizon is valid)", goal.requiredMonthlyContribution);
    add(`goals[${index}].projectedAmount`, inputs,
      "projectedAmount = currentAllocatedAmount + (monthlyContribution × monthsRemaining), with no return applied", goal.projectedAmount);
    add(`goals[${index}].projectedGoalShortfall`, { projectedAmount: goal.projectedAmount, targetAmount: source.targetAmount },
      "projectedGoalShortfall = max(targetAmount - projectedAmount, 0)", goal.projectedGoalShortfall);
    add(`goals[${index}].monthsToGoal`, {
      currentFundingGap: goal.currentFundingGap,
      monthlyContribution: goal.monthlyContributionUsed,
    }, "monthsToGoal = ceil(currentFundingGap / monthlyContribution); 0 if funded, null if contribution is not positive", goal.monthsToGoal);
    add(`goals[${index}].feasible`, {
      projectedGoalShortfall: goal.projectedGoalShortfall,
      returnAssumption: source.returnAssumption,
      monthsRemaining: goal.monthsRemaining,
    }, "feasible = true when already funded or a zero-return projection within the horizon reaches target; null when unavailable", goal.feasible);
  });
  return records;
}
