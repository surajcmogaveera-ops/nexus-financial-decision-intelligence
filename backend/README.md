# NEXUS Node backend

The Node.js, Express, and TypeScript application is the authoritative NEXUS application backend and persistence owner. The backend uses Prisma 7.10.0 for PostgreSQL. The initial migration `20261004120000_init_nexus_schema` is applied. Financial Twin recalculation remains request-based and in-memory and does not persist state.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The service listens on `PORT` (default `3000`).

The prior Python financial/API application is preserved under `../legacy/python-reference/` as a behavioral reference and parity oracle; it is not the target Node backend or a production dependency.

Node owns deterministic calculations and is the only intended caller of the FastAPI AI service. Configure `AI_SERVICE_URL` and `AI_SERVICE_TOKEN` in the ignored local `.env`; configure the same token as `SERVICE_TOKEN` in `../ai-service`. `AiServiceClient` sends the strict request to FastAPI's internal `POST /internal/ai/analyze` using `X-Service-Token` and validates the response. The token is never returned by Node APIs or sent to the browser. This internal client is a service boundary only; no public analysis route calls it yet. FastAPI explains Node-supplied deterministic results with Gemini structured output when `GEMINI_API_KEY` is configured and returns an explicit non-AI placeholder when it is not; all deterministic calculations still originate only in Node.

Run the Node tests with `pnpm test`. Authentication endpoints are `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me`. Registration and login issue a signed eight-hour HttpOnly `nexus_session` cookie; it is SameSite=Lax and Secure in production. Passwords use bcrypt cost 12 and are never stored or returned in plaintext. Emails are trimmed and lowercased. Configure `AUTH_SECRET` with a random value of at least 32 bytes in the ignored `.env`; the server will refuse to start if it is missing or too short. Set `FRONTEND_ORIGIN` to the exact browser origin for cookie-based cross-origin requests (default `http://localhost:5173`). `GET /api/financial-twin` and the Goal read/write endpoints require a valid session and derive ownership only from its verified identity. `NEXUS_DEV_USER_ID` is no longer used. `GET /api/auth/me` returns safe user details; logout clears the browser cookie. The deterministic `POST /api/financial-twin/recalculate`, `/api/scenarios/simulate`, and `/api/simulations` endpoints remain public and non-persistent because they calculate only from caller-supplied inputs; they do not read account data. The eight scenario types and unsupported market-stress limitation are documented in `../docs/api-contracts.md`. Derived metrics are never authoritative raw user state. Persisted goal writes store raw goal inputs only; no snapshots or audit rows are created. RAG, embeddings execution, market APIs, and frontend product UI are not implemented; Gemini structured explanation is implemented in the FastAPI AI service (see `../ai-service/README.md`). The simulation API does not call FastAPI.

The unchanged Python engine under `../legacy/python-reference/` is the behavior and parity oracle. Risk evidence IDs are generated from canonical values: numeric values use 16 significant digits with ties-to-even rounding, trailing zeros and negative zero are normalized, and object keys are sorted. This mapping affects evidence identity only; display values and financial formulas are unchanged. Python-parity comparison flags remain distinct from NEXUS profile-level missing-data and projected-shortfall extensions.

## PostgreSQL setup

1. Create an empty local PostgreSQL database named `nexus` (no demo or seed rows are inserted).
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `AUTH_SECRET` to local values. Keep `.env` ignored by Git; the checked-in values are placeholders only. Use a high-entropy secret of at least 32 bytes.
3. Apply the checked-in migration with `pnpm db:migrate` during development. In environments applying committed migrations only, use `pnpm db:deploy`. `pnpm db:status` reports migration state; `pnpm prisma:validate` validates the schema.

`GET /health` is process liveness and does not require PostgreSQL. `GET /health/db` runs a real `SELECT 1` through the shared Prisma client and returns HTTP 503 with a safe structured error when configuration or connectivity fails.

Prisma owns future application persistence. The initial schema includes users, financial profiles and line items, goals, scenario definitions/results, financial snapshots, evidence source/document/chunk metadata, AI analysis/verification storage, market data, and audit logs. Monetary columns use PostgreSQL `DECIMAL`, and no derived metrics are stored as raw profile fields. Profile aggregate inputs are preserved separately from optional line-item records; no aggregation or CRUD behavior is implemented yet. JSONB is intentionally used for evolvable scenario inputs/results and point-in-time snapshot payloads. Snapshot creation, evidence ingestion, AI work, market fetching, and scenario execution do not occur in Hour 3.

The migration includes PostgreSQL `CHECK` constraints for non-negative financial amounts. Prisma's schema language does not currently represent these constraints, so preserve them in migration SQL when editing/recreating the initial migration. `legacy/python-reference/` retains the historical SQLAlchemy/Alembic reference and is not a second production database layer.
