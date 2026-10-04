from collections.abc import Generator
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_database_url


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    return create_engine(get_database_url(), pool_pre_ping=True)


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    try:
        factory = get_session_factory()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    with factory() as session:
        yield session
