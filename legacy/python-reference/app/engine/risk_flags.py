"""Deterministic risk flags from already-calculated baseline/scenario metrics."""

from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from app.engine.financial_metrics import FinancialTwinMetrics, scenario_delta
from app.evidence.calculations import CalculationEvidence

LOW_CHANGE_CEILING_PERCENT = Decimal("10")
HIGH_CHANGE_THRESHOLD_PERCENT = Decimal("50")


class RiskType(str, Enum):
    LIQUIDITY_REDUCTION = "LIQUIDITY_REDUCTION"
    GOAL_SHORTFALL = "GOAL_SHORTFALL"
    NEGATIVE_SURPLUS = "NEGATIVE_SURPLUS"
    HIGHER_DEBT_BURDEN = "HIGHER_DEBT_BURDEN"
    EMERGENCY_COVERAGE_REDUCTION = "EMERGENCY_COVERAGE_REDUCTION"


class RiskSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class RiskFlag(BaseModel):
    model_config = ConfigDict(frozen=True)

    type: RiskType
    severity: RiskSeverity
    trigger: str
    evidence: list[str] = Field(min_length=1)


class RiskDetectionResult(BaseModel):
    """Risk flags plus the deterministic calculation records they reference."""

    model_config = ConfigDict(frozen=True)

    flags: list[RiskFlag]
    calculations: list[CalculationEvidence]


def _magnitude_severity(baseline: Decimal, scenario: Decimal) -> RiskSeverity:
    """Classify a reduction: under 10% low, 10–49.99% medium, 50%+ high."""

    if baseline <= 0:
        return RiskSeverity.HIGH
    reduction_percent = ((baseline - scenario) / baseline) * Decimal("100")
    if reduction_percent >= HIGH_CHANGE_THRESHOLD_PERCENT:
        return RiskSeverity.HIGH
    if reduction_percent >= LOW_CHANGE_CEILING_PERCENT:
        return RiskSeverity.MEDIUM
    return RiskSeverity.LOW


def _increase_severity(baseline: Decimal, scenario: Decimal) -> RiskSeverity:
    if baseline == 0 and scenario > 0:
        return RiskSeverity.HIGH
    increase_percent = ((scenario - baseline) / baseline) * Decimal("100")
    if increase_percent >= HIGH_CHANGE_THRESHOLD_PERCENT:
        return RiskSeverity.HIGH
    if increase_percent >= LOW_CHANGE_CEILING_PERCENT:
        return RiskSeverity.MEDIUM
    return RiskSeverity.LOW


def detect_risk_flags(
    baseline_metrics: FinancialTwinMetrics,
    scenario_metrics: FinancialTwinMetrics,
    *,
    baseline_liquid_savings: Decimal | int | float | None = None,
    scenario_liquid_savings: Decimal | int | float | None = None,
    baseline_goal_feasible: bool | None = None,
    scenario_goal_feasible: bool | None = None,
) -> RiskDetectionResult:
    """Compare existing calculated metrics and return explicit flags.

    Goal feasibility and liquid savings are explicit companion inputs because
    neither is included in FinancialTwinMetrics. No metrics are recalculated
    here. The feasibility values must come from the caller's deterministic
    goal calculation; omitted feasibility data does not get guessed.
    """

    flags: list[RiskFlag] = []
    calculations: list[CalculationEvidence] = []

    def record(metric: str, expression: str, baseline, scenario, result: bool) -> str:
        calculation = CalculationEvidence(
            metric=metric,
            expression=expression,
            baseline_value=baseline,
            scenario_value=scenario,
            result=result,
        )
        calculations.append(calculation)
        return calculation.evidence_id

    # Keep output order aligned with the UI display order specified in the brief.
    liquidity_delta = scenario_delta(baseline_liquid_savings, scenario_liquid_savings)
    liquidity_changed = liquidity_delta.delta is not None and liquidity_delta.delta < 0
    if liquidity_changed:
        evidence_id = record(
            "liquid_savings",
            "scenario_liquid_savings < baseline_liquid_savings",
            Decimal(str(baseline_liquid_savings)),
            Decimal(str(scenario_liquid_savings)),
            True,
        )
        flags.append(
            RiskFlag(
                type=RiskType.LIQUIDITY_REDUCTION,
                severity=_magnitude_severity(
                    Decimal(str(baseline_liquid_savings)),
                    Decimal(str(scenario_liquid_savings)),
                ),
                trigger="scenario_liquid_savings < baseline_liquid_savings",
                evidence=[evidence_id],
            )
        )

    goal_gap_delta = scenario_delta(
        baseline_metrics.goal_funding_gap, scenario_metrics.goal_funding_gap
    )
    goal_gap_increased = goal_gap_delta.delta is not None and goal_gap_delta.delta > 0
    if goal_gap_increased:
        evidence_id = record(
            "goal_funding_gap",
            "scenario_goal_gap > baseline_goal_gap",
            baseline_metrics.goal_funding_gap,
            scenario_metrics.goal_funding_gap,
            True,
        )
        became_infeasible = (
            baseline_goal_feasible is True and scenario_goal_feasible is False
        )
        baseline_gap = baseline_metrics.goal_funding_gap
        scenario_gap = scenario_metrics.goal_funding_gap
        if became_infeasible:
            severity = RiskSeverity.HIGH
            feasibility_id = record(
                "goal_feasibility",
                "baseline_goal_feasible and not scenario_goal_feasible",
                True,
                False,
                True,
            )
            evidence_id_for_flag = [evidence_id, feasibility_id]
        elif baseline_gap > 0:
            increase_percent = (
                (scenario_gap - baseline_gap) / baseline_gap
            ) * Decimal("100")
            severity = (
                RiskSeverity.LOW
                if increase_percent < LOW_CHANGE_CEILING_PERCENT
                else RiskSeverity.MEDIUM
            )
            evidence_id_for_flag = [evidence_id]
        else:
            # Starting from no gap, any newly required funding is a clear
            # deterioration; feasibility can raise it to high above.
            severity = RiskSeverity.MEDIUM
            evidence_id_for_flag = [evidence_id]
        flags.append(
            RiskFlag(
                type=RiskType.GOAL_SHORTFALL,
                severity=severity,
                trigger="scenario_goal_gap > baseline_goal_gap",
                evidence=evidence_id_for_flag,
            )
        )

    scenario_surplus = scenario_metrics.monthly_surplus
    if scenario_surplus < 0:
        evidence_id = record(
            "monthly_surplus",
            "scenario_monthly_surplus < 0",
            baseline_metrics.monthly_surplus,
            scenario_surplus,
            True,
        )
        flags.append(
            RiskFlag(
                type=RiskType.NEGATIVE_SURPLUS,
                severity=RiskSeverity.HIGH,
                trigger="scenario_monthly_surplus < 0",
                evidence=[evidence_id],
            )
        )

    baseline_dti = baseline_metrics.debt_to_income
    scenario_dti = scenario_metrics.debt_to_income
    dti_delta = scenario_delta(baseline_dti, scenario_dti)
    if dti_delta.delta is not None and dti_delta.delta > 0:
        evidence_id = record(
            "debt_to_income",
            "scenario_dti > baseline_dti",
            baseline_dti,
            scenario_dti,
            True,
        )
        severity = _increase_severity(baseline_dti, scenario_dti)
        flags.append(
            RiskFlag(
                type=RiskType.HIGHER_DEBT_BURDEN,
                severity=severity,
                trigger="scenario_dti > baseline_dti",
                evidence=[evidence_id],
            )
        )

    baseline_coverage = baseline_metrics.emergency_coverage_months
    scenario_coverage = scenario_metrics.emergency_coverage_months
    coverage_delta = scenario_delta(baseline_coverage, scenario_coverage)
    if coverage_delta.delta is not None and coverage_delta.delta < 0:
        evidence_id = record(
            "emergency_coverage_months",
            "scenario_emergency_coverage_months < baseline_emergency_coverage_months",
            baseline_coverage,
            scenario_coverage,
            True,
        )
        flags.append(
            RiskFlag(
                type=RiskType.EMERGENCY_COVERAGE_REDUCTION,
                severity=_magnitude_severity(baseline_coverage, scenario_coverage),
                trigger=(
                    "scenario_emergency_coverage_months "
                    "< baseline_emergency_coverage_months"
                ),
                evidence=[evidence_id],
            )
        )

    return RiskDetectionResult(flags=flags, calculations=calculations)
