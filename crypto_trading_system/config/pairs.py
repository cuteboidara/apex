"""
Per-pair profiles.  Every pair can override global settings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class PairProfile:
    symbol: str
    min_confidence: Decimal = Decimal("0.60")
    min_rr: Decimal = Decimal("2.0")
    max_signals_per_day: int = 4
    cooldown_minutes: int = 60
    leverage: int = 10
    tick_size: Decimal = Decimal("0.01")
    qty_precision: int = 3
    # per-pair overrides for regime filter
    adx_trending_override: int | None = None
    tags: list[str] = field(default_factory=list)


ACTIVE_PAIRS: dict[str, PairProfile] = {
    "BTCUSDT": PairProfile(
        symbol="BTCUSDT",
        min_rr=Decimal("2.0"),
        max_signals_per_day=4,
        cooldown_minutes=60,
        leverage=10,
        tick_size=Decimal("0.10"),
        qty_precision=3,
        tags=["core"],
    ),
    "ETHUSDT": PairProfile(
        symbol="ETHUSDT",
        min_rr=Decimal("2.0"),
        max_signals_per_day=4,
        cooldown_minutes=60,
        leverage=10,
        tick_size=Decimal("0.01"),
        qty_precision=3,
        tags=["core"],
    ),
    "SOLUSDT": PairProfile(
        symbol="SOLUSDT",
        min_rr=Decimal("2.0"),
        max_signals_per_day=3,
        cooldown_minutes=75,
        leverage=10,
        tick_size=Decimal("0.01"),
        qty_precision=1,
        tags=["core"],
    ),
    "BNBUSDT": PairProfile(
        symbol="BNBUSDT",
        min_rr=Decimal("2.0"),
        max_signals_per_day=3,
        cooldown_minutes=75,
        leverage=10,
        tick_size=Decimal("0.01"),
        qty_precision=2,
        tags=["core"],
    ),
}

EXPANSION_PAIRS: dict[str, PairProfile] = {
    "XRPUSDT": PairProfile(symbol="XRPUSDT", tick_size=Decimal("0.0001"), qty_precision=1, tags=["phase2"]),
    "ADAUSDT": PairProfile(symbol="ADAUSDT", tick_size=Decimal("0.0001"), qty_precision=0, tags=["phase2"]),
    "AVAXUSDT": PairProfile(symbol="AVAXUSDT", tick_size=Decimal("0.01"), qty_precision=1, tags=["phase2"]),
    "DOGEUSDT": PairProfile(symbol="DOGEUSDT", tick_size=Decimal("0.00001"), qty_precision=0, tags=["phase2"]),
    "LINKUSDT": PairProfile(symbol="LINKUSDT", tick_size=Decimal("0.001"), qty_precision=1, tags=["phase2"]),
    "DOTUSDT": PairProfile(symbol="DOTUSDT", tick_size=Decimal("0.001"), qty_precision=1, tags=["phase2"]),
    "ATOMUSDT": PairProfile(symbol="ATOMUSDT", tick_size=Decimal("0.001"), qty_precision=1, tags=["phase2"]),
}
