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
| `POST /internal/ai/analyze` | **IMPLEMENTED (Gemini structured explanation)** | FastAPI; Node internal client | Explain request-scoped deterministic Financial Twin and simulation context; deterministic calculations remain in Node. | Strict `AiAnalysisRequest`: `requestId`, `question`, `financialTwin` (`raw`, `derived`, `provenance`), `baseline`, `scenario`, `delta`, `riskFlags`, `assumptions`, `evidence`, and `calculationVersion: "1.0"`. Provenance includes per-goal-field `goalFields` and `assumptions: "ASSUMPTION"`; FastAPI defaults these additive provenance fields for older internal callers. | Unchanged `AiAnalysisResponse` shape: matching `requestId`, `status: "READY"`, `summary`/`keyChanges`/`tradeoffs`/`limitations` from Pydantic-validated Gemini structured output when configured (otherwise a null/empty explicit not-configured placeholder), `riskFlags` always equal to the supplied `request.riskFlags`, `evidenceRefs` restricted to supplied evidence IDs, `assumptions` restricted to supplied assumptions, `model` = configured Gemini model, `promptVersion` = `hour12-analysis-v1`, and preserved calculation version. | Requires `X-Service-Token` matching FastAPI `SERVICE_TOKEN`; missing/incorrect token returns 401 before generation. Malformed payload returns generic 422. Missing `GEMINI_API_KEY`/model returns the explicit placeholder with 200. Provider API failure or timeout returns 503 `AI_GENERATION_UNAVAILABLE`; malformed or schema-invalid model output returns 502 `AI_INVALID_OUTPUT`; other provider errors return 500 `AI_GENERATION_ERROR`. Unexpected failures return generic 500. Node validates responses and maps failures to safe errors without exposing URLs or tokens. This is not a public browser API. |

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

`POST /api/simulations` is the versioned flagship orchestration endpoint. It requires an explicit `asOfDate` and a raw `baseline` in the existing `FinancialProfileInput` shape; it accepts no caller-supplied derived metrics, risk flags, or provenance. `scenario` uses one of the structured types above. Node validates and completes the deterministic Scenario Engine and Financial Engine calculation before it calls the internal AI client. The response keeps `baseline`, `scenario`, `delta`, `riskFlags`, `assumptions`, and `calculationVersion` at the top level; the additive `ai` field reports whether an explanation is ready, unavailable, or not configured. AI service configuration errors become `NOT_CONFIGURED`; connection, timeout, authentication, upstream, and invalid-response errors become `UNAVAILABLE`. No fake explanation is generated on fallback. Deterministic simulation errors remain ordinary simulation errors and do not become AI fallback responses. The route does not invoke RAG, retrieval, embeddings, or a market service.

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

Deterministic comparison evidence uses the existing `RiskCalculationEvidence` shape (`metric`, `expression`, `baselineValue`, `scenarioValue`, `result`, `provenance: "COMPUTED"`, `evidenceId`). Evidence IDs remain stable through canonical numeric serialization (16 significant digits, ties-to-even, trailing-zero and negative-zero normalization, sorted object keys). Node validates provenance in AI requests, and FastAPI filters generated `evidenceRefs` against request-supplied evidence IDs. User request fields cannot set provenance; Gemini structured output rejects extra fields, including any attempted provenance claim. No external or retrieved evidence records are currently created. Prisma's existing evidence source/document/chunk tables are unchanged; no ingestion, retrieval, or provenance schema migration is part of this work.

## Owned Financial Twin and Goal APIs

Register with `POST /api/auth/register` using `{ "email", "password", "name"? }`. Email is trimmed and lowercased before validation and storage, so case variants map to the same account. Passwords are bcrypt-hashed (cost 12), never stored as plaintext, and must be at least 12 characters and no more than 72 UTF-8 bytes. Login uses the same email normalization and returns a generic failure for unknown email or wrong password. Register and login set the signed `nexus_session` cookie; it is HttpOnly, SameSite=Lax, expires after eight hours, and adds Secure in production. `POST /api/auth/logout` clears that cookie and `GET /api/auth/me` returns only the safe user object. `AUTH_SECRET` must contain at least 32 bytes; the Node server refuses to start when it is absent or too short. Configure `FRONTEND_ORIGIN` as the exact frontend origin (default `http://localhost:5173`) for credentialed browser requests; production requires one or more explicit HTTPS origins. CORS never uses a wildcard with credentials.

The only authoritative identity is the verified session token's user ID in `req.auth`. Clients cannot set ownership through a header, body, query, or URL parameter. The Hour 8 `NEXUS_DEV_USER_ID` resolver has been removed. Financial Twin and goal reads/writes are scoped to the authenticated user's profile, and cross-user goal access returns the same 404 as a missing goal. Sessions are signed with HS256; invalid, malformed, or expired cookies receive 401. Logout clears the browser's cookie; a copied token remains valid until its eight-hour expiry.

`GET /api/financial-twin` looks up a profile by the trusted user ID, loads its related income, expense, debt, asset, investment, and goal rows, maps persisted raw values into the existing Financial Engine input, and recalculates on every request. A non-null profile aggregate takes precedence over line-item totals. When a required aggregate is absent, active line items are normalized into monthly values; supported frequencies are daily, weekly, biweekly, monthly, quarterly, and annually, rounded to cents using deterministic half-even rounding. Liquid savings may be derived from liquid assets. Missing required income, expense, or liquid-savings data returns 422 `FINANCIAL_PROFILE_INCOMPLETE` rather than zero-filled data. No profile returns 404 `FINANCIAL_PROFILE_NOT_FOUND`. No derived metric is saved.

`GET /api/goals` returns current-profile goals ordered by creation time ascending then ID ascending. `POST /api/goals` accepts a raw Goal input and returns the persisted raw record plus a `derived` GoalProgress result. `PUT /api/goals/:id` accepts a partial raw Goal update and recalculates that result. Both use the existing deterministic goal engine; derived values and caller-supplied status are not accepted or persisted. Target date and remaining-month horizon are mutually exclusive; switching between them during update clears the prior horizon field. The default persisted monthly contribution is zero. Goal update lookup and write predicates both include the current financial profile ID; cross-user and missing IDs return the same 404 `GOAL_NOT_FOUND` response.

No financial profile or user is created automatically. Goals persist only raw goal inputs. Financial snapshots and audit records are not created by these read/write APIs. Database-backed route tests use a fresh in-memory repository adapter and clear it after each test; they do not insert test records into the configured development PostgreSQL database.
