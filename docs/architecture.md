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
  └── Node-owned PostgreSQL FTS + optional pgvector retrieval → request-scoped AI grounding
```

## Ownership

- **Frontend:** Next.js and TypeScript UI, communicating with the Node API. It does not call Gemini or the AI service for normal user operations and is not the source of financial calculations.
- **Node backend:** The authoritative application backend and Express/TypeScript boundary. It owns authentication/authorization, users and profiles, Financial Twin raw data, goals, scenarios, PostgreSQL access, market-data integration, calls to the AI service, and application-level orchestration and verification. Prisma owns account and financial persistence.
- **PostgreSQL:** Node + Prisma is the authoritative application persistence path. `DATABASE_URL` configures access. The initial migration `20261004120000_init_nexus_schema` has been applied and verified; database health checks use a real connection. No seed data is created by the application.
- **Financial Engine:** The deterministic TypeScript implementation in the Node backend is the authoritative production calculation source. It recalculates derived metrics from validated raw financial inputs, uses decimal-string/BigInt arithmetic for money, and exposes explicit, deterministic risk flags with computed provenance. Python financial, goal, and risk engines are **LEGACY/REFERENCE** behavioral and parity oracles; Python is not an active production financial backend and these engines are not part of the AI service.
- **Scenario Engine:** The in-memory deterministic implementation in the Node backend applies validated scenario transforms to cloned raw Financial Twin state, recalculates baseline and scenario using the same Financial Engine, then derives deltas, comparison/profile risk flags, provenance, and stable evidence. It does not persist scenario executions.
- **Evidence and provenance:** Node's single application-level definition is `Provenance` in `backend/src/financial/constants.ts`. Provenance describes origin, not confidence or correctness. Raw user-supplied values are USER, deterministic metrics and scenario changes are COMPUTED, method conditions are explicitly listed ASSUMPTION, and the flagship AI wrapper labels generated prose AI_INTERPRETATION. EXTERNAL and RETRIEVED are reserved for data actually supplied by an authoritative external source or actually retrieved from a NEXUS corpus; neither is currently fabricated or populated.
- **Simulation API:** `POST /api/simulations` calculates first, preserves calculation evidence, retrieves a bounded request-scoped context through the existing Node/PostgreSQL RAG repository, calls authenticated FastAPI, and runs the H19.1 Node verifier on valid AI output. The response exposes deterministic values, `retrieval`, `ai`, and `verification` separately. If AI is unavailable, deterministic values and retrieval diagnostics remain available and verification is `NOT_APPLICABLE`; a verifier exception is `FLAGGED`. Authenticated executions persist through the existing owner-scoped scenario repository and require a saved Financial Profile; anonymous executions are non-persistent. The prior `POST /api/scenarios/simulate` route remains deterministic-only and keeps its Hour 6 response shape.
- **Authentication:** Registration and login hash passwords with bcrypt and issue an eight-hour signed HttpOnly SameSite=Lax cookie. Middleware verifies the cookie and places the trusted subject in `req.auth.userId`. CORS only allows configured explicit origins and enables credentials for them; cookies are Secure in production.
- **Owned Financial Twin and Goals APIs:** Protected Node routes derive ownership solely from the verified authenticated request context, then use profile/goal services and Prisma repositories scoped to that user. Client-supplied IDs never select an owner. Hour 8's development identity was removed; `NEXUS_DEV_USER_ID` is not used.
- **FastAPI AI service:** Owns Gemini interaction, structured analysis, and the embedding provider utility. It has no PostgreSQL access and receives only selected chunks in Node's analysis request. The protected embedding operation returns a vector to Node and does not query or persist anything. Gemini is configured by `GEMINI_API_KEY`; embeddings use `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`) at 768 dimensions. Provider failures stay explicit and no vectors are fabricated.
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

Hour 17 adds a small retrieval MVP to existing evidence storage. The eight internally authored corpus entries are explicitly `ASSUMPTION`, carry no fabricated external URL, and are loaded idempotently with `pnpm build` then `pnpm rag:ingest` from `backend/`. Prisma remains the only ORM. A GIN expression index supports PostgreSQL English full-text search; an optional pgvector column and HNSW cosine index are installed by migration only when the extension can be created. Isolated raw SQL in the Node retrieval repository performs FTS and vector similarity; results are merged with deterministic Reciprocal Rank Fusion (RRF, default k=60), deduplicated by chunk ID, with stable ID tie breaks. If pgvector or Gemini embeddings are unavailable, FTS remains available and metadata explicitly reports the limitation. Empty search returns `NO_RESULTS`; DB/search errors return `UNAVAILABLE`; simulation continues deterministically.

Node selects a bounded context from its retrieval results and sends it to the authenticated internal analysis endpoint. The Gemini prompt labels this as general grounding, distinguishes internally authored assumptions from external source material, and forbids changing or recalculating Node's values. FastAPI filters evidence references to IDs Node supplied. No public retrieval endpoint, crawler, autonomous ingestion, or frontend RAG UI is included.

### Evidence and provenance contract

| Provenance | Meaning |
|---|---|
| `USER` | Directly supplied by the user |
| `COMPUTED` | Deterministically calculated by NEXUS |
| `EXTERNAL` | Obtained from an external authoritative source |
| `RETRIEVED` | Retrieved from an evidence/document corpus |
| `AI_INTERPRETATION` | Generated interpretation from AI |
| `ASSUMPTION` | Explicit modeling or system assumption |

Provenance describes origin. It does not describe confidence or correctness. AI_INTERPRETATION is explanatory output, not authoritative financial data.

The existing `RiskCalculationEvidence` collection remains canonical. Full calculation entries extend it with `type: "CALCULATION"`, `id`/`calculationId`, structured `inputs`, `formula`, authoritative `output`, and ISO `timestamp`; their IDs use `CALC-` plus 12 uppercase SHA-256 hex characters. The financial engine wraps values it has already computed, and the Scenario Engine records baseline, scenario, and delta values. Timestamp is audit metadata and is excluded from deterministic identity. IDs reuse `evidenceIdentity.ts` canonical JSON and numeric normalization. Financial formulas and displayed values are unchanged. These records are computed response evidence and are persisted with authenticated H16 scenarios in the existing result JSON. AI may interpret them but cannot change their inputs, formula, output, or COMPUTED provenance. No database migration is required.

Financial Twin and scenario provenance is attached to raw fields, individual goal fields, derived metrics, and the explicit assumptions list. This distinguishes a supplied goal target from a defaulted zero return assumption. User request schemas reject caller-provided provenance. The Node → FastAPI validator rejects unknown labels, requires derived values to be COMPUTED and assumptions to be ASSUMPTION, and prevents AI_INTERPRETATION from entering raw financial state. Gemini's strict schema has no provenance field, and unknown fields are rejected. Node labels returned prose AI_INTERPRETATION; evidence references are still restricted to IDs supplied by Node.

### Evidence Ledger

Authenticated `POST /api/simulations` runs persist the authoritative response in the existing `Scenario` / `ScenarioResult` models, linked through the authenticated user's Financial Profile. The response includes the persisted scenario UUID. `GET /api/evidence/:scenarioId` applies session authentication and an owner-scoped Scenario query before returning the ledger. The `scenario_results.result_data` JSON holds the complete result and H15 calculation evidence once (the API's duplicate baseline evidence copy is omitted from storage), so H16 adds no tables or Prisma migration. The ledger is an audit view over authoritative deterministic simulation results: CLAIM → EVIDENCE → CALCULATION → INPUT. It builds human-readable deterministic claims from stored deltas and points them to existing H15 records and their inputs; it never reruns the financial engine. Assumptions stay separately labeled ASSUMPTION. AI interpretation may explain evidence but is not used as the source of claims or calculation facts; no AI or external service is called by the ledger endpoint. Anonymous simulations remain available and are not persisted for the ledger.

The FastAPI Pydantic provenance literals mirror the Node service-boundary values; the additive goal-field, assumptions, and retrieved-context fields default compatibly for older internal clients. FastAPI also rejects AI_INTERPRETATION as provenance for raw financial data. Prisma's existing EvidenceSource, EvidenceDocument, and EvidenceChunk models are reused for the curated corpus; H17 adds optional pgvector and FTS database indexes only.

## Migration status

### IMPLEMENTED

- Node/Express/TypeScript backend bootstrap and `GET /health`.
- Validated TypeScript Financial Twin contracts, deterministic metric and goal calculations, comparison-based risk detection, stable risk evidence IDs, validation, structured errors, provenance, and Python-reference parity fixtures/tests.
- Temporary, request-based and in-memory `POST /api/financial-twin/recalculate`; it does not persist state.
- In-memory deterministic `POST /api/scenarios/simulate` supporting investment contribution change, income shock, expense change, rent change, one-time emergency expense, monthly debt payment change, goal change, and explicitly unsupported market stress. It does not persist results.
- In-memory `POST /api/simulations` with the same eight scenario contracts and response calculation version `1.0`. Node calculates only from the supplied raw baseline and remains authoritative; AI is attempted afterward. On expected AI-service failure the response retains all deterministic results and includes a machine-readable fallback state without inventing an explanation. It does not associate the calculation with an account or persist results.
- Canonical Node provenance values and strict internal AI request provenance validation; deterministic evidence identity and its parity behavior are preserved.
- PostgreSQL-backed `GET /api/financial-twin`, `GET /api/goals`, `POST /api/goals`, and ownership-scoped `PUT /api/goals/:id`. Goal and Financial Twin derived values are recalculated in memory through the existing deterministic engines; only raw goal values are written.
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and protected `GET /api/auth/me`; password hashing, signed cookie sessions, and authenticated ownership context.
- Prisma 7.10.0 schema for the NEXUS application data model, initial PostgreSQL migration, shared client integration, and dependency-aware `GET /health/db`.
- Authenticated Node → FastAPI internal request/response contract and FastAPI `GET /health`; the analysis endpoint runs Gemini structured explanation over supplied Node results when configured and returns an explicit non-AI placeholder otherwise.
- Real Gemini structured explanation inside the FastAPI AI service: strict `GeminiStructuredAnalysis` Pydantic output schema (summary, whatChanged, tradeoffs, risks, evidenceRefs, assumptions, limitations, confidence, disclaimer), official `google-genai` SDK with `response_schema` JSON output, prompt instructions separating authoritative Node input from AI interpretation, adapter onto the unchanged Node `AiAnalysisResponse` contract, `evidenceRefs`/assumptions validated against supplied Node data, deterministic `riskFlags` preserved verbatim, explicit `NOT_CONFIGURED`/`UNAVAILABLE`/`INVALID_OUTPUT`/`ERROR` failure states, and mocked-provider tests plus an opt-in `NEXUS_LIVE_GEMINI_TEST=true` live test.
- Architecture documentation and target directories.

### SCAFFOLDED

- Node backend module directories for configuration, middleware, routes, controllers, services, repositories, financial logic, scenarios, verification, AI calls, market data, validators, and tests. Financial Twin recalculation, owner-scoped Financial Twin reads, Goal CRUD limited to list/create/update, simulation, and health checks have behavior; user/profile CRUD and other application data CRUD do not.
- AI-service schema/verification scaffold and H17 retrieval/embedding integration described above; model-output verification beyond evidence-reference/assumption filtering remains unimplemented.
- Empty Next.js frontend location.

### LEGACY/REFERENCE

- The original Python FastAPI financial API, Pydantic schemas, Financial Twin, deterministic Financial/Goal/Risk engines, evidence/provenance code, SQLAlchemy models/repository/service, PostgreSQL configuration, Alembic migration, requirements, `.env`, and tests are preserved under `legacy/python-reference/`.
- The original Python tests still run from that location. PostgreSQL integration remains opt-in and skips unless `NEXUS_TEST_DATABASE_URL` is configured.

### NOT YET IMPLEMENTED

- Advanced account recovery, email verification, OAuth, MFA, user/profile CRUD, goal deletion and individual goal reads, market APIs, public analysis API, and frontend product UI. H17 RAG storage/retrieval is present; live pgvector availability depends on PostgreSQL installation.

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
Delta, risk flags, calculation evidence, assumptions
        ↓
Node PostgreSQL FTS + optional pgvector RAG (up to five chunks)
        ↓
Authenticated FastAPI contract → Gemini structured analysis
        ↓
Node response validation → H19.1 deterministic verifier
        ↓
Deterministic result + retrieval diagnostics + AI interpretation + verification
```

The authoritative simulation response is generated entirely by the Node.js deterministic calculation path. After calculation, Node retrieves up to five evidence chunks and sends them with request-scoped deterministic context to authenticated FastAPI. FastAPI validates the request and either generates a structured Gemini interpretation or returns an explicit configuration/generation failure. Node validates the AI contract and runs its deterministic verifier before exposing the explanation. AI output cannot overwrite deterministic results. Retrieval availability and verification status are included in the response. Anonymous executions are non-persistent; authenticated executions persist through the existing scenario/evidence repository and require an owned Financial Profile. The endpoint accepts a supplied raw baseline and structured scenario and requires an explicit calculation date.

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
