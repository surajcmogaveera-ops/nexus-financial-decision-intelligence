import assert from "node:assert/strict";
import { test } from "node:test";
import { domainCalculationEvidenceId } from "../dist/financial/engine/evidenceIdentity.js";
import { calculateFinancialTwin } from "../dist/financial/service.js";
import { parseFinancialTwinRequest } from "../dist/financial/schemas.js";
import { runScenario } from "../dist/scenarios/engine.js";
import { parseScenarioInput } from "../dist/scenarios/schemas.js";

const semantic = { metric: "monthlySurplus", inputs: { monthlyIncome: "30000", monthlyExpenses: "20000", monthlyDebtPayments: "0" }, formula: "monthlySurplus = monthlyIncome - monthlyExpenses - monthlyDebtPayments", output: "10000", provenance: "COMPUTED" };
const profile = { currency: "INR", monthlyIncome: "30000", monthlyExpenses: "20000", monthlyDebtPayments: "0", liquidSavings: "40000", essentialMonthlyExpenses: "20000", investments: "0", monthlyInvestmentContribution: "0", goals: [{ name: "Goal", targetAmount: "200000", currentAllocatedAmount: "40000", monthsRemaining: 12, priority: 1, returnAssumption: 0, status: "active" }] };

test("CALC identity is canonical, semantic, and timestamp independent", () => {
  const id = domainCalculationEvidenceId(semantic);
  assert.match(id, /^CALC-[A-F0-9]{12}$/);
  assert.equal(domainCalculationEvidenceId({ ...semantic, timestamp: "2026-01-01T00:00:00.000Z" }), id);
  assert.equal(domainCalculationEvidenceId({ ...semantic, inputs: { ...semantic.inputs, monthlyIncome: "30001" } }) === id, false);
  assert.notEqual(domainCalculationEvidenceId({ ...semantic, formula: "changed formula" }), id);
  assert.notEqual(domainCalculationEvidenceId({ ...semantic, output: "10001" }), id);
});

test("financial calculation evidence wraps exact computed outputs without recalculation", () => {
  const twin = calculateFinancialTwin(parseFinancialTwinRequest({ profile, asOfDate: "2026-10-06" }));
  const surplus = twin.evidence.find((item) => item.metric === "monthlySurplus");
  assert.equal(surplus.output, twin.derived.monthlySurplus);
  assert.deepEqual(surplus.inputs, { monthlyIncome: "30000", monthlyExpenses: "20000", monthlyDebtPayments: "0" });
  for (const item of twin.evidence) {
    assert.match(item.id, /^CALC-[A-F0-9]{12}$/);
    assert.equal(item.id, item.evidenceId);
    assert.equal(item.provenance, "COMPUTED");
    assert.equal(item.type, "CALCULATION");
    assert.ok(item.formula && item.inputs && "output" in item && Number.isFinite(Date.parse(item.timestamp)));
  }
});

test("scenario evidence contains internally consistent baseline, scenario, and delta outputs", () => {
  const request = parseFinancialTwinRequest({ profile, asOfDate: "2026-10-06" });
  const result = runScenario(request, parseScenarioInput({ type: "EXPENSE_CHANGE", amountDelta: "2000" }));
  const baseline = result.evidence.find((item) => item.metric === "monthlySurplus" && item.output === "10000");
  const scenario = result.evidence.find((item) => item.metric === "monthlySurplus" && item.output === "8000");
  const delta = result.evidence.find((item) => item.metric === "scenarioDelta.monthlySurplus");
  assert.equal(baseline.provenance, "COMPUTED");
  assert.equal(scenario.provenance, "COMPUTED");
  assert.deepEqual(delta.output, result.delta.monthlySurplus);
  assert.equal(delta.output.delta, "-2000");
});
