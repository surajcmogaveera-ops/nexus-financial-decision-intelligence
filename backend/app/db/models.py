from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class IdentityMixin:
    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class User(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "users"

    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), unique=True)

    financial_profile: Mapped[FinancialProfile | None] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class FinancialProfile(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "financial_profiles"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    display_name: Mapped[str | None] = mapped_column(String(200))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    profile_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    user: Mapped[User] = relationship(back_populates="financial_profile")
    income_sources: Mapped[list[IncomeSource]] = relationship(
        back_populates="financial_profile", cascade="all, delete-orphan"
    )
    expenses: Mapped[list[Expense]] = relationship(
        back_populates="financial_profile", cascade="all, delete-orphan"
    )
    debts: Mapped[list[Debt]] = relationship(
        back_populates="financial_profile", cascade="all, delete-orphan"
    )
    assets: Mapped[list[Asset]] = relationship(
        back_populates="financial_profile", cascade="all, delete-orphan"
    )
    investments: Mapped[list[Investment]] = relationship(
        back_populates="financial_profile", cascade="all, delete-orphan"
    )
    goals: Mapped[list[GoalRecord]] = relationship(
        back_populates="financial_profile", cascade="all, delete-orphan"
    )
    scenarios: Mapped[list[Scenario]] = relationship(
        back_populates="financial_profile", cascade="all, delete-orphan"
    )


class IncomeSource(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "income_sources"
    __table_args__ = (CheckConstraint("amount >= 0", name="amount_nonnegative"),)

    financial_profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("financial_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    financial_profile: Mapped[FinancialProfile] = relationship(back_populates="income_sources")


class Expense(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (CheckConstraint("amount >= 0", name="amount_nonnegative"),)

    financial_profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("financial_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")
    is_essential: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    financial_profile: Mapped[FinancialProfile] = relationship(back_populates="expenses")


class Debt(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "debts"
    __table_args__ = (
        CheckConstraint("principal_amount >= 0", name="principal_nonnegative"),
        CheckConstraint("payment_amount >= 0", name="payment_nonnegative"),
        CheckConstraint(
            "interest_rate IS NULL OR interest_rate >= 0", name="interest_nonnegative"
        ),
    )

    financial_profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("financial_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    principal_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    payment_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    payment_frequency: Mapped[str] = mapped_column(
        String(20), nullable=False, default="monthly"
    )
    interest_rate: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    financial_profile: Mapped[FinancialProfile] = relationship(back_populates="debts")


class Asset(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "assets"
    __table_args__ = (CheckConstraint("current_value >= 0", name="value_nonnegative"),)

    financial_profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("financial_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(100), nullable=False)
    current_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    is_liquid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    financial_profile: Mapped[FinancialProfile] = relationship(back_populates="assets")


class Investment(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "investments"
    __table_args__ = (
        CheckConstraint("current_value >= 0", name="value_nonnegative"),
        CheckConstraint(
            "monthly_contribution IS NULL OR monthly_contribution >= 0",
            name="contribution_nonnegative",
        ),
    )

    financial_profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("financial_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    investment_type: Mapped[str] = mapped_column(String(100), nullable=False)
    current_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    monthly_contribution: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    is_liquid: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    financial_profile: Mapped[FinancialProfile] = relationship(back_populates="investments")


class GoalRecord(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "goals"
    __table_args__ = (
        CheckConstraint("target_amount >= 0", name="target_nonnegative"),
        CheckConstraint("current_allocated_amount >= 0", name="allocation_nonnegative"),
        CheckConstraint("current_contribution >= 0", name="contribution_nonnegative"),
        CheckConstraint("return_assumption >= 0", name="return_nonnegative"),
        CheckConstraint("priority >= 1", name="priority_positive"),
    )

    financial_profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("financial_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    target_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    current_allocated_amount: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, default=Decimal("0")
    )
    target_date: Mapped[date | None] = mapped_column(Date)
    current_contribution: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), nullable=False, default=Decimal("0")
    )
    funding_source: Mapped[str | None] = mapped_column(String(200))
    return_assumption: Mapped[Decimal] = mapped_column(
        Numeric(12, 8), nullable=False, default=Decimal("0")
    )
    priority: Mapped[int] = mapped_column(nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    financial_profile: Mapped[FinancialProfile] = relationship(back_populates="goals")


class Scenario(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "scenarios"

    financial_profile_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("financial_profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    scenario_type: Mapped[str] = mapped_column(String(100), nullable=False)
    input_changes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    financial_profile: Mapped[FinancialProfile] = relationship(back_populates="scenarios")
    results: Mapped[list[ScenarioResult]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan"
    )


class ScenarioResult(IdentityMixin, TimestampMixin, Base):
    __tablename__ = "scenario_results"

    scenario_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("scenarios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    baseline_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    scenario_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    derived_results: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    delta_data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    goal_impact: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    risk_flags: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    evidence_references: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)

    scenario: Mapped[Scenario] = relationship(back_populates="results")
