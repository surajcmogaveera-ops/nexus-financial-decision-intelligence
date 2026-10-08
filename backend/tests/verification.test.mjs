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
  assert.ok(hasCode(mismatch, "NUMERIC_MISMATCH"));
});

test("metric names bind numbers to the selected authoritative field and state", () => {
  const request = makeRequest({ type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: 5000 }, [], FLAGSHIP_BASELINE);
  const monthlySurplus = request.evidence.find((entry) => entry.metric === "monthlySurplus");
  if (monthlySurplus) {
    const citedMatch = verifyAiAnalysis(responseFor(request, {
      summary: `The monthly surplus is ₹${request.scenario.derived.monthlySurplus}.`,
      evidenceRefs: [monthlySurplus.evidenceId],
    }), request);
    assert.equal(citedMatch.checks.numeric.status, "PASS");
  }
  const state = verifyAiAnalysis(responseFor(request, { summary: "The scenario projected amount is ₹100,000." }), request);
  assert.equal(state.checks.numeric.status, "PASS");
  const baselineCollision = verifyAiAnalysis(responseFor(request, { summary: "The scenario projected amount is ₹160,000." }), request);
  assert.ok(hasCode(baselineCollision, "NUMERIC_MISMATCH"));
  const scenarioCollision = verifyAiAnalysis(responseFor(request, { summary: "The baseline projected amount is ₹100,000." }), request);
  assert.ok(hasCode(scenarioCollision, "NUMERIC_MISMATCH"));
  const baselineMatch = verifyAiAnalysis(responseFor(request, { summary: "The baseline projected amount is ₹160,000." }), request);
  assert.equal(baselineMatch.checks.numeric.status, "PASS");
  const evidence = request.evidence.find((entry) => entry.metric === "monthlySurplus");
  if (evidence) {
    const conflictingEvidenceClaim = verifyAiAnalysis(responseFor(request, {
      summary: "The monthly surplus is ₹120,000.", evidenceRefs: [evidence.evidenceId],
    }), request);
    assert.ok(hasCode(conflictingEvidenceClaim, "NUMERIC_MISMATCH"));
  }
});

test("coincidental retrieved numbers do not support return, tax, or market claims", () => {
  const retrieved = [{
    chunkId: "unrelated-return-number", documentId: "doc-return", title: "Market note", topic: "market",
    content: "Typical long-term investment returns may be 12%.", sourceId: "source-return", sourceType: "ARTICLE",
    provenance: "EXTERNAL", sourceUrl: "https://example.test/market",
  }];
  const request = makeRequest(undefined, retrieved, FLAGSHIP_BASELINE);
  for (const summary of [
    "This investment will return 12%.",
    "You will save ₹20,000 in tax.",
    "The market will rise by 15%.",
  ]) {
    const result = verifyAiAnalysis(responseFor(request, { summary }), request);
    assert.equal(result.status, "FLAGGED", summary);
    assert.ok(hasCode(result, "UNSUPPORTED_NUMERIC_CLAIM"), summary);
  }
});

test("cited numeric evidence must correspond to the claim and the referenced source", () => {
  const retrieved = [{
    chunkId: "evidence-12", documentId: "doc-12", title: "Returns", topic: "returns",
    content: "Typical long-term investment returns may be 12%.", sourceId: "source-12", sourceType: "ARTICLE",
    provenance: "EXTERNAL", sourceUrl: null,
  }];
  const request = makeRequest(undefined, retrieved);
  const cited = verifyAiAnalysis(responseFor(request, {
    summary: "Typical long-term investment returns may be 12%.", evidenceRefs: ["evidence-12"],
  }), request);
  assert.equal(cited.checks.numeric.status, "PASS");
  const uncited = verifyAiAnalysis(responseFor(request, {
    summary: "The emergency coverage is 12 months.", evidenceRefs: ["evidence-12"],
  }), request);
  assert.equal(uncited.status, "FLAGGED");
  assert.ok(hasCode(uncited, "NUMERIC_MISMATCH"));
});

test("numeric units and periods cannot be interchanged", () => {
  const request = makeRequest();
  const amount = String(request.scenario.derived.monthlySurplus);
  assert.equal(verifyAiAnalysis(responseFor(request, { summary: `Monthly surplus is ₹${Number(amount).toLocaleString("en-IN")}.` }), request).checks.numeric.status, "PASS");
  assert.ok(hasCode(verifyAiAnalysis(responseFor(request, { summary: `Monthly surplus is ${amount}%.` }), request), "NUMERIC_MISMATCH"));
  assert.ok(hasCode(verifyAiAnalysis(responseFor(request, { summary: `Monthly surplus is ₹${amount}/year.` }), request), "NUMERIC_MISMATCH"));
  const rate = Number(request.scenario.derived.savingsRate) * 100;
  const correctRate = verifyAiAnalysis(responseFor(request, { summary: `Savings rate is ${rate}%.` }), request);
  assert.equal(correctRate.checks.numeric.status, "PASS");
  const currencyRate = verifyAiAnalysis(responseFor(request, { summary: `Savings rate is ₹${rate}.` }), request);
  assert.ok(hasCode(currencyRate, "NUMERIC_MISMATCH"));
});

test("an explicit request assumption supports only the matching assumption statement", () => {
  const request = makeRequest();
  request.assumptions = [...request.assumptions, "Illustrative return assumption: 12%."];
  const matching = verifyAiAnalysis(responseFor(request, { assumptions: [...request.assumptions] }), request);
  assert.equal(matching.checks.numeric.status, "PASS");
  const mismatch = verifyAiAnalysis(responseFor(request, { assumptions: [...request.assumptions, "Illustrative return assumption: 15%."] }), request);
  assert.ok(hasCode(mismatch, "UNSUPPORTED_NUMERIC_CLAIM"));
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
  assert.ok(hasCode(verifyAiAnalysis(responseFor(request, { summary: "The investment will definitely return 12%." }), request), "GUARANTEE_LANGUAGE_DETECTED"));
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
