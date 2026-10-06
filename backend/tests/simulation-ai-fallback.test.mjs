import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../dist/app.js";
import { AiServiceError } from "../dist/ai/client.js";
import { simulate } from "../dist/simulations/service.js";
import { BASIC_PROFILE } from "./fixtures/financial-parity-fixtures.mjs";

const requestBody = (monthlyIncome = 30000) => ({
  asOfDate: "2026-10-05",
  baseline: { ...BASIC_PROFILE, currency: "INR", monthlyIncome },
  scenario: { type: "INCOME_SHOCK", percentageBasisPoints: -1000 },
});

function withoutEvidenceTimestamps(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "timestamp" ? undefined : item));
}

function readyExplanation(request) {
  return {
    requestId: request.requestId,
    status: "READY",
    summary: "This explanation came from the AI service.",
    keyChanges: ["The supplied income shock reduces available cash flow."],
    tradeoffs: [],
    riskFlags: request.riskFlags,
    evidenceRefs: [],
    assumptions: request.assumptions,
    limitations: [],
    model: "gemini-test-model",
    promptVersion: "hour12-analysis-v1",
    calculationVersion: "1.0",
  };
}

async function postSimulation(aiServiceClient, body = requestBody()) {
  const server = createApp({ aiServiceClient }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/api/simulations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const unavailableClient = (code) => ({
  analyze: async () => { throw new AiServiceError(code, "controlled test failure"); },
});

test("successful AI explanation is additive to the deterministic simulation", async () => {
  const direct = simulate(requestBody());
  const response = await postSimulation({ analyze: async (request) => readyExplanation(request) });
  assert.equal(response.status, 200);
  const result = await response.json();
  const { ai, ...simulation } = result;
  assert.deepEqual(withoutEvidenceTimestamps(simulation), withoutEvidenceTimestamps(direct));
  assert.equal(ai.status, "READY");
  assert.equal(ai.explanation.summary, "This explanation came from the AI service.");
  assert.equal(ai.provenance, "AI_INTERPRETATION");
  assert.equal(result.scenario.derived.monthlySurplus, direct.scenario.derived.monthlySurplus);
  assert.equal(result.baseline.provenance.assumptions, "ASSUMPTION");
  assert.equal(ai.message, null);
});

test("FastAPI unavailable preserves the complete deterministic simulation", async () => {
  const direct = simulate(requestBody());
  const response = await postSimulation(unavailableClient("AI_SERVICE_UNAVAILABLE"));
  const result = await response.json();
  const { ai, ...simulation } = result;
  assert.equal(response.status, 200);
  assert.deepEqual(withoutEvidenceTimestamps(simulation), withoutEvidenceTimestamps(direct));
  assert.equal(ai.status, "UNAVAILABLE");
  assert.equal(ai.explanation, null);
  assert.equal(ai.message, "AI explanation unavailable.");
});

test("FastAPI authentication failure is isolated to the AI explanation state", async () => {
  const direct = simulate(requestBody());
  const response = await postSimulation(unavailableClient("AI_SERVICE_UNAUTHORIZED"));
  const result = await response.json();
  const { ai, ...simulation } = result;
  assert.deepEqual(withoutEvidenceTimestamps(simulation), withoutEvidenceTimestamps(direct));
  assert.equal(ai.status, "UNAVAILABLE");
});

test("Gemini not configured maps the existing FastAPI placeholder to NOT_CONFIGURED", async () => {
  const response = await postSimulation({ analyze: async (request) => ({
    ...readyExplanation(request), summary: null, model: null, promptVersion: null,
    keyChanges: [], tradeoffs: [], limitations: ["AI explanation is unavailable because Gemini is not configured."],
  }) });
  const result = await response.json();
  assert.equal(result.ai.status, "NOT_CONFIGURED");
  assert.equal(result.ai.explanation, null);
  assert.equal(result.scenario.derived.monthlySurplus, simulate(requestBody()).scenario.derived.monthlySurplus);
});

test("AI timeout preserves deterministic simulation and returns UNAVAILABLE", async () => {
  const direct = simulate(requestBody());
  const response = await postSimulation(unavailableClient("AI_SERVICE_TIMEOUT"));
  const result = await response.json();
  const { ai, ...simulation } = result;
  assert.deepEqual(withoutEvidenceTimestamps(simulation), withoutEvidenceTimestamps(direct));
  assert.equal(ai.status, "UNAVAILABLE");
  assert.equal(ai.message, "AI explanation unavailable.");
});

test("invalid AI response preserves deterministic simulation and returns UNAVAILABLE", async () => {
  const direct = simulate(requestBody());
  const response = await postSimulation(unavailableClient("AI_SERVICE_INVALID_RESPONSE"));
  const result = await response.json();
  const { ai, ...simulation } = result;
  assert.deepEqual(withoutEvidenceTimestamps(simulation), withoutEvidenceTimestamps(direct));
  assert.equal(ai.status, "UNAVAILABLE");
});

test("AI failure leaves every authoritative simulation field unchanged", async () => {
  const direct = simulate(requestBody());
  const response = await postSimulation(unavailableClient("AI_SERVICE_FAILURE"));
  const result = await response.json();
  for (const field of ["baseline", "scenario", "delta", "riskFlags", "assumptions", "calculationVersion"]) {
    assert.deepEqual(withoutEvidenceTimestamps(result[field]), withoutEvidenceTimestamps(direct[field]), `${field} must remain deterministic`);
  }
  assert.notEqual(result.ai.status, "READY");
});

test("fallback has no canned financial values and uses each request's deterministic values", async () => {
  const first = await (await postSimulation(unavailableClient("AI_SERVICE_UNAVAILABLE"), requestBody(30000))).json();
  const second = await (await postSimulation(unavailableClient("AI_SERVICE_UNAVAILABLE"), requestBody(50000))).json();
  assert.equal(first.scenario.derived.monthlySurplus, simulate(requestBody(30000)).scenario.derived.monthlySurplus);
  assert.equal(second.scenario.derived.monthlySurplus, simulate(requestBody(50000)).scenario.derived.monthlySurplus);
  assert.notEqual(first.scenario.derived.monthlySurplus, second.scenario.derived.monthlySurplus);
  assert.deepEqual(first.ai, { status: "UNAVAILABLE", explanation: null, message: "AI explanation unavailable." });
});

test("deterministic simulation failure remains a simulation error and skips AI", async () => {
  let aiCalled = false;
  const response = await postSimulation({ analyze: async () => { aiCalled = true; throw new Error("must not run"); } }, {
    asOfDate: "2026-10-05",
    baseline: { monthlyIncome: 30000, monthlyExpenses: 20000, liquidSavings: 40000 },
    scenario: { type: "EMERGENCY_EXPENSE", amount: 999999999 },
  });
  const result = await response.json();
  assert.equal(response.status, 400);
  assert.equal(result.error.code, "INVALID_SCENARIO");
  assert.equal(aiCalled, false);
  assert.equal(result.ai, undefined);
});

test("unexpected programming errors are not disguised as AI unavailability", async () => {
  const response = await postSimulation({ analyze: async () => { throw new Error("invariant failure"); } });
  const result = await response.json();
  assert.equal(response.status, 500);
  assert.equal(result.error.code, "INTERNAL_ERROR");
  assert.equal(result.ai, undefined);
});
