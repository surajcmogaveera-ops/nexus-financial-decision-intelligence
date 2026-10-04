# NEXUS architecture

## Target service boundaries

```text
USER
  ↓
NEXT.JS FRONTEND
  ↓
NODE + EXPRESS BACKEND
  ├── PostgreSQL application data
  ├── Financial Twin and deterministic Financial Engine
  ├── Scenario Engine
  ├── Market-data integrations
  └── Final application verification
          ↓ Node-to-service API calls
       FASTAPI AI SERVICE
       ├── Document ingestion and chunking
       ├── Retrieval and embeddings
       ├── RAG
       ├── Gemini orchestration
       └── AI-specific structured-output validation
```

## Ownership

- **Frontend:** Next.js and TypeScript UI, communicating with the Node API. It does not call Gemini or the AI service for normal user operations and is not the source of financial calculations.
- **Node backend:** The authoritative application backend and Express/TypeScript boundary. It owns application routing, future authentication/authorization, users and profiles, Financial Twin raw data, goals, scenarios, PostgreSQL access, market-data integration, calls to the AI service, and application-level orchestration and verification. The in-memory Financial Twin contracts and deterministic engine are partially implemented here.
- **PostgreSQL:** The Node backend is the target owner of application persistence. No Node database integration is implemented yet.
- **Financial Engine:** The deterministic TypeScript implementation in the Node backend is the authoritative application calculation source as its port progresses. Its current pure calculations cover the Financial Twin and core goal metrics. The Python financial, goal, and risk engines are **LEGACY/REFERENCE** parity oracles; Python is not an active production financial backend and these engines are not part of the AI service.
- **Scenario Engine:** Belongs in the Node backend and will consume the deterministic engines. It is **NOT YET IMPLEMENTED**.
- **FastAPI AI service:** Owns Gemini interaction, document ingestion, chunking, embeddings, retrieval, RAG, and AI-specific structured-output validation. It is the intelligence service, not a second production Financial Twin backend. It remains **SCAFFOLDED** with a health endpoint only.
- **Verification:** Final business/application verification belongs to the Node backend. AI structured-output checks belong to the AI service. Current deterministic Python verification/evidence code remains **LEGACY/REFERENCE**.
- **Node → FastAPI:** The Node backend will call the AI service through an internal API when a future application flow needs AI. There is no caller or AI feature yet.

## Migration status

### IMPLEMENTED

- Node/Express/TypeScript backend bootstrap and `GET /health`.
- Validated TypeScript Financial Twin contracts, deterministic metrics/goal calculations, validation, structured errors, provenance, and Python-parity fixtures/tests.
- Temporary, request-based and in-memory `POST /api/financial-twin/recalculate`; it does not persist state.
- FastAPI scaffold and `GET /health` only.
- Architecture documentation and target directories.

### SCAFFOLDED

- Node backend module directories for configuration, middleware, routes, controllers, services, repositories, financial logic, scenarios, verification, AI calls, market data, validators, and tests. Only health and Financial Twin recalculation routes have behavior.
- AI-service directories for API, schemas, services, RAG, retrieval, embeddings, Gemini, verification, prompts, and core configuration.
- Empty Next.js frontend location.

### LEGACY/REFERENCE

- The original Python FastAPI financial API, Pydantic schemas, Financial Twin, deterministic Financial/Goal/Risk engines, evidence/provenance code, SQLAlchemy models/repository/service, PostgreSQL configuration, Alembic migration, requirements, `.env`, and tests are preserved under `legacy/python-reference/`.
- The original Python tests still run from that location. PostgreSQL integration remains opt-in and skips unless `NEXUS_TEST_DATABASE_URL` is configured.

### NOT YET IMPLEMENTED

- PostgreSQL persistence, authentication, profile/goal/scenario/simulation APIs, complete TypeScript scenario engine, Gemini, RAG, embeddings, market APIs, Node-to-FastAPI calls, and frontend product UI.

PostgreSQL persistence will be owned by the Node backend and is planned for Hour 3. Until then, Financial Twin recalculation is non-persistent and request-based; the FastAPI service has no financial persistence responsibility.

The deterministic financial engine is being ported gradually from Python to TypeScript. Fixtures capture reference outputs; the Python implementation remains unchanged for parity checks during migration.

This is only the architecture reset; it does not make NEXUS architecturally complete.
