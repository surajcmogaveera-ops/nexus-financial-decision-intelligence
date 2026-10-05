# NEXUS Node backend

The Node.js, Express, and TypeScript application is the authoritative NEXUS application backend and persistence owner. The backend uses Prisma 7.10.0 for PostgreSQL. The initial migration `20261004120000_init_nexus_schema` is applied. Financial Twin recalculation remains request-based and in-memory and does not persist state.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The service listens on `PORT` (default `3000`).

The prior Python financial/API application is preserved under `../legacy/python-reference/` as a behavioral reference and parity oracle; it is not the target Node backend or a production dependency.

Run the Node tests with `pnpm test`. `GET /api/financial-twin`, `GET /api/goals`, `POST /api/goals`, and `PUT /api/goals/:id` use Prisma repositories scoped to a trusted user context. The temporary development identity is enabled only when `NODE_ENV` is `development` or `test` and `NEXUS_DEV_USER_ID` names an existing user UUID; it does not create users/profiles and is not production authentication. Configure it in PowerShell with `$env:NODE_ENV = 'development'` and `$env:NEXUS_DEV_USER_ID = '<existing-user-uuid>'` before `pnpm start`. Production must use a future trusted authentication resolver. `POST /api/financial-twin/recalculate` remains request-based and independent of this identity layer. `POST /api/scenarios/simulate` and `POST /api/simulations` share the Node Simulation Service and deterministic Scenario Engine; the former preserves the Hour 6 response, while the latter returns the versioned baseline/scenario/delta response with `calculationVersion: "1.0"`. The simulation endpoint uses a caller-supplied raw baseline and does not persist results. The eight scenario types and unsupported market-stress limitation are documented in `../docs/api-contracts.md`. Derived metrics are never authoritative raw user state. Persisted goal writes store raw goal inputs only; no snapshots or audit rows are created. Gemini, RAG, embeddings, market APIs, and frontend product UI are not implemented. The FastAPI service is scaffolded for future AI work and currently only exposes health; the simulation API does not call it.

The unchanged Python engine under `../legacy/python-reference/` is the behavior and parity oracle. Risk evidence IDs are generated from canonical values: numeric values use 16 significant digits with ties-to-even rounding, trailing zeros and negative zero are normalized, and object keys are sorted. This mapping affects evidence identity only; display values and financial formulas are unchanged. Python-parity comparison flags remain distinct from NEXUS profile-level missing-data and projected-shortfall extensions.

## PostgreSQL setup

1. Create an empty local PostgreSQL database named `nexus` (no demo or seed rows are inserted).
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the credentials for that database. `.env` is ignored by Git; the checked-in URL is an example only.
3. Apply the checked-in migration with `pnpm db:migrate` during development. In environments applying committed migrations only, use `pnpm db:deploy`. `pnpm db:status` reports migration state; `pnpm prisma:validate` validates the schema.

`GET /health` is process liveness and does not require PostgreSQL. `GET /health/db` runs a real `SELECT 1` through the shared Prisma client and returns HTTP 503 with a safe structured error when configuration or connectivity fails.

Prisma owns future application persistence. The initial schema includes users, financial profiles and line items, goals, scenario definitions/results, financial snapshots, evidence source/document/chunk metadata, AI analysis/verification storage, market data, and audit logs. Monetary columns use PostgreSQL `DECIMAL`, and no derived metrics are stored as raw profile fields. Profile aggregate inputs are preserved separately from optional line-item records; no aggregation or CRUD behavior is implemented yet. JSONB is intentionally used for evolvable scenario inputs/results and point-in-time snapshot payloads. Snapshot creation, evidence ingestion, AI work, market fetching, and scenario execution do not occur in Hour 3.

The migration includes PostgreSQL `CHECK` constraints for non-negative financial amounts. Prisma's schema language does not currently represent these constraints, so preserve them in migration SQL when editing/recreating the initial migration. `legacy/python-reference/` retains the historical SQLAlchemy/Alembic reference and is not a second production database layer.
