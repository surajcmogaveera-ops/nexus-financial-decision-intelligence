from decimal import Decimal
from uuid import UUID

from sqlalchemy.orm import Session

from app.engine.financial_metrics import calculate_financial_metrics
from app.models.financial_twin import FinancialTwinState
from app.models.goal import Goal
from app.repositories.financial_twin_repository import FinancialTwinRepository
from app.schemas.persistence import FinancialTwinRead


MONTHLY_FREQUENCY_FACTORS = {
    "daily": Decimal("365") / Decimal("12"),
    "weekly": Decimal("52") / Decimal("12"),
    "biweekly": Decimal("26") / Decimal("12"),
    "monthly": Decimal("1"),
    "quarterly": Decimal("1") / Decimal("3"),
    "annually": Decimal("1") / Decimal("12"),
}


def normalize_monthly(amount: Decimal, frequency: str) -> Decimal:
    """Normalize a persisted recurring amount in the application layer."""

    try:
        factor = MONTHLY_FREQUENCY_FACTORS[frequency]
    except KeyError as error:
        raise ValueError(f"Unsupported frequency: {frequency}") from error
    return amount * factor


class FinancialTwinService:
    def __init__(self, session: Session) -> None:
        self.repository = FinancialTwinRepository(session)

    def get_financial_twin(self, profile_id: UUID) -> FinancialTwinRead | None:
        records = self.repository.get_financial_twin_records(profile_id)
        if records is None:
            return None

        active_incomes = [item for item in records["income_sources"] if item.is_active]
        active_expenses = [item for item in records["expenses"] if item.is_active]
        active_debts = [item for item in records["debts"] if item.is_active]
        liquid_assets = [
            item
            for item in records["assets"]
            if item.is_liquid
        ]
        active_investments = [
            item for item in records["investments"] if item.current_value is not None
        ]
        essential_expenses = [item for item in active_expenses if item.is_essential]

        unavailable_fields: list[str] = []
        if not active_incomes:
            unavailable_fields.append("monthly_income")
        if not active_expenses:
            unavailable_fields.append("monthly_expenses")
        if not liquid_assets:
            unavailable_fields.append("liquid_savings")

        financial_twin = None
        derived_metrics = None
        if not unavailable_fields:
            goals = [
                Goal(
                    name=item.name,
                    targetAmount=item.target_amount,
                    currentAllocatedAmount=item.current_allocated_amount,
                    targetDate=item.target_date,
                    currentContribution=item.current_contribution,
                    fundingSource=item.funding_source,
                    returnAssumption=item.return_assumption,
                    priority=item.priority,
                    status=item.status,
                )
                for item in records["goals"]
            ]
            financial_twin = FinancialTwinState(
                monthly_income=sum(
                    (
                        normalize_monthly(item.amount, item.frequency)
                        for item in active_incomes
                    ),
                    start=Decimal("0"),
                ),
                monthly_expenses=sum(
                    (
                        normalize_monthly(item.amount, item.frequency)
                        for item in active_expenses
                    ),
                    start=Decimal("0"),
                ),
                liquid_savings=sum(
                    (item.current_value for item in liquid_assets),
                    start=Decimal("0"),
                ),
                monthly_debt_payments=sum(
                    (
                        normalize_monthly(item.payment_amount, item.payment_frequency)
                        for item in active_debts
                    ),
                    start=Decimal("0"),
                ),
                investments=sum(
                    (item.current_value for item in active_investments),
                    start=Decimal("0"),
                ),
                goals=goals,
            )
            essential_monthly_expenses = (
                sum(
                    (
                        normalize_monthly(item.amount, item.frequency)
                        for item in essential_expenses
                    ),
                    start=Decimal("0"),
                )
                if essential_expenses
                else None
            )
            derived_metrics = calculate_financial_metrics(
                financial_twin,
                essential_monthly_expenses=essential_monthly_expenses,
            )

        return FinancialTwinRead(
            **records,
            financial_twin=financial_twin,
            derived_metrics=derived_metrics,
            unavailable_fields=unavailable_fields,
        )
