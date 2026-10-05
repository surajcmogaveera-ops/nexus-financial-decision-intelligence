# NEXUS architecture

## Target service boundaries

```text
Browser / Frontend
        ↓ public application API only
Node.js + Express
  ├── PostgreSQL application data (Prisma)
  ├── Financial Twin + deterministic Financial/Scenario Engines
  └── internal AI client — X-Service-Token
        ↓ POST /internal/ai/analyze
FastAPI AI service
  ├── Gemini structured explanation (implemented)
  └── future RAG / retrieval / embeddings / verification
```

## Ownership

- **Frontend:** Next.js and TypeScript UI, communicating with the Node API. It does not call Gemini or the AI service for normal user operations and is not the source of financial calculations.
- **Node backend:** The authoritative application backend and Express/TypeScript boundary. It owns authentication/authorization, users and profiles, Financial Twin raw data, goals, scenarios, PostgreSQL access, market-data integration, calls to the AI service, and application-level orchestration and verification. Prisma owns account and financial persistence.
- **PostgreSQL:** Node + Prisma is the authoritative application persistence path. `DATABASE_URL` configures access. The initial migration `20261004120000_init_nexus_schema` has been applied and verified; database health checks use a real connection. No seed data is created by the application.
- **Financial Engine:** The deterministic TypeScript implementation in the Node backend is the authoritative production calculation source. It recalculates derived metrics from validated raw financial inputs, uses decimal-string/BigInt arithmetic for money, and exposes explicit, deterministic risk flags with computed provenance. Python financial, goal, and risk engines are **LEGACY/REFERENCE** behavioral and parity oracles; Python is not an active production financial backend and these engines are not part of the AI service.
- **Scenario Engine:** The in-memory deterministic implementation in the Node backend applies validated scenario transforms to cloned raw Financial Twin state, recalculates baseline and scenario using the same Financial Engine, then derives deltas, comparison/profile risk flags, provenance, and stable evidence. It does not persist scenario executions.
- **Simulation API:** `POST /api/simulations` delegates to a shared Node Simulation Service, which validates the request, invokes the existing Scenario Engine, and maps its result to the versioned API response. The prior `POST /api/scenarios/simulate` route uses the same service and keeps its Hour 6 response shape.
- **Authentication:** Registration and login hash passwords with bcrypt and issue an eight-hour signed HttpOnly SameSite=Lax cookie. Middleware verifies the cookie and places the trusted subject in `req.auth.userId`. CORS only allows configured explicit origins and enables credentials for them; cookies are Secure in production.
- **Owned Financial Twin and Goals APIs:** Protected Node routes derive ownership solely from the verified authenticated request context, then use profile/goal services and Prisma repositories scoped to that user. Client-supplied IDs never select an owner. Hour 8's development identity was removed; `NEXUS_DEV_USER_ID` is not used.
- **FastAPI AI service:** Owns Gemini interaction, AI-specific structured-output validation, and future document ingestion, chunking, embeddings, retrieval, and RAG. It has no direct PostgreSQL access. The internal analysis endpoint validates the Node contract and, when `GEMINI_API_KEY` is configured, runs Gemini structured JSON generation (official Google GenAI SDK, Pydantic-validated) through an adapter onto the unchanged Node response contract; without configuration it returns the explicit not-configured placeholder, and provider failures map to explicit 502/503/500 errors instead of fabricated output. It is not a second production Financial Twin backend.
- **Verification:** Final business/application verification belongs to the Node backend. AI structured-output checks belong to the AI service. Current deterministic Python verification/evidence code remains **LEGACY/REFERENCE**.
- **Node → FastAPI:** The server-side Node client calls `POST /internal/ai/analyze` with `X-Service-Token`; FastAPI rejects missing or invalid tokens. The frontend never receives the token and never calls FastAPI directly. Node supplies deterministic results for later explanation; FastAPI does not calculate financial metrics, scenario deltas, or risk flags.

### FastAPI AI-service module boundaries

```text
Node-produced AI analysis context
        ↓
schemas/context → RAG boundary → retrieval boundary
        ↓                       evidence refs (future)
      prompts → Gemini provider boundary → verification boundary
```

The subsystem modules provide typed interfaces and explicit unavailable/not-implemented results. Hour 12 wired the analysis endpoint to the prompt and Gemini boundaries: `schemas/context → prompts → Gemini provider → strict Pydantic validation → evidence/assumption checks → adapter → AiAnalysisResponse`. Gemini structured generation is implemented behind the existing `GeminiClient` protocol using schema-constrained output; the deterministic request objects stay separate from generated prose so model output cannot overwrite Node-owned values (`riskFlags`, `calculationVersion`, evidence IDs). RAG, retrieval, embeddings, and verification remain skeletons only. Prompt construction serializes the supplied Node context verbatim and instructs the model not to invent or recalculate financial facts. None of these modules performs financial calculations or accesses PostgreSQL.

## Migration status

### IMPLEMENTED

- Node/Express/TypeScript backend bootstrap and `GET /health`.
- Validated TypeScript Financial Twin contracts, deterministic metric and goal calculations, comparison-based risk detection, stable risk evidence IDs, validation, structured errors, provenance, and Python-reference parity fixtures/tests.
- Temporary, request-based and in-memory `POST /api/financial-twin/recalculate`; it does not persist state.
- In-memory deterministic `POST /api/scenarios/simulate` supporting investment contribution change, income shock, expense change, rent change, one-time emergency expense, monthly debt payment change, goal change, and explicitly unsupported market stress. It does not persist results.
- Node-only in-memory `POST /api/simulations` with the same eight scenario contracts and response calculation version `1.0`. The endpoint calculates only from the supplied raw baseline; it does not associate the calculation with an account or persist results.
- PostgreSQL-backed `GET /api/financial-twin`, `GET /api/goals`, `POST /api/goals`, and ownership-scoped `PUT /api/goals/:id`. Goal and Financial Twin derived values are recalculated in memory through the existing deterministic engines; only raw goal values are written.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and protected `GET /api/auth/me`; password hashing, signed cookie sessions, and authenticated ownership context.
- Prisma 7.10.0 schema for the NEXUS application data model, initial PostgreSQL migration, shared client integration, and dependency-aware `GET /health/db`.
- Authenticated Node → FastAPI internal request/response contract and FastAPI `GET /health`; the analysis endpoint runs Gemini structured explanation over supplied Node results when configured and returns an explicit non-AI placeholder otherwise.
- Real Gemini structured explanation inside the FastAPI AI service: strict `GeminiStructuredAnalysis` Pydantic output schema (summary, whatChanged, tradeoffs, risks, evidenceRefs, assumptions, limitations, confidence, disclaimer), official `google-genai` SDK with `response_schema` JSON output, prompt instructions separating authoritative Node input from AI interpretation, adapter onto the unchanged Node `AiAnalysisResponse` contract, `evidenceRefs`/assumptions validated against supplied Node data, deterministic `riskFlags` preserved verbatim, explicit `NOT_CONFIGURED`/`UNAVAILABLE`/`INVALID_OUTPUT`/`ERROR` failure states, and mocked-provider tests plus an opt-in `NEXUS_LIVE_GEMINI_TEST=true` live test.
- Architecture documentation and target directories.

### SCAFFOLDED

- Node backend module directories for configuration, middleware, routes, controllers, services, repositories, financial logic, scenarios, verification, AI calls, market data, validators, and tests. Financial Twin recalculation, owner-scoped Financial Twin reads, Goal CRUD limited to list/create/update, simulation, and health checks have behavior; user/profile CRUD and other application data CRUD do not.
- AI-service API/schema scaffold. RAG, retrieval, embeddings, and verification behavior remain unimplemented.
- Empty Next.js frontend location.

### LEGACY/REFERENCE

- The original Python FastAPI financial API, Pydantic schemas, Financial Twin, deterministic Financial/Goal/Risk engines, evidence/provenance code, SQLAlchemy models/repository/service, PostgreSQL configuration, Alembic migration, requirements, `.env`, and tests are preserved under `legacy/python-reference/`.
- The original Python tests still run from that location. PostgreSQL integration remains opt-in and skips unless `NEXUS_TEST_DATABASE_URL` is configured.

### NOT YET IMPLEMENTED

- Advanced account recovery, email verification, OAuth, MFA, user/profile CRUD, goal deletion and individual goal reads, persisted scenario definitions/results and simulations, RAG, embeddings execution, market APIs, public analysis API, and frontend product UI.

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

The simulation response is generated entirely by the Node.js deterministic calculation path. FastAPI/Gemini are not required. The endpoint accepts a supplied raw baseline and structured scenario, requires an explicit calculation date, and remains a public, non-persistent calculation endpoint; it does not read account data.

### Financial Twin and Goal ownership flows

```text
authenticated request
        ↓
verified session token → trusted user ID
        ↓
Financial Profile ownership (Prisma/PostgreSQL)
        ↓
raw state from PostgreSQL and owned related records
        ↓
Financial Profile mapper
        ↓
existing deterministic Financial Engine
        ↓
Financial Twin response (raw separate from derived)
```

```text
authenticated request
        ↓
verified session token → trusted user ID
        ↓
Financial Profile ownership lookup
        ↓
Goals (Prisma/PostgreSQL, scoped to that profile)
        ↓
existing deterministic Goal Engine
        ↓
goal response (persisted raw fields plus computed progress)
```

Authentication determines ownership for Financial Twin and Goal APIs; no development identity shortcut or client-provided user ID is trusted. Financial calculations remain independent of authentication and consume validated raw domain inputs. Missing profile inputs remain missing and return a structured error instead of being replaced with synthetic zero values. `NEXUS_DEV_USER_ID` is no longer used.

This is only the architecture reset; it does not make NEXUS architecturally complete.
