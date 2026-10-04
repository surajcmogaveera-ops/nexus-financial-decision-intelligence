import { decimalToMinorUnits } from "../money.js";
import type { FinancialTwin, GoalProgress, RiskFlag } from "../types.js";
import { calculateScenarioDelta, type ScenarioDelta } from "./financialMetrics.js";
import { sumDecimalAmounts } from "./goalProgress.js";

function reductionSeverity(baseline: number, scenario: number): RiskFlag["severity"] {
  if (baseline <= 0) return "high";
  const percent = ((baseline - scenario) / baseline) * 100;
  if (percent >= 50) return "high";
  if (percent >= 10) return "medium";
  return "low";
}

function increaseSeverity(baseline: number, scenario: number): RiskFlag["severity"] {
  if (baseline === 0 && scenario > 0) return "high";
  const percent = ((scenario - baseline) / baseline) * 100;
  if (percent >= 50) return "high";
  if (percent >= 10) return "medium";
  return "low";
}

function projectedGoalShortfall(goals: GoalProgress[]): string | null {
  return sumDecimalAmounts(goals.map((goal) => goal.projectedGoalShortfall));
}

function isNegative(value: string): boolean {
  return decimalToMinorUnits(value, "derived amount", true) < 0n;
}

export function calculateProfileRiskFlags(twin: FinancialTwin): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (isNegative(twin.derived.monthlySurplus)) {
    flags.push({
      type: "NEGATIVE_SURPLUS",
      severity: "high",
      trigger: "monthlySurplus < 0",
      details: { monthlySurplus: twin.derived.monthlySurplus },
    });
  }

  const projectedGap = projectedGoalShortfall(twin.derived.goals);
  if (
    projectedGap !== null &&
    decimalToMinorUnits(projectedGap, "projected goal shortfall") > 0n
  ) {
    flags.push({
      type: "GOAL_SHORTFALL",
      severity: "medium",
      trigger: "projectedAmount < targetAmount within the selected horizon",
      details: { projectedGoalShortfall: projectedGap },
    });
  }

  if (twin.derived.emergencyCoverageMonths === null) {
    flags.push({
      type: "MISSING_DATA",
      severity: "low",
      trigger: "essentialMonthlyExpenses is unavailable or zero",
      details: { metric: "emergencyCoverageMonths", available: false },
    });
  }
  return flags;
}

export function calculateScenarioRiskFlags(
  baseline: FinancialTwin,
  scenario: FinancialTwin,
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const liquidityDelta = calculateScenarioDelta(
    baseline.raw.liquidSavings,
    scenario.raw.liquidSavings,
  );
  if (typeof liquidityDelta.delta === "string" && isNegative(liquidityDelta.delta)) {
    const baselineValue = Number(baseline.raw.liquidSavings);
    const scenarioValue = Number(scenario.raw.liquidSavings);
    flags.push({
      type: "LIQUIDITY_REDUCTION",
      severity: reductionSeverity(baselineValue, scenarioValue),
      trigger: "scenarioLiquidSavings < baselineLiquidSavings",
      details: { delta: liquidityDelta.delta, percentageDelta: liquidityDelta.percentageDelta },
    });
  }

  const rawGapDelta = calculateScenarioDelta(
    baseline.derived.currentFundingGap,
    scenario.derived.currentFundingGap,
  );
  const baselineProjectedGap = projectedGoalShortfall(baseline.derived.goals);
  const scenarioProjectedGap = projectedGoalShortfall(scenario.derived.goals);
  const projectedGapDelta = baselineProjectedGap === null || scenarioProjectedGap === null
    ? null
    : calculateScenarioDelta(baselineProjectedGap, scenarioProjectedGap);
  const rawGapIncreased = typeof rawGapDelta.delta === "string" && isPositive(rawGapDelta.delta);
  const projectedGapIncreased = typeof projectedGapDelta?.delta === "string" &&
    isPositive(projectedGapDelta.delta);

  if (rawGapIncreased || projectedGapIncreased) {
    const baselineFeasible = baseline.derived.goals.length > 0 &&
      baseline.derived.goals.every((goal) => goal.feasible === true);
    const scenarioFeasible = scenario.derived.goals.length > 0 &&
      scenario.derived.goals.every((goal) => goal.feasible === true);
    let severity: RiskFlag["severity"];
    if (baselineFeasible && !scenarioFeasible) {
      severity = "high";
    } else {
      const oldGap = baselineProjectedGap !== null
        ? Number(baselineProjectedGap)
        : Number(baseline.derived.currentFundingGap);
      const newGap = scenarioProjectedGap !== null
        ? Number(scenarioProjectedGap)
        : Number(scenario.derived.currentFundingGap);
      const percent = oldGap > 0 ? ((newGap - oldGap) / oldGap) * 100 : Number.POSITIVE_INFINITY;
      severity = oldGap === 0 || percent >= 10 ? "medium" : "low";
    }
    flags.push({
      type: "GOAL_SHORTFALL",
      severity,
      trigger: projectedGapIncreased
        ? "scenarioProjectedGoalShortfall > baselineProjectedGoalShortfall"
        : "scenarioCurrentFundingGap > baselineCurrentFundingGap",
      details: {
        baselineCurrentFundingGap: baseline.derived.currentFundingGap,
        scenarioCurrentFundingGap: scenario.derived.currentFundingGap,
        baselineProjectedGoalShortfall: baselineProjectedGap,
        scenarioProjectedGoalShortfall: scenarioProjectedGap,
      },
    });
  }

  if (isNegative(scenario.derived.monthlySurplus)) {
    flags.push({
      type: "NEGATIVE_SURPLUS",
      severity: "high",
      trigger: "scenarioMonthlySurplus < 0",
      details: { monthlySurplus: scenario.derived.monthlySurplus },
    });
  }

  const baselineDebtBurden = baseline.derived.debtToIncome;
  const scenarioDebtBurden = scenario.derived.debtToIncome;
  if (
    baselineDebtBurden !== null &&
    scenarioDebtBurden !== null &&
    scenarioDebtBurden > baselineDebtBurden
  ) {
    flags.push({
      type: "HIGHER_DEBT_BURDEN",
      severity: increaseSeverity(baselineDebtBurden, scenarioDebtBurden),
      trigger: "scenarioDebtToIncome > baselineDebtToIncome",
      details: { baselineDebtToIncome: baselineDebtBurden, scenarioDebtToIncome: scenarioDebtBurden },
    });
  }

  const baselineCoverage = baseline.derived.emergencyCoverageMonths;
  const scenarioCoverage = scenario.derived.emergencyCoverageMonths;
  if (baselineCoverage !== null && scenarioCoverage !== null && scenarioCoverage < baselineCoverage) {
    flags.push({
      type: "EMERGENCY_COVERAGE_REDUCTION",
      severity: reductionSeverity(baselineCoverage, scenarioCoverage),
      trigger: "scenarioEmergencyCoverageMonths < baselineEmergencyCoverageMonths",
      details: { baselineEmergencyCoverageMonths: baselineCoverage, scenarioEmergencyCoverageMonths: scenarioCoverage },
    });
  }
  return flags;
}

function isPositive(delta: string): boolean {
  return decimalToMinorUnits(delta, "scenario delta", true) > 0n;
}

export function liquidityImpact(baseline: string, scenario: string): ScenarioDelta {
  return calculateScenarioDelta(baseline, scenario);
}

