import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { AiServiceClient, AiServiceError } from "../dist/ai/client.js";
import { createAiAnalysisRequest } from "../dist/ai/types.js";
import { simulate } from "../dist/simulations/service.js";
import { BASIC_PROFILE } from "./fixtures/financial-parity-fixtures.mjs";

const python = resolve("../ai-service/.venv/Scripts/python.exe");
const cwd = resolve("../ai-service");
const probe = spawnSync(python, ["-c", "import fastapi, uvicorn"], { stdio: "ignore" });

test("Node calls the real authenticated FastAPI endpoint", { skip: probe.error || probe.status !== 0 ? "AI service test venv is not available" : false, timeout: 25_000 }, async (t) => {
  const port = await availablePort();
  const serviceToken = "nexus-hour10-controlled-integration-token";
  const child = spawn(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port), "--log-level", "critical"], {
    cwd,
    env: { ...process.env, SERVICE_TOKEN: serviceToken },
    stdio: "ignore",
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, child);
    const result = simulate({
      baseline: { ...BASIC_PROFILE, currency: "INR" },
      asOfDate: "2026-10-05",
      scenario: { type: "INCOME_SHOCK", percentageBasisPoints: -1000 },
    });
    const request = createAiAnalysisRequest("Explain this simulation", result, "08e3e76d-8f83-42a3-9fc5-9ce155c4db23");

    const accepted = await new AiServiceClient({ serviceUrl: baseUrl, serviceToken }).analyze(request);
    assert.equal(accepted.requestId, request.requestId);
    assert.equal(accepted.status, "READY");
    assert.match(accepted.limitations[0], /not implemented/i);

    const rejected = new AiServiceClient({ serviceUrl: baseUrl, serviceToken: "incorrect-controlled-token" });
    await assert.rejects(rejected.analyze(request), (error) => error instanceof AiServiceError && error.code === "AI_SERVICE_UNAUTHORIZED");

    const unauthenticated = await fetch(`${baseUrl}/internal/ai/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(unauthenticated.status, 401);
    const authError = await unauthenticated.json();
    assert.equal(JSON.stringify(authError).includes(serviceToken), false);
  } finally {
    child.kill();
    await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(3000)]);
  }
});

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.listen(0, "127.0.0.1", resolveListen).once("error", reject));
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("FastAPI integration server exited before startup.");
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* Wait for Uvicorn startup. */ }
    await delay(150);
  }
  throw new Error("FastAPI integration server did not become healthy.");
}
