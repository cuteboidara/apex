"""
SQLAlchemy 2.0 models — signals, trades, outcomes, daily performance.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)

# ── Enums ────────────────────────────────────────────────────────────

import enum


class Direction(str, enum.Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class SignalStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    REJECTED = "REJECTED"


class ExitReason(str, enum.Enum):
    TP1 = "TP1"
    TP2 = "TP2"
    TP3 = "TP3"
    SL = "SL"
    TRAILING = "TRAILING"
    MANUAL = "MANUAL"
    EXPIRED = "EXPIRED"
    RISK_HALT = "RISK_HALT"


class Regime(str, enum.Enum):
    TRENDING = "TRENDING"
    RANGING = "RANGING"
    CHOPPY = "CHOPPY"
    UNKNOWN = "UNKNOWN"


class OutcomeResult(str, enum.Enum):
    TP1_HIT = "TP1_HIT"
    TP2_HIT = "TP2_HIT"
    TP3_HIT = "TP3_HIT"
    SL_HIT = "SL_HIT"
    EXPIRED = "EXPIRED"
    PENDING = "PENDING"


# ── Base ─────────────────────────────────────────────────────────────


class Base(DeclarativeBase):
    pass


# ── Signal ───────────────────────────────────────────────────────────


class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    pair: Mapped[str] = mapped_column(String(20), index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction))
    timeframe: Mapped[str] = mapped_column(String(5))

    entry_price: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    stop_loss: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    tp1: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    tp2: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    tp3: Mapped[Decimal] = mapped_column(Numeric(18, 8))

    confluence_score: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    confluence_grade: Mapped[str] = mapped_column(String(2))
    regime: Mapped[Regime] = mapped_column(Enum(Regime))
    htf_bias: Mapped[Direction] = mapped_column(Enum(Direction))
    session: Mapped[str] = mapped_column(String(20))

    sweep_volume_ratio: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4), nullable=True)
    ob_strength: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4), nullable=True)
    fvg_size: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 8), nullable=True)

    status: Mapped[SignalStatus] = mapped_column(Enum(SignalStatus), default=SignalStatus.PENDING)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # relationships
    trades: Mapped[list["Trade"]] = relationship(back_populates="signal")
    outcome: Mapped[Optional["Outcome"]] = relationship(back_populates="signal", uselist=False)


# ── Trade ────────────────────────────────────────────────────────────


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), index=True)
    timestamp_open: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    timestamp_close: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    pair: Mapped[str] = mapped_column(String(20), index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction))
    entry_price: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    exit_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 8), nullable=True)

    position_size: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    leverage: Mapped[int] = mapped_column(Integer)

    realized_pnl: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 8), nullable=True)
    fees: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    funding_paid: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))

    exit_reason: Mapped[Optional[ExitReason]] = mapped_column(Enum(ExitReason), nullable=True)

    signal: Mapped["Signal"] = relationship(back_populates="trades")


# ── Outcome (tracks what WOULD have happened, even for un-traded signals) ─


class Outcome(Base):
    __tablename__ = "outcomes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), unique=True, index=True)

    result: Mapped[OutcomeResult] = mapped_column(Enum(OutcomeResult), default=OutcomeResult.PENDING)

    tp1_hit: Mapped[bool] = mapped_column(default=False)
    tp1_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    tp2_hit: Mapped[bool] = mapped_column(default=False)
    tp2_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    tp3_hit: Mapped[bool] = mapped_column(default=False)
    tp3_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sl_hit: Mapped[bool] = mapped_column(default=False)
    sl_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    mfe: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 8), nullable=True)
    mae: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 8), nullable=True)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    realized_rr: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4), nullable=True)

    signal: Mapped["Signal"] = relationship(back_populates="outcome")


# ── Daily Performance ────────────────────────────────────────────────


class DailyPerformance(Base):
    __tablename__ = "daily_performance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[dt.date] = mapped_column(unique=True, index=True)

    total_trades: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)

    gross_pnl: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    net_pnl: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    fees_paid: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))

    max_drawdown: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    equity_high: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    equity_low: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))

    best_trade_pnl: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))
    worst_trade_pnl: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"))

    regime_distribution: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


# ── Backtest Run ─────────────────────────────────────────────────────


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    params: Mapped[dict] = mapped_column(JSON)
    train_start: Mapped[dt.date] = mapped_column()
    train_end: Mapped[dt.date] = mapped_column()
    test_start: Mapped[dt.date] = mapped_column()
    test_end: Mapped[dt.date] = mapped_column()

    total_trades: Mapped[int] = mapped_column(Integer)
    win_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4))
    profit_factor: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    sharpe: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    sortino: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    max_drawdown: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    expectancy: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    net_pnl: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    is_oos: Mapped[bool] = mapped_column(default=False)
