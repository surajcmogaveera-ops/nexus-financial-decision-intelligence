# NEXUS AI service

This FastAPI service owns AI intelligence. Node remains the authoritative application backend, persistence owner, and source of deterministic financial and scenario results. FastAPI receives request-scoped calculated context from Node and has no PostgreSQL access or end-user authentication responsibility.

`GET /health` is public liveness. `POST /internal/ai/analyze` accepts the existing strict Node contract and requires `X-Service-Token`.

## Gemini structured generation (Hour 12)

When `GEMINI_API_KEY` is configured, the analysis endpoint runs a real Gemini generation through the official Google GenAI Python SDK (`google-genai`) using schema-constrained structured output: the model must return JSON matching the strict Pydantic model `GeminiStructuredAnalysis` (`summary`, `whatChanged`, `tradeoffs`, `risks`, `evidenceRefs`, `assumptions`, `limitations`, `confidence`, `disclaimer`), requested via `response_schema` with `application/json`. The returned JSON is then re-validated with strict Pydantic validation (unknown fields, unknown confidence values, and pathological lengths are rejected).

The pipeline:

```text
POST /internal/ai/analyze (X-Service-Token)
  → validate Node AIAnalysisRequest
  → PromptBuilder (AUTHORITATIVE INPUT vs AI INTERPRETATION)
  → GeminiClient (provider behind the existing protocol)
  → Gemini structured JSON
  → strict Pydantic validation (GeminiStructuredAnalysis)
  → evidenceRefs / assumptions validated against Node-supplied data
  → adapter → existing AiAnalysisResponse contract
```

Boundaries that Hour 12 preserves:

- **Node computes the financial truth.** Gemini never recalculates, modifies, estimates, or invents financial values; the prompt explicitly forbids arithmetic and requires numbers to be copied verbatim from the supplied context.
- **Deterministic risk flags remain owned by Node.** `response.riskFlags` is always `request.riskFlags`. Gemini's `risks` is explanatory prose about supplied flags and can never add, remove, or reclassify a flag; a `riskFlags` key inside model output is rejected by the schema.
- **Evidence identity remains owned by Node.** Every returned `evidenceRef` is checked against the evidence IDs supplied in `request.evidence`, `request.baseline.evidence`, and `request.scenario.evidence`; unknown references are dropped. Assumptions are filtered the same way against `request.assumptions`.
- **The Node → FastAPI contract is unchanged.** The adapter maps the internal Gemini schema onto the existing `AiAnalysisResponse` (`requestId`, `status`, `summary`, `keyChanges`, `tradeoffs`, `riskFlags`, `evidenceRefs`, `assumptions`, `limitations`, `model`, `promptVersion`, `calculationVersion`). `requestId` and `calculationVersion` are always taken from the request. Gemini's `confidence` and `disclaimer` stay in the internal schema until the richer public analysis contract is introduced.
- **Provider failures are explicit, never faked.** Missing key/model → `NOT_CONFIGURED` (the existing explicit contract placeholder is returned); API failure or timeout → `UNAVAILABLE` (HTTP 503 `AI_GENERATION_UNAVAILABLE`); malformed or schema-invalid model output → `INVALID_OUTPUT` (HTTP 502 `AI_INVALID_OUTPUT`); other provider exceptions → `ERROR` (HTTP 500 `AI_GENERATION_ERROR`). No fabricated AI output is ever returned.

Configuration (never commit real values; use ignored local environment files):

| Variable | Purpose |
| --- | --- |
| `SERVICE_TOKEN` | Internal endpoint auth; must equal the Node backend's `AI_SERVICE_TOKEN`. |
| `GEMINI_API_KEY` | Enables real Gemini generation. Absent → explicit not-configured placeholder. |
| `GEMINI_MODEL` | Optional model name (default `gemini-2.5-flash`). |
| `GEMINI_TIMEOUT_MS` | Optional request timeout in milliseconds (default `20000`). |

The API key is read from the environment, is never hardcoded, never logged, and never exposed in object representations or responses.

## AI service boundaries

```text
Node calculated context
  → schemas/context
  → prompts → Gemini provider (structured JSON)   [RAG → retrieval → evidence context: future]
  → strict Pydantic validation → adapter
  → verification                                  [future]
```

Current subsystem status:

- Gemini: **implemented** — real structured JSON generation behind the existing `GeminiClient` protocol, strict Pydantic validation, explicit `READY`/`NOT_CONFIGURED`/`UNAVAILABLE`/`INVALID_OUTPUT`/`ERROR` states.
- Prompts: **implemented** — analysis instruction separates AUTHORITATIVE INPUT from AI INTERPRETATION and carries the anti-recalculation, no-invented-evidence/assumptions/risk-categories constraints.
- RAG: skeleton only; no pipeline execution.
- Retrieval: skeleton only; no vector search, external scraping, or fabricated documents.
- Embeddings: skeleton only; no provider calls or fabricated vectors.
- Verification: skeleton only; no verification success is claimed.

FastAPI does not calculate monthly surplus, ratios, goals, scenario deltas, liquidity impact, or risk flags. Those results come from Node. RAG, retrieval, embeddings execution, and final AI verification remain future work.

## Running

```powershell
python -m pip install -r requirements-test.txt
python -m uvicorn app.main:app --reload --port 8000
```

Set `SERVICE_TOKEN` in the service environment, and set the same value as `AI_SERVICE_TOKEN` in the Node backend environment. Use real random values only in ignored local environment files; the checked-in examples are placeholders. The browser never receives the service token and does not call FastAPI directly.

Run service tests from this directory with `python -m pytest tests -q`. The normal suite never requires a Gemini API key or network access; the Gemini provider is mocked through the existing `GeminiClient` protocol. A live integration test is opt-in:

```powershell
$env:NEXUS_LIVE_GEMINI_TEST = "true"; $env:GEMINI_API_KEY = "..."; python -m pytest tests -q
```
