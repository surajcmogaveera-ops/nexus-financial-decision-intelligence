import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApp } from "../dist/app.js";
import { EXPECTED, INVEST_5000_SCENARIO } from "./fixtures/financial-parity-fixtures.mjs";

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

test("contract-only routes are clearly not implemented", async () => {
  const response = await fetch(`${baseUrl}/api/goals`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_IMPLEMENTED");
});

