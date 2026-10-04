from datetime import date
from decimal import Decimal
from enum import Enum

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class GoalStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    PAUSED = "paused"


class Goal(BaseModel):
    """A user-defined savings goal stored as raw Financial Twin input."""

    model_config = ConfigDict(
        alias_generator=lambda name: "".join(
            part.capitalize() if index else part
            for index, part in enumerate(name.split("_"))
        ),
        populate_by_name=True,
        extra="forbid",
    )

    name: str = Field(min_length=1)
    target_amount: Decimal = Field(ge=0)
    current_allocated_amount: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        validation_alias=AliasChoices(
            "currentAllocation", "currentAllocatedAmount", "current_allocated_amount"
        ),
        serialization_alias="currentAllocatedAmount",
    )
    target_date: date | None = None
    current_contribution: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        validation_alias=AliasChoices(
            "currentContribution",
            "monthlyContribution",
            "current_contribution",
            "monthly_contribution",
        ),
        serialization_alias="monthlyContribution",
    )
    funding_source: str | None = None
    return_assumption: Decimal = Field(
        default=Decimal("0"),
        ge=0,
        description=(
            "Explicit illustrative annual return assumption. The Goal Engine "
            "currently calculates deterministic projections with zero return."
        ),
    )
    priority: int = Field(ge=1)
    status: GoalStatus = GoalStatus.ACTIVE

    @property
    def current_allocation(self) -> Decimal:
        """Preferred concise name for the stored current allocation."""

        return self.current_allocated_amount

    @property
    def monthly_contribution(self) -> Decimal:
        """Backward-compatible alias for the former raw goal field."""

        return self.current_contribution

