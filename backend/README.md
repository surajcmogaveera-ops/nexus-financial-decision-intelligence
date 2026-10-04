# NEXUS Node backend

The Node.js, Express, and TypeScript application is the authoritative NEXUS application backend and persistence owner. The backend uses Prisma 7.10.0 for PostgreSQL. The schema and initial migration are ready; the migration must be applied to a configured PostgreSQL database before database health reports success. Financial Twin recalculation remains request-based and in-memory and does not persist state.

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The service listens on `PORT` (default `3000`).

The prior Python financial/API application is preserved under `../legacy/python-reference/`; it is not the target Node backend.

Run the Node tests with `pnpm test`. `POST /api/financial-twin/recalculate` accepts a validated request-body Financial Profile, recalculates all derived metrics in memory, and returns provenance, risk flags, and calculation metadata. Goal results distinguish current funding gap, projected goal amount, and projected goal shortfall. Authentication, scenario execution, Gemini, RAG, embeddings, market APIs, and frontend product UI are not implemented. The FastAPI service is scaffolded for future AI work and currently only exposes health.

## PostgreSQL setup

1. Create an empty local PostgreSQL database named `nexus` (no demo or seed rows are inserted).
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the credentials for that database. `.env` is ignored by Git; the checked-in URL is an example only.
3. Apply the checked-in migration with `pnpm db:migrate` during development. In environments applying committed migrations only, use `pnpm db:deploy`. `pnpm db:status` reports migration state; `pnpm prisma:validate` validates the schema.

`GET /health` is process liveness and does not require PostgreSQL. `GET /health/db` runs a real `SELECT 1` through the shared Prisma client and returns HTTP 503 with a safe structured error when configuration or connectivity fails.

Prisma owns future application persistence. The initial schema includes users, financial profiles and line items, goals, scenario definitions/results, financial snapshots, evidence source/document/chunk metadata, AI analysis/verification storage, market data, and audit logs. Monetary columns use PostgreSQL `DECIMAL`, and no derived metrics are stored as raw profile fields. Profile aggregate inputs are preserved separately from optional line-item records; no aggregation or CRUD behavior is implemented yet. JSONB is intentionally used for evolvable scenario inputs/results and point-in-time snapshot payloads. Snapshot creation, evidence ingestion, AI work, market fetching, and scenario execution do not occur in Hour 3.

The migration includes PostgreSQL `CHECK` constraints for non-negative financial amounts. Prisma's schema language does not currently represent these constraints, so preserve them in migration SQL when editing/recreating the initial migration. `legacy/python-reference/` retains the historical SQLAlchemy/Alembic reference and is not a second production database layer.
