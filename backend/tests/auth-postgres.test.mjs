import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createApp } from "../dist/app.js";
import { AuthService } from "../dist/auth/service.js";
import { createPrismaClient } from "../dist/db/prisma.js";
import { PrismaAuthUserRepository } from "../dist/auth/repository.js";
import { PrismaFinancialDataRepository } from "../dist/financial/profileRepository.js";

const testDatabaseUrl = process.env.NEXUS_TEST_DATABASE_URL;
const TEST_SECRET = "postgres-hour-nine-test-secret-never-use-123456";

test("PostgreSQL auth and ownership integration isolates two registered users and cleans up fixtures", {
  skip: !testDatabaseUrl,
}, async () => {
  const parsed = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  assert.match(databaseName, /^nexus_(?:hour9_)?test_[a-z0-9_]+$/i,
    "NEXUS_TEST_DATABASE_URL must point to a dedicated NEXUS test database, never the development database");

  const prisma = createPrismaClient(testDatabaseUrl);
  const auth = new AuthService(new PrismaAuthUserRepository(() => prisma), TEST_SECRET, "test");
  const financialRepository = new PrismaFinancialDataRepository(() => prisma);
  const app = createApp({ authService: auth, financialDataRepository: financialRepository });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const marker = randomUUID();
  const emailA = `hour9-a-${marker}@example.test`;
  const emailB = `hour9-b-${marker}@example.test`;
  const createdEmails = [emailA, emailB];

  const call = (path, { cookie, ...options } = {}) => {
    const headers = new Headers(options.headers ?? {});
    if (cookie) headers.set("cookie", cookie);
    return fetch(`${baseUrl}${path}`, { ...options, headers });
  };
  const cookieOf = (response) => (response.headers.get("set-cookie") ?? "").split(";")[0];
  const register = async (email, name) => {
    const response = await call("/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, password: "secure-hour-nine-password" }),
    });
    assert.equal(response.status, 201);
    return { ...(await response.json()), cookie: cookieOf(response) };
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    const userA = await register(` ${emailA.toUpperCase()} `, "User A");
    const userB = await register(emailB, "User B");
    assert.equal(userA.user.email, emailA);
    await prisma.financialProfile.create({
      data: {
        userId: userA.user.id,
        monthlyIncome: "30000.00",
        monthlyExpenses: "20000.00",
        monthlyDebtPayments: "0.00",
        liquidSavings: "40000.00",
        essentialMonthlyExpenses: "20000.00",
      },
    });
    await prisma.financialProfile.create({
      data: {
        userId: userB.user.id,
        monthlyIncome: "90000.00",
        monthlyExpenses: "70000.00",
        monthlyDebtPayments: "10000.00",
        liquidSavings: "80000.00",
        essentialMonthlyExpenses: "70000.00",
      },
    });

    const createGoal = async (cookie, name) => {
      const response = await call("/api/goals", {
        method: "POST", cookie, headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          targetAmount: "200000",
          currentAllocatedAmount: "40000",
          monthsRemaining: 12,
          monthlyContribution: "5000",
        }),
      });
      assert.equal(response.status, 201);
      return response.json();
    };
    const goalB = await createGoal(userB.cookie, "B private goal");

    const twinA = await call(`/api/financial-twin?userId=${encodeURIComponent(userB.user.id)}`, { cookie: userA.cookie });
    const twinB = await call(`/api/financial-twin?userId=${encodeURIComponent(userA.user.id)}`, { cookie: userB.cookie });
    assert.equal(twinA.status, 200);
    assert.equal((await twinA.json()).raw.monthlyIncome, "30000");
    assert.equal(twinB.status, 200);
    assert.equal((await twinB.json()).raw.monthlyIncome, "90000");

    const goalsAInitially = await call("/api/goals", { cookie: userA.cookie });
    assert.deepEqual(await goalsAInitially.json(), []);
    const goalA = await createGoal(userA.cookie, "A private goal");
    const goalsA = await call("/api/goals", { cookie: userA.cookie });
    assert.deepEqual((await goalsA.json()).map((goal) => goal.name), ["A private goal"]);
    const updatedA = await call(`/api/goals/${goalA.id}`, {
      method: "PUT", cookie: userA.cookie, headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyContribution: "10000" }),
    });
    assert.equal(updatedA.status, 200);

    const readForeignGoal = await call(`/api/goals/${goalB.id}`, { cookie: userA.cookie });
    assert.equal(readForeignGoal.status, 404);
    const updateForeignGoal = await call(`/api/goals/${goalB.id}`, {
      method: "PUT", cookie: userA.cookie, headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetAmount: "1" }),
    });
    assert.equal(updateForeignGoal.status, 404);
    const bOwnGoals = await call("/api/goals", { cookie: userB.cookie });
    assert.deepEqual((await bOwnGoals.json()).map((goal) => goal.name), ["B private goal"]);
    const bCannotUpdateA = await call(`/api/goals/${goalA.id}`, {
      method: "PUT", cookie: userB.cookie, headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetAmount: "1" }),
    });
    assert.equal(bCannotUpdateA.status, 404);

    const duplicate = await call("/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailA.toUpperCase(), password: "secure-hour-nine-password" }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await prisma.user.count({ where: { email: { in: createdEmails } } })), 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  }
});

