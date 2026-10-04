import { addMoney, decimalToMinorUnits, divideMoney, minorUnitsToMoney, moneyToNumber, subtractMoney } from "../money.js";
import type { DerivedFinancialMetrics, FinancialProfile, FinancialTwinRequest, GoalProgress, Money } from "../types.js";
import { calculateCurrentFundingGap, calculateGoalProgress, monthsBetweenDates, sumDecimalAmounts } from "./goalProgress.js";

export interface ScenarioDelta {
  delta: number | Money | null;
  percentageDelta: number | null;
}

function ratio(numerator: Money, denominator: Money): number | null {
  const denominatorMinor = decimalToMinorUnits(denominator, "denominator");
  if (denominatorMinor === 0n) return null;
  const value = moneyToNumber(numerator) / moneyToNumber(denominator);
  if (!Number.isFinite(value)) throw new TypeError("ratio exceeds supported numeric range");
  return value;
}

export function calculateMonthlySurplus(
  monthlyIncome: Money,
  monthlyExpenses: Money,
  monthlyDebtPayments: Money,
): Money {
  const income = decimalToMinorUnits(monthlyIncome, "monthlyIncome");
  const expenses = decimalToMinorUnits(monthlyExpenses, "monthlyExpenses");
  const debt = decimalToMinorUnits(monthlyDebtPayments, "monthlyDebtPayments");
  return minorUnitsToMoney(income - expenses - debt);
}

export function calculateSavingsRate(
  monthlySurplus: Money,
  monthlyIncome: Money,
): number | null {
  return ratio(monthlySurplus, monthlyIncome);
}

export function calculateDebtBurden(
  monthlyDebtPayments: Money,
  monthlyIncome: Money,
): number | null {
  return ratio(monthlyDebtPayments, monthlyIncome);
}

export function calculateEmergencyCoverage(
  liquidSavings: Money,
  essentialMonthlyExpenses: Money | undefined,
): number | null {
  if (essentialMonthlyExpenses === undefined || essentialMonthlyExpenses === "0") return null;
  return ratio(liquidSavings, essentialMonthlyExpenses);
}

export function calculateTotalCurrentFundingGap(goals: FinancialProfile["goals"]): Money {
  return goals.reduce(
    (total, goal) => addMoney(
      total,
      calculateCurrentFundingGap(goal.targetAmount, goal.currentAllocatedAmount),
    ),
    "0",
  );
}

export function calculateRequiredMonthlyContribution(
  goals: GoalProgress[],
): Money | null {
  return sumDecimalAmounts(goals.map((goal) => goal.requiredMonthlyContribution));
}

export function calculateScenarioDelta(
  baseline: number | Money | null,
  scenario: number | Money | null,
): ScenarioDelta {
  if (baseline === null || scenario === null) {
    return { delta: null, percentageDelta: null };
  }
  if (typeof baseline === "string" && typeof scenario === "string") {
    const baselineMinor = decimalToMinorUnits(baseline, "baseline", true);
    const scenarioMinor = decimalToMinorUnits(scenario, "scenario", true);
    const delta = minorUnitsToMoney(scenarioMinor - baselineMinor);
    const percentageDelta = baselineMinor === 0n
      ? null
      : ((Number(scenarioMinor - baselineMinor) / Math.abs(Number(baselineMinor))) * 100);
    return { delta, percentageDelta };
  }
  const baselineNumber = Number(baseline);
  const scenarioNumber = Number(scenario);
  if (!Number.isFinite(baselineNumber) || !Number.isFinite(scenarioNumber)) {
    throw new TypeError("scenario metrics must be finite numbers");
  }
  const delta = scenarioNumber - baselineNumber;
  return {
    delta,
    percentageDelta: baselineNumber === 0
      ? null
      : (delta / Math.abs(baselineNumber)) * 100,
  };
}

/** Scenario projected shortfall minus baseline projected shortfall; null when either projection is unavailable. */
export function calculateAdditionalScenarioShortfall(
  baseline: GoalProgress,
  scenario: GoalProgress,
): Money | null {
  if (baseline.projectedGoalShortfall === null || scenario.projectedGoalShortfall === null) {
    return null;
  }
  const { delta } = calculateScenarioDelta(
    baseline.projectedGoalShortfall,
    scenario.projectedGoalShortfall,
  );
  return typeof delta === "string" ? delta : null;
}

function resolveGoalHorizon(goal: FinancialProfile["goals"][number], asOfDate: string): number | null {
  if (goal.monthsRemaining !== undefined) return goal.monthsRemaining;
  if (!goal.targetDate) return null;
  return monthsBetweenDates(asOfDate, goal.targetDate);
}

export function calculateFinancialMetrics(
  profile: FinancialProfile,
  asOfDate: FinancialTwinRequest["asOfDate"],
): DerivedFinancialMetrics {
  const monthlySurplus = calculateMonthlySurplus(
    profile.monthlyIncome,
    profile.monthlyExpenses,
    profile.monthlyDebtPayments,
  );
  const availableMonthlyCashFlow = subtractMoney(
    monthlySurplus,
    profile.monthlyInvestmentContribution,
  );

  let defaultGoalContribution: Money = "0";
  if (profile.goals.length === 1 && decimalToMinorUnits(availableMonthlyCashFlow, "cash flow", true) > 0n) {
    defaultGoalContribution = availableMonthlyCashFlow;
  }
  const goalProgress = profile.goals.map((goal) => calculateGoalProgress(
    goal,
    resolveGoalHorizon(goal, asOfDate),
    goal.monthlyContribution ?? defaultGoalContribution,
  ));

  return {
    monthlySurplus,
    availableMonthlyCashFlow,
    savingsRate: calculateSavingsRate(monthlySurplus, profile.monthlyIncome),
    debtToIncome: calculateDebtBurden(profile.monthlyDebtPayments, profile.monthlyIncome),
    emergencyCoverageMonths: calculateEmergencyCoverage(
      profile.liquidSavings,
      profile.essentialMonthlyExpenses,
    ),
    currentFundingGap: calculateTotalCurrentFundingGap(profile.goals),
    requiredMonthlyContribution: calculateRequiredMonthlyContribution(goalProgress),
    goals: goalProgress,
  };
}

export function calculateLiquidityImpact(baselineSavings: Money, scenarioSavings: Money): ScenarioDelta {
  return calculateScenarioDelta(baselineSavings, scenarioSavings);
}

