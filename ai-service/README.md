# NEXUS AI service

This FastAPI service owns future AI intelligence. Node remains the authoritative application backend, persistence owner, and source of deterministic financial and scenario results. FastAPI receives request-scoped calculated context from Node and has no PostgreSQL access or end-user authentication responsibility.

`GET /health` is public liveness. `POST /internal/ai/analyze` accepts the existing strict Node contract and requires `X-Service-Token`. It returns the unchanged contract-valid placeholder; it does not invoke any pipeline component.

## AI service boundaries

```text
Node calculated context
  → schemas/context
  → rag → retrieval → evidence context
  → prompts → Gemini provider
  → verification
```

The subsystem modules define typed interfaces and explicit unavailable/not-implemented responses. Their current status is:

- Gemini: skeleton only; no API calls or API key.
- RAG: skeleton only; no pipeline execution.
- Retrieval: skeleton only; no vector search, external scraping, or fabricated documents.
- Embeddings: skeleton only; no provider calls or fabricated vectors.
- Prompts: small builder for supplied context, with an instruction not to invent or recalculate facts.
- Verification: skeleton only; no verification success is claimed.

FastAPI does not calculate monthly surplus, ratios, goals, scenario deltas, liquidity impact, or risk flags. Those results come from Node.

```powershell
python -m pip install -r requirements-test.txt
python -m uvicorn app.main:app --reload --port 8000
```

Set `SERVICE_TOKEN` in the service environment, and set the same value as `AI_SERVICE_TOKEN` in the Node backend environment. Use real random values only in ignored local environment files; the checked-in examples are placeholders. The browser never receives the service token and does not call FastAPI directly.

Run service tests from this directory with `python -m pytest tests -q`.
