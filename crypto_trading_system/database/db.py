"""
Database connection and session management.
SQLite for development, PostgreSQL for production.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from database.models import Base

_DATABASE_URL = os.getenv("CTS_DATABASE_URL", "sqlite:///crypto_trading.db")

engine = create_engine(
    _DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    # SQLite needs check_same_thread=False for multi-threaded access
    connect_args={"check_same_thread": False} if _DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_db() -> None:
    """Create all tables if they don't exist."""
    Base.metadata.create_all(engine)


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Yield a transactional session; commit on success, rollback on error."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
