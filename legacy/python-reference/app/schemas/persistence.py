from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.engine.financial_metrics import FinancialTwinMetrics
from app.models.financial_twin import FinancialTwinState
from app.models.goal import Goal, GoalStatus


def to_camel(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class Frequency(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUALLY = "annually"


class UserCreate(ApiModel):
    display_name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=320)


class UserRead(UserCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime


class FinancialProfileCreate(ApiModel):
    user_id: UUID
    display_name: str | None = Field(default=None, max_length=200)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    profile_metadata: dict[str, Any] = Field(default_factory=dict)


class FinancialProfileRead(FinancialProfileCreate):
    id: UUID
    created_at: datetime
    updated_at: datetime


class IncomeSourceCreate(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(ge=0)
    frequency: Frequency = Frequency.MONTHLY
    is_active: bool = True


class IncomeSourceRead(IncomeSourceCreate):
    id: UUID
    financial_profile_id: UUID
    created_at: datetime
    updated_at: datetime


class ExpenseCreate(ApiModel):
    category: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(ge=0)
    frequency: Frequency = Frequency.MONTHLY
    essential: bool = False
    is_active: bool = True


class ExpenseRead(ApiModel):
    id: UUID
    financial_profile_id: UUID
    category: str
    name: str
    amount: Decimal
    frequency: Frequency
    essential: bool = Field(validation_alias="is_essential")
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DebtCreate(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    principal_amount: Decimal = Field(ge=0)
    payment_amount: Decimal = Field(ge=0)
    payment_frequency: Frequency = Frequency.MONTHLY
    interest_rate: Decimal | None = Field(default=None, ge=0)
    is_active: bool = True


class DebtRead(DebtCreate):
    id: UUID
    financial_profile_id: UUID
    created_at: datetime
    updated_at: datetime


class AssetCreate(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    asset_type: str = Field(min_length=1, max_length=100)
    current_value: Decimal = Field(ge=0)
    liquid: bool = False


class AssetRead(ApiModel):
    id: UUID
    financial_profile_id: UUID
    name: str
    asset_type: str
    current_value: Decimal
    liquid: bool = Field(validation_alias="is_liquid")
    created_at: datetime
    updated_at: datetime


class InvestmentCreate(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    investment_type: str = Field(min_length=1, max_length=100)
    current_value: Decimal = Field(ge=0)
    monthly_contribution: Decimal | None = Field(default=None, ge=0)
    liquid: bool = False


class InvestmentRead(ApiModel):
    id: UUID
    financial_profile_id: UUID
    name: str
    investment_type: str
    current_value: Decimal
    monthly_contribution: Decimal | None
    liquid: bool = Field(validation_alias="is_liquid")
    created_at: datetime
    updated_at: datetime


class GoalRead(ApiModel):
    id: UUID
    financial_profile_id: UUID
    name: str
    target_amount: Decimal
    current_allocated_amount: Decimal
    target_date: date | None
    current_contribution: Decimal
    funding_source: str | None
    return_assumption: Decimal
    priority: int
    status: GoalStatus
    created_at: datetime
    updated_at: datetime


class FinancialTwinRead(ApiModel):
    profile: FinancialProfileRead
    income_sources: list[IncomeSourceRead]
    expenses: list[ExpenseRead]
    debts: list[DebtRead]
    assets: list[AssetRead]
    investments: list[InvestmentRead]
    goals: list[GoalRead]
    financial_twin: FinancialTwinState | None
    derived_metrics: FinancialTwinMetrics | None
    unavailable_fields: list[str]


__all__ = [
    "ApiModel",
    "AssetCreate",
    "AssetRead",
    "DebtCreate",
    "DebtRead",
    "ExpenseCreate",
    "ExpenseRead",
    "FinancialProfileCreate",
    "FinancialProfileRead",
    "FinancialTwinRead",
    "Frequency",
    "Goal",
    "GoalRead",
    "IncomeSourceCreate",
    "IncomeSourceRead",
    "InvestmentCreate",
    "InvestmentRead",
    "UserCreate",
    "UserRead",
]
