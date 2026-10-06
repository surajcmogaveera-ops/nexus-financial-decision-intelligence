import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../dist/app.js";
import { AuthService } from "../dist/auth/service.js";
import { PrismaScenarioEvidenceRepository } from "../dist/scenarios/repository.js";
import { InMemoryAuthUserRepository } from "./helpers/in-memory-auth-repository.mjs";

const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";
const SECRET = "hour-16-evidence-ledger-test-secret-0123456789";
const profile = {
  currency: "INR", monthlyIncome: "30000", monthlyExpenses: "20000", monthlyDebtPayments: "0",
  liquidSavings: "40000", essentialMonthlyExpenses: "20000", investments: "0",
  monthlyInvestmentContribution: "0",
  goals: [{ name: "Flagship", targetAmount: "200000", currentAllocatedAmount: "40000", monthsRemaining: 12, priority: 1, returnAssumption: 0, status: "active" }],
};

class MemoryScenarioEvidenceRepository {
  scenarios = new Map();
  nextId = 10;
  hasProfile = new Set([USER_A, USER_B]);

  async createForUser(userId, result, scenarioInput) {
    if (!this.hasProfile.has(userId)) return null;
    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    this.scenarios.set(id, { owner: userId, result: structuredClone(result), input: structuredClone(scenarioInput) });
    return id;
  }

  async findOwnedResult(userId, scenarioId) {
    const row = this.scenarios.get(scenarioId);
    return row?.owner === userId ? structuredClone(row.result) : null;
  }
}

async function startServer() {
  const repository = new MemoryScenarioEvidenceRepository();
  const auth = new AuthService(new InMemoryAuthUserRepository(), SECRET, "test");
  const tokens = new Map(await Promise.all([USER_A, USER_B].map(async (id) => [id, await auth.createSessionToken(id)])));
  const aiServiceClient = { analyze: async () => ({ requestId: "00000000-0000-4000-8000-000000000099", status: "READY", summary: "AI commentary cannot replace the deterministic calculation chain.", keyChanges: [], tradeoffs: [], riskFlags: [], evidenceRefs: [], assumptions: [], limitations: [], model: "test", promptVersion: "test", calculationVersion: "1.0" }) };
  const server = createApp({ authService: auth, scenarioEvidenceRepository: repository, aiServiceClient }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (userId, path, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(userId ? { cookie: `nexus_session=${tokens.get(userId)}` } : {}) },
  });
  return { base, call, repository, server };
}

test("authenticated simulation persists evidence for a separate, ownership-scoped ledger request", async () => {
  const app = await startServer();
  try {
    const simulationResponse = await app.call(USER_A, "/api/simulations", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ asOfDate: "2026-10-06", baseline: profile, scenario: { type: "EXPENSE_CHANGE", amountDelta: "5000" } }),
    });
    assert.equal(simulationResponse.status, 200);
    const simulation = await simulationResponse.json();
    assert.match(simulation.scenarioId, /^[0-9a-f-]{36}$/i);
    assert.equal(simulation.baseline.derived.monthlySurplus, "10000");
    assert.equal(simulation.scenario.derived.monthlySurplus, "5000");
    assert.equal(simulation.ai.provenance, "AI_INTERPRETATION");
    assert.deepEqual(app.repository.scenarios.get(simulation.scenarioId).input, { type: "EXPENSE_CHANGE", amountDelta: "5000" });

    // A distinct HTTP request retrieves the stored deterministic result.
    const response = await app.call(USER_A, `/api/evidence/${simulation.scenarioId}`);
    assert.equal(response.status, 200);
    const ledger = await response.json();
    assert.equal(ledger.scenarioId, simulation.scenarioId);
    assert.equal(ledger.assumptions.provenance, "ASSUMPTION");
    const surplusClaim = ledger.claims.find((claim) => claim.claim === "Monthly surplus decreases.");
    const goalClaim = ledger.claims.find((claim) => claim.claim === "Projected goal shortfall increases.");
    assert.equal(surplusClaim.provenance, "COMPUTED");
    assert.equal(goalClaim.provenance, "COMPUTED");
    const surplusEvidence = surplusClaim.evidence[0];
    assert.equal(surplusEvidence.calculation.output.delta, "-5000");
    assert.equal(surplusEvidence.calculation.formula.includes("percentageDelta"), true);
    assert.equal(surplusEvidence.calculation.provenance, "COMPUTED");
    assert.match(surplusEvidence.calculation.id, /^CALC-[A-F0-9]{12}$/);
    assert.deepEqual(surplusEvidence.calculation.inputs, { baseline: "10000", scenario: "5000" });
    assert.ok(Number.isFinite(Date.parse(surplusEvidence.calculation.timestamp)));
    assert.ok(surplusEvidence.supportingCalculations.some((item) => item.inputs.monthlyIncome === "30000"));
    assert.ok(goalClaim.evidence[0].supportingCalculations.some((item) => item.metric.endsWith("projectedGoalShortfall")));
    const shortfallFlag = simulation.riskFlags.find((flag) => flag.type === "GOAL_SHORTFALL");
    assert.ok(goalClaim.evidence[0].riskEvidenceIds.some((id) => shortfallFlag.evidence.includes(id)));

    const unauthenticated = await app.call(null, `/api/evidence/${simulation.scenarioId}`);
    assert.equal(unauthenticated.status, 401);
    const otherUser = await app.call(USER_B, `/api/evidence/${simulation.scenarioId}`);
    assert.equal(otherUser.status, 404);
    assert.deepEqual(await otherUser.json(), { error: { code: "SCENARIO_NOT_FOUND", message: "Scenario not found.", details: {} } });
    assert.equal((await app.call(USER_A, "/api/evidence/not-a-uuid")).status, 404);
    assert.equal((await app.call(USER_A, "/api/evidence/00000000-0000-4000-8000-999999999999")).status, 404);
    assert.ok(ledger.claims.every((claim) => claim.provenance === "COMPUTED"));
  } finally {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  }
});

test("legacy or evidence-free scenario results return an empty ledger without fabricated claims", async () => {
  const app = await startServer();
  try {
    const id = "00000000-0000-4000-8000-000000000777";
    app.repository.scenarios.set(id, { owner: USER_A, result: { baseline: {}, scenario: { evidence: [] }, delta: {}, assumptions: ["No return assumed."], riskFlags: [] } });
    const response = await app.call(USER_A, `/api/evidence/${id}`);
    assert.equal(response.status, 200);
    const ledger = await response.json();
    assert.deepEqual(ledger.claims, []);
    assert.deepEqual(ledger.assumptions, { provenance: "ASSUMPTION", items: ["No return assumed."] });
  } finally {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  }
});

test("authenticated simulations require an owned Financial Profile to persist", async () => {
  const app = await startServer();
  const token = await new AuthService(new InMemoryAuthUserRepository(), SECRET, "test").createSessionToken("00000000-0000-4000-8000-000000000003");
  try {
    const response = await fetch(`${app.base}/api/simulations`, {
      method: "POST", headers: { "content-type": "application/json", cookie: `nexus_session=${token}` },
      body: JSON.stringify({ asOfDate: "2026-10-06", baseline: profile, scenario: { type: "EXPENSE_CHANGE", amountDelta: "5000" } }),
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "FINANCIAL_PROFILE_NOT_FOUND");
  } finally {
    await new Promise((resolve, reject) => app.server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Prisma adapter stores the existing ScenarioResult and scopes ledger lookup by owner", async () => {
  const calls = {};
  const prisma = {
    financialProfile: { findUnique: async (args) => { calls.profile = args; return { id: "profile-id" }; } },
    scenario: {
      create: async (args) => { calls.create = args; return { id: "00000000-0000-4000-8000-000000000088" }; },
      findFirst: async (args) => { calls.find = args; return { results: [{ resultData: { scenario: { evidence: [] } } }] }; },
    },
  };
  const repository = new PrismaScenarioEvidenceRepository(() => prisma);
  const result = { scenario: { type: "EXPENSE_CHANGE", evidence: [{ evidenceId: "CALC-000000000001" }] }, assumptions: [], baseline: { evidence: [{ evidenceId: "CALC-000000000001" }] }, delta: {}, riskFlags: [] };
  const id = await repository.createForUser(USER_A, result);
  assert.equal(id, "00000000-0000-4000-8000-000000000088");
  assert.deepEqual(calls.create.data.results.create.resultData, { ...result, baseline: { evidence: [] } });
  assert.equal(calls.create.data.results.create.resultData.scenario.evidence.length, 1);
  assert.equal(calls.create.data.financialProfileId, "profile-id");
  assert.deepEqual(calls.create.data.inputChanges, { type: result.scenario.type });
  await repository.findOwnedResult(USER_A, id);
  assert.deepEqual(calls.find.where, { id, financialProfile: { userId: USER_A } });
  assert.equal(calls.find.select.results.take, 1);
});
