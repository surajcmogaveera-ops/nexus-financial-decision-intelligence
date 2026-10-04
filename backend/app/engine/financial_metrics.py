"""Pure, deterministic calculations for Financial Twin and goal inputs."""

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING
from pydantic import BaseModel, ConfigDict

from app.models.financial_twin import FinancialTwinState

Numeric = Decimal | int | float
OptionalNumeric = Numeric | None
UNREACHABLE_GOAL_MESSAGE = (
    "Goal is not reachable within the selected horizon under the current assumptions."
)


def _decimal(value: Numeric) -> Decimal:
    """Convert supported numeric inputs without introducing float artifacts."""

    return value if isinstance(value, Decimal) else Decimal(str(value))


def _nonnegative(value: Numeric, field_name: str) -> Decimal:
    amount = _decimal(value)
    if amount < 0:
        raise ValueError(f"{field_name} must be non-negative")
    return amount


def monthly_surplus(
    monthly_income: Numeric,
    monthly_expenses: Numeric,
    monthly_debt_payments: Numeric,
) -> Decimal:
    income = _nonnegative(monthly_income, "monthly_income")
    expenses = _nonnegative(monthly_expenses, "monthly_expenses")
    debt_payments = _nonnegative(monthly_debt_payments, "monthly_debt_payments")
    return income - expenses - debt_payments


def savings_rate(monthly_surplus_amount: Numeric, monthly_income: Numeric) -> Decimal | None:
    """Return surplus / income, or None when income is zero."""

    income = _nonnegative(monthly_income, "monthly_income")
    if income == 0:
        return None
    return _decimal(monthly_surplus_amount) / income


def debt_to_income(monthly_debt_payments: Numeric, monthly_income: Numeric) -> Decimal | None:
    income = _nonnegative(monthly_income, "monthly_income")
    debt_payments = _nonnegative(monthly_debt_payments, "monthly_debt_payments")
    return None if income == 0 else debt_payments / income


def emergency_coverage_months(
    liquid_savings: OptionalNumeric,
    essential_monthly_expenses: OptionalNumeric,
) -> Decimal | None:
    """Return coverage only when both inputs exist and expenses are nonzero."""

    if liquid_savings is None or essential_monthly_expenses is None:
        return None
    savings = _nonnegative(liquid_savings, "liquid_savings")
    expenses = _nonnegative(essential_monthly_expenses, "essential_monthly_expenses")
    if expenses == 0:
        return None
    return savings / expenses


def goal_gap(target_amount: Numeric, current_allocated: Numeric) -> Decimal:
    target = _nonnegative(target_amount, "target_amount")
    allocated = _nonnegative(current_allocated, "current_allocated")
    return max(Decimal("0"), target - allocated)


def required_monthly_contribution(
    target_amount: Numeric,
    current_allocated: Numeric,
    months_remaining: int | None,
) -> Decimal | None:
    """Return a no-return contribution plan, or None for an invalid horizon."""

    gap = goal_gap(target_amount, current_allocated)
    if gap == 0:
        return Decimal("0")
    if type(months_remaining) is not int or months_remaining <= 0:
        return None
    return gap / Decimal(months_remaining)


def projected_goal_amount(
    current_allocated: Numeric, monthly_contribution: Numeric, months: int
) -> Decimal:
    if type(months) is not int or months < 0:
        raise ValueError("months must be a non-negative integer")
    allocated = _nonnegative(current_allocated, "current_allocated")
    contribution = _nonnegative(monthly_contribution, "monthly_contribution")
    return allocated + contribution * months


def months_to_goal(
    target_amount: Numeric, current_allocated: Numeric, contribution: Numeric
) -> int | None:
    """Return whole months to target, or None when unreachable at this rate."""

    gap = goal_gap(target_amount, current_allocated)
    if gap == 0:
        return 0
    monthly_amount = _nonnegative(contribution, "contribution")
    if monthly_amount <= 0:
        return None
    return int((gap / monthly_amount).to_integral_value(rounding=ROUND_CEILING))


@dataclass(frozen=True)
class MetricDelta:
    delta: Decimal | None
    percentage_delta: Decimal | None


def scenario_delta(baseline: OptionalNumeric, scenario: OptionalNumeric) -> MetricDelta:
    """Compare one numeric metric; unavailable inputs remain unavailable."""

    if baseline is None or scenario is None:
        return MetricDelta(delta=None, percentage_delta=None)
    baseline_value = _decimal(baseline)
    delta = _decimal(scenario) - baseline_value
    percentage = (
        None if baseline_value == 0 else (delta / abs(baseline_value)) * Decimal("100")
    )
    return MetricDelta(delta=delta, percentage_delta=percentage)


def goal_unreachable_message(
    target_amount: Numeric,
    current_allocated: Numeric,
    monthly_contribution: Numeric,
    months_remaining: int | None,
) -> str | None:
    """Explain when current contributions cannot reach the goal in its horizon."""

    gap = goal_gap(target_amount, current_allocated)
    if gap == 0 or months_remaining is None or months_remaining <= 0:
        return None
    if projected_goal_amount(current_allocated, monthly_contribution, months_remaining) < _decimal(target_amount):
        return UNREACHABLE_GOAL_MESSAGE
    return None


class FinancialTwinMetrics(BaseModel):
    """Ephemeral derived values; never stored in FinancialTwinState."""

    model_config = ConfigDict(
        alias_generator=lambda name: "".join(
            part.capitalize() if index else part
            for index, part in enumerate(name.split("_"))
        ),
        populate_by_name=True,
        frozen=True,
    )

    monthly_surplus: Decimal
    savings_rate: Decimal | None
    debt_to_income: Decimal | None
    emergency_coverage_months: Decimal | None
    goal_funding_gap: Decimal


def calculate_financial_metrics(
    state: FinancialTwinState,
    *,
    essential_monthly_expenses: Numeric | None = None,
) -> FinancialTwinMetrics:
    """Recalculate derived metrics from raw state on every call.

    Essential expenses are an explicit input because total monthly expenses do
    not identify which portion is essential. Leave it unset to mark coverage
    unavailable instead of assuming.
    """

    surplus = monthly_surplus(
        state.monthly_income, state.monthly_expenses, state.monthly_debt_payments
    )
    return FinancialTwinMetrics(
        monthly_surplus=surplus,
        savings_rate=savings_rate(surplus, state.monthly_income),
        debt_to_income=debt_to_income(
            state.monthly_debt_payments, state.monthly_income
        ),
        emergency_coverage_months=emergency_coverage_months(
            state.liquid_savings, essential_monthly_expenses
        ),
        goal_funding_gap=sum(
            (
                goal_gap(goal.target_amount, goal.current_allocated_amount)
                for goal in state.goals
            ),
            start=Decimal("0"),
        ),
    )

