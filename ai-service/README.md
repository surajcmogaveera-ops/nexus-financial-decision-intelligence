# NEXUS AI service

This FastAPI service is the NEXUS AI/RAG service boundary. `GET /health` is public liveness. `POST /internal/ai/analyze` accepts the strict Node simulation contract and requires `X-Service-Token`. It returns a contract-valid placeholder that explicitly says AI explanations are not implemented. No Gemini, RAG, database access, or financial calculation is implemented here.

```powershell
python -m pip install -r requirements-test.txt
python -m uvicorn app.main:app --reload --port 8000
```

Set `SERVICE_TOKEN` in the service environment, and set the same value as `AI_SERVICE_TOKEN` in the Node backend environment. Use real random values only in ignored local environment files; the checked-in examples are placeholders. Node remains the application data owner and deterministic calculation authority; FastAPI receives only the request-scoped structured context.

Run service tests from this directory with `python -m pytest tests -q`.
