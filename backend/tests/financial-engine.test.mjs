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

