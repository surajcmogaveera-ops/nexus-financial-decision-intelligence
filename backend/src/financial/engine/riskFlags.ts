import { decimalToMinorUnits } from "../money.js";
import { calculationEvidenceId, canonicalEvidenceNumber } from "./evidenceIdentity.js";
import { Provenance } from "../constants.js";
import type {
  FinancialTwin,
  RiskCalculationEvidence,
  RiskDetectionResult,
  RiskFlag,
} from "../types.js";
import { calculateScenarioDelta, type ScenarioDelta } from "./financialMetrics.js";

function changePercentAtLeast(baseline: number | string, scenario: number | string, threshold: 10 | 50, reduction: boolean): boolean {
  const values = [baseline, scenario].map((value) => {
    const canonical = canonicalEvidenceNumber(value);
    const negative = canonical.startsWith("-");
    const unsigned = negative ? canonical.slice(1) : canonical;
    const [whole, fraction = ""] = unsigned.split(".");
    return { negative, whole, fraction };
  });
  const fractionLength = Math.max(...values.map(({ fraction }) => fraction.length));
  const [baselineParts, scenarioParts] = values;
  const toScaled = ({ negative, whole, fraction }: (typeof values)[number]): bigint => {
    const scaled = BigInt(`${whole}${fraction.padEnd(fractionLength, "0")}`);
    return negative ? -scaled : scaled;
  };
  const baselineValue = toScaled(baselineParts);
  const scenarioValue = toScaled(scenarioParts);
  const change = reduction ? baselineValue - scenarioValue : scenarioValue - baselineValue;
  return change * 100n >= baselineValue * BigInt(threshold);
}

function reductionSeverity(baseline: number, scenario: number): RiskFlag["severity"] {
  if (baseline <= 0) return "high";
  if (changePercentAtLeast(baseline, scenario, 50, true)) return "high";
  if (changePercentAtLeast(baseline, scenario, 10, true)) return "medium";
  return "low";
}

function increaseSeverity(baseline: number, scenario: number): RiskFlag["severity"] {
  if (baseline === 0 && scenario > 0) return "high";
  if (changePercentAtLeast(baseline, scenario, 50, false)) return "high";
  if (changePercentAtLeast(baseline, scenario, 10, false)) return "medium";
  return "low";
}

function evidenceId(record: Omit<RiskCalculationEvidence, "evidenceId">): string {
  return calculationEvidenceId({
    metric: record.metric,
    expression: record.expression,
    baseline: record.baselineValue,
    scenario: record.scenarioValue,
    result: record.result,
    provenance: record.provenance,
  });
}

function makeEvidence(
  metric: string,
  expression: string,
  baselineValue: RiskCalculationEvidence["baselineValue"],
  scenarioValue: RiskCalculationEvidence["scenarioValue"],
): RiskCalculationEvidence {
  const partial: Omit<RiskCalculationEvidence, "evidenceId"> = {
    metric,
    expression,
    baselineValue,
    scenarioValue,
    result: true,
    provenance: Provenance.COMPUTED,
  };
  return { ...partial, evidenceId: evidenceId(partial) };
}

/** Compare already-derived metrics. This function never recalculates or mutates its inputs. */
export function calculateRiskFlags(
  baseline: FinancialTwin["derived"],
  scenario: FinancialTwin["derived"],
  options: {
    baselineLiquidSavings?: string | null;
    scenarioLiquidSavings?: string | null;
    baselineGoalFeasible?: boolean | null;
    scenarioGoalFeasible?: boolean | null;
  } = {},
): RiskDetectionResult {
  const flags: RiskFlag[] = [];
  const calculations: RiskCalculationEvidence[] = [];

  const record = (
    metric: string,
    expression: string,
    baselineValue: RiskCalculationEvidence["baselineValue"],
    scenarioValue: RiskCalculationEvidence["scenarioValue"],
  ): string => {
    const item = makeEvidence(metric, expression, baselineValue, scenarioValue);
    calculations.push(item);
    return item.evidenceId;
  };

  const liquidity = calculateScenarioDelta(
    options.baselineLiquidSavings ?? null,
    options.scenarioLiquidSavings ?? null,
  );
  if (typeof liquidity.delta === "string" && decimalToMinorUnits(liquidity.delta, "liquidity delta", true) < 0n) {
    const baselineValue = Number(options.baselineLiquidSavings);
    const scenarioValue = Number(options.scenarioLiquidSavings);
    const id = record("liquid_savings", "scenario_liquid_savings < baseline_liquid_savings", options.baselineLiquidSavings!, options.scenarioLiquidSavings!);
    flags.push({
      type: "LIQUIDITY_REDUCTION",
      severity: reductionSeverity(baselineValue, scenarioValue),
      trigger: "scenario_liquid_savings < baseline_liquid_savings",
      evidence: [id],
      details: { delta: liquidity.delta, percentageDelta: liquidity.percentageDelta },
    });
  }

  const goalDelta = calculateScenarioDelta(baseline.currentFundingGap, scenario.currentFundingGap);
  if (typeof goalDelta.delta === "string" && decimalToMinorUnits(goalDelta.delta, "goal gap delta", true) > 0n) {
    const id = record("goal_funding_gap", "scenario_goal_gap > baseline_goal_gap", baseline.currentFundingGap, scenario.currentFundingGap);
    const becameInfeasible = options.baselineGoalFeasible === true && options.scenarioGoalFeasible === false;
    const baselineGap = decimalToMinorUnits(baseline.currentFundingGap, "baseline goal gap");
    const severity = becameInfeasible
      ? "high"
      : baselineGap > 0n
        ? changePercentAtLeast(baseline.currentFundingGap, scenario.currentFundingGap, 10, false) ? "medium" : "low"
        : "medium";
    const evidence = [id];
    if (becameInfeasible) evidence.push(record("goal_feasibility", "baseline_goal_feasible and not scenario_goal_feasible", true, false));
    flags.push({
      type: "GOAL_SHORTFALL",
      severity,
      trigger: "scenario_goal_gap > baseline_goal_gap",
      evidence,
      details: { baselineCurrentFundingGap: baseline.currentFundingGap, scenarioCurrentFundingGap: scenario.currentFundingGap },
    });
  }

  if (Number(scenario.monthlySurplus) < 0) {
    const id = record("monthly_surplus", "scenario_monthly_surplus < 0", baseline.monthlySurplus, scenario.monthlySurplus);
    flags.push({ type: "NEGATIVE_SURPLUS", severity: "high", trigger: "scenario_monthly_surplus < 0", evidence: [id], details: { monthlySurplus: scenario.monthlySurplus } });
  }

  const debtDelta = calculateScenarioDelta(baseline.debtToIncome, scenario.debtToIncome);
  if (typeof debtDelta.delta === "number" && debtDelta.delta > 0) {
    const id = record("debt_to_income", "scenario_dti > baseline_dti", baseline.debtToIncome, scenario.debtToIncome);
    flags.push({ type: "HIGHER_DEBT_BURDEN", severity: increaseSeverity(baseline.debtToIncome!, scenario.debtToIncome!), trigger: "scenario_dti > baseline_dti", evidence: [id], details: { baselineDebtToIncome: baseline.debtToIncome, scenarioDebtToIncome: scenario.debtToIncome } });
  }

  const coverageDelta = calculateScenarioDelta(baseline.emergencyCoverageMonths, scenario.emergencyCoverageMonths);
  if (typeof coverageDelta.delta === "number" && coverageDelta.delta < 0) {
    const id = record("emergency_coverage_months", "scenario_emergency_coverage_months < baseline_emergency_coverage_months", baseline.emergencyCoverageMonths, scenario.emergencyCoverageMonths);
    flags.push({ type: "EMERGENCY_COVERAGE_REDUCTION", severity: reductionSeverity(baseline.emergencyCoverageMonths!, scenario.emergencyCoverageMonths!), trigger: "scenario_emergency_coverage_months < baseline_emergency_coverage_months", evidence: [id], details: { baselineEmergencyCoverageMonths: baseline.emergencyCoverageMonths, scenarioEmergencyCoverageMonths: scenario.emergencyCoverageMonths } });
  }
  return { flags, calculations };
}

function isNegative(value: string): boolean {
  return decimalToMinorUnits(value, "derived amount", true) < 0n;
}

export function calculateProfileRiskFlags(twin: FinancialTwin): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (isNegative(twin.derived.monthlySurplus)) {
    const result = calculateRiskFlags(
      { ...twin.derived, monthlySurplus: "0" },
      twin.derived,
    );
    flags.push(...result.flags);
  }
  const projectedGap = twin.derived.goals.reduce< string | null>((total, goal) => {
    if (goal.projectedGoalShortfall === null) return null;
    if (total === null) return goal.projectedGoalShortfall;
    const left = decimalToMinorUnits(total, "projected shortfall", true);
    const right = decimalToMinorUnits(goal.projectedGoalShortfall, "projected shortfall", true);
    const sum = left + right;
    const negative = sum < 0n;
    const absolute = negative ? -sum : sum;
    const whole = absolute / 100n;
    const cents = (absolute % 100n).toString().padStart(2, "0").replace(/0$/, "");
    return `${negative ? "-" : ""}${whole}${cents ? `.${cents}` : ""}`;
  }, "0");
  if (projectedGap !== null && decimalToMinorUnits(projectedGap, "projected shortfall", true) > 0n) {
    const evidence = makeEvidence(
      "projected_goal_shortfall",
      "projected_amount < target_amount within the selected horizon",
      null,
      projectedGap,
    );
    flags.push({
      type: "GOAL_SHORTFALL",
      severity: "medium",
      trigger: "projectedAmount < targetAmount within the selected horizon",
      evidence: [evidence.evidenceId],
      details: { projectedGoalShortfall: projectedGap },
    });
  }
  if (twin.derived.emergencyCoverageMonths === null) {
    const evidence = makeEvidence("emergency_coverage_months", "essential_monthly_expenses is unavailable", null, null);
    flags.push({ type: "MISSING_DATA", severity: "low", trigger: "essentialMonthlyExpenses is unavailable or zero", evidence: [evidence.evidenceId], details: { metric: "emergencyCoverageMonths", available: false } });
  }
  return flags;
}

export function calculateScenarioRiskFlags(baseline: FinancialTwin, scenario: FinancialTwin): RiskFlag[] {
  return calculateRiskFlags(baseline.derived, scenario.derived, {
    baselineLiquidSavings: baseline.raw.liquidSavings,
    scenarioLiquidSavings: scenario.raw.liquidSavings,
    baselineGoalFeasible: baseline.derived.goals.length > 0 && baseline.derived.goals.every((goal) => goal.feasible === true),
    scenarioGoalFeasible: scenario.derived.goals.length > 0 && scenario.derived.goals.every((goal) => goal.feasible === true),
  }).flags;
}

export function liquidityImpact(baseline: string, scenario: string): ScenarioDelta {
  return calculateScenarioDelta(baseline, scenario);
}
