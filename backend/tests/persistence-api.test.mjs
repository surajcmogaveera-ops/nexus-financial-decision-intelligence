import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../dist/app.js";
import { createDevelopmentIdentityResolver } from "../dist/auth/context.js";
import {
  GOAL_A, GOAL_B, PROFILE_A, PROFILE_B, USER_A, USER_B, USER_WITHOUT_PROFILE,
  InMemoryFinancialDataRepository, makeGoal, makeProfile, testUserContext,
} from "./helpers/in-memory-financial-repository.mjs";

async function withServer(repository, resolver = testUserContext, callback) {
  const server = createApp({ financialDataRepository: repository, userContextResolver: resolver }).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    repository.clear?.();
  }
}

function request(baseUrl, userId, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "x-test-user": userId, ...(options.headers ?? {}) },
  });
}

const goalInput = {
  name: "Flagship",
  targetAmount: "200000",
  currentAllocatedAmount: "40000",
  monthsRemaining: 12,
  monthlyContribution: "5000",
  fundingSource: "Monthly savings",
  returnAssumption: 0,
};

test("GET /api/financial-twin maps PostgreSQL raw relations and recalculates through the Financial Engine", async () => {
  const goal = makeGoal({ name: "Flagship", targetAmount: "200000", currentAllocatedAmount: "40000", monthsRemaining: 12, monthlyContribution: "5000" });
  const repository = new InMemoryFinancialDataRepository([
    makeProfile({ goals: [goal] }),
    makeProfile({ id: PROFILE_B, userId: USER_B, monthlyIncome: "90000", monthlyExpenses: "70000", liquidSavings: "80000", monthlyDebtPayments: "0", essentialMonthlyExpenses: "70000" }),
  ]);
  await withServer(repository, testUserContext, async (baseUrl) => {
    const response = await request(baseUrl, USER_A, "/api/financial-twin?monthlySurplus=999999");
    assert.equal(response.status, 200);
    const twin = await response.json();
    assert.equal(twin.raw.monthlyIncome, "30000");
    assert.equal(twin.raw.monthlyExpenses, "20000");
    assert.equal(twin.raw.monthlyDebtPayments, "0");
    assert.equal(twin.raw.liquidSavings, "40000");
    assert.equal(twin.derived.monthlySurplus, "10000");
    assert.equal(twin.derived.emergencyCoverageMonths, 2);
    assert.equal(twin.derived.currentFundingGap, "160000");
    assert.equal(twin.derived.goals[0].projectedAmount, "100000");
    assert.equal(twin.derived.goals[0].projectedGoalShortfall, "100000");
    assert.equal(twin.provenance.raw.monthlyIncome, "USER");
    assert.equal(twin.provenance.derived.monthlySurplus, "COMPUTED");
    assert.equal("monthlySurplus" in twin.raw, false);
    const otherUser = await request(baseUrl, USER_B, "/api/financial-twin");
    const otherTwin = await otherUser.json();
    assert.equal(otherUser.status, 200);
    assert.equal(otherTwin.raw.monthlyIncome, "90000");
    assert.equal(otherTwin.derived.monthlySurplus, "20000");
    assert.equal(repository.profiles.get(USER_A).financialSnapshots?.length ?? 0, 0);
  });
});

test("Financial Twin returns explicit errors for missing and incomplete profiles without creating data", async () => {
  const repository = new InMemoryFinancialDataRepository([makeProfile({
    id: PROFILE_B, userId: USER_B, incomeSources: [], expenseCategories: [], assets: [],
  })]);
  await withServer(repository, testUserContext, async (baseUrl) => {
    const missing = await request(baseUrl, USER_WITHOUT_PROFILE, "/api/financial-twin");
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "FINANCIAL_PROFILE_NOT_FOUND");
    const incomplete = await request(baseUrl, USER_B, "/api/financial-twin");
    assert.equal(incomplete.status, 422);
    assert.equal((await incomplete.json()).error.code, "FINANCIAL_PROFILE_INCOMPLETE");
    assert.equal(repository.profiles.has(USER_WITHOUT_PROFILE), false);
  });
});

test("GET /api/goals handles empty lists, orders records deterministically, and computes goal progress", async () => {
  const newer = makeGoal({ id: GOAL_B, name: "Second", createdAt: new Date("2026-02-01T00:00:00Z") });
  const older = makeGoal({ id: GOAL_A, name: "First", createdAt: new Date("2026-01-01T00:00:00Z") });
  const repository = new InMemoryFinancialDataRepository([
    makeProfile({ goals: [] }),
    makeProfile({ id: PROFILE_B, userId: USER_B, goals: [newer, older] }),
  ]);
  await withServer(repository, testUserContext, async (baseUrl) => {
    const empty = await request(baseUrl, USER_A, "/api/goals");
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), []);
    const list = await request(baseUrl, USER_B, "/api/goals");
    assert.equal(list.status, 200);
    const goals = await list.json();
    assert.deepEqual(goals.map((goal) => goal.name), ["First", "Second"]);
    assert.equal(goals[0].derived.currentFundingGap, "160000");
    assert.equal(goals[0].derived.projectedAmount, "100000");
    assert.equal(goals[0].derived.projectedGoalShortfall, "100000");
    assert.equal(goals[0].provenance.derived.projectedAmount, "COMPUTED");
  });
});

test("POST /api/goals persists raw goal fields and returns deterministic computed goal information", async () => {
  const repository = new InMemoryFinancialDataRepository([makeProfile()]);
  await withServer(repository, testUserContext, async (baseUrl) => {
    const response = await request(baseUrl, USER_A, "/api/goals", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(goalInput),
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.name, "Flagship");
    assert.equal(created.currentAllocatedAmount, "40000");
    assert.equal(created.derived.projectedAmount, "100000");
    assert.equal(created.derived.projectedGoalShortfall, "100000");
    assert.equal(created.provenance.raw.targetAmount, "USER");
    assert.equal(created.provenance.derived.projectedGoalShortfall, "COMPUTED");
    const stored = repository.profiles.get(USER_A).goals[0];
    assert.equal(stored.targetAmount, "200000");
    assert.equal("projectedAmount" in stored, false);
    assert.equal("derived" in stored, false);
  });
});

test("POST /api/goals rejects negative, invalid-date, invalid-horizon, status, and derived-field inputs", async () => {
  const repository = new InMemoryFinancialDataRepository([makeProfile()]);
  await withServer(repository, testUserContext, async (baseUrl) => {
    const invalidGoals = [
      { ...goalInput, targetAmount: "-1" },
      { ...goalInput, targetDate: "2026-02-30", monthsRemaining: undefined },
      { ...goalInput, monthsRemaining: -1 },
      { ...goalInput, status: "completed" },
      { ...goalInput, projectedAmount: 100 },
    ];
    for (const goal of invalidGoals) {
      const response = await request(baseUrl, USER_A, "/api/goals", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(goal),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_GOAL");
    }
    assert.equal(repository.profiles.get(USER_A).goals.length, 0);
  });
});

test("PUT /api/goals/:id validates ownership, updates raw values, and recalculates derived values", async () => {
  const goalA = makeGoal({ id: GOAL_A, financialProfileId: PROFILE_A, name: "A goal" });
  const goalB = makeGoal({ id: GOAL_B, financialProfileId: PROFILE_B, name: "B goal", targetAmount: "90000" });
  const repository = new InMemoryFinancialDataRepository([
    makeProfile({ id: PROFILE_A, userId: USER_A, goals: [goalA] }),
    makeProfile({ id: PROFILE_B, userId: USER_B, goals: [goalB] }),
  ]);
  await withServer(repository, testUserContext, async (baseUrl) => {
    const updated = await request(baseUrl, USER_A, `/api/goals/${GOAL_A}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ monthlyContribution: "10000" }),
    });
    assert.equal(updated.status, 200);
    const value = await updated.json();
    assert.equal(value.monthlyContribution, "10000");
    assert.equal(value.derived.projectedAmount, "160000");
    assert.equal(value.derived.projectedGoalShortfall, "40000");

    const crossUser = await request(baseUrl, USER_A, `/api/goals/${GOAL_B}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetAmount: "1" }),
    });
    assert.equal(crossUser.status, 404);
    assert.equal((await crossUser.json()).error.code, "GOAL_NOT_FOUND");
    assert.equal(repository.profiles.get(USER_B).goals[0].targetAmount, "90000");

    const missing = await request(baseUrl, USER_A, "/api/goals/cccccccc-0000-4000-8000-000000000003", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetAmount: "1" }),
    });
    assert.equal(missing.status, 404);
    const invalid = await request(baseUrl, USER_A, `/api/goals/${GOAL_A}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetAmount: "-2" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(repository.profiles.get(USER_A).goals[0].targetAmount, "200000");
  });
});

test("development identity uses only configured environment and production rejects it", async () => {
  const repository = new InMemoryFinancialDataRepository([makeProfile()]);
  const developmentResolver = createDevelopmentIdentityResolver({ NODE_ENV: "development", NEXUS_DEV_USER_ID: USER_A });
  await withServer(repository, developmentResolver, async (baseUrl) => {
    const response = await request(baseUrl, USER_B, "/api/goals");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });
  const productionResolver = createDevelopmentIdentityResolver({ NODE_ENV: "production", NEXUS_DEV_USER_ID: USER_A });
  await withServer(repository, productionResolver, async (baseUrl) => {
    const response = await request(baseUrl, USER_A, "/api/goals");
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "AUTHENTICATION_REQUIRED");
  });
});
