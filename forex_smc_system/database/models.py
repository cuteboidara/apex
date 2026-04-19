"""
SQLAlchemy 2.0 ORM models.

Tables:
  signals           — every generated signal (traded or not)
  trades            — every executed trade with MT5 ticket
  outcomes          — post-trade resolution (TP/SL hit tracking)
  daily_performance — daily aggregated P&L metrics
  backtest_runs     — walk-forward backtest results
  spread_history    — per-pair per-session spread tracking
  news_events       — cached economic calendar
"""

from __future__ import annotations

import datetime as dt
import enum
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
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


# ── Enums ─────────────────────────────────────────────────────────────

class Direction(str, enum.Enum):
    LONG = "LONG"
    SHORT = "SHORT"


class SignalStatus(str, enum.Enum):
    EMITTED = "EMITTED"
    TRADED = "TRADED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ExitReason(str, enum.Enum):
    TP1 = "TP1"
    TP2 = "TP2"
    TP3 = "TP3"
    SL = "SL"
    TRAILING = "TRAILING"
    MANUAL = "MANUAL"
    WEEKEND_CLOSE = "WEEKEND_CLOSE"
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


class NewsImpact(str, enum.Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


# ── Base ──────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


# ── Signal ────────────────────────────────────────────────────────────

class Signal(Base):
    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    pair: Mapped[str] = mapped_column(String(10), index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction))
    timeframe_entry: Mapped[str] = mapped_column(String(5))  # M5, M15

    entry_price: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    stop_loss: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    tp1: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    tp2: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    tp3: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    sl_pips: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    rr_ratio: Mapped[Decimal] = mapped_column(Numeric(6, 2))

    confluence_score: Mapped[Decimal] = mapped_column(Numeric(6, 2))
    confluence_grade: Mapped[str] = mapped_column(String(3))    # A+, A, B, C, D, F

    regime: Mapped[Regime] = mapped_column(Enum(Regime))
    htf_bias: Mapped[Direction] = mapped_column(Enum(Direction))
    session: Mapped[str] = mapped_column(String(20))            # LONDON, NEW_YORK, OVERLAP
    killzone: Mapped[str] = mapped_column(String(20))           # LONDON_OPEN, NY_OPEN, …

    spread_at_signal: Mapped[Decimal] = mapped_column(Numeric(8, 2))   # pips
    day_of_week: Mapped[int] = mapped_column(Integer)                   # 0=Mon … 4=Fri

    sweep_type: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # ASIAN_HIGH, PDH, …
    poi_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)    # H4_OB, H1_FVG, …

    status: Mapped[SignalStatus] = mapped_column(Enum(SignalStatus), default=SignalStatus.EMITTED)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # relationships
    trades: Mapped[list["Trade"]] = relationship(back_populates="signal")
    outcome: Mapped[Optional["Outcome"]] = relationship(back_populates="signal", uselist=False)


# ── Trade ─────────────────────────────────────────────────────────────

class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), index=True)
    ticket: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)   # MT5 order ticket

    timestamp_open: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    timestamp_close: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    pair: Mapped[str] = mapped_column(String(10), index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction))

    entry_price: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    exit_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    sl_price: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    tp_price: Mapped[Decimal] = mapped_column(Numeric(18, 6))

    lot_size: Mapped[Decimal] = mapped_column(Numeric(10, 4))

    realized_pnl: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 4), nullable=True)
    realized_pips: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    fees_spread: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))
    swap: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))

    exit_reason: Mapped[Optional[ExitReason]] = mapped_column(Enum(ExitReason), nullable=True)

    signal: Mapped["Signal"] = relationship(back_populates="trades")


# ── Outcome ───────────────────────────────────────────────────────────

class Outcome(Base):
    """
    Tracks what happened to every signal — whether actually traded or not.
    This is the gold dataset for improving the system over time.
    """
    __tablename__ = "outcomes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    signal_id: Mapped[int] = mapped_column(ForeignKey("signals.id"), unique=True, index=True)

    result: Mapped[OutcomeResult] = mapped_column(Enum(OutcomeResult), default=OutcomeResult.PENDING)

    tp1_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    tp1_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    tp2_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    tp2_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    tp3_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    tp3_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sl_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    sl_time: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    mfe_pips: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    mae_pips: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    realized_rr: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 4), nullable=True)

    signal: Mapped["Signal"] = relationship(back_populates="outcome")


# ── Daily Performance ─────────────────────────────────────────────────

class DailyPerformance(Base):
    __tablename__ = "daily_performance"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[dt.date] = mapped_column(Date, unique=True, index=True)

    total_signals: Mapped[int] = mapped_column(Integer, default=0)
    signals_traded: Mapped[int] = mapped_column(Integer, default=0)
    signals_rejected: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)

    gross_pnl: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0"))
    net_pnl: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=Decimal("0"))
    pips_won: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    pips_lost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    fees_paid: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))
    swap_paid: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))

    max_drawdown: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))
    equity_high: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("0"))
    equity_low: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("0"))

    regime_distribution: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    session_distribution: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


# ── Backtest Run ──────────────────────────────────────────────────────

class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    params: Mapped[dict] = mapped_column(JSON)

    train_start: Mapped[dt.date] = mapped_column(Date)
    train_end: Mapped[dt.date] = mapped_column(Date)
    test_start: Mapped[dt.date] = mapped_column(Date)
    test_end: Mapped[dt.date] = mapped_column(Date)
    is_oos: Mapped[bool] = mapped_column(Boolean, default=False)

    total_trades: Mapped[int] = mapped_column(Integer)
    win_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4))
    profit_factor: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    sharpe: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    sortino: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    max_drawdown: Mapped[Decimal] = mapped_column(Numeric(8, 4))
    expectancy_pips: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    net_pnl: Mapped[Decimal] = mapped_column(Numeric(14, 4))

    by_pair: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    by_session: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    by_regime: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    by_dow: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    monthly_pnl: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)


# ── Spread History ────────────────────────────────────────────────────

class SpreadHistory(Base):
    """Tracks observed spreads per pair per session for backtest accuracy."""
    __tablename__ = "spread_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    pair: Mapped[str] = mapped_column(String(10), index=True)
    session: Mapped[str] = mapped_column(String(20))
    spread_pips: Mapped[Decimal] = mapped_column(Numeric(8, 2))


# ── News Events ───────────────────────────────────────────────────────

class NewsEvent(Base):
    """Cached economic calendar events for news blackout logic."""
    __tablename__ = "news_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_time: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    currency: Mapped[str] = mapped_column(String(5))
    title: Mapped[str] = mapped_column(String(200))
    impact: Mapped[NewsImpact] = mapped_column(Enum(NewsImpact))
    actual: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    forecast: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    previous: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
