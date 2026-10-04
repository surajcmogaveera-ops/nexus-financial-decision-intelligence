# Initial Node API contracts

The Node/Express backend is the authoritative application API. Raw request money may be a JSON number with at most two decimal places or a decimal string; decimal strings are preferred. Money is serialized as decimal strings. Ratios are JSON numbers or `null` when unavailable.

Invalid implemented requests use:

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

## Endpoint contracts

| Method and path | Status | Owner | Purpose | Request | Response | Validation and errors |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /health` | **IMPLEMENTED** | Node | Process health probe. | None. | `{"status":"ok"}` | HTTP 200 when the service is running. |
| `GET /health/db` | **IMPLEMENTED** | Node + Prisma | Execute `SELECT 1` through the shared Prisma client. | None. | `{"status":"ok","database":"ok"}` | HTTP 503 with `DATABASE_UNAVAILABLE` if `DATABASE_URL` is missing/invalid or PostgreSQL cannot be queried. The error does not expose connection details. |
| `GET /api/financial-twin` | **NOT IMPLEMENTED** | Node | Read the persisted Financial Twin after storage exists. | None. | Planned `FinancialTwin`: `raw`, `derived`, `provenance`, `riskFlags`, `calculatedAt`. | Future not-found error if no profile exists; currently `NOT_IMPLEMENTED`. |
| `POST /api/financial-twin/recalculate` | **IMPLEMENTED** (request-body only; temporary and non-persistent) | Node | Validate raw values and recalculate the Financial Twin deterministically. | `{ "profile": FinancialProfileInput, "asOfDate"?: "YYYY-MM-DD" }` | `FinancialTwin` with normalized `raw`, computed `derived`, provenance, explicit risk flags, assumptions, and calculation time. Goal progress distinguishes `currentFundingGap`, `projectedAmount`, and `projectedGoalShortfall`. | Income, expenses, savings, debt, investment balance/contribution, and goal money must be non-negative and finite. Essential expenses are optional; emergency coverage is `null` if missing or zero. Goal dates and horizons are validated. Unknown fields and caller-supplied provenance are rejected. Invalid requests return structured `VALIDATION_ERROR`; malformed JSON returns `INVALID_JSON`. |
| `GET /api/profile` | **NOT IMPLEMENTED** | Node | Read the current user's financial profile. | None. | Planned `FinancialProfile`. | Future authenticated-user context; currently `NOT_IMPLEMENTED`. |
| `PUT /api/profile` | **NOT IMPLEMENTED** | Node | Create or update the current user's profile. | `{ "currency": "INR", "riskPreferences"?: object }` | Planned `FinancialProfile`. | Node will validate supported profile fields; currently `NOT_IMPLEMENTED`. |
| `GET /api/goals` | **NOT IMPLEMENTED** | Node | List the current user's goals. | None. | Planned `Goal[]`. | Future profile/user context; currently `NOT_IMPLEMENTED`. |
| `POST /api/goals` | **NOT IMPLEMENTED** | Node | Create a goal. | `{ "name", "targetAmount", "currentAllocatedAmount"?, "targetDate"?, "monthlyContribution"?, "priority"?, "status"? }` | Planned `Goal`. | Money must be non-negative; dates, horizon, status, and priority must be valid. Currently `NOT_IMPLEMENTED`. |
| `GET /api/goals/:id` | **NOT IMPLEMENTED** | Node | Read one goal. | Goal ID in path. | Planned `Goal`. | Invalid IDs and missing goals will have structured errors; currently `NOT_IMPLEMENTED`. |
| `PUT /api/goals/:id` | **NOT IMPLEMENTED** | Node | Update a goal. | Partial fields from `POST /api/goals`. | Planned `Goal`. | Applies goal validation; currently `NOT_IMPLEMENTED`. |
| `DELETE /api/goals/:id` | **NOT IMPLEMENTED** | Node | Delete a goal. | Goal ID in path. | Planned `{ "deleted": true }`. | Invalid IDs and missing goals will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/scenarios` | **NOT IMPLEMENTED** | Node | Define scenario input changes. | `{ "name", "description"?, "changes": object }` | Planned scenario definition. | Scenario changes will be validated by Node; currently `NOT_IMPLEMENTED`. |
| `GET /api/scenarios` | **NOT IMPLEMENTED** | Node | List scenario definitions. | None. | Planned `Scenario[]`. | Future profile/user context; currently `NOT_IMPLEMENTED`. |
| `GET /api/scenarios/:id` | **NOT IMPLEMENTED** | Node | Read a scenario definition. | Scenario ID in path. | Planned scenario definition. | Invalid IDs and missing scenarios will have structured errors; currently `NOT_IMPLEMENTED`. |
| `POST /api/simulations` | **NOT IMPLEMENTED** | Node | Run deterministic scenario simulation. | `{ "scenarioId" }` or inline scenario definition. | Planned baseline/scenario metrics, deltas, goal impact, and risk flags. | Node validates inputs and assumptions; currently `NOT_IMPLEMENTED`. |
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

Derived values are recalculated for every request and are absent from raw profile input. Derived provenance is `COMPUTED`; supplied raw values are `USER`; defaulted raw values are `ASSUMPTION`. The caller cannot set provenance, so AI output cannot label itself as user input or deterministic computation.

Goal terminology is deliberately distinct: `currentFundingGap` is `max(0, targetAmount - currentAllocatedAmount)` (summed across goals in the top-level derived metrics); `projectedAmount` is current allocation plus contribution times remaining months; `projectedGoalShortfall` is `max(0, targetAmount - projectedAmount)`. A baseline-to-scenario shortfall delta is `additionalScenarioShortfall = scenario projectedGoalShortfall - baseline projectedGoalShortfall`. The last value is only a pure comparison helper/example; no Scenario Engine endpoint is implemented. These names replace the ambiguous Hour 2 response fields `goalFundingGap` and `projectedShortfall`; no backward alias is emitted because this is a pre-persistence checkpoint without persisted response consumers.

## Ownership boundary

Node owns the application API and deterministic calculations. Current Financial Twin recalculation is request-body/in-memory only and never persists state. Node + Prisma is the authoritative application persistence path; its schema and initial migration are prepared, but the migration is not yet applied. `GET /health` reports process liveness only; `/health/db` reports success only after a real query succeeds. FastAPI is scaffolded for future Gemini/RAG/retrieval/embedding work. The Python SQLAlchemy/Alembic code is a parity reference only.
