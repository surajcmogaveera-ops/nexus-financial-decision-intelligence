# Initial Node API contracts

The Node/Express backend is the authoritative application API. Raw request money may be a JSON number with at most two decimal places or a decimal string; decimal strings are preferred. Money is serialized as decimal strings. Ratios are JSON numbers or `null` when unavailable.

Invalid Financial Twin requests use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "details": { "field.path": "reason" }
  }
}
```

Malformed JSON returns `INVALID_JSON`; unexpected errors return `INTERNAL_ERROR` without a stack trace. API paths marked NOT IMPLEMENTED currently return HTTP 404 with `NOT_IMPLEMENTED`.

`POST /api/simulations` uses `INVALID_REQUEST`, `INVALID_SCENARIO`, `UNSUPPORTED_SCENARIO`, or `CALCULATION_ERROR` in the same structured error envelope.

## Endpoint contracts

| Method and path | Status | Owner | Purpose | Request | Response | Validation and errors |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /health` | **IMPLEMENTED** | Node | Process health probe. | None. | `{"status":"ok"}` | HTTP 200 when the service is running. |
| `GET /health/db` | **IMPLEMENTED** | Node + Prisma | Execute `SELECT 1` through the shared Prisma client. | None. | `{"status":"ok","database":"ok"}` | HTTP 503 with `DATABASE_UNAVAILABLE` if `DATABASE_URL` is missing/invalid or PostgreSQL cannot be queried. The error does not expose connection details. |
| `POST /api/auth/register` | **IMPLEMENTED** | Node + Prisma | Create an account and establish a signed session cookie. | `{ "email", "password", "name"? }` | `{ "user": { "id", "email", "name" } }` | Email is trimmed/lowercased and validated; password must be 12+ characters and at most 72 UTF-8 bytes (bcrypt input limit). Duplicate normalized email returns 409 `EMAIL_ALREADY_EXISTS`; malformed input returns 400 `INVALID_REQUEST`. Password hashes and tokens are never returned. |
| `POST /api/auth/login` | **IMPLEMENTED** | Node + Prisma | Verify credentials and establish a session cookie. | `{ "email", "password" }` | `{ "user": { "id", "email", "name" } }` | Invalid email/password returns the same 401 `AUTHENTICATION_FAILED` response. Email normalization matches registration. |
| `POST /api/auth/logout` | **IMPLEMENTED** | Node | Clear the session cookie. | None. | `{ "status": "ok" }` | Always clears the browser cookie; no client user ID is accepted. |
| `GET /api/auth/me` | **IMPLEMENTED** | Node + Prisma | Return the authenticated user's safe account information. | Signed session cookie. | `{ "user": { "id", "email", "name" } }` | Requires valid unexpired session; returns 401 `AUTHENTICATION_REQUIRED` or `UNAUTHORIZED`. Password hashes and tokens are never returned. |
| `GET /api/financial-twin` | **IMPLEMENTED** | Node + Prisma | Load the authenticated user's raw profile/related records and recalculate the Financial Twin. | None; requires valid `nexus_session` cookie. | `FinancialTwin`: `raw`, `derived` (including goal progress), `provenance`, `riskFlags`, `assumptions`, `calculatedAt`. | 401 `AUTHENTICATION_REQUIRED` or `UNAUTHORIZED`; 404 `FINANCIAL_PROFILE_NOT_FOUND`; 422 `FINANCIAL_PROFILE_INCOMPLETE` for missing/invalid required raw data. No profile is created. |
| `POST /api/financial-twin/recalculate` | **IMPLEMENTED** (request-body only; temporary and non-persistent) | Node | Validate raw values and recalculate the Financial Twin deterministically. | `{ "profile": FinancialProfileInput, "asOfDate"?: "YYYY-MM-DD" }` | `FinancialTwin` with normalized `raw`, computed `derived`, provenance, explicit risk flags, assumptions, and calculation time. Goal progress distinguishes `currentFundingGap`, `projectedAmount`, and `projectedGoalShortfall`. | Income, expenses, savings, debt, investment balance/contribution, and goal money must be non-negative and finite. Essential expenses are optional; emergency coverage is `null` if missing or zero. Goal dates and horizons are validated. Unknown fields and caller-supplied provenance are rejected. Invalid requests return structured `VALIDATION_ERROR`; malformed JSON returns `INVALID_JSON`. |
| `GET /api/profile` | **NOT IMPLEMENTED** | Node | Read the current user's financial profile. | None. | Planned `FinancialProfile`. | Future authenticated-user context; currently `NOT_IMPLEMENTED`. |
| `PUT /api/profile` | **NOT IMPLEMENTED** | Node | Create or update the current user's profile. | `{ "currency": "INR", "riskPreferences"?: object }` | Planned `FinancialProfile`. | Node will validate supported profile fields; currently `NOT_IMPLEMENTED`. |
| `GET /api/goals` | **IMPLEMENTED** | Node + Prisma | List the authenticated user's persisted goals with deterministic goal-engine output. | None; requires valid `nexus_session` cookie. | Ordered `GoalWithDerived[]` (`createdAt`, then `id`, ascending), each with raw fields, `derived`, and provenance. | Scoped to the authenticated user's profile; no profile returns 404. No rows are created or changed. |
| `POST /api/goals` | **IMPLEMENTED** | Node + Prisma | Validate and persist raw goal fields for the authenticated user's existing profile. | `{ "name", "targetAmount", "currentAllocatedAmount"?, "targetDate"?, "monthsRemaining"?, "monthlyContribution"?, "fundingSource"?, "returnAssumption"?, "priority"? }`; requires valid session cookie. | Persisted goal fields plus deterministic `derived` goal progress and provenance. | 201 on success; money must be non-negative; dates/horizon are mutually exclusive; unknown/computed fields and caller-supplied `status` are rejected. Does not create profiles. |
| `GET /api/goals/:id` | **NOT IMPLEMENTED** | Node | Read one goal. | Goal ID in path. | Planned `Goal`. | Invalid IDs and missing goals will have structured errors; currently `NOT_IMPLEMENTED`. |
| `PUT /api/goals/:id` | **IMPLEMENTED** | Node + Prisma | Update raw fields of one goal owned by the authenticated user's profile. | Partial raw fields from `POST /api/goals`; requires valid session cookie. | Updated goal fields plus recalculated deterministic derived state and provenance. | Ownership is checked in both lookup and update predicates. Missing and cross-user IDs both return 404 `GOAL_NOT_FOUND`; invalid fields return 400 `INVALID_GOAL`. |
| `DELETE /api/goals/:id` | **NOT IMPLEMENTED** | Node | Delete a goal. | Goal ID in path. | Planned `{ "deleted": true }`. | Invalid IDs and missing goals will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/scenarios` | **NOT IMPLEMENTED** | Node | Define scenario input changes. | `{ "name", "description"?, "changes": object }` | Planned scenario definition. | Scenario changes will be validated by Node; currently `NOT_IMPLEMENTED`. |
| `GET /api/scenarios` | **NOT IMPLEMENTED** | Node | List scenario definitions. | None. | Planned `Scenario[]`. | Future profile/user context; currently `NOT_IMPLEMENTED`. |
| `GET /api/scenarios/:id` | **NOT IMPLEMENTED** | Node | Read a scenario definition. | Scenario ID in path. | Planned scenario definition. | Invalid IDs and missing scenarios will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/scenarios/simulate` | **IMPLEMENTED** (in-memory; non-persistent) | Node | Apply one deterministic structured transform and recalculate baseline/scenario metrics. | `{ "profile": FinancialProfileInput, "asOfDate": "YYYY-MM-DD", "scenario": ScenarioInput }` | `ScenarioResult`: baseline/scenario raw context and metrics, deltas, risk flags, evidence, assumptions, provenance, status, and calculation time. | Uses the shared Simulation Service and existing Financial Engine. Invalid baseline data uses `INVALID_REQUEST`; malformed scenario data uses `INVALID_SCENARIO`; unknown scenario types use `UNSUPPORTED_SCENARIO`. `MARKET_STRESS` is explicitly `UNSUPPORTED` with unavailable deltas and no state change. |
| `POST /api/simulations` | **IMPLEMENTED** (deterministic Node simulation with optional AI explanation) | Node | Calculate one deterministic simulation, then optionally request an explanation. | `{ "baseline": FinancialProfileInput, "asOfDate": "YYYY-MM-DD", "scenario": ScenarioInput }` | `{ baseline, scenario, delta, riskFlags, assumptions, calculationVersion: "1.0", ai }`; `ai` is `{ status: "READY", explanation: AiAnalysisResponse, provenance: "AI_INTERPRETATION", message: null }` or `{ status: "UNAVAILABLE" | "NOT_CONFIGURED", explanation: null, message: "AI explanation unavailable." }`. | Deterministic fields are computed first by the shared simulation service and remain authoritative. A classified AI-service failure does not invalidate a successful simulation. No authentication context exists, so this endpoint does not persist results. |
| `GET /api/simulations/:id` | **NOT IMPLEMENTED** | Node | Read a simulation result. | Simulation ID in path. | Planned persisted simulation result. | Invalid IDs and missing results will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/analysis` | **NOT IMPLEMENTED** | Node public route | Future public analysis feature routed through Node. | Planned user-facing request. | Planned validated analysis with evidence references. | No public route is registered yet; the browser cannot call FastAPI or use its service token. |
| `POST /internal/ai/analyze` | **IMPLEMENTED (Gemini structured explanation + optional retrieved context)** | FastAPI; Node internal client | Explain Node's deterministic financial result, optionally grounded by selected context retrieved by Node. | Strict `AiAnalysisRequest` includes optional-compatible `retrievedContext` items with chunk/document/source IDs, title, topic, content, source type/URL and provenance; old internal requests default it to `[]`. | `evidenceRefs` are retained only when matching supplied calculation evidence IDs or retrieved chunk IDs; assumptions and Node risk flags remain authoritative. Retrieved context is general guidance and cannot supply user-specific calculations. | Requires `X-Service-Token`. FastAPI has no database connection; retrieval/storage belongs to Node. Existing Gemini failure behavior is unchanged. |

| `POST /internal/ai/embed` | **IMPLEMENTED (protected embedding utility)** | FastAPI; Node internal client | Turn one text string into a real provider embedding for Node-owned vector storage/search. | `{ "text": "..." }` (strict, maximum 100,000 characters). | `{ "status": "READY"|"NOT_CONFIGURED"|"UNAVAILABLE", "vector": number[]|null, "message": string }`; Gemini uses `GEMINI_EMBEDDING_MODEL` (default `gemini-embedding-001`) at 768 dimensions. Never returns a fabricated vector. | Requires `X-Service-Token`; no database, SQL, or persistence is used by FastAPI. |

RAG uses the existing evidence_sources/evidence_documents/evidence_chunks tables. `pnpm build` then `pnpm rag:ingest` from `backend/` idempotently loads the eight internally authored topics (SEBI, budgeting, emergency fund, debt, liquidity, risk, diversification, financial goals), all marked `ASSUMPTION`. PostgreSQL GIN English FTS is always attempted. pgvector HNSW cosine search is optional and the migration leaves it disabled if the extension is not installed/creatable. Node merges FTS and semantic ranks by RRF (`sum(1/(60+rank))`), deduplicates by chunk ID, and sends only selected chunks to the internal AI service. Search failure never prevents deterministic simulation; unavailable/no-results states are explicit. No crawler, general-purpose public retrieval route, or RAG UI is part of this MVP.

## Recalculate request example

```json
{
  "asOfDate": "2026-10-04",
  "profile": {
    "currency": "INR",
    "monthlyIncome": "30000",
    "monthlyExpenses": "20000",
    "monthlyDebtPayments": "0",
    "liquidSavings": "40000",
    "essentialMonthlyExpenses": "20000",
    "investments": "0",
    "monthlyInvestmentContribution": "5000",
    "goals": [
      {
        "name": "Flagship goal",
        "targetAmount": "200000",
        "currentAllocatedAmount": "40000",
        "monthsRemaining": 12,
        "priority": 1,
        "returnAssumption": 0
      }
    ]
  }
}
```

`targetDate` and `monthsRemaining` are alternative horizon inputs; supplying both is rejected. Horizon zero is valid for a goal due now and safely leaves required monthly contribution unavailable. Negative or fractional horizons are rejected. Goal return assumptions default to zero; nonzero assumptions remain visible but make return-dependent projections unavailable until a return model is explicitly specified.

The Python reference defines `monthlySurplus = income - expenses - debt payments`. The Node implementation preserves that definition and separately reports `availableMonthlyCashFlow = monthlySurplus - monthlyInvestmentContribution`. If a profile has one goal with no explicit monthly contribution, its projection uses this available cash flow. With multiple goals, each goal needs an explicit contribution for cash flow to be allocated; omitted contributions are treated as zero so the same cash flow is never counted more than once. Investment contributions are not also credited to a short-term goal.

## Scenario simulation contract

`POST /api/scenarios/simulate` accepts the same `profile` format as Financial Twin recalculation, a required explicit `asOfDate`, and one structured `scenario`. The explicit date keeps goal horizons reproducible. The endpoint does not call FastAPI, Gemini, a database, or a market service and creates no persisted scenario record.

Supported `scenario.type` values and fields:

| Type | Fields | Transformation and assumptions |
| --- | --- | --- |
| `INVESTMENT_CHANGE` | `monthlyInvestmentContribution` (non-negative money) | Sets monthly contribution; the existing engine subtracts it from available goal cash. No investment returns are assumed. |
| `INCOME_SHOCK` | exactly one of `percentageBasisPoints` (-10000..100000 integer) or signed `amountDelta` | Changes monthly income, then recalculates all metrics. No secondary response is modeled. |
| `EXPENSE_CHANGE` | exactly one of `percentageBasisPoints` (-10000..100000 integer) or signed `amountDelta` | Changes recurring monthly expenses. |
| `RENT_CHANGE` | signed `monthlyRentDelta` | Adds the recurring rent delta to `monthlyExpenses`; no separate rent field exists. |
| `EMERGENCY_EXPENSE` | non-negative `amount` | Subtracts once from liquid savings; does not change monthly expenses. |
| `DEBT_CHANGE` | signed `monthlyPaymentDelta` | Changes monthly debt payments only; balance and amortization are unsupported. |
| `GOAL_CHANGE` | `goalName` plus one or more of `targetAmount`, `currentAllocatedAmount`, `monthsRemaining` | Requires one uniquely named goal; existing no-return goal engine calculates the outcome. |
| `MARKET_STRESS` | `stressBasisPoints` (-10000..0 integer) | Hypothetical input only. Returns `status: UNSUPPORTED`, unchanged state, unavailable deltas, and an explicit limitation because asset-level exposure is not modeled. It is not a forecast. |

For supported scenarios `status` is `COMPLETED`. `delta` includes absolute and percentage changes for available metrics plus `additionalScenarioShortfall`. Derived and transformation provenance is `COMPUTED`; supplied baseline input provenance follows the Financial Twin parser. Evidence IDs use the established deterministic calculation identity utility. `calculatedAt` is metadata only and is excluded from scenario IDs, deltas, and evidence identity.

## Simulation API contract

`POST /api/simulations` is the versioned flagship orchestration endpoint. It requires an explicit `asOfDate` and a raw `baseline` in the existing `FinancialProfileInput` shape; it accepts no caller-supplied derived metrics, risk flags, or provenance. Node completes deterministic calculations first, then attempts bounded Node-owned retrieval and calls the internal AI client with selected context. Retrieval failure is isolated, so deterministic results are returned unchanged and the AI service receives an empty context if retrieval fails. The response keeps `baseline`, `scenario`, `delta`, `riskFlags`, `assumptions`, and `calculationVersion` at the top level; the additive `ai` field reports whether an explanation is ready, unavailable, or not configured. No fake explanation is generated on fallback. Deterministic simulation errors remain ordinary simulation errors and do not become AI fallback responses.

The successful top-level response has exactly these fields:

```json
{
  "baseline": { "raw": {}, "derived": {}, "provenance": {}, "evidence": [] },
  "scenario": { "type": "INVESTMENT_CHANGE", "status": "COMPLETED", "raw": {}, "derived": {}, "provenance": {}, "evidence": [] },
  "delta": {},
  "riskFlags": [],
  "assumptions": [],
  "calculationVersion": "1.0"
}
```

Both `evidence` arrays carry the same deterministic comparison/reference records so baseline/scenario values remain linked to their evidence IDs. Goal outputs are included in each `derived.goals` array. `calculationVersion` comes from the single `CALCULATION_VERSION` constant and identifies the deterministic simulation calculation contract currently used; it makes no broader semantic-versioning promise. Repeated equivalent requests return identical logical responses; time metadata is omitted from this response.

Invalid baseline/request fields return HTTP 400 `INVALID_REQUEST`. Invalid scenario payloads or transformations return HTTP 400 `INVALID_SCENARIO`. Unknown scenario types return HTTP 422 `UNSUPPORTED_SCENARIO`. Unexpected deterministic calculation errors return HTTP 500 `CALCULATION_ERROR`, without stack details. `MARKET_STRESS` remains a successful explicit `UNSUPPORTED` scenario result with unchanged raw state and unavailable deltas; no market loss is invented.

Simulation is currently in-memory. Prisma's `Scenario` and `ScenarioResult` require a `financialProfileId`, while the endpoint receives only an unowned request baseline and there is no authentication/profile ownership context. The API therefore creates no database records and does not invent ownership.

Derived values are recalculated for every request and are absent from raw profile input. Derived provenance is `COMPUTED`; supplied raw values are `USER`; defaulted raw values are `ASSUMPTION`. The caller cannot set provenance, so AI output cannot label itself as user input or deterministic computation.

Goal terminology is deliberately distinct: `currentFundingGap` is `max(0, targetAmount - currentAllocatedAmount)` (summed across goals in the top-level derived metrics); `projectedAmount` is current allocation plus contribution times remaining months; `projectedGoalShortfall` is `max(0, targetAmount - projectedAmount)`. The in-memory scenario endpoint reports `additionalScenarioShortfall = scenario projectedGoalShortfall - baseline projectedGoalShortfall` when both projections are available. These names replace the ambiguous Hour 2 response fields `goalFundingGap` and `projectedShortfall`; no backward alias is emitted because this is a pre-persistence checkpoint without persisted response consumers.

## Ownership boundary

Node owns the application API and deterministic calculations. `POST /api/financial-twin/recalculate`, `/api/scenarios/simulate`, and `/api/simulations` accept caller-supplied inputs and run in memory; they do not read or persist an account's data and remain public tools. `/api/simulations` returns the deterministic result even if its optional explanation service fails. Financial Twin and Goals persistence routes require cookie authentication. Node + Prisma is the authoritative application persistence path. `GET /health` reports process liveness only; `/health/db` reports success only after a real query succeeds. FastAPI runs Gemini structured explanation over Node-supplied context and is scaffolded for future RAG/retrieval/embedding/verification work; it never calculates financial values. The Python SQLAlchemy/Alembic code is a parity reference only.

## Evidence and provenance

The canonical Node provenance definition is `Provenance` in `backend/src/financial/constants.ts`. Provenance describes origin; it does not describe confidence or correctness.

| Provenance | Meaning |
|---|---|
| `USER` | Directly supplied by the user |
| `COMPUTED` | Deterministically calculated by NEXUS |
| `EXTERNAL` | Obtained from an external authoritative source |
| `RETRIEVED` | Retrieved from an evidence/document corpus |
| `AI_INTERPRETATION` | Generated interpretation from AI |
| `ASSUMPTION` | Explicit modeling/system assumption |

AI_INTERPRETATION is explanatory output, not authoritative financial data. Financial Twin and scenario provenance tags raw fields, derived metrics, and assumptions. The flagship response labels successful AI prose `ai.provenance: "AI_INTERPRETATION"`; unavailable AI returns no prose and carries no interpretation provenance.

Simulation baseline and scenario evidence arrays retain the existing deterministic evidence collection. Calculation entries add `type: "CALCULATION"`, `id`, `calculationId`, structured `inputs`, `formula`, authoritative `output`, and ISO `timestamp`; IDs match `^CALC-[A-F0-9]{12}$`. Timestamp is audit metadata and is excluded from identity. Evidence wraps already-computed Node values without recalculating them. AI can reference evidence IDs but cannot change calculation inputs, formula, output, or COMPUTED provenance. FastAPI accepts the additive fields and legacy comparison evidence. Persistence for authenticated scenarios is described in the Evidence Ledger section below; no separate calculation endpoint is added.

## Evidence Ledger API

`POST /api/simulations` retains its existing response and accepts anonymous requests as before. When the caller has a valid authenticated session and an owned Financial Profile, Node persists the validated scenario input and deterministic result in the existing `scenarios` and `scenario_results` tables and adds the stored UUID `scenarioId` to the response. The authoritative result, including H15 evidence, is stored once in `scenario_results.result_data` (the duplicated baseline evidence copy from the API response is omitted); no new table or migration is used. `GET /api/evidence/:scenarioId` requires authentication and returns only scenarios owned by the session user; missing, malformed, and other users' IDs receive the same `SCENARIO_NOT_FOUND` 404. Legacy/evidence-free stored results return an empty `claims` array rather than fabricated evidence.

The Evidence Ledger response is `{ scenarioId, claims, assumptions }`. Each claim has `id`, `claim`, provenance, and evidence references. Each reference carries a factual `statement`, COMPUTED provenance, the authoritative H15 `calculation` record, relevant supporting calculation records, and any related existing risk evidence IDs. Calculation records retain `CALC-XXXXXXXXXXXX`, `inputs`, `formula`, `output`, COMPUTED provenance, and timestamp. Claims are derived from persisted scenario deltas and risk flags; the endpoint does not recalculate or call AI/FastAPI. The chain is CLAIM → EVIDENCE → CALCULATION → INPUT. Assumptions are returned separately with ASSUMPTION provenance.

## Owned Financial Twin and Goal APIs

Register with `POST /api/auth/register` using `{ "email", "password", "name"? }`. Email is trimmed and lowercased before validation and storage, so case variants map to the same account. Passwords are bcrypt-hashed (cost 12), never stored as plaintext, and must be at least 12 characters and no more than 72 UTF-8 bytes. Login uses the same email normalization and returns a generic failure for unknown email or wrong password. Register and login set the signed `nexus_session` cookie; it is HttpOnly, SameSite=Lax, expires after eight hours, and adds Secure in production. `POST /api/auth/logout` clears that cookie and `GET /api/auth/me` returns only the safe user object. `AUTH_SECRET` must contain at least 32 bytes; the Node server refuses to start when it is absent or too short. Configure `FRONTEND_ORIGIN` as the exact frontend origin (default `http://localhost:5173`) for credentialed browser requests; production requires one or more explicit HTTPS origins. CORS never uses a wildcard with credentials.

The only authoritative identity is the verified session token's user ID in `req.auth`. Clients cannot set ownership through a header, body, query, or URL parameter. The Hour 8 `NEXUS_DEV_USER_ID` resolver has been removed. Financial Twin and goal reads/writes are scoped to the authenticated user's profile, and cross-user goal access returns the same 404 as a missing goal. Sessions are signed with HS256; invalid, malformed, or expired cookies receive 401. Logout clears the browser's cookie; a copied token remains valid until its eight-hour expiry.

`GET /api/financial-twin` looks up a profile by the trusted user ID, loads its related income, expense, debt, asset, investment, and goal rows, maps persisted raw values into the existing Financial Engine input, and recalculates on every request. A non-null profile aggregate takes precedence over line-item totals. When a required aggregate is absent, active line items are normalized into monthly values; supported frequencies are daily, weekly, biweekly, monthly, quarterly, and annually, rounded to cents using deterministic half-even rounding. Liquid savings may be derived from liquid assets. Missing required income, expense, or liquid-savings data returns 422 `FINANCIAL_PROFILE_INCOMPLETE` rather than zero-filled data. No profile returns 404 `FINANCIAL_PROFILE_NOT_FOUND`. No derived metric is saved.

`GET /api/goals` returns current-profile goals ordered by creation time ascending then ID ascending. `POST /api/goals` accepts a raw Goal input and returns the persisted raw record plus a `derived` GoalProgress result. `PUT /api/goals/:id` accepts a partial raw Goal update and recalculates that result. Both use the existing deterministic goal engine; derived values and caller-supplied status are not accepted or persisted. Target date and remaining-month horizon are mutually exclusive; switching between them during update clears the prior horizon field. The default persisted monthly contribution is zero. Goal update lookup and write predicates both include the current financial profile ID; cross-user and missing IDs return the same 404 `GOAL_NOT_FOUND` response.

No financial profile or user is created automatically. Goals persist only raw goal inputs. Financial snapshots and audit records are not created by these read/write APIs. Database-backed route tests use a fresh in-memory repository adapter and clear it after each test; they do not insert test records into the configured development PostgreSQL database.
