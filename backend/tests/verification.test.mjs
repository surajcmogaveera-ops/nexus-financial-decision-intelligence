import assert from "node:assert/strict";
import { test } from "node:test";
import { createAiAnalysisRequest } from "../dist/ai/types.js";
import { simulate } from "../dist/simulations/service.js";
import { verifyAiAnalysis } from "../dist/verification/service.js";
import { BASIC_PROFILE, FLAGSHIP_BASELINE } from "./fixtures/financial-parity-fixtures.mjs";

function makeRequest(scenario = { type: "INCOME_SHOCK", percentageBasisPoints: -1000 }, retrievedContext = [], profile = BASIC_PROFILE) {
  const result = simulate({
    asOfDate: "2026-10-05",
    baseline: { ...profile, currency: "INR" },
    scenario,
  });
  return createAiAnalysisRequest("Explain the scenario outcome.", result, "123e4567-e89b-42d3-a456-426614174000", retrievedContext);
}

function responseFor(request, overrides = {}) {
  return {
    requestId: request.requestId,
    status: "READY",
    summary: "The scenario changes the financial outlook based on the supplied information.",
    keyChanges: [],
    tradeoffs: [],
    riskFlags: request.riskFlags,
    evidenceRefs: [],
    assumptions: request.assumptions,
    limitations: [],
    model: "test-model",
    promptVersion: "test-prompt",
    calculationVersion: request.calculationVersion,
    ...overrides,
  };
}

function hasCode(result, code) {
  return result.issues.some((item) => item.code === code);
}

test("verification passes a valid response and preserves deterministic result", () => {
  const request = makeRequest();
  const result = verifyAiAnalysis(responseFor(request), request);
  assert.equal(result.status, "PASS");
  assert.equal(result.checks.schema.status, "PASS");
});

test("schema rejects missing fields and wrong field types", () => {
  const request = makeRequest();
  const missing = responseFor(request);
  delete missing.summary;
  assert.equal(verifyAiAnalysis(missing, request).status, "FLAGGED");
  assert.ok(hasCode(verifyAiAnalysis(missing, request), "SCHEMA_INVALID"));
  const wrongType = verifyAiAnalysis(responseFor(request, { keyChanges: "not an array" }), request);
  assert.equal(wrongType.status, "FLAGGED");
  assert.ok(hasCode(wrongType, "SCHEMA_INVALID"));
});

test("numeric claims matching deterministic values pass while mismatches and invented numbers are flagged", () => {
  const request = makeRequest();
  const validValue = request.scenario.derived.monthlySurplus;
  const valid = verifyAiAnalysis(responseFor(request, { summary: `Scenario monthly surplus is ${validValue}.` }), request);
  assert.equal(valid.checks.numeric.status, "PASS");
  const mismatch = verifyAiAnalysis(responseFor(request, { summary: "Scenario monthly surplus is 987654321." }), request);
  assert.ok(hasCode(mismatch, "UNSUPPORTED_NUMERIC_CLAIM"));
  assert.ok(hasCode(mismatch, "NUMERIC_MISMATCH"));
});

test("evidence references accept supplied ids and reject unknown or cross-scenario ids", () => {
  const request = makeRequest();
  const evidenceId = request.evidence[0]?.evidenceId;
  if (evidenceId) {
    assert.equal(verifyAiAnalysis(responseFor(request, { evidenceRefs: [evidenceId] }), request).checks.evidenceReferences.status, "PASS");
  }
  const other = makeRequest({ type: "EMERGENCY_EXPENSE", amount: 10000 });
  const foreignId = other.evidence.find((item) => !request.evidence.some((present) => present.evidenceId === item.evidenceId))?.evidenceId;
  const unknown = verifyAiAnalysis(responseFor(request, { evidenceRefs: [foreignId ?? "not-supplied"] }), request);
  assert.ok(hasCode(unknown, "UNKNOWN_EVIDENCE_REFERENCE"));
});

test("retrieved chunk ids are accepted and provenance is retained as evidence context", () => {
  const retrieved = [{
    chunkId: "chunk-test-1", documentId: "doc-test-1", title: "Budget guide", topic: "budget", content: "Evidence text.",
    sourceId: "source-test-1", sourceType: "GUIDE", provenance: "EXTERNAL", sourceUrl: "https://example.test/source",
  }];
  const request = makeRequest(undefined, retrieved);
  const result = verifyAiAnalysis(responseFor(request, { evidenceRefs: ["chunk-test-1"] }), request);
  assert.equal(result.checks.evidenceReferences.status, "PASS");
  assert.equal(request.retrievedContext[0].provenance, "EXTERNAL");
});

test("scenario contradictions and external factual claims are flagged", () => {
  const request = makeRequest(undefined, [], FLAGSHIP_BASELINE);
  const supported = verifyAiAnalysis(responseFor(request, { summary: "The scenario increases the goal shortfall." }), request);
  assert.equal(supported.checks.scenarioConsistency.status, "PASS");
  const contradiction = verifyAiAnalysis(responseFor(request, { summary: "The goal is fully funded and there is no shortfall." }), request);
  assert.ok(hasCode(contradiction, "SCENARIO_MISMATCH"));
  const unsupported = verifyAiAnalysis(responseFor(request, { tradeoffs: ["This investment is tax-free and the market will rise."] }), request);
  assert.ok(hasCode(unsupported, "UNSUPPORTED_FACTUAL_CLAIM"));
  const returnClaim = verifyAiAnalysis(responseFor(request, { summary: "This investment will earn a 12% return." }), request);
  assert.ok(hasCode(returnClaim, "UNSUPPORTED_FACTUAL_CLAIM"));
});

test("scenario type and changed action values must match the calculated scenario", () => {
  const request = makeRequest({ type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: 5000 });
  const matching = verifyAiAnalysis(responseFor(request, { summary: "The investment contribution change sets monthly investment contribution to ₹5,000." }), request);
  assert.equal(matching.checks.scenarioConsistency.status, "PASS");
  const mismatching = verifyAiAnalysis(responseFor(request, { summary: "The rent increase sets monthly investment contribution to ₹10,000." }), request);
  assert.ok(hasCode(mismatching, "SCENARIO_MISMATCH"));
});

test("guarantee language is flagged, including guaranteed returns and certainty", () => {
  const request = makeRequest();
  for (const summary of ["Returns are guaranteed.", "This is risk-free.", "You will definitely reach the goal."]) {
    assert.ok(hasCode(verifyAiAnalysis(responseFor(request, { summary }), request), "GUARANTEE_LANGUAGE_DETECTED"));
  }
});

test("unsupported deterministic scenarios report a limitation", () => {
  const request = makeRequest({ type: "MARKET_STRESS", stressBasisPoints: -5000 });
  const result = verifyAiAnalysis(responseFor(request), request);
  assert.equal(result.status, request.scenario.status === "UNSUPPORTED" ? "PASS_WITH_LIMITATION" : "PASS");
});

test("verification is deterministic for repeated identical inputs", () => {
  const request = makeRequest();
  const response = responseFor(request);
  assert.deepEqual(verifyAiAnalysis(response, request), verifyAiAnalysis(response, request));
});
