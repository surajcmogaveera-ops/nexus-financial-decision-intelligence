from collections.abc import Callable
from typing import TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.goal import Goal
from app.repositories.financial_twin_repository import FinancialTwinRepository
from app.schemas.persistence import (
    AssetCreate,
    AssetRead,
    DebtCreate,
    DebtRead,
    ExpenseCreate,
    ExpenseRead,
    FinancialProfileCreate,
    FinancialProfileRead,
    FinancialTwinRead,
    GoalRead,
    IncomeSourceCreate,
    IncomeSourceRead,
    InvestmentCreate,
    InvestmentRead,
    UserCreate,
    UserRead,
)
from app.services.financial_twin_service import FinancialTwinService

router = APIRouter(prefix="/api", tags=["financial data"])
T = TypeVar("T")


def _persist(operation: Callable[[], T]) -> T:
    try:
        return operation()
    except LookupError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except IntegrityError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The record conflicts with existing financial data",
        ) from error


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(values: UserCreate, db: Session = Depends(get_db)):
    return _persist(lambda: FinancialTwinRepository(db).create_user(values))


@router.post(
    "/financial-profiles",
    response_model=FinancialProfileRead,
    status_code=status.HTTP_201_CREATED,
)
def create_financial_profile(
    values: FinancialProfileCreate, db: Session = Depends(get_db)
):
    return _persist(
        lambda: FinancialTwinRepository(db).create_financial_profile(values)
    )


@router.post(
    "/financial-profiles/{profile_id}/income",
    response_model=IncomeSourceRead,
    status_code=status.HTTP_201_CREATED,
)
def add_income(
    profile_id: UUID, values: IncomeSourceCreate, db: Session = Depends(get_db)
):
    return _persist(lambda: FinancialTwinRepository(db).add_income(profile_id, values))


@router.post(
    "/financial-profiles/{profile_id}/expenses",
    response_model=ExpenseRead,
    status_code=status.HTTP_201_CREATED,
)
def add_expense(
    profile_id: UUID, values: ExpenseCreate, db: Session = Depends(get_db)
):
    return _persist(lambda: FinancialTwinRepository(db).add_expense(profile_id, values))


@router.post(
    "/financial-profiles/{profile_id}/debts",
    response_model=DebtRead,
    status_code=status.HTTP_201_CREATED,
)
def add_debt(profile_id: UUID, values: DebtCreate, db: Session = Depends(get_db)):
    return _persist(lambda: FinancialTwinRepository(db).add_debt(profile_id, values))


@router.post(
    "/financial-profiles/{profile_id}/assets",
    response_model=AssetRead,
    status_code=status.HTTP_201_CREATED,
)
def add_asset(profile_id: UUID, values: AssetCreate, db: Session = Depends(get_db)):
    return _persist(lambda: FinancialTwinRepository(db).add_asset(profile_id, values))


@router.post(
    "/financial-profiles/{profile_id}/investments",
    response_model=InvestmentRead,
    status_code=status.HTTP_201_CREATED,
)
def add_investment(
    profile_id: UUID, values: InvestmentCreate, db: Session = Depends(get_db)
):
    return _persist(
        lambda: FinancialTwinRepository(db).add_investment(profile_id, values)
    )


@router.post(
    "/financial-profiles/{profile_id}/goals",
    response_model=GoalRead,
    status_code=status.HTTP_201_CREATED,
)
def add_goal(profile_id: UUID, values: Goal, db: Session = Depends(get_db)):
    return _persist(lambda: FinancialTwinRepository(db).add_goal(profile_id, values))


@router.get(
    "/financial-profiles/{profile_id}/financial-twin",
    response_model=FinancialTwinRead,
)
def get_financial_twin(profile_id: UUID, db: Session = Depends(get_db)):
    result = FinancialTwinService(db).get_financial_twin(profile_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Financial profile not found")
    return result
