from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.goal import Goal


class FinancialTwinState(BaseModel):
    """Authoritative, user-provided financial inputs only."""

    model_config = ConfigDict(
        alias_generator=lambda name: "".join(
            part.capitalize() if index else part
            for index, part in enumerate(name.split("_"))
        ),
        populate_by_name=True,
        extra="forbid",
        validate_assignment=True,
    )

    monthly_income: Decimal = Field(ge=0)
    monthly_expenses: Decimal = Field(ge=0)
    liquid_savings: Decimal = Field(ge=0)
    monthly_debt_payments: Decimal = Field(default=Decimal("0"), ge=0)
    investments: Decimal = Field(default=Decimal("0"), ge=0)
    goals: list[Goal] = Field(default_factory=list)

