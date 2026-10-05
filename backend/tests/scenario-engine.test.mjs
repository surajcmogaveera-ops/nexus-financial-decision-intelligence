import assert from "node:assert/strict";
import { test } from "node:test";
import { runScenario } from "../dist/scenarios/engine.js";
import { parseScenarioInput } from "../dist/scenarios/schemas.js";
import { parseFinancialTwinRequest } from "../dist/financial/schemas.js";

const PROFILE = {
  currency: "INR",
  monthlyIncome: "30000",
  monthlyExpenses: "20000",
  monthlyDebtPayments: "0",
  liquidSavings: "40000",
  essentialMonthlyExpenses: "20000",
  investments: "0",
  monthlyInvestmentContribution: "0",
  goals: [{ name: "Flagship", targetAmount: "200000", currentAllocatedAmount: "40000", monthsRemaining: 12, priority: 1, returnAssumption: 0, status: "active" }],
};
const baseline = (profile = PROFILE) => parseFinancialTwinRequest({ profile, asOfDate: "2026-10-05" });
const run = (scenario, profile = PROFILE) => runScenario(baseline(profile), parseScenarioInput(scenario));

test("INVESTMENT_CHANGE flagship reuses existing engine and preserves baseline", () => {
  const input = baseline();
  const snapshot = structuredClone(input.request.profile);
  const result = runScenario(input, parseScenarioInput({ type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: "5000" }));
  assert.deepEqual(input.request.profile, snapshot);
  assert.equal(result.baselineMetrics.monthlySurplus, "10000");
  assert.equal(result.scenarioMetrics.availableMonthlyCashFlow, "5000");
  assert.equal(result.baselineMetrics.goals[0].projectedAmount, "160000");
  assert.equal(result.baselineMetrics.goals[0].projectedGoalShortfall, "40000");
  assert.equal(result.scenarioMetrics.goals[0].projectedAmount, "100000");
  assert.equal(result.scenarioMetrics.goals[0].projectedGoalShortfall, "100000");
  assert.equal(result.delta.additionalScenarioShortfall, "60000");
  assert.equal(result.delta.projectedGoalShortfall.delta, "60000");
  assert.equal(result.scenarioState.raw.monthlyInvestmentContribution, "5000");
  assert.equal(result.scenarioState.provenance.raw.monthlyInvestmentContribution, "COMPUTED");
  assert.equal(result.scenarioState.provenance.derived.monthlySurplus, "COMPUTED");
  assert.equal(result.scenarioState.provenance.assumptions, "ASSUMPTION");
  assert.equal(result.baselineState.provenance.goalFields[0].targetAmount, "USER");
  assert.equal(result.scenarioState.provenance.goalFields[0].targetAmount, "USER");
  assert.ok(result.riskFlags.some((flag) => flag.type === "GOAL_SHORTFALL"));
  assert.ok(result.assumptions.some((item) => item.includes("investment returns are not assumed")));
  assert.ok(result.evidence.every((record) => record.provenance === "COMPUTED" && /^CALC-[0-9A-F]{12}$/.test(record.evidenceId)));
  const evidenceIds = new Set(result.evidence.map((record) => record.evidenceId));
  for (const flag of result.riskFlags) for (const evidenceId of flag.evidence) assert.ok(evidenceIds.has(evidenceId));
});

test("all eight scenario types transform or report unsupported without fabricated impact", () => {
  const investment = run({ type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: 5000 });
  assert.equal(investment.status, "COMPLETED");
  assert.equal(investment.scenarioState.raw.monthlyInvestmentContribution, "5000");

  const income = run({ type: "INCOME_SHOCK", percentageBasisPoints: -1000 });
  assert.equal(income.scenarioState.raw.monthlyIncome, "27000");
  assert.equal(income.scenarioMetrics.monthlySurplus, "7000");
  assert.equal(income.scenarioMetrics.savingsRate, 7000 / 27000);
  assert.equal(income.scenarioMetrics.debtToIncome, 0);
  assert.equal(income.scenarioMetrics.emergencyCoverageMonths, 2);

  const expenses = run({ type: "EXPENSE_CHANGE", percentageBasisPoints: 1000 });
  assert.equal(expenses.scenarioState.raw.monthlyExpenses, "22000");
  assert.equal(expenses.scenarioMetrics.monthlySurplus, "8000");
  assert.equal(expenses.delta.monthlySurplus.delta, "-2000");

  const rent = run({ type: "RENT_CHANGE", monthlyRentDelta: "2000" });
  assert.equal(rent.scenarioState.raw.monthlyExpenses, "22000");
  assert.ok(rent.assumptions.some((item) => item.includes("mapped to monthlyExpenses")));

  const emergency = run({ type: "EMERGENCY_EXPENSE", amount: "10000" });
  assert.equal(emergency.scenarioState.raw.liquidSavings, "30000");
  assert.equal(emergency.scenarioState.raw.monthlyExpenses, PROFILE.monthlyExpenses);
  assert.equal(emergency.scenarioMetrics.emergencyCoverageMonths, 1.5);
  assert.ok(emergency.riskFlags.some((flag) => flag.type === "LIQUIDITY_REDUCTION"));

  const debt = run({ type: "DEBT_CHANGE", monthlyPaymentDelta: "1000" });
  assert.equal(debt.scenarioState.raw.monthlyDebtPayments, "1000");
  assert.equal(debt.scenarioMetrics.monthlySurplus, "9000");
  assert.equal(debt.scenarioMetrics.debtToIncome, 1000 / 30000);
  assert.ok(debt.riskFlags.some((flag) => flag.type === "HIGHER_DEBT_BURDEN"));

  const goal = run({ type: "GOAL_CHANGE", goalName: "Flagship", targetAmount: "250000", monthsRemaining: 10 });
  assert.equal(goal.scenarioState.raw.goals[0].targetAmount, "250000");
  assert.equal(goal.scenarioState.provenance.goalFields[0].targetAmount, "COMPUTED");
  assert.equal(goal.scenarioState.raw.goals[0].targetDate, undefined);
  assert.equal(goal.scenarioMetrics.goals[0].monthsRemaining, 10);
  assert.equal(goal.scenarioMetrics.goals[0].currentFundingGap, "210000");

  const market = run({ type: "MARKET_STRESS", stressBasisPoints: -1000 });
  assert.equal(market.status, "UNSUPPORTED");
  assert.deepEqual(market.scenarioState.raw, PROFILE);
  assert.deepEqual(market.delta.liquidityImpact, { delta: null, percentageDelta: null });
  assert.ok(market.assumptions.some((item) => item.includes("no asset exposure detail")));
});

test("scenario result and evidence IDs are deterministic apart from calculatedAt metadata", () => {
  const first = run({ type: "EMERGENCY_EXPENSE", amount: "1250.50" });
  const second = run({ type: "EMERGENCY_EXPENSE", amount: "1250.50" });
  assert.equal(first.scenarioId, second.scenarioId);
  assert.deepEqual(first.scenarioState, second.scenarioState);
  assert.deepEqual(first.delta, second.delta);
  assert.deepEqual(first.riskFlags, second.riskFlags);
  assert.deepEqual(first.evidence, second.evidence);
});

test("separate scenarios start from the original baseline and do not contaminate each other", () => {
  const source = baseline();
  const original = structuredClone(source.request.profile);
  const investment = runScenario(source, parseScenarioInput({ type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: "5000" }));
  const emergency = runScenario(source, parseScenarioInput({ type: "EMERGENCY_EXPENSE", amount: "10000" }));
  assert.deepEqual(source.request.profile, original);
  assert.equal(investment.scenarioState.raw.liquidSavings, "40000");
  assert.equal(emergency.scenarioState.raw.monthlyInvestmentContribution, "0");
  assert.equal(emergency.scenarioState.raw.liquidSavings, "30000");
});

test("scenario validation rejects invalid kinds, unsupported fields, bad ranges, negative results and ambiguous goals", () => {
  for (const bad of [
    { type: "UNKNOWN" },
    { type: "MARKET_STRESS", stressBasisPoints: -100, portfolioExposure: "all" },
    { type: "INCOME_SHOCK", percentageBasisPoints: -10001 },
    { type: "EMERGENCY_EXPENSE", amount: "NaN" },
  ]) {
    assert.throws(() => parseScenarioInput(bad));
  }
  assert.throws(() => run({ type: "EMERGENCY_EXPENSE", amount: "50000" }));
  assert.throws(() => run({ type: "EXPENSE_CHANGE", amountDelta: "-30000" }));
  assert.throws(() => run({ type: "INCOME_SHOCK", amountDelta: "-30001" }));
  assert.throws(() => run({ type: "GOAL_CHANGE", goalName: "Missing", targetAmount: 200 }));
  assert.throws(() => run({ type: "GOAL_CHANGE", goalName: "Same", targetAmount: "2" }, {
    ...PROFILE,
    goals: [PROFILE.goals[0], { ...PROFILE.goals[0] }],
  }));
});

test("zero-valued changes are valid and retain deterministic unchanged metrics", () => {
  const result = run({ type: "INCOME_SHOCK", amountDelta: "0" });
  assert.deepEqual(result.delta.monthlySurplus, { delta: "0", percentageDelta: 0 });
  assert.equal(result.scenarioState.raw.monthlyIncome, "30000");
});
