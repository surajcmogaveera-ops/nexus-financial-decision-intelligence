import assert from "node:assert/strict";
import { test } from "node:test";
import { isProvenance, Provenance } from "../dist/financial/constants.js";
import { calculateFinancialTwin } from "../dist/financial/service.js";
import { parseFinancialTwinRequest } from "../dist/financial/schemas.js";
import { simulate } from "../dist/simulations/service.js";
import { createAiAnalysisRequest } from "../dist/ai/types.js";
import { validateAiAnalysisRequest } from "../dist/ai/schemas.js";
import { BASIC_PROFILE } from "./fixtures/financial-parity-fixtures.mjs";

const VALID_PROVENANCE = [
  "USER", "COMPUTED", "EXTERNAL", "RETRIEVED", "AI_INTERPRETATION", "ASSUMPTION",
];

test("one canonical model represents all six provenance classes", () => {
  assert.deepEqual(Object.values(Provenance), VALID_PROVENANCE);
  assert.equal(new Set(Object.values(Provenance)).size, 6);
  for (const value of VALID_PROVENANCE) assert.equal(isProvenance(value), true, value);
  for (const value of ["AI", "GENERATED", "SYSTEM", "UNKNOWN", "MODEL", "AI_GENERATED"]) {
    assert.equal(isProvenance(value), false, value);
  }
  assert.notEqual(Provenance.EXTERNAL, Provenance.RETRIEVED);
});

test("raw user values, deterministic metrics, and explicit assumptions retain distinct provenance", () => {
  const result = calculateFinancialTwin(parseFinancialTwinRequest({
    profile: {
      ...BASIC_PROFILE,
      goals: [{ name: "No return", targetAmount: "100000", monthsRemaining: 12 }],
    },
    asOfDate: "2026-10-05",
  }));

  assert.equal(result.provenance.raw.monthlyIncome, Provenance.USER);
  assert.equal(result.provenance.raw.monthlyExpenses, Provenance.USER);
  assert.equal(result.provenance.derived.monthlySurplus, Provenance.COMPUTED);
  assert.equal(result.raw.goals[0].returnAssumption, 0);
  assert.equal(result.provenance.goalFields[0].returnAssumption, Provenance.ASSUMPTION);
  assert.equal(result.provenance.goalFields[0].targetAmount, Provenance.USER);
  assert.equal(result.provenance.assumptions, Provenance.ASSUMPTION);
  assert.ok(result.assumptions.some((item) => item.includes("assume no investment return")));
});

test("AI interpretation is labeled at the response boundary and cannot claim computed provenance", () => {
  const simulation = simulate({
    baseline: { ...BASIC_PROFILE, currency: "INR" },
    asOfDate: "2026-10-05",
    scenario: { type: "INCOME_SHOCK", percentageBasisPoints: -1000 },
  });
  const request = createAiAnalysisRequest("Explain.", simulation);
  request.financialTwin.provenance.raw.monthlyIncome = "AI_INTERPRETATION";
  assert.throws(() => validateAiAnalysisRequest(request), /provenance/i);

  const invalidAssumption = createAiAnalysisRequest("Explain.", structuredClone(simulation));
  invalidAssumption.financialTwin.provenance.raw.monthlyIncome = "USER";
  invalidAssumption.financialTwin.provenance.assumptions = "COMPUTED";
  assert.throws(() => validateAiAnalysisRequest(invalidAssumption), /ASSUMPTION/i);

  const invalidLabel = createAiAnalysisRequest("Explain.", structuredClone(simulation));
  invalidLabel.financialTwin.provenance.raw.monthlyIncome = "AI";
  assert.throws(() => validateAiAnalysisRequest(invalidLabel), /provenance/i);
});

test("retrieved and external labels are valid but remain semantically distinct", () => {
  assert.equal(isProvenance(Provenance.RETRIEVED), true);
  assert.equal(isProvenance(Provenance.EXTERNAL), true);
  assert.notEqual(Provenance.RETRIEVED, Provenance.EXTERNAL);
});
