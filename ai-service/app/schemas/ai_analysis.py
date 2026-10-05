from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Money = Annotated[str, StringConstraints(pattern=r"^(?:0|[0-9]+(?:\.[0-9]+)?)$")]
SignedMoney = Annotated[str, StringConstraints(pattern=r"^-?(?:0|[0-9]+(?:\.[0-9]+)?)$")]
RequestId = Annotated[
    str,
    StringConstraints(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"),
]
Provenance = Literal["USER", "COMPUTED", "EXTERNAL", "RETRIEVED", "AI_INTERPRETATION", "ASSUMPTION"]
RiskType = Literal[
    "LIQUIDITY_REDUCTION",
    "GOAL_SHORTFALL",
    "NEGATIVE_SURPLUS",
    "HIGHER_DEBT_BURDEN",
    "EMERGENCY_COVERAGE_REDUCTION",
    "MISSING_DATA",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class GoalState(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    targetAmount: Money
    currentAllocatedAmount: Money
    targetDate: date | None = None
    monthsRemaining: int | None = None
    monthlyContribution: Money | None = None
    fundingSource: str | None = None
    returnAssumption: float
    priority: int
    status: Literal["active", "completed", "paused"]


class RawFinancialState(StrictModel):
    currency: str = Field(min_length=3, max_length=3)
    monthlyIncome: Money
    monthlyExpenses: Money
    monthlyDebtPayments: Money
    liquidSavings: Money
    investments: Money
    monthlyInvestmentContribution: Money
    essentialMonthlyExpenses: Money | None = None
    goals: list[GoalState]


class GoalMetrics(StrictModel):
    name: str
    targetAmount: Money
    currentAllocatedAmount: Money
    currentFundingGap: Money
    monthsRemaining: int | None
    monthlyContributionUsed: Money
    requiredMonthlyContribution: Money | None
    projectedAmount: Money | None
    projectedGoalShortfall: Money | None
    monthsToGoal: int | None
    feasible: bool | None
    status: Literal["FUNDED", "ON_TRACK", "SHORTFALL", "UNREACHABLE", "UNAVAILABLE"]
    statusMessage: str | None


class DerivedFinancialMetrics(StrictModel):
    monthlySurplus: SignedMoney
    availableMonthlyCashFlow: SignedMoney
    savingsRate: float | None
    debtToIncome: float | None
    emergencyCoverageMonths: float | None
    currentFundingGap: Money
    requiredMonthlyContribution: Money | None
    goals: list[GoalMetrics]


class RawProvenance(StrictModel):
    currency: Provenance | None = None
    monthlyIncome: Provenance | None = None
    monthlyExpenses: Provenance | None = None
    monthlyDebtPayments: Provenance | None = None
    liquidSavings: Provenance | None = None
    investments: Provenance | None = None
    monthlyInvestmentContribution: Provenance | None = None
    essentialMonthlyExpenses: Provenance | None = None
    goals: Provenance | None = None


class DerivedProvenance(StrictModel):
    monthlySurplus: Literal["COMPUTED"]
    availableMonthlyCashFlow: Literal["COMPUTED"]
    savingsRate: Literal["COMPUTED"]
    debtToIncome: Literal["COMPUTED"]
    emergencyCoverageMonths: Literal["COMPUTED"]
    currentFundingGap: Literal["COMPUTED"]
    requiredMonthlyContribution: Literal["COMPUTED"]
    goals: Literal["COMPUTED"]


class ProvenanceState(StrictModel):
    raw: RawProvenance
    derived: DerivedProvenance
    goalFields: list[dict[str, Provenance]] = Field(default_factory=list)
    # Additive default keeps older internal Node clients contract-compatible.
    assumptions: Literal["ASSUMPTION"] = "ASSUMPTION"

    @model_validator(mode="after")
    def reject_ai_as_source_data(self) -> "ProvenanceState":
        raw_values = [
            *[value for value in self.raw.model_dump().values() if value is not None],
            *(value for goal in self.goalFields for value in goal.values()),
        ]
        if "AI_INTERPRETATION" in raw_values:
            raise ValueError("AI interpretation cannot be provenance for source financial data.")
        return self


class RiskFlag(StrictModel):
    type: RiskType
    severity: Literal["low", "medium", "high"]
    trigger: str
    evidence: list[str]
    details: dict[str, str | int | float | bool | None]


class RiskEvidence(StrictModel):
    metric: str
    expression: str
    baselineValue: str | float | bool | None
    scenarioValue: str | float | bool | None
    result: bool
    provenance: Literal["COMPUTED"]
    evidenceId: str


class FinancialTwinContext(StrictModel):
    raw: RawFinancialState
    derived: DerivedFinancialMetrics
    provenance: ProvenanceState


class SimulationBaseline(FinancialTwinContext):
    evidence: list[RiskEvidence]


class SimulationScenario(StrictModel):
    type: Literal[
        "INVESTMENT_CHANGE", "INCOME_SHOCK", "EXPENSE_CHANGE", "RENT_CHANGE",
        "EMERGENCY_EXPENSE", "DEBT_CHANGE", "GOAL_CHANGE", "MARKET_STRESS",
    ]
    status: Literal["COMPLETED", "UNSUPPORTED"]
    raw: RawFinancialState
    derived: DerivedFinancialMetrics
    provenance: ProvenanceState
    evidence: list[RiskEvidence]


class ScenarioMetricDelta(StrictModel):
    delta: str | float | None
    percentageDelta: float | None


class ScenarioDelta(StrictModel):
    monthlySurplus: ScenarioMetricDelta
    availableMonthlyCashFlow: ScenarioMetricDelta
    savingsRate: ScenarioMetricDelta
    debtToIncome: ScenarioMetricDelta
    emergencyCoverageMonths: ScenarioMetricDelta
    currentFundingGap: ScenarioMetricDelta
    projectedAmount: ScenarioMetricDelta
    projectedGoalShortfall: ScenarioMetricDelta
    liquidityImpact: ScenarioMetricDelta
    additionalScenarioShortfall: SignedMoney | None


class AiAnalysisRequest(StrictModel):
    requestId: RequestId
    question: str = Field(min_length=1, max_length=2000)
    financialTwin: FinancialTwinContext
    baseline: SimulationBaseline
    scenario: SimulationScenario
    delta: ScenarioDelta
    riskFlags: list[RiskFlag]
    assumptions: list[str]
    evidence: list[RiskEvidence]
    calculationVersion: Literal["1.0"]


class AiAnalysisResponse(StrictModel):
    requestId: RequestId
    status: Literal["READY"]
    summary: str | None
    keyChanges: list[str]
    tradeoffs: list[str]
    riskFlags: list[RiskFlag]
    evidenceRefs: list[str]
    assumptions: list[str]
    limitations: list[str]
    model: str | None
    promptVersion: str | None
    calculationVersion: Literal["1.0"]
