import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { createApp } from "../dist/app.js";
import { AiServiceClient } from "../dist/ai/client.js";
import { AuthService } from "../dist/auth/service.js";
import { verifyAiAnalysis } from "../dist/verification/service.js";
import { InMemoryAuthUserRepository } from "./helpers/in-memory-auth-repository.mjs";
import { FLAGSHIP_BASELINE } from "./fixtures/financial-parity-fixtures.mjs";

const python = resolve("../ai-service/.venv/Scripts/python.exe");
const cwd = resolve("../ai-service");
const probe = spawnSync(python, ["-c", "import fastapi, uvicorn"], { stdio: "ignore" });

test("authenticated flagship simulation traverses Node, RAG context, FastAPI validation, Gemini adapter, and verifier", {
  skip: probe.error || probe.status !== 0 ? "AI service test venv is not available" : false,
  timeout: 60_000,
}, async () => {
  const port = await availablePort();
  const serviceToken = "nexus-hour20-controlled-integration-token";
  const child = spawn(python, ["-c", mockFastApiServer(port)], {
    cwd,
    env: { ...process.env, SERVICE_TOKEN: serviceToken, GEMINI_API_KEY: "" },
    stdio: "ignore",
  });
  let nodeServer;
  try {
    const aiServiceUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(aiServiceUrl, child);

    const users = new InMemoryAuthUserRepository();
    const auth = new AuthService(users, "hour20-test-auth-secret-not-for-production-123", "test");
    const persisted = new Map();
    const scenarioEvidenceRepository = {
      async createForUser(_userId, result) {
        const id = `00000000-0000-4000-8000-${String(persisted.size + 1).padStart(12, "0")}`;
        persisted.set(id, structuredClone(result));
        return id;
      },
      async findOwnedResult() { return null; },
    };
    let retrievalAvailable = true;
    let flaggedExplanation = false;
    let verifierFails = false;
    const simulationFlowDependencies = {
      async retrieve(query) {
        if (!retrievalAvailable) {
          return {
            query, status: "UNAVAILABLE", results: [],
            metadata: { methods: [], candidateCount: 0, ftsAvailable: false, vectorAvailable: false, vectorStatus: "UNAVAILABLE", message: "Controlled RAG outage." },
          };
        }
        const content = flaggedExplanation
          ? "hour20-rag-flag: deterministic text intended to exercise verifier safety."
          : "hour20-rag-context: curated budgeting guidance for funding a goal.";
        return {
          query, status: "READY",
          results: [{
            chunkId: "rag-flagship-chunk", documentId: "rag-flagship-doc", title: "Goal funding guide", topic: "budgeting",
            content, sourceId: "rag-flagship-source", sourceName: "NEXUS curated guide", sourceType: "INTERNAL_CURATED",
            sourceUrl: null, provenance: "ASSUMPTION", retrievalMethods: ["fts"], ftsRank: 1, ftsScore: 0.5,
            vectorRank: null, vectorScore: null, rrfScore: 1 / 61,
          }],
          metadata: { methods: ["fts"], candidateCount: 1, ftsAvailable: true, vectorAvailable: false, vectorStatus: "NOT_CONFIGURED", message: null },
        };
      },
      verify(response, context) {
        if (verifierFails) throw new Error("controlled verifier failure");
        return verifyAiAnalysis(response, context);
      },
    };
    const aiServiceClient = new AiServiceClient({ serviceUrl: aiServiceUrl, serviceToken });
    nodeServer = createApp({ authUserRepository: users, authService: auth, scenarioEvidenceRepository, aiServiceClient, simulationFlowDependencies }).listen(0, "127.0.0.1");
    await new Promise((resolveListen, reject) => { nodeServer.once("listening", resolveListen); nodeServer.once("error", reject); });
    const baseUrl = `http://127.0.0.1:${nodeServer.address().port}`;

    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "hour20@example.test", password: "a-long-controlled-password", name: "H20 test" }),
    });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie?.startsWith("nexus_session="));
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { cookie } });
    assert.equal(me.status, 200);

    const body = flagshipRequest();
    const response = await postSimulation(baseUrl, cookie, body);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.baseline.derived.monthlySurplus, "10000");
    assert.equal(result.baseline.derived.goals[0].projectedAmount, "160000");
    assert.equal(result.baseline.derived.goals[0].projectedGoalShortfall, "40000");
    assert.equal(result.scenario.derived.monthlySurplus, "10000");
    assert.equal(result.scenario.derived.availableMonthlyCashFlow, "5000");
    assert.equal(result.scenario.derived.goals[0].projectedAmount, "100000");
    assert.equal(result.scenario.derived.goals[0].projectedGoalShortfall, "100000");
    assert.equal(result.delta.additionalScenarioShortfall, "60000");
    assert.ok(result.baseline.evidence.some((entry) => entry.type === "CALCULATION" && entry.evidenceId === entry.calculationId));
    assert.equal(result.retrieval.status, "READY");
    assert.deepEqual(result.retrieval.metadata.methods, ["fts"]);
    assert.equal(result.ai.status, "READY");
    assert.match(result.ai.explanation.summary, /supplied goal projection/i);
    assert.deepEqual(result.ai.explanation.evidenceRefs, ["rag-flagship-chunk"]);
    assert.equal(result.verification.status, "PASS");
    assert.equal(result.scenarioId, "00000000-0000-4000-8000-000000000001");
    assert.equal(persisted.get(result.scenarioId).scenario.derived.goals[0].projectedAmount, "100000");
    assert.equal(result.scenario.derived.monthlySurplus, persisted.get(result.scenarioId).scenario.derived.monthlySurplus);

    retrievalAvailable = false;
    const ragOutageResponse = await postSimulation(baseUrl, cookie, body);
    const ragOutage = await ragOutageResponse.json();
    assert.equal(ragOutageResponse.status, 200);
    assert.equal(ragOutage.retrieval.status, "UNAVAILABLE");
    assert.equal(ragOutage.ai.status, "READY", "AI may continue with deterministic context and no retrieved chunks");
    assert.deepEqual(ragOutage.ai.explanation.evidenceRefs, []);
    assert.equal(ragOutage.verification.status, "PASS");

    retrievalAvailable = true;
    const geminiUnavailableResponse = await postSimulation(baseUrl, cookie, body);
    const geminiUnavailable = await geminiUnavailableResponse.json();
    assert.equal(geminiUnavailableResponse.status, 200);
    assert.equal(geminiUnavailable.ai.status, "UNAVAILABLE");
    assert.equal(geminiUnavailable.ai.explanation, null);
    assert.equal(geminiUnavailable.verification.status, "NOT_APPLICABLE");
    assert.equal(geminiUnavailable.scenario.derived.goals[0].projectedAmount, "100000");

    const invalidOutputResponse = await postSimulation(baseUrl, cookie, body);
    const invalidOutput = await invalidOutputResponse.json();
    assert.equal(invalidOutputResponse.status, 200);
    assert.equal(invalidOutput.ai.status, "UNAVAILABLE");
    assert.equal(invalidOutput.ai.explanation, null);
    assert.equal(invalidOutput.verification.status, "NOT_APPLICABLE");
    assert.equal(invalidOutput.scenario.derived.goals[0].projectedAmount, "100000");

    flaggedExplanation = true;
    const flaggedResponse = await postSimulation(baseUrl, cookie, body);
    const flagged = await flaggedResponse.json();
    assert.equal(flaggedResponse.status, 200);
    assert.equal(flagged.ai.status, "READY");
    assert.equal(flagged.verification.status, "FLAGGED");
    assert.ok(flagged.verification.issues.some((item) => item.code === "GUARANTEE_LANGUAGE_DETECTED"));
    assert.equal(flagged.scenario.derived.goals[0].projectedAmount, "100000");

    flaggedExplanation = false;
    verifierFails = true;
    const verifierFailureResponse = await postSimulation(baseUrl, cookie, body);
    const verifierFailure = await verifierFailureResponse.json();
    assert.equal(verifierFailureResponse.status, 200);
    assert.equal(verifierFailure.verification.status, "FLAGGED");
    assert.ok(verifierFailure.verification.issues.some((item) => item.code === "VERIFIER_FAILURE"));
    assert.equal(verifierFailure.scenario.derived.goals[0].projectedAmount, "100000");

    const invalidRequest = await fetch(`${baseUrl}/api/simulations`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...body, unexpected: true }),
    });
    assert.equal(invalidRequest.status, 400);
  } finally {
    if (nodeServer) await new Promise((resolveClose, reject) => nodeServer.close((error) => error ? reject(error) : resolveClose()));
    child.kill();
    await Promise.race([new Promise((resolveExit) => child.once("exit", resolveExit)), delay(3000)]);
  }
});

function flagshipRequest() {
  return {
    asOfDate: "2026-10-08",
    baseline: {
      ...FLAGSHIP_BASELINE,
      currency: "INR",
      monthlyIncome: "30000",
      monthlyExpenses: "20000",
      monthlyDebtPayments: "0",
      liquidSavings: "40000",
      essentialMonthlyExpenses: "20000",
      monthlyInvestmentContribution: "0",
    },
    scenario: { type: "INVESTMENT_CHANGE", monthlyInvestmentContribution: "5000" },
  };
}

function postSimulation(baseUrl, cookie, body) {
  return fetch(`${baseUrl}/api/simulations`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body),
  });
}

function mockFastApiServer(port) {
  return [
    "import json, uvicorn",
    "import app.services.analysis as analysis",
    "from app.gemini.types import GenerationResult, GenerationStatus",
    "from app.main import app",
    "class ControlledGemini:",
    "    def __init__(self): self.calls = 0",
    "    async def generate(self, request):",
    "        self.calls += 1",
    "        if self.calls == 3:",
    "            return GenerationResult(status=GenerationStatus.UNAVAILABLE, text=None, message='controlled provider outage', model='controlled-gemini')",
    "        if self.calls == 4:",
    "            return GenerationResult(status=GenerationStatus.READY, text='{malformed-json', message='controlled invalid output', model='controlled-gemini')",
    "        if 'hour20-rag-flag' in request.prompt:",
    "            summary = 'The guaranteed monthly surplus is ₹123456.'",
    "        else:",
    "            summary = 'The supplied goal projection remains the authoritative result.'",
    "        evidence_refs = ['rag-flagship-chunk'] if 'hour20-rag-context' in request.prompt else []",
    "        output = {'summary': summary, 'whatChanged': ['The scenario changes goal funding progress.'], 'tradeoffs': [], 'risks': [], 'evidenceRefs': evidence_refs, 'assumptions': [], 'limitations': [], 'confidence': 'medium', 'disclaimer': 'This explanation does not replace the deterministic calculation.'}",
    "        return GenerationResult(status=GenerationStatus.READY, text=json.dumps(output), message='controlled structured output', model='controlled-gemini')",
    "controlled_gemini = ControlledGemini()",
    "analysis.create_gemini_client = lambda: controlled_gemini",
    `uvicorn.run(app, host='127.0.0.1', port=${port}, log_level='critical')`,
  ].join("\n");
}

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
