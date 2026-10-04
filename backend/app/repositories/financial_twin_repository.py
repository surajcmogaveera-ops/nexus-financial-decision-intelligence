from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.models import (
    Asset,
    Debt,
    Expense,
    FinancialProfile,
    GoalRecord,
    IncomeSource,
    Investment,
    User,
)
from app.models.goal import Goal
from app.schemas.persistence import (
    AssetCreate,
    DebtCreate,
    ExpenseCreate,
    FinancialProfileCreate,
    IncomeSourceCreate,
    InvestmentCreate,
    UserCreate,
)


class FinancialTwinRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def _save(self, record):
        try:
            self.session.add(record)
            self.session.commit()
            self.session.refresh(record)
        except IntegrityError:
            self.session.rollback()
            raise
        return record

    def _require_profile(self, profile_id: UUID) -> None:
        if self.session.get(FinancialProfile, profile_id) is None:
            raise LookupError("Financial profile not found")

    def create_user(self, values: UserCreate) -> User:
        return self._save(User(**values.model_dump()))

    def get_user(self, user_id: UUID) -> User | None:
        return self.session.get(User, user_id)

    def create_financial_profile(self, values: FinancialProfileCreate) -> FinancialProfile:
        if self.get_user(values.user_id) is None:
            raise LookupError("User not found")
        return self._save(FinancialProfile(**values.model_dump()))

    def get_financial_profile(self, profile_id: UUID) -> FinancialProfile | None:
        return self.session.get(FinancialProfile, profile_id)

    def add_income(self, profile_id: UUID, values: IncomeSourceCreate) -> IncomeSource:
        self._require_profile(profile_id)
        payload = values.model_dump()
        payload["frequency"] = values.frequency.value
        return self._save(
            IncomeSource(
                financial_profile_id=profile_id,
                **payload,
            )
        )

    def add_expense(self, profile_id: UUID, values: ExpenseCreate) -> Expense:
        self._require_profile(profile_id)
        return self._save(
            Expense(
                financial_profile_id=profile_id,
                category=values.category,
                name=values.name,
                amount=values.amount,
                frequency=values.frequency.value,
                is_essential=values.essential,
                is_active=values.is_active,
            )
        )

    def add_debt(self, profile_id: UUID, values: DebtCreate) -> Debt:
        self._require_profile(profile_id)
        payload = values.model_dump()
        payload["payment_frequency"] = values.payment_frequency.value
        return self._save(Debt(financial_profile_id=profile_id, **payload))

    def add_asset(self, profile_id: UUID, values: AssetCreate) -> Asset:
        self._require_profile(profile_id)
        return self._save(
            Asset(
                financial_profile_id=profile_id,
                name=values.name,
                asset_type=values.asset_type,
                current_value=values.current_value,
                is_liquid=values.liquid,
            )
        )

    def add_investment(self, profile_id: UUID, values: InvestmentCreate) -> Investment:
        self._require_profile(profile_id)
        return self._save(
            Investment(
                financial_profile_id=profile_id,
                name=values.name,
                investment_type=values.investment_type,
                current_value=values.current_value,
                monthly_contribution=values.monthly_contribution,
                is_liquid=values.liquid,
            )
        )

    def add_goal(self, profile_id: UUID, goal: Goal) -> GoalRecord:
        self._require_profile(profile_id)
        return self._save(
            GoalRecord(
                financial_profile_id=profile_id,
                name=goal.name,
                target_amount=goal.target_amount,
                current_allocated_amount=goal.current_allocated_amount,
                target_date=goal.target_date,
                current_contribution=goal.current_contribution,
                funding_source=goal.funding_source,
                return_assumption=goal.return_assumption,
                priority=goal.priority,
                status=goal.status.value,
            )
        )

    def get_financial_twin_records(self, profile_id: UUID) -> dict | None:
        statement = (
            select(FinancialProfile)
            .where(FinancialProfile.id == profile_id)
            .options(
                selectinload(FinancialProfile.income_sources),
                selectinload(FinancialProfile.expenses),
                selectinload(FinancialProfile.debts),
                selectinload(FinancialProfile.assets),
                selectinload(FinancialProfile.investments),
                selectinload(FinancialProfile.goals),
            )
        )
        profile = self.session.scalar(statement)
        if profile is None:
            return None

        def ordered(records: list) -> list:
            return sorted(records, key=lambda record: (record.created_at, str(record.id)))

        return {
            "profile": profile,
            "income_sources": ordered(profile.income_sources),
            "expenses": ordered(profile.expenses),
            "debts": ordered(profile.debts),
            "assets": ordered(profile.assets),
            "investments": ordered(profile.investments),
            "goals": ordered(profile.goals),
        }
