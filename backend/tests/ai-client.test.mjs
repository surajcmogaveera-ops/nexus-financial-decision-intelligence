import assert from "node:assert/strict";
import { test } from "node:test";
import { AiServiceClient, AiServiceError } from "../dist/ai/client.js";
import { createAiAnalysisRequest } from "../dist/ai/types.js";
import { simulate } from "../dist/simulations/service.js";
import { BASIC_PROFILE } from "./fixtures/financial-parity-fixtures.mjs";

const responseFor = (request) => ({
  requestId: request.requestId,
  status: "READY",
  summary: null,
  keyChanges: [],
  tradeoffs: [],
  riskFlags: [],
  evidenceRefs: [],
  assumptions: [],
  limitations: ["AI explanation service is not implemented yet."],
  model: null,
  promptVersion: null,
  calculationVersion: "1.0",
});

function request() {
  return createAiAnalysisRequest("Explain this simulation", simulate({
    baseline: { ...BASIC_PROFILE, currency: "INR" },
    asOfDate: "2026-10-05",
    scenario: { type: "INCOME_SHOCK", percentageBasisPoints: -1000 },
  }), "08e3e76d-8f83-42a3-9fc5-9ce155c4db23");
}

test("Node AI client sends the internal contract and service-token header", async () => {
  const input = request();
  let call;
  const client = new AiServiceClient({
    serviceUrl: "http://localhost:8000/",
    serviceToken: "controlled-test-token",
    fetcher: async (url, init) => {
      call = { url, init };
      return Response.json(responseFor(input));
    },
  });

  assert.deepEqual(await client.analyze(input), responseFor(input));
  assert.equal(call.url, "http://localhost:8000/internal/ai/analyze");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["X-Service-Token"], "controlled-test-token");
  assert.equal(JSON.parse(call.init.body).calculationVersion, "1.0");
});

test("Node AI client handles configuration, transport and upstream failures safely", async (t) => {
  const input = request();
  const cases = [
    ["missing service config", new AiServiceClient({}), "AI_SERVICE_NOT_CONFIGURED", undefined],
    ["connection refused", new AiServiceClient({ serviceUrl: "http://localhost:8000", serviceToken: "x", fetcher: async () => { throw new TypeError("connection refused"); } }), "AI_SERVICE_UNAVAILABLE", undefined],
    ["timeout", new AiServiceClient({ serviceUrl: "http://localhost:8000", serviceToken: "x", fetcher: async () => { throw new DOMException("timeout", "TimeoutError"); } }), "AI_SERVICE_TIMEOUT", undefined],
    ["unauthorized", new AiServiceClient({ serviceUrl: "http://localhost:8000", serviceToken: "secret-token", fetcher: async () => new Response("secret-token", { status: 401 }) }), "AI_SERVICE_UNAUTHORIZED", "secret-token"],
    ["invalid request", new AiServiceClient({ serviceUrl: "http://localhost:8000", serviceToken: "x", fetcher: async () => new Response("", { status: 422 }) }), "AI_SERVICE_REJECTED_REQUEST", undefined],
    ["server error", new AiServiceClient({ serviceUrl: "http://localhost:8000", serviceToken: "secret-token", fetcher: async () => new Response("secret-token python stack", { status: 500 }) }), "AI_SERVICE_FAILURE", "secret-token"],
    ["malformed response", new AiServiceClient({ serviceUrl: "http://localhost:8000", serviceToken: "x", fetcher: async () => Response.json({ requestId: input.requestId }) }), "AI_SERVICE_INVALID_RESPONSE", undefined],
  ];
  for (const [name, client, code, secret] of cases) {
    await t.test(name, async () => {
      await assert.rejects(client.analyze(input), (error) => {
        assert.ok(error instanceof AiServiceError);
        assert.equal(error.code, code);
        if (secret) assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes("localhost"), false);
        return true;
      });
    });
  }
});

test("Node rejects an invalid internal request before making a network call", async () => {
  let called = false;
  const client = new AiServiceClient({
    serviceUrl: "http://localhost:8000",
    serviceToken: "x",
    fetcher: async () => { called = true; return Response.json({}); },
  });
  await assert.rejects(client.analyze({}), { code: "INVALID_AI_REQUEST" });
  assert.equal(called, false);
});
