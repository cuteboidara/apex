"""
Pair profiles — pip size, typical spread, session preferences,
correlation groups, and per-pair risk adjustments.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional


@dataclass(frozen=True, slots=True)
class PairProfile:
    symbol: str
    pip_size: Decimal               # e.g. 0.0001 for EURUSD, 0.01 for USDJPY
    pip_value_per_lot: Decimal      # USD per pip per standard lot at ~current rate
    typical_spread_london: Decimal  # pips during London
    typical_spread_asian: Decimal   # pips during Asian (wider)
    typical_spread_ny: Decimal      # pips during NY
    digits: int                     # decimal places (4 for most, 2 for JPY)
    min_lot: Decimal = Decimal("0.01")
    max_lot: Decimal = Decimal("100.0")
    lot_step: Decimal = Decimal("0.01")
    typical_atr_pips: Decimal = Decimal("80")  # daily ATR in pips (rough)
    preferred_sessions: list[str] = field(default_factory=lambda: ["LONDON", "NEW_YORK"])
    correlation_groups: list[str] = field(default_factory=list)
    notes: str = ""


# Active phase-1 pairs
ACTIVE_PAIRS: dict[str, PairProfile] = {
    "EURUSD": PairProfile(
        symbol="EURUSD",
        pip_size=Decimal("0.0001"),
        pip_value_per_lot=Decimal("10.00"),
        typical_spread_london=Decimal("0.1"),
        typical_spread_asian=Decimal("1.2"),
        typical_spread_ny=Decimal("0.2"),
        digits=5,
        typical_atr_pips=Decimal("80"),
        preferred_sessions=["LONDON", "NEW_YORK"],
        correlation_groups=["USD_WEAKNESS", "EUR_STRENGTH"],
    ),
    "GBPUSD": PairProfile(
        symbol="GBPUSD",
        pip_size=Decimal("0.0001"),
        pip_value_per_lot=Decimal("10.00"),
        typical_spread_london=Decimal("0.5"),
        typical_spread_asian=Decimal("2.0"),
        typical_spread_ny=Decimal("0.8"),
        digits=5,
        typical_atr_pips=Decimal("100"),
        preferred_sessions=["LONDON", "NEW_YORK"],
        correlation_groups=["USD_WEAKNESS"],
        notes="Volatile — great for SMC sweeps. Watch for BOE announcements.",
    ),
    "USDJPY": PairProfile(
        symbol="USDJPY",
        pip_size=Decimal("0.01"),
        pip_value_per_lot=Decimal("6.50"),    # approx at 155 rate
        typical_spread_london=Decimal("0.3"),
        typical_spread_asian=Decimal("0.8"),
        typical_spread_ny=Decimal("0.4"),
        digits=3,
        typical_atr_pips=Decimal("90"),
        preferred_sessions=["LONDON", "NEW_YORK", "TOKYO"],
        correlation_groups=["JPY_WEAKNESS"],
        notes="Strong trends, active in Tokyo session too.",
    ),
    "AUDUSD": PairProfile(
        symbol="AUDUSD",
        pip_size=Decimal("0.0001"),
        pip_value_per_lot=Decimal("10.00"),
        typical_spread_london=Decimal("0.5"),
        typical_spread_asian=Decimal("1.5"),
        typical_spread_ny=Decimal("0.7"),
        digits=5,
        typical_atr_pips=Decimal("70"),
        preferred_sessions=["LONDON", "NEW_YORK"],
        correlation_groups=["USD_WEAKNESS"],
        notes="Clean technical pair, correlated with commodities.",
    ),
}

# Phase-2 expansion pairs
EXPANSION_PAIRS: dict[str, PairProfile] = {
    "USDCHF": PairProfile(
        symbol="USDCHF",
        pip_size=Decimal("0.0001"),
        pip_value_per_lot=Decimal("10.00"),  # approx
        typical_spread_london=Decimal("0.8"),
        typical_spread_asian=Decimal("2.5"),
        typical_spread_ny=Decimal("1.0"),
        digits=5,
        correlation_groups=["EUR_STRENGTH"],
        notes="Inversely correlated to EURUSD.",
    ),
    "USDCAD": PairProfile(
        symbol="USDCAD",
        pip_size=Decimal("0.0001"),
        pip_value_per_lot=Decimal("7.50"),   # approx at 1.35
        typical_spread_london=Decimal("1.0"),
        typical_spread_asian=Decimal("3.0"),
        typical_spread_ny=Decimal("1.2"),
        digits=5,
        correlation_groups=["USD_WEAKNESS"],
    ),
    "NZDUSD": PairProfile(
        symbol="NZDUSD",
        pip_size=Decimal("0.0001"),
        pip_value_per_lot=Decimal("10.00"),
        typical_spread_london=Decimal("1.0"),
        typical_spread_asian=Decimal("2.5"),
        typical_spread_ny=Decimal("1.2"),
        digits=5,
        correlation_groups=["USD_WEAKNESS"],
    ),
    "EURJPY": PairProfile(
        symbol="EURJPY",
        pip_size=Decimal("0.01"),
        pip_value_per_lot=Decimal("6.50"),
        typical_spread_london=Decimal("0.8"),
        typical_spread_asian=Decimal("2.0"),
        typical_spread_ny=Decimal("1.0"),
        digits=3,
        correlation_groups=["JPY_WEAKNESS", "EUR_STRENGTH"],
    ),
    "GBPJPY": PairProfile(
        symbol="GBPJPY",
        pip_size=Decimal("0.01"),
        pip_value_per_lot=Decimal("6.50"),
        typical_spread_london=Decimal("1.5"),
        typical_spread_asian=Decimal("4.0"),
        typical_spread_ny=Decimal("2.0"),
        digits=3,
        typical_atr_pips=Decimal("150"),
        correlation_groups=["JPY_WEAKNESS"],
        notes="Most volatile major cross — high RR but wide stops. Phase 2 only.",
    ),
    "EURGBP": PairProfile(
        symbol="EURGBP",
        pip_size=Decimal("0.0001"),
        pip_value_per_lot=Decimal("10.00"),
        typical_spread_london=Decimal("0.8"),
        typical_spread_asian=Decimal("2.5"),
        typical_spread_ny=Decimal("1.0"),
        digits=5,
        correlation_groups=["EUR_STRENGTH"],
        notes="Low volatility, range-bound — good for ranging regime.",
    ),
}

# Correlation groups — max 2 positions per group
CORRELATION_GROUPS: dict[str, list[str]] = {
    "USD_WEAKNESS": ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD"],
    "JPY_WEAKNESS": ["USDJPY", "EURJPY", "GBPJPY"],
    "EUR_STRENGTH": ["EURUSD", "EURJPY", "EURGBP", "USDCHF"],
}


def get_pair(symbol: str) -> Optional[PairProfile]:
    """Return a pair profile from active or expansion pairs."""
    return ACTIVE_PAIRS.get(symbol) or EXPANSION_PAIRS.get(symbol)


def pip_value(symbol: str, lot_size: Decimal, account_currency: str = "USD") -> Decimal:
    """
    Rough pip value in account currency for a given lot size.
    Uses stored pip_value_per_lot (per standard lot) as a baseline.
    For production, call MT5 to get the exact current rate.
    """
    profile = get_pair(symbol)
    if profile is None:
        raise ValueError(f"Unknown symbol: {symbol}")
    return profile.pip_value_per_lot * lot_size
