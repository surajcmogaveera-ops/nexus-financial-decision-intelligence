import assert from "node:assert/strict";
import { test } from "node:test";

import { createApp } from "../dist/app.js";
import { DatabaseConfigurationError, getDatabaseUrl } from "../dist/db/config.js";
import {
  createPrismaClient,
  disconnectPrismaClient,
  getPrismaClient,
} from "../dist/db/prisma.js";

const validDatabaseUrl = "postgresql://example-user:example-password@127.0.0.1:5432/example_db?schema=public";

test("database configuration accepts PostgreSQL URLs and rejects other or malformed values safely", () => {
  assert.equal(getDatabaseUrl(validDatabaseUrl), validDatabaseUrl);
  for (const value of [undefined, "", "not-a-url", "https://example.test/db", "postgresql://localhost/"]) {
    assert.throws(() => getDatabaseUrl(value ?? ""), (error) => {
      assert.ok(error instanceof DatabaseConfigurationError);
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
  }
});

test("Prisma client can be initialized and is shared as one application instance", async () => {
  const standalone = createPrismaClient(validDatabaseUrl);
  assert.ok(standalone);
  await standalone.$disconnect();

  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = validDatabaseUrl;
  try {
    const first = getPrismaClient();
    assert.strictEqual(getPrismaClient(), first);
  } finally {
    await disconnectPrismaClient();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});

test("real database health path reports missing connection configuration as unavailable", {
  skip: Boolean(process.env.DATABASE_URL),
}, async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health/db`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "DATABASE_UNAVAILABLE");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a real PostgreSQL connection is checked when NEXUS_TEST_DATABASE_URL is supplied", {
  skip: !process.env.NEXUS_TEST_DATABASE_URL,
}, async () => {
  const client = createPrismaClient(getDatabaseUrl(process.env.NEXUS_TEST_DATABASE_URL));
  try {
    await client.$queryRaw`SELECT 1`;
  } finally {
    await client.$disconnect();
  }
});
