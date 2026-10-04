# NEXUS architecture

## Target service boundaries

```text
USER
  ↓
NEXT.JS FRONTEND
  ↓
NODE + EXPRESS BACKEND
  ├── Prisma → PostgreSQL application data
  ├── Financial Twin and deterministic Financial Engine
  ├── Scenario Engine
  ├── Simulation Service and API
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
- **Node backend:** The authoritative application backend and Express/TypeScript boundary. It owns application routing, future authentication/authorization, users and profiles, Financial Twin raw data, goals, scenarios, PostgreSQL access, market-data integration, calls to the AI service, and application-level orchestration and verification. A Prisma schema/migration and shared client access layer are implemented; data CRUD is not.
- **PostgreSQL:** Node + Prisma is the authoritative application persistence path. `DATABASE_URL` configures access. The initial migration `20261004120000_init_nexus_schema` has been applied and verified; database health checks use a real connection. No seed data is created by the application.
- **Financial Engine:** The deterministic TypeScript implementation in the Node backend is the authoritative production calculation source. It recalculates derived metrics from validated raw financial inputs, uses decimal-string/BigInt arithmetic for money, and exposes explicit, deterministic risk flags with computed provenance. Python financial, goal, and risk engines are **LEGACY/REFERENCE** behavioral and parity oracles; Python is not an active production financial backend and these engines are not part of the AI service.
- **Scenario Engine:** The in-memory deterministic implementation in the Node backend applies validated scenario transforms to cloned raw Financial Twin state, recalculates baseline and scenario using the same Financial Engine, then derives deltas, comparison/profile risk flags, provenance, and stable evidence. It does not persist scenario executions.
- **Simulation API:** `POST /api/simulations` delegates to a shared Node Simulation Service, which validates the request, invokes the existing Scenario Engine, and maps its result to the versioned API response. The prior `POST /api/scenarios/simulate` route uses the same service and keeps its Hour 6 response shape.
- **FastAPI AI service:** Owns Gemini interaction, document ingestion, chunking, embeddings, retrieval, RAG, and AI-specific structured-output validation. It is the intelligence service, not a second production Financial Twin backend. It remains **SCAFFOLDED** with a health endpoint only.
- **Verification:** Final business/application verification belongs to the Node backend. AI structured-output checks belong to the AI service. Current deterministic Python verification/evidence code remains **LEGACY/REFERENCE**.
- **Node → FastAPI:** The Node backend will call the AI service through an internal API when a future application flow needs AI. There is no caller or AI feature yet.

## Migration status

### IMPLEMENTED

- Node/Express/TypeScript backend bootstrap and `GET /health`.
- Validated TypeScript Financial Twin contracts, deterministic metric and goal calculations, comparison-based risk detection, stable risk evidence IDs, validation, structured errors, provenance, and Python-reference parity fixtures/tests.
- Temporary, request-based and in-memory `POST /api/financial-twin/recalculate`; it does not persist state.
- In-memory deterministic `POST /api/scenarios/simulate` supporting investment contribution change, income shock, expense change, rent change, one-time emergency expense, monthly debt payment change, goal change, and explicitly unsupported market stress. It does not persist results.
- Node-only in-memory `POST /api/simulations` with the same eight scenario contracts and response calculation version `1.0`. Persistence is deferred because the request has no authenticated financial-profile owner.
- Prisma 7.10.0 schema for the NEXUS application data model, initial PostgreSQL migration, shared client integration, and dependency-aware `GET /health/db`.
- FastAPI scaffold and `GET /health` only.
- Architecture documentation and target directories.

### SCAFFOLDED

- Node backend module directories for configuration, middleware, routes, controllers, services, repositories, financial logic, scenarios, verification, AI calls, market data, validators, and tests. Financial Twin recalculation and health checks have behavior; application data CRUD does not.
- AI-service directories for API, schemas, services, RAG, retrieval, embeddings, Gemini, verification, prompts, and core configuration.
- Empty Next.js frontend location.

### LEGACY/REFERENCE

- The original Python FastAPI financial API, Pydantic schemas, Financial Twin, deterministic Financial/Goal/Risk engines, evidence/provenance code, SQLAlchemy models/repository/service, PostgreSQL configuration, Alembic migration, requirements, `.env`, and tests are preserved under `legacy/python-reference/`.
- The original Python tests still run from that location. PostgreSQL integration remains opt-in and skips unless `NEXUS_TEST_DATABASE_URL` is configured.

### NOT YET IMPLEMENTED

- Application CRUD APIs, authentication, persisted scenario definitions/results and simulations, Gemini, RAG, embeddings, market APIs, Node-to-FastAPI calls, and frontend product UI.

Financial Twin recalculation remains request-based and non-persistent. The Python SQLAlchemy/Alembic layer is a legacy parity/reference artifact only; it is not the production persistence owner.

The deterministic engine port covers the reference's supported financial metrics, no-return goal calculations, comparison deltas, and comparison-based risk-flag rules. The Scenario Engine never repeats those formulas: it clones raw inputs, transforms supported fields, and calls the same Financial Engine for both baseline and scenario. Its raw state remains separate from derived values; transformed fields and derived metrics carry `COMPUTED` provenance. The Python implementation remains unchanged as the behavioral oracle. Evidence IDs canonicalize finite numeric values before hashing: decimal representations are rounded to 16 significant digits using nearest/ties-to-even, insignificant zeros are removed, negative zero becomes zero, object keys are sorted, and null/undefined remain distinct. This mapping affects evidence identity only; financial calculations and API display values are unchanged. Python-parity flags retain their reference conditions, order, and severity. Profile-level MISSING_DATA and projected-goal-shortfall flags are additional deterministic NEXUS rules and are not part of the Python comparison detector.

### Scenario Engine boundary

Supported structured types are `INVESTMENT_CHANGE`, `INCOME_SHOCK`, `EXPENSE_CHANGE`, `RENT_CHANGE`, `EMERGENCY_EXPENSE`, `DEBT_CHANGE`, `GOAL_CHANGE`, and `MARKET_STRESS`. Income and general expense changes accept one signed amount delta or an integer percentage in basis points (-10000 to 100000). Rent and debt changes use signed monthly deltas. Investment changes set the monthly contribution. Emergency expense reduces liquid savings once and leaves recurring expense unchanged. Goal changes select a uniquely named goal and update its target amount, current allocation, and/or remaining-month horizon. Goal projections retain the Financial Engine's no-return behavior.

Rent is auditable as a monthly delta but maps to `monthlyExpenses`, because the current raw Financial Twin has no rent component. Debt changes affect monthly payments only; debt balance and amortization are not modeled. `MARKET_STRESS` accepts a negative hypothetical basis-point input but returns `UNSUPPORTED`, leaves raw state untouched, and reports unavailable deltas: aggregate `investments` does not describe asset exposure well enough for a meaningful valuation stress. It is not a market prediction and has no live data dependency. All scenarios run in memory, start from the supplied baseline, and leave it unchanged.

### Simulation API flow

```text
POST /api/simulations
        ↓
Simulation Service (validation and response mapping)
        ↓
Scenario Engine
        ↓
Financial Engine (baseline and transformed state)
        ↓
Delta, risk flags, evidence, assumptions
        ↓
Versioned Simulation Response (calculationVersion 1.0)
```

The simulation response is generated entirely by the Node.js deterministic calculation path. FastAPI/Gemini are not required. The endpoint accepts a supplied raw baseline and structured scenario, requires an explicit calculation date, and does not persist because no authenticated profile owner is available.

This is only the architecture reset; it does not make NEXUS architecturally complete.
