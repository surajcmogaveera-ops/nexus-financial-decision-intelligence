import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApp } from "../dist/app.js";
import { calculateFinancialTwin } from "../dist/financial/service.js";
import { parseFinancialTwinRequest } from "../dist/financial/schemas.js";
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

test("contract-only routes are clearly not implemented", async () => {
  const response = await fetch(`${baseUrl}/api/goals`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_IMPLEMENTED");
});

