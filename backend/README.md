# NEXUS Node backend

The Node.js, Express, and TypeScript application is the authoritative NEXUS application backend. Currently implemented are `GET /health` and the validated, deterministic Financial Twin recalculation endpoint, with structured errors, provenance, and parity fixtures/tests. Recalculation is request-based and in-memory only: it does not persist Financial Twin state.

```powershell
pnpm install
pnpm build
pnpm start
```

The service listens on `PORT` (default `3000`).

The prior Python financial/API application is preserved under `../legacy/python-reference/`; it is not the target Node backend.

Run the Node tests with `pnpm test`. `POST /api/financial-twin/recalculate` accepts a validated request-body Financial Profile, recalculates all derived metrics in memory, and returns provenance, risk flags, and calculation metadata. Goal results distinguish current funding gap, projected goal amount, and projected goal shortfall. PostgreSQL persistence is not implemented yet; it will be owned by Node in Hour 3. Authentication, scenarios, Gemini, RAG, embeddings, market APIs, and frontend product UI are not implemented. The FastAPI service is scaffolded for future AI work and currently only exposes health.
