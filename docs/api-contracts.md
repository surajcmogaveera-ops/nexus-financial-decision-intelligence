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
| `GET /api/financial-twin` | **IMPLEMENTED** | Node + Prisma | Load the authenticated user's raw profile/related records and recalculate the Financial Twin. | None; requires trusted user context. | `FinancialTwin`: `raw`, `derived` (including goal progress), `provenance`, `riskFlags`, `assumptions`, `calculatedAt`. | 401 `AUTHENTICATION_REQUIRED` without trusted context; 404 `FINANCIAL_PROFILE_NOT_FOUND`; 422 `FINANCIAL_PROFILE_INCOMPLETE` for missing/invalid required raw data. No profile is created. |
| `POST /api/financial-twin/recalculate` | **IMPLEMENTED** (request-body only; temporary and non-persistent) | Node | Validate raw values and recalculate the Financial Twin deterministically. | `{ "profile": FinancialProfileInput, "asOfDate"?: "YYYY-MM-DD" }` | `FinancialTwin` with normalized `raw`, computed `derived`, provenance, explicit risk flags, assumptions, and calculation time. Goal progress distinguishes `currentFundingGap`, `projectedAmount`, and `projectedGoalShortfall`. | Income, expenses, savings, debt, investment balance/contribution, and goal money must be non-negative and finite. Essential expenses are optional; emergency coverage is `null` if missing or zero. Goal dates and horizons are validated. Unknown fields and caller-supplied provenance are rejected. Invalid requests return structured `VALIDATION_ERROR`; malformed JSON returns `INVALID_JSON`. |
| `GET /api/profile` | **NOT IMPLEMENTED** | Node | Read the current user's financial profile. | None. | Planned `FinancialProfile`. | Future authenticated-user context; currently `NOT_IMPLEMENTED`. |
| `PUT /api/profile` | **NOT IMPLEMENTED** | Node | Create or update the current user's profile. | `{ "currency": "INR", "riskPreferences"?: object }` | Planned `FinancialProfile`. | Node will validate supported profile fields; currently `NOT_IMPLEMENTED`. |
| `GET /api/goals` | **IMPLEMENTED** | Node + Prisma | List the current user's persisted goals with deterministic goal-engine output. | None; requires trusted user context. | Ordered `GoalWithDerived[]` (`createdAt`, then `id`, ascending), each with raw fields, `derived`, and provenance. | Scoped to the trusted user's profile; no profile returns 404. No rows are created or changed. |
| `POST /api/goals` | **IMPLEMENTED** | Node + Prisma | Validate and persist raw goal fields for the current user's existing profile. | `{ "name", "targetAmount", "currentAllocatedAmount"?, "targetDate"?, "monthsRemaining"?, "monthlyContribution"?, "fundingSource"?, "returnAssumption"?, "priority"? }` | Persisted goal fields plus deterministic `derived` goal progress and provenance. | 201 on success; money must be non-negative; dates/horizon are mutually exclusive; unknown/computed fields and caller-supplied `status` are rejected. Does not create profiles. |
| `GET /api/goals/:id` | **NOT IMPLEMENTED** | Node | Read one goal. | Goal ID in path. | Planned `Goal`. | Invalid IDs and missing goals will have structured errors; currently `NOT_IMPLEMENTED`. |
| `PUT /api/goals/:id` | **IMPLEMENTED** | Node + Prisma | Update raw fields of one goal owned by the current user's profile. | Partial raw fields from `POST /api/goals`; requires trusted user context. | Updated goal fields plus recalculated deterministic derived state and provenance. | Ownership is checked in both lookup and update predicates. Missing and cross-user IDs both return 404 `GOAL_NOT_FOUND`; invalid fields return 400 `INVALID_GOAL`. |
| `DELETE /api/goals/:id` | **NOT IMPLEMENTED** | Node | Delete a goal. | Goal ID in path. | Planned `{ "deleted": true }`. | Invalid IDs and missing goals will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/scenarios` | **NOT IMPLEMENTED** | Node | Define scenario input changes. | `{ "name", "description"?, "changes": object }` | Planned scenario definition. | Scenario changes will be validated by Node; currently `NOT_IMPLEMENTED`. |
| `GET /api/scenarios` | **NOT IMPLEMENTED** | Node | List scenario definitions. | None. | Planned `Scenario[]`. | Future profile/user context; currently `NOT_IMPLEMENTED`. |
| `GET /api/scenarios/:id` | **NOT IMPLEMENTED** | Node | Read a scenario definition. | Scenario ID in path. | Planned scenario definition. | Invalid IDs and missing scenarios will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/scenarios/simulate` | **IMPLEMENTED** (in-memory; non-persistent) | Node | Apply one deterministic structured transform and recalculate baseline/scenario metrics. | `{ "profile": FinancialProfileInput, "asOfDate": "YYYY-MM-DD", "scenario": ScenarioInput }` | `ScenarioResult`: baseline/scenario raw context and metrics, deltas, risk flags, evidence, assumptions, provenance, status, and calculation time. | Uses the shared Simulation Service and existing Financial Engine. Invalid baseline data uses `INVALID_REQUEST`; malformed scenario data uses `INVALID_SCENARIO`; unknown scenario types use `UNSUPPORTED_SCENARIO`. `MARKET_STRESS` is explicitly `UNSUPPORTED` with unavailable deltas and no state change. |
| `POST /api/simulations` | **IMPLEMENTED** (Node-only; in-memory) | Node | Orchestrate one deterministic simulation. | `{ "baseline": FinancialProfileInput, "asOfDate": "YYYY-MM-DD", "scenario": ScenarioInput }` | `{ baseline, scenario, delta, riskFlags, assumptions, calculationVersion: "1.0" }` | Uses the shared simulation service and Hour 6 Scenario Engine. Structured errors distinguish invalid request/scenario, unsupported type, and calculation failure. No authentication context exists, so this endpoint does not persist results. |
| `GET /api/simulations/:id` | **NOT IMPLEMENTED** | Node | Read a simulation result. | Simulation ID in path. | Planned persisted simulation result. | Invalid IDs and missing results will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/analysis` | **NOT IMPLEMENTED** | Node public route / FastAPI processing | Request AI-assisted analysis through an internal Node-to-FastAPI call. | Planned `{ "question": string, "context"?: object }`. | Planned validated analysis with evidence references. | Node validates the public request; FastAPI validates AI input/output. Currently `NOT_IMPLEMENTED`. |

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

`POST /api/simulations` is the versioned orchestration endpoint. It requires an explicit `asOfDate` and a raw `baseline` in the existing `FinancialProfileInput` shape; it accepts no caller-supplied derived metrics, risk flags, or provenance. `scenario` uses one of the structured types above. The endpoint delegates validation and orchestration to the shared Node simulation service, which calls the existing Scenario Engine and Financial Engine. It does not call FastAPI, Gemini, RAG, a market service, or any external network service.

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

Node owns the application API and deterministic calculations. Current Financial Twin recalculation and simulation endpoints accept request data and run in memory; they do not persist state. Node + Prisma is the authoritative application persistence path; the initial schema and migration are applied and verified. `GET /health` reports process liveness only; `/health/db` reports success only after a real query succeeds. FastAPI is scaffolded for future Gemini/RAG/retrieval/embedding work. The Python SQLAlchemy/Alembic code is a parity reference only.

## Owned Financial Twin and Goal APIs

`GET /api/financial-twin` and `/api/goals` require an `AuthenticatedUserContext` resolved by server middleware. Clients do not send a user ID. In development or test only, configure `NODE_ENV=development` (or `test`) and `NEXUS_DEV_USER_ID` to an existing database user's UUID. The adapter ignores request headers/body for identity and never creates a user or profile. In production and other modes it provides no identity, so protected routes return 401 `AUTHENTICATION_REQUIRED` until a trusted authentication resolver is installed. This is a temporary development adapter, not production authentication.

`GET /api/financial-twin` looks up a profile by the trusted user ID, loads its related income, expense, debt, asset, investment, and goal rows, maps persisted raw values into the existing Financial Engine input, and recalculates on every request. A non-null profile aggregate takes precedence over line-item totals. When a required aggregate is absent, active line items are normalized into monthly values; supported frequencies are daily, weekly, biweekly, monthly, quarterly, and annually, rounded to cents using deterministic half-even rounding. Liquid savings may be derived from liquid assets. Missing required income, expense, or liquid-savings data returns 422 `FINANCIAL_PROFILE_INCOMPLETE` rather than zero-filled data. No profile returns 404 `FINANCIAL_PROFILE_NOT_FOUND`. No derived metric is saved.

`GET /api/goals` returns current-profile goals ordered by creation time ascending then ID ascending. `POST /api/goals` accepts a raw Goal input and returns the persisted raw record plus a `derived` GoalProgress result. `PUT /api/goals/:id` accepts a partial raw Goal update and recalculates that result. Both use the existing deterministic goal engine; derived values and caller-supplied status are not accepted or persisted. Target date and remaining-month horizon are mutually exclusive; switching between them during update clears the prior horizon field. The default persisted monthly contribution is zero. Goal update lookup and write predicates both include the current financial profile ID; cross-user and missing IDs return the same 404 `GOAL_NOT_FOUND` response.

No financial profile or user is created automatically. Goals persist only raw goal inputs. Financial snapshots and audit records are not created by these read/write APIs. Database-backed route tests use a fresh in-memory repository adapter and clear it after each test; they do not insert test records into the configured development PostgreSQL database.
