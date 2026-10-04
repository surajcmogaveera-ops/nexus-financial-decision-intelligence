import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAdditionalScenarioShortfall,
  calculateDebtBurden,
  calculateEmergencyCoverage,
  calculateFinancialMetrics,
  calculateCurrentFundingGap,
  calculateGoalProgress,
  calculateLiquidityImpact,
  calculateMonthlySurplus,
  calculateRequiredContribution,
  calculateScenarioDelta,
  calculateSavingsRate,
  calculateScenarioRiskFlags,
  calculateRiskFlags,
  calculationEvidenceId,
  canonicalEvidenceNumber,
  canonicalizeEvidenceValue,
  monthsBetweenDates,
  projectGoal,
} from "../dist/financial/engine/index.js";
import { calculateFinancialTwin } from "../dist/financial/service.js";
import { parseFinancialTwinRequest } from "../dist/financial/schemas.js";
import { BASIC_PROFILE, EXPECTED, FLAGSHIP_BASELINE, INVEST_5000_SCENARIO } from "./fixtures/financial-parity-fixtures.mjs";

function twin(profile) {
  return calculateFinancialTwin(parseFinancialTwinRequest({
    profile,
    asOfDate: "2026-10-04",
  }));
}

test("basic Financial Twin metrics match the Python reference fixture", () => {
  const metrics = twin(BASIC_PROFILE).derived;
  assert.equal(metrics.monthlySurplus, EXPECTED.basic.monthlySurplus);
  assert.ok(Math.abs(metrics.savingsRate - EXPECTED.basic.savingsRate) < 1e-15);
  assert.equal(metrics.debtToIncome, EXPECTED.basic.debtToIncome);
  assert.equal(metrics.emergencyCoverageMonths, EXPECTED.basic.emergencyCoverageMonths);
  assert.equal(metrics.currentFundingGap, EXPECTED.basic.currentFundingGap);
});

test("monthly surplus is exact and excludes the separate investment contribution", () => {
  assert.equal(calculateMonthlySurplus("30000", "20000", "0"), "10000");
  const metrics = twin(INVEST_5000_SCENARIO).derived;
  assert.equal(metrics.monthlySurplus, "10000");
  assert.equal(metrics.availableMonthlyCashFlow, "5000");
});

test("zero income leaves savings rate and debt burden unavailable", () => {
  assert.equal(calculateSavingsRate("0", "0"), null);
  assert.equal(calculateDebtBurden("0", "0"), null);
});

test("zero essential expenses and missing essentials do not divide by zero", () => {
  assert.equal(calculateEmergencyCoverage("40000", "0"), null);
  assert.equal(calculateEmergencyCoverage("40000", undefined), null);
});

test("goal gap, required contribution, projection and time-to-goal match reference cases", () => {
  assert.equal(calculateCurrentFundingGap("200000", "40000"), "160000");
  assert.equal(calculateCurrentFundingGap("100", "120"), "0");
  assert.equal(
    calculateRequiredContribution("200000", "40000", 12),
    "13333.33333333333333333333333",
  );
  assert.equal(calculateRequiredContribution("200000", "40000", 0), null);
  assert.equal(projectGoal("40000", "10000", 12), "160000");
  assert.equal(projectGoal("40000", "5000", 12), "100000");
  assert.equal(monthsBetweenDates("2026-10-04", "2027-10-04"), 12);
  assert.equal(monthsBetweenDates("2026-10-04", "2026-10-04"), 0);
  assert.throws(() => monthsBetweenDates("2026-10-04", "2026-10-03"), /before/);
});

test("goal calculations distinguish funded, feasible, shortfall and unreachable", () => {
  const goal = {
    name: "Short-term goal",
    targetAmount: "200000",
    currentAllocatedAmount: "40000",
    monthsRemaining: 12,
    priority: 1,
    status: "active",
    returnAssumption: 0,
  };
  const progress = calculateGoalProgress(goal, 12, "10000");
  assert.equal(progress.projectedAmount, "160000");
  assert.equal(progress.currentFundingGap, "160000");
  assert.equal(progress.projectedGoalShortfall, "40000");
  assert.equal(progress.feasible, false);
  assert.equal(progress.status, "SHORTFALL");
  assert.match(progress.statusMessage, /not reachable within the selected horizon/);
  assert.equal(calculateGoalProgress({ ...goal, targetAmount: "40000" }, 12).monthsToGoal, 0);
  assert.equal(calculateGoalProgress(goal, 12, "0").status, "UNREACHABLE");
  assert.equal(calculateGoalProgress(goal, null, "5000").status, "UNAVAILABLE");
  assert.equal(calculateGoalProgress({ ...goal, returnAssumption: 0.05 }, 12).projectedAmount, null);
});

test("investment contribution is not double-counted as goal funding", () => {
  const baseline = twin(FLAGSHIP_BASELINE).derived.goals[0];
  const scenario = twin(INVEST_5000_SCENARIO).derived.goals[0];
  assert.equal(baseline.projectedAmount, EXPECTED.flagshipBaseline.projectedAmount);
  assert.equal(baseline.projectedGoalShortfall, EXPECTED.flagshipBaseline.projectedGoalShortfall);
  assert.equal(scenario.projectedAmount, EXPECTED.invest5000.projectedAmount);
  assert.equal(scenario.projectedGoalShortfall, EXPECTED.invest5000.projectedGoalShortfall);
  assert.equal(calculateAdditionalScenarioShortfall(baseline, scenario), EXPECTED.invest5000.additionalScenarioShortfall);
});

test("scenario absolute and percentage deltas are deterministic", () => {
  assert.deepEqual(calculateScenarioDelta("100", "125"), {
    delta: "25",
    percentageDelta: 25,
  });
  assert.deepEqual(calculateScenarioDelta(0.1, 0.15), {
    delta: 0.04999999999999999,
    percentageDelta: 49.999999999999986,
  });
  assert.deepEqual(calculateScenarioDelta("0", "25"), {
    delta: "25",
    percentageDelta: null,
  });
  assert.deepEqual(calculateLiquidityImpact("40000", "30000"), {
    delta: "-10000",
    percentageDelta: -25,
  });
  assert.deepEqual(calculateLiquidityImpact(null, "30000"), {
    delta: null,
    percentageDelta: null,
  });
});

test("risk flags preserve the deterministic reference conditions and order", () => {
  const baseline = twin({
    ...FLAGSHIP_BASELINE,
    goals: [{
      ...FLAGSHIP_BASELINE.goals[0],
      targetAmount: "100000",
      currentAllocatedAmount: "40000",
      monthlyContribution: "5000",
    }],
  });
  const scenario = twin({
    ...FLAGSHIP_BASELINE,
    monthlyExpenses: "32000",
    monthlyDebtPayments: "3000",
    liquidSavings: "30000",
    essentialMonthlyExpenses: "25000",
    goals: [{
      ...FLAGSHIP_BASELINE.goals[0],
      targetAmount: "150000",
      currentAllocatedAmount: "20000",
      monthlyContribution: "1000",
    }],
  });
  assert.deepEqual(
    calculateScenarioRiskFlags(baseline, scenario).map(({ type, severity }) => [type, severity]),
    [
      ["LIQUIDITY_REDUCTION", "medium"],
      ["GOAL_SHORTFALL", "high"],
      ["NEGATIVE_SURPLUS", "high"],
      ["HIGHER_DEBT_BURDEN", "high"],
      ["EMERGENCY_COVERAGE_REDUCTION", "medium"],
    ],
  );
});

test("ported risk detector matches reference ordering, explicit metrics and stable evidence", () => {
  const baseline = twin({
    ...BASIC_PROFILE,
    goals: [{ name: "Goal", targetAmount: "100", currentAllocatedAmount: "50", monthsRemaining: 10, monthlyContribution: "5" }],
  });
  const scenario = twin({
    ...BASIC_PROFILE,
    monthlyExpenses: "32000",
    monthlyDebtPayments: "3000",
    liquidSavings: "30000",
    essentialMonthlyExpenses: "25000",
    goals: [{ name: "Goal", targetAmount: "200", currentAllocatedAmount: "50", monthsRemaining: 10, monthlyContribution: "5" }],
  });
  const options = {
    baselineLiquidSavings: baseline.raw.liquidSavings,
    scenarioLiquidSavings: scenario.raw.liquidSavings,
    baselineGoalFeasible: true,
    scenarioGoalFeasible: false,
  };
  const first = calculateRiskFlags(baseline.derived, scenario.derived, options);
  const second = calculateRiskFlags(baseline.derived, scenario.derived, options);
  assert.deepEqual(first, second);
  assert.deepEqual(first.flags.map(({ type, severity }) => [type, severity]), [
    ["LIQUIDITY_REDUCTION", "medium"],
    ["GOAL_SHORTFALL", "high"],
    ["NEGATIVE_SURPLUS", "high"],
    ["HIGHER_DEBT_BURDEN", "high"],
    ["EMERGENCY_COVERAGE_REDUCTION", "medium"],
  ]);
  const evidence = new Map(first.calculations.map((item) => [item.evidenceId, item]));
  for (const flag of first.flags) {
    assert.ok(flag.evidence.length > 0);
    for (const id of flag.evidence) {
      assert.match(id, /^CALC-[0-9A-F]{12}$/);
      assert.equal(evidence.get(id)?.provenance, "COMPUTED");
      assert.equal(evidence.get(id)?.result, true);
    }
  }
});

test("risk detector leaves missing comparison data unavailable and does not flag it", () => {
  const missing = twin({ ...BASIC_PROFILE, essentialMonthlyExpenses: undefined });
  const result = calculateRiskFlags(missing.derived, missing.derived);
  assert.deepEqual(result.flags, []);
  assert.deepEqual(result.calculations, []);
});

test("evidence numbers have a stable 16-significant-digit canonical form", () => {
  const value = 0.3333333333333333;
  assert.equal(canonicalEvidenceNumber(value), "0.3333333333333333");
  assert.equal(canonicalEvidenceNumber(value), canonicalEvidenceNumber(value));
  const ratioIdentity = () => calculationEvidenceId({
    metric: "savings_rate",
    expression: "monthly_surplus / monthly_income",
    baseline: value,
    scenario: 0.3333333333333333,
    result: true,
    provenance: "COMPUTED",
  });
  assert.equal(ratioIdentity(), ratioIdentity());
  assert.deepEqual(canonicalizeEvidenceValue({ z: 0.33, a: "0.3300" }), {
    a: "0.33",
    z: "0.33",
  });
});

test("equivalent decimal spellings and signed zero have identical evidence IDs", () => {
  const evidence = (baseline) => calculationEvidenceId({
    metric: "debt_to_income",
    expression: "scenario_dti > baseline_dti",
    baseline,
    scenario: "0.4",
    result: true,
    provenance: "COMPUTED",
  });
  assert.equal(evidence("0.33"), evidence("0.3300"));
  assert.equal(evidence(-0), evidence(0));
  assert.equal(evidence("-0.000"), evidence("0"));
});

test("evidence identity rejects NaN and infinity values", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "NaN", "Infinity"]) {
    assert.throws(() => canonicalEvidenceNumber(value));
  }
});

test("canonical TypeScript identity matches a finite Python-reference evidence value", () => {
  assert.equal(calculationEvidenceId({
    metric: "debt_to_income",
    expression: "scenario_dti > baseline_dti",
    baseline: "0.3300",
    scenario: 0.4,
    result: true,
    provenance: "COMPUTED",
  }), "CALC-CF1943AB4D79");
});

test("Python Decimal ratio outputs map to the same identity as their JS ratio display", () => {
  const identity = (ratio) => calculationEvidenceId({
    metric: "savings_rate",
    expression: "monthly_surplus / monthly_income",
    baseline: ratio,
    scenario: "0.5",
    result: true,
    provenance: "COMPUTED",
  });
  const pythonDecimalRatio = "0.3333333333333333333333333333";
  const javascriptRatio = 0.3333333333333333;
  assert.equal(canonicalEvidenceNumber(pythonDecimalRatio), "0.3333333333333333");
  assert.equal(identity(pythonDecimalRatio), identity(javascriptRatio));
});

test("risk severity thresholds use canonical decimals at exact percentage boundaries", () => {
  const baseline = twin({ ...BASIC_PROFILE, monthlyIncome: "10000", monthlyExpenses: "0", monthlyDebtPayments: "1000" });
  const scenario = twin({ ...BASIC_PROFILE, monthlyIncome: "10000", monthlyExpenses: "0", monthlyDebtPayments: "1500" });
  const result = calculateRiskFlags(baseline.derived, scenario.derived);
  assert.deepEqual(result.flags.map(({ type, severity }) => [type, severity]), [
    ["HIGHER_DEBT_BURDEN", "high"],
  ]);
});

test("undefined and null have distinct deterministic evidence representations", () => {
  assert.deepEqual(canonicalizeEvidenceValue(undefined), { $type: "undefined" });
  assert.equal(canonicalizeEvidenceValue(null), null);
  const identity = (baseline) => calculationEvidenceId({
    metric: "optional_metric",
    expression: "is_available",
    baseline,
    scenario: null,
    result: false,
    provenance: "COMPUTED",
  });
  assert.notEqual(identity(undefined), identity(null));
});

test("all monetary inputs reject negative, non-finite and malformed values", () => {
  for (const value of [-1, "-1", "NaN", "Infinity", "1.001", "1e4"]) {
    assert.throws(() => parseFinancialTwinRequest({
      profile: { monthlyIncome: value, monthlyExpenses: 1, liquidSavings: 1 },
    }));
  }
  assert.throws(() => parseFinancialTwinRequest({
    profile: {
      ...BASIC_PROFILE,
      goals: [{ name: "Bad", targetAmount: "-1" }],
    },
  }));
  assert.throws(() => parseFinancialTwinRequest({
    profile: {
      ...BASIC_PROFILE,
      monthlyInvestmentContribution: "-1",
    },
  }));
  assert.throws(() => calculateDebtBurden("-1", "30000"));
  assert.throws(() => calculateEmergencyCoverage("-1", "20000"));
  assert.throws(() => projectGoal("-1", "100", 1));
  assert.throws(() => projectGoal("100", "-1", 1));
});

test("invalid goal horizons and non-finite values are rejected", () => {
  for (const monthsRemaining of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => parseFinancialTwinRequest({
      profile: {
        ...BASIC_PROFILE,
        goals: [{ name: "Bad horizon", targetAmount: "1", monthsRemaining }],
      },
    }));
  }
  assert.throws(() => parseFinancialTwinRequest({
    profile: {
      ...BASIC_PROFILE,
      goals: [{ name: "Bad date", targetAmount: "1", targetDate: "2027-02-30" }],
    },
    asOfDate: "2026-10-04",
  }));
});

test("every derived metric is computed provenance and raw state has no derived fields", () => {
  const result = twin(BASIC_PROFILE);
  assert.equal(result.provenance.derived.monthlySurplus, "COMPUTED");
  assert.equal(result.provenance.raw.monthlyIncome, "USER");
  assert.equal(result.provenance.raw.monthlyDebtPayments, "USER");
  assert.equal(result.provenance.raw.monthlyInvestmentContribution, "USER");
  assert.equal(result.provenance.raw.investments, "USER");
  assert.equal(result.provenance.raw.essentialMonthlyExpenses, "USER");
  assert.equal("monthlySurplus" in result.raw, false);
  assert.equal("savingsRate" in result.raw, false);
  assert.throws(() => parseFinancialTwinRequest({
    profile: { ...BASIC_PROFILE, provenance: { monthlyIncome: "AI_INTERPRETATION" } },
  }), /unsupported fields/i);
});

