import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApp } from "../dist/app.js";
import { calculateFinancialTwin } from "../dist/financial/service.js";
import { parseFinancialTwinRequest } from "../dist/financial/schemas.js";
import { runScenario } from "../dist/scenarios/engine.js";
import { parseScenarioInput } from "../dist/scenarios/schemas.js";
import { mapScenarioResultToSimulationResponse } from "../dist/simulations/service.js";
import { EXPECTED, INVEST_5000_SCENARIO } from "./fixtures/financial-parity-fixtures.mjs";
import parityGoldens from "./fixtures/parity/financial-engine-python-goldens.json" with { type: "json" };

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("health remains available", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("database health returns success only after its connection check resolves", async () => {
  const dbServer = createApp({ databaseHealthCheck: async () => {} }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    dbServer.once("listening", resolve);
    dbServer.once("error", reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${dbServer.address().port}/health/db`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", database: "ok" });
  } finally {
    await new Promise((resolve, reject) => dbServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("database health failure is structured and does not affect process health", async () => {
  const dbServer = createApp({
    databaseHealthCheck: async () => { throw new Error("password=never-return-this"); },
  }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    dbServer.once("listening", resolve);
    dbServer.once("error", reject);
  });
  try {
    const base = `http://127.0.0.1:${dbServer.address().port}`;
    const databaseResponse = await fetch(`${base}/health/db`);
    assert.equal(databaseResponse.status, 503);
    const body = await databaseResponse.json();
    assert.equal(body.error.code, "DATABASE_UNAVAILABLE");
    assert.equal(JSON.stringify(body).includes("never-return-this"), false);

    const processResponse = await fetch(`${base}/health`);
    assert.equal(processResponse.status, 200);
    assert.deepEqual(await processResponse.json(), { status: "ok" });
  } finally {
    await new Promise((resolve, reject) => dbServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("recalculate returns raw, derived, provenance and risk metadata", async () => {
  const response = await fetch(`${baseUrl}/api/financial-twin/recalculate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: INVEST_5000_SCENARIO, asOfDate: "2026-10-04" }),
  });
  assert.equal(response.status, 200);
  const twin = await response.json();
  assert.equal(twin.raw.monthlyIncome, "30000");
  assert.equal(twin.raw.monthlyInvestmentContribution, "5000");
  assert.equal(twin.derived.monthlySurplus, "10000");
  assert.equal(twin.derived.availableMonthlyCashFlow, "5000");
  assert.equal(twin.derived.goals[0].projectedAmount, "100000");
  assert.equal(twin.derived.goals[0].projectedGoalShortfall, "100000");
  assert.equal(twin.provenance.derived.currentFundingGap, "COMPUTED");
  assert.ok(Array.isArray(twin.riskFlags));
  assert.ok(Number.isFinite(Date.parse(twin.calculatedAt)));
});

test("basic response matches parity outputs", async () => {
  const response = await fetch(`${baseUrl}/api/financial-twin/recalculate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profile: {
        monthlyIncome: 30000,
        monthlyExpenses: 20000,
        monthlyDebtPayments: 0,
        liquidSavings: 40000,
        essentialMonthlyExpenses: 20000,
        goals: [],
      },
      asOfDate: "2026-10-04",
    }),
  });
  assert.equal(response.status, 200);
  const { derived } = await response.json();
  assert.equal(derived.monthlySurplus, EXPECTED.basic.monthlySurplus);
  assert.equal(derived.debtToIncome, EXPECTED.basic.debtToIncome);
  assert.equal(derived.emergencyCoverageMonths, EXPECTED.basic.emergencyCoverageMonths);
});

test("scenario simulation endpoint returns deterministic-engine output and structured validation errors", async () => {
  const requestBody = {
    asOfDate: "2026-10-05",
    profile: {
      monthlyIncome: "30000",
      monthlyExpenses: "20000",
      monthlyDebtPayments: "0",
      liquidSavings: "40000",
      essentialMonthlyExpenses: "20000",
      goals: [{ name: "Flagship", targetAmount: "200000", currentAllocatedAmount: "40000", monthsRemaining: 12 }],
    },
    scenario: { type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: "5000" },
  };
  const response = await fetch(`${baseUrl}/api/scenarios/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.scenarioMetrics.availableMonthlyCashFlow, "5000");
  assert.equal(result.delta.additionalScenarioShortfall, "60000");
  assert.equal(result.provenance.scenarioDerived, "COMPUTED");

  const invalidResponse = await fetch(`${baseUrl}/api/scenarios/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...requestBody, scenario: { type: "MARKET_STRESS", stressBasisPoints: 0, guessedExposure: 10 } }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error.code, "INVALID_SCENARIO");

  const missingDate = await fetch(`${baseUrl}/api/scenarios/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: requestBody.profile, scenario: requestBody.scenario }),
  });
  assert.equal(missingDate.status, 400);
  assert.ok((await missingDate.json()).error.details.asOfDate);
});

test("POST /api/simulations returns the versioned flagship response and matches direct engine output", async () => {
  const requestBody = {
    asOfDate: "2026-10-05",
    baseline: {
      monthlyIncome: "30000",
      monthlyExpenses: "20000",
      monthlyDebtPayments: "0",
      liquidSavings: "40000",
      essentialMonthlyExpenses: "20000",
      goals: [{ name: "Flagship", targetAmount: "200000", currentAllocatedAmount: "40000", monthsRemaining: 12 }],
    },
    scenario: { type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: "5000" },
  };
  const response = await fetch(`${baseUrl}/api/simulations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ["ai", "assumptions", "baseline", "calculationVersion", "delta", "riskFlags", "scenario"].sort());
  assert.equal(result.calculationVersion, "1.0");
  assert.equal(result.baseline.derived.monthlySurplus, "10000");
  assert.equal(result.baseline.derived.goals[0].projectedAmount, "160000");
  assert.equal(result.baseline.derived.goals[0].projectedGoalShortfall, "40000");
  assert.equal(result.scenario.derived.availableMonthlyCashFlow, "5000");
  assert.equal(result.scenario.derived.goals[0].projectedAmount, "100000");
  assert.equal(result.scenario.derived.goals[0].projectedGoalShortfall, "100000");
  assert.equal(result.delta.additionalScenarioShortfall, "60000");
  assert.equal(result.scenario.type, "INVESTMENT_CHANGE");
  assert.equal(result.scenario.status, "COMPLETED");
  assert.equal(result.baseline.provenance.raw.monthlyIncome, "USER");
  assert.equal(result.scenario.provenance.raw.monthlyInvestmentContribution, "COMPUTED");
  assert.ok(result.baseline.evidence.length > 0);
  assert.ok(result.riskFlags.some((flag) => flag.type === "GOAL_SHORTFALL"));

  const direct = runScenario(
    parseFinancialTwinRequest({ profile: requestBody.baseline, asOfDate: requestBody.asOfDate }),
    parseScenarioInput(requestBody.scenario),
  );
  const { ai, ...deterministicResult } = result;
  assert.deepEqual(deterministicResult, mapScenarioResultToSimulationResponse(direct));
  assert.equal(ai.status, "NOT_CONFIGURED");
  assert.equal(ai.explanation, null);
  assert.equal(ai.message, "AI explanation unavailable.");
});

test("simulation API handles all eight scenario types consistently, including unsupported market stress", async () => {
  const baseline = {
    monthlyIncome: "30000", monthlyExpenses: "20000", monthlyDebtPayments: "0",
    liquidSavings: "40000", essentialMonthlyExpenses: "20000",
    goals: [{ name: "Flagship", targetAmount: "200000", currentAllocatedAmount: "40000", monthsRemaining: 12 }],
  };
  const scenarios = [
    { type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: "5000" },
    { type: "INCOME_SHOCK", percentageBasisPoints: -1000 },
    { type: "EXPENSE_CHANGE", percentageBasisPoints: 1000 },
    { type: "RENT_CHANGE", monthlyRentDelta: "2000" },
    { type: "EMERGENCY_EXPENSE", amount: "10000" },
    { type: "DEBT_CHANGE", monthlyPaymentDelta: "1000" },
    { type: "GOAL_CHANGE", goalName: "Flagship", targetAmount: "250000" },
    { type: "MARKET_STRESS", stressBasisPoints: -1000 },
  ];
  for (const scenario of scenarios) {
    const response = await fetch(`${baseUrl}/api/simulations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseline, asOfDate: "2026-10-05", scenario }),
    });
    assert.equal(response.status, 200, scenario.type);
    const result = await response.json();
    assert.equal(result.scenario.type, scenario.type);
    assert.equal(result.calculationVersion, "1.0");
    if (scenario.type === "MARKET_STRESS") {
      assert.equal(result.scenario.status, "UNSUPPORTED");
      assert.equal(result.delta.liquidityImpact.delta, null);
      assert.equal(result.scenario.raw.investments, "0");
    } else {
      assert.equal(result.scenario.status, "COMPLETED");
    }
  }
});

test("simulation API distinguishes invalid request, invalid scenario, unsupported type, and calculation-safe errors", async () => {
  const base = { asOfDate: "2026-10-05", baseline: { monthlyIncome: 30000, monthlyExpenses: 20000, liquidSavings: 40000 } };
  const cases = [
    [{ ...base, baseline: { ...base.baseline, monthlySurplus: 10000 }, scenario: { type: "EMERGENCY_EXPENSE", amount: 1 } }, 400, "INVALID_REQUEST"],
    [{ ...base, scenario: { type: "EMERGENCY_EXPENSE" } }, 400, "INVALID_SCENARIO"],
    [{ ...base, scenario: { type: "UNKNOWN_SCENARIO" } }, 422, "UNSUPPORTED_SCENARIO"],
    [{ ...base, scenario: { type: "EMERGENCY_EXPENSE", amount: 50000 } }, 400, "INVALID_SCENARIO"],
  ];
  for (const [body, status, code] of cases) {
    const response = await fetch(`${baseUrl}/api/simulations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
});

test("repeated simulation requests are logically identical", async () => {
  const body = {
    asOfDate: "2026-10-05",
    baseline: { monthlyIncome: 30000, monthlyExpenses: 20000, monthlyDebtPayments: 0, liquidSavings: 40000, essentialMonthlyExpenses: 20000, goals: [{ name: "Flagship", targetAmount: 200000, currentAllocatedAmount: 40000, monthsRemaining: 12 }] },
    scenario: { type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: 5000 },
  };
  const execute = async () => {
    const response = await fetch(`${baseUrl}/api/simulations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await execute(), await execute());
});

test("simulation endpoint succeeds while all non-test-server fetches are blocked", async () => {
  const originalFetch = globalThis.fetch;
  const origin = new URL(baseUrl).origin;
  const blocked = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.origin !== origin) {
      blocked.push(url.href);
      throw new Error("Outbound service calls are disabled in this test");
    }
    return originalFetch(input, init);
  };
  try {
    const response = await fetch(`${baseUrl}/api/simulations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asOfDate: "2026-10-05",
        baseline: { monthlyIncome: 30000, monthlyExpenses: 20000, liquidSavings: 40000 },
        scenario: { type: "INCOME_SHOCK", percentageBasisPoints: -1000 },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).scenario.derived.monthlySurplus, "7000");
    assert.deepEqual(blocked, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Financial Twin API response matches the direct TypeScript engine for a Python parity fixture", async () => {
  const normalCase = parityGoldens.cases.find(({ id }) => id === "normal-state");
  const requestBody = { profile: normalCase.profile, asOfDate: parityGoldens.contract.asOfDate };
  const direct = calculateFinancialTwin(parseFinancialTwinRequest(requestBody));
  const response = await fetch(`${baseUrl}/api/financial-twin/recalculate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  assert.equal(response.status, 200);
  const apiResult = await response.json();
  assert.deepEqual(apiResult.derived, direct.derived);
  assert.deepEqual(apiResult.riskFlags, direct.riskFlags);
});

test("invalid inputs return a structured validation error without a stack trace", async () => {
  const response = await fetch(`${baseUrl}/api/financial-twin/recalculate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profile: { monthlyIncome: -1, monthlyExpenses: 0, liquidSavings: 0 },
    }),
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.ok(body.error.details["profile.monthlyIncome"]);
  assert.equal("stack" in body.error, false);
});

test("goal routes require an authenticated session", async () => {
  const response = await fetch(`${baseUrl}/api/goals`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
});

