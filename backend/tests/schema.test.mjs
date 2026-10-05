import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../prisma/migrations/20261004120000_init_nexus_schema/migration.sql", import.meta.url),
  "utf8",
);
const authMigration = await readFile(
  new URL("../prisma/migrations/20261005042054_auth_password_hash/migration.sql", import.meta.url),
  "utf8",
);

test("Prisma schema and initial migration contain the required NEXUS data models", () => {
  const models = [
    ["User", "users"],
    ["FinancialProfile", "financial_profiles"],
    ["IncomeSource", "income_sources"],
    ["ExpenseCategory", "expense_categories"],
    ["Debt", "debts"],
    ["Asset", "assets"],
    ["Investment", "investments"],
    ["Goal", "goals"],
    ["Scenario", "scenarios"],
    ["ScenarioResult", "scenario_results"],
    ["FinancialSnapshot", "financial_snapshots"],
    ["EvidenceSource", "evidence_sources"],
    ["EvidenceDocument", "evidence_documents"],
    ["EvidenceChunk", "evidence_chunks"],
    ["AIAnalysis", "ai_analyses"],
    ["VerificationResult", "verification_results"],
    ["MarketData", "market_data"],
    ["AuditLog", "audit_logs"],
  ];

  for (const [model, table] of models) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
    assert.ok(migration.includes(`CREATE TABLE "${table}"`), `${table} migration missing`);
  }
  assert.equal(models.length, 18);
});

test("raw profile storage uses Decimal and excludes derived Financial Twin metrics", () => {
  const profile = schema.match(/model FinancialProfile \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(profile);
  for (const field of [
    "monthlyIncome",
    "monthlyExpenses",
    "monthlyDebtPayments",
    "liquidSavings",
    "investments",
    "monthlyInvestmentContribution",
  ]) {
    assert.match(profile, new RegExp(`${field}\\s+Decimal\\?`));
  }
  for (const derived of [
    "monthlySurplus",
    "savingsRate",
    "debtToIncome",
    "emergencyCoverageMonths",
    "projectedGoalShortfall",
  ]) {
    assert.doesNotMatch(profile, new RegExp(`\\b${derived}\\b`));
  }
  assert.match(migration, /DECIMAL\(18,2\)/);
  assert.match(migration, /CHECK \("monthly_income" IS NULL OR "monthly_income" >= 0\)/);
});

test("migration contains no inserts or seed/demo data", () => {
  assert.doesNotMatch(migration, /\bINSERT\s+INTO\b/i);
});

test("authentication adds only an optional password hash to the existing User model", () => {
  const user = schema.match(/model User \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(user);
  assert.match(user, /passwordHash\s+String\?\s+@map\("password_hash"\)/);
  assert.match(authMigration, /ALTER TABLE "users" ADD COLUMN\s+"password_hash" VARCHAR\(255\)/);
  assert.doesNotMatch(authMigration, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(authMigration, /DROP TABLE|DROP COLUMN/i);
});
