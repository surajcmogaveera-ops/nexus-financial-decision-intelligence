"""Deterministic Goal Engine over authoritative raw Goal definitions."""

from datetime import date
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict

from app.engine.financial_metrics import (
    UNREACHABLE_GOAL_MESSAGE,
    goal_gap,
    goal_unreachable_message,
    months_to_goal,
    projected_goal_amount,
    required_monthly_contribution,
)
from app.evidence.calculations import GoalCalculationEvidence
from app.evidence.provenance import ProvenanceType
from app.models.goal import Goal


class GoalCalculationStatus(str, Enum):
    FUNDED = "FUNDED"
    ON_TRACK = "ON_TRACK"
    SHORTFALL = "SHORTFALL"
    UNREACHABLE = "UNREACHABLE"
    UNAVAILABLE = "UNAVAILABLE"


class GoalCalculationResult(BaseModel):
    """Raw inputs and ephemeral calculations for one goal."""

    model_config = ConfigDict(
        alias_generator=lambda name: "".join(
            part.capitalize() if index else part
            for index, part in enumerate(name.split("_"))
        ),
        populate_by_name=True,
        frozen=True,
    )

    name: str
    target_amount: Decimal
    current_allocation: Decimal
    target_date: date | None
    current_contribution: Decimal
    funding_source: str | None
    return_assumption: Decimal
    goal_gap: Decimal
    months_remaining: int | None
    required_monthly_contribution: Decimal | None
    projected_amount: Decimal | None
    months_to_goal: int | None
    feasible: bool | None
    calculation_status: GoalCalculationStatus
    assumptions: list[str]
    unavailable_fields: list[str]
    evidence: list[GoalCalculationEvidence]

    @property
    def status_message(self) -> str | None:
        if self.calculation_status is GoalCalculationStatus.UNREACHABLE:
            return UNREACHABLE_GOAL_MESSAGE
        if self.calculation_status is GoalCalculationStatus.SHORTFALL:
            return UNREACHABLE_GOAL_MESSAGE
        return None


def months_between_dates(as_of_date: date, target_date: date) -> int:
    """Count contribution months by calendar month, rounding partial months up.

    A target on the as-of date is zero months. For future dates, count the
    difference in calendar-month positions and add one when the target falls
    after the matching day of the month. A future date in the same month is
    therefore one month. This uses calendar dates rather than days / 30 and
    naturally handles year boundaries and shorter months.
    """

    if target_date < as_of_date:
        raise ValueError("target_date must not be before as_of_date")
    if target_date == as_of_date:
        return 0

    month_difference = (target_date.year - as_of_date.year) * 12
    month_difference += target_date.month - as_of_date.month
    if target_date.day > as_of_date.day:
        month_difference += 1
    return max(1, month_difference)


def _calculation(
    name: str,
    inputs: dict[str, Decimal | int | bool | str | date | None],
    output: Decimal | int | bool | str | None,
) -> GoalCalculationEvidence:
    return GoalCalculationEvidence(
        calculation=name,
        inputs=tuple(inputs.items()),
        output=output,
        provenance=ProvenanceType.COMPUTED,
    )


def calculate_goal(goal: Goal, *, as_of_date: date) -> GoalCalculationResult:
    """Calculate one goal from its raw inputs and a caller-supplied current date.

    No income or expense inputs are used. Return assumptions default to zero;
    nonzero assumptions are kept visible but mark projections unavailable until
    return simulation is deliberately added to the calculation contract.
    """

    if goal.target_date is not None and goal.target_date < as_of_date:
        raise ValueError("target_date must not be before as_of_date")

    target = goal.target_amount
    allocation = goal.current_allocated_amount
    contribution = goal.current_contribution
    gap = goal_gap(target, allocation)
    evidence = [
        _calculation(
            "goal_gap",
            {"target_amount": target, "current_allocation": allocation},
            gap,
        )
    ]
    if gap == 0 or goal.return_assumption == 0:
        months_to_target = months_to_goal(target, allocation, contribution)
        evidence.append(
            _calculation(
                "months_to_goal",
                {
                    "target_amount": target,
                    "current_allocation": allocation,
                    "current_contribution": contribution,
                    "return_assumption": goal.return_assumption,
                },
                months_to_target,
            )
        )
    else:
        months_to_target = None

    assumptions: list[str] = []
    if "current_allocated_amount" not in goal.model_fields_set:
        assumptions.append(
            "Current allocation defaulted to 0 by the Goal model because it was omitted."
        )
    if "current_contribution" not in goal.model_fields_set:
        assumptions.append(
            "Current contribution defaulted to 0 by the Goal model because it was omitted."
        )
    unavailable_fields: list[str] = []
    months_remaining: int | None = None
    required_contribution: Decimal | None = None
    projection: Decimal | None = None
    feasible: bool | None = None

    if goal.return_assumption == 0:
        assumptions.append(
            "No investment return assumed; projection is current allocation "
            "+ current contribution × months remaining."
        )
    else:
        assumptions.append(
            "A nonzero return assumption was provided. Return simulation is "
            "not implemented, so return-dependent calculations are unavailable."
        )

    if goal.target_date is not None:
        months_remaining = months_between_dates(as_of_date, goal.target_date)
        evidence.append(
            _calculation(
                "months_remaining",
                {"as_of_date": as_of_date, "target_date": goal.target_date},
                months_remaining,
            )
        )
    else:
        unavailable_fields.append("months_remaining")

    if gap == 0:
        required_contribution = Decimal("0")
        evidence.append(
            _calculation(
                "required_monthly_contribution",
                {"goal_gap": gap, "months_remaining": months_remaining},
                required_contribution,
            )
        )
        feasible = True
        evidence.append(
            _calculation(
                "goal_feasibility",
                {"target_amount": target, "current_allocation": allocation},
                feasible,
            )
        )
        if months_remaining is not None and goal.return_assumption == 0:
            projection = projected_goal_amount(allocation, contribution, months_remaining)
            evidence.append(
                _calculation(
                    "projected_goal_amount",
                    {
                        "current_allocation": allocation,
                        "current_contribution": contribution,
                        "months_remaining": months_remaining,
                        "return_assumption": goal.return_assumption,
                    },
                    projection,
                )
            )
        elif goal.return_assumption != 0:
            unavailable_fields.append("projected_amount")
        else:
            unavailable_fields.append("projected_amount")
        status = GoalCalculationStatus.FUNDED
    elif goal.return_assumption != 0:
        unavailable_fields.extend(
            [
                "required_monthly_contribution",
                "projected_amount",
                "months_to_goal",
                "feasible",
            ]
        )
        status = GoalCalculationStatus.UNAVAILABLE
    elif goal.target_date is None:
        unavailable_fields.extend(
            [
                "required_monthly_contribution",
                "projected_amount",
                "feasible",
            ]
        )
        status = (
            GoalCalculationStatus.UNREACHABLE
            if months_to_target is None
            else GoalCalculationStatus.UNAVAILABLE
        )
    else:
        required_contribution = required_monthly_contribution(
            target, allocation, months_remaining
        )
        if required_contribution is not None:
            evidence.append(
                _calculation(
                    "required_monthly_contribution",
                    {"goal_gap": gap, "months_remaining": months_remaining},
                    required_contribution,
                )
            )
        else:
            unavailable_fields.append("required_monthly_contribution")

        projection = projected_goal_amount(allocation, contribution, months_remaining)
        evidence.append(
            _calculation(
                "projected_goal_amount",
                {
                    "current_allocation": allocation,
                    "current_contribution": contribution,
                    "months_remaining": months_remaining,
                    "return_assumption": goal.return_assumption,
                },
                projection,
            )
        )
        feasible = projection >= target
        evidence.append(
            _calculation(
                "goal_feasibility",
                {"projected_amount": projection, "target_amount": target},
                feasible,
            )
        )
        status = (
            GoalCalculationStatus.UNREACHABLE
            if months_to_target is None
            else GoalCalculationStatus.ON_TRACK
            if feasible
            else GoalCalculationStatus.SHORTFALL
        )

    if months_remaining == 0 and gap > 0 and required_contribution is None:
        if "required_monthly_contribution" not in unavailable_fields:
            unavailable_fields.append("required_monthly_contribution")

    return GoalCalculationResult(
        name=goal.name,
        target_amount=target,
        current_allocation=allocation,
        target_date=goal.target_date,
        current_contribution=contribution,
        funding_source=goal.funding_source,
        return_assumption=goal.return_assumption,
        goal_gap=gap,
        months_remaining=months_remaining,
        required_monthly_contribution=required_contribution,
        projected_amount=projection,
        months_to_goal=months_to_target,
        feasible=feasible,
        calculation_status=status,
        assumptions=assumptions,
        unavailable_fields=unavailable_fields,
        evidence=evidence,
    )


def calculate_goals(
    goals: list[Goal], *, as_of_date: date
) -> list[GoalCalculationResult]:
    """Calculate every goal independently, preserving input order."""

    return [calculate_goal(goal, as_of_date=as_of_date) for goal in goals]
