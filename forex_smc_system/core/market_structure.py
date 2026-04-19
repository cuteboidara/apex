"""
Market structure detection.

  - Swing highs / swing lows (configurable lookback)
  - Break of Structure (BOS) — body close beyond swing, same direction as trend
  - Change of Character (CHoCH) — first BOS against prevailing trend
  - Internal (M15/M5) vs External (H4/H1) structure
  - Premium / Discount zone labelling
  - Protected highs / lows (the swing that would change trend if broken)

Bias is determined by structure breaks, NOT by arbitrary % thresholds.
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from config import settings
from core.data_feed import Candle

log = logging.getLogger(__name__)


# ── Enums ─────────────────────────────────────────────────────────────

class Bias(str, enum.Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"
    NEUTRAL = "NEUTRAL"


class SwingType(str, enum.Enum):
    HIGH = "HIGH"
    LOW = "LOW"


class BreakType(str, enum.Enum):
    BOS = "BOS"      # Continuation break
    CHOCH = "CHOCH"  # Character change / reversal


class StructureType(str, enum.Enum):
    INTERNAL = "INTERNAL"   # lower-TF swings
    EXTERNAL = "EXTERNAL"   # higher-TF swings


class PriceZone(str, enum.Enum):
    PREMIUM = "PREMIUM"       # above 60% of range
    EQUILIBRIUM = "EQUILIBRIUM"
    DISCOUNT = "DISCOUNT"     # below 40% of range


# ── Data classes ──────────────────────────────────────────────────────

@dataclass(slots=True)
class SwingPoint:
    index: int
    price: Decimal
    swing_type: SwingType
    timestamp: object  # dt.datetime

    def __repr__(self) -> str:
        return f"Swing({self.swing_type.value}@{float(self.price):.5f} idx={self.index})"


@dataclass(slots=True)
class StructureBreak:
    index: int
    break_type: BreakType
    direction: Bias        # resulting bias AFTER the break
    level: Decimal         # the swing price that was broken
    broken_swing: SwingPoint
    timestamp: object


@dataclass
class StructureState:
    """Complete structure analysis for a candle series."""
    swings: list[SwingPoint] = field(default_factory=list)
    breaks: list[StructureBreak] = field(default_factory=list)
    current_bias: Bias = Bias.NEUTRAL
    key_levels: list[SwingPoint] = field(default_factory=list)
    bias_series: list[Bias] = field(default_factory=list)
    protected_high: Optional[SwingPoint] = None
    protected_low: Optional[SwingPoint] = None
    premium_level: Optional[Decimal] = None   # 60% of range
    equilibrium: Optional[Decimal] = None     # 50% of range
    discount_level: Optional[Decimal] = None  # 40% of range


# ── Swing detection ───────────────────────────────────────────────────

def detect_swings(
    candles: list[Candle],
    lookback: Optional[int] = None,
) -> list[SwingPoint]:
    """
    Identify swing highs and swing lows.

    A swing high at index i requires candle[i].high to be strictly the
    highest high in the window [i-lb, i+lb].
    A swing low requires candle[i].low to be strictly the lowest low.
    """
    lb = lookback if lookback is not None else settings.get("swing_lookback")
    n = len(candles)
    if n < 2 * lb + 1:
        return []

    swings: list[SwingPoint] = []

    for i in range(lb, n - lb):
        # ── Swing high ──
        window_highs = [candles[j].high for j in range(i - lb, i + lb + 1) if j != i]
        if candles[i].high > max(window_highs):
            swings.append(SwingPoint(
                index=i,
                price=candles[i].high,
                swing_type=SwingType.HIGH,
                timestamp=candles[i].timestamp,
            ))

        # ── Swing low ──
        window_lows = [candles[j].low for j in range(i - lb, i + lb + 1) if j != i]
        if candles[i].low < min(window_lows):
            swings.append(SwingPoint(
                index=i,
                price=candles[i].low,
                swing_type=SwingType.LOW,
                timestamp=candles[i].timestamp,
            ))

    swings.sort(key=lambda s: s.index)
    return swings


# ── BOS / CHoCH detection ─────────────────────────────────────────────

def detect_structure_breaks(
    candles: list[Candle],
    swings: list[SwingPoint],
    require_body_close: Optional[bool] = None,
) -> list[StructureBreak]:
    """
    Scan for BOS and CHoCH events in a swing sequence.

    - BOS  : price closes beyond a swing in the direction of current bias
    - CHoCH: price closes beyond a swing AGAINST the current bias (first break)

    If require_body_close is True, the candle body (open/close) must breach
    the swing level — a wick alone is not sufficient.
    """
    if require_body_close is None:
        require_body_close = settings.get("bos_require_body_close")

    breaks: list[StructureBreak] = []
    if len(swings) < 2:
        return breaks

    current_bias = Bias.NEUTRAL
    prev_sh: Optional[SwingPoint] = None
    prev_sl: Optional[SwingPoint] = None

    # Process swings chronologically and look for candles that break them
    for swing in swings:
        if swing.swing_type == SwingType.HIGH:
            if prev_sh is not None:
                # Look for a candle AFTER prev_sh that breaks it
                search_end = min(swing.index, len(candles))
                for idx in range(prev_sh.index + 1, search_end):
                    c = candles[idx]
                    breach = c.close if require_body_close else c.high
                    if breach > prev_sh.price:
                        bt = (BreakType.BOS if current_bias == Bias.BULLISH
                              else BreakType.CHOCH)
                        new_bias = Bias.BULLISH
                        breaks.append(StructureBreak(
                            index=idx,
                            break_type=bt,
                            direction=new_bias,
                            level=prev_sh.price,
                            broken_swing=prev_sh,
                            timestamp=c.timestamp,
                        ))
                        current_bias = new_bias
                        break  # one break per swing
            prev_sh = swing

        else:  # SwingType.LOW
            if prev_sl is not None:
                search_end = min(swing.index, len(candles))
                for idx in range(prev_sl.index + 1, search_end):
                    c = candles[idx]
                    breach = c.close if require_body_close else c.low
                    if breach < prev_sl.price:
                        bt = (BreakType.BOS if current_bias == Bias.BEARISH
                              else BreakType.CHOCH)
                        new_bias = Bias.BEARISH
                        breaks.append(StructureBreak(
                            index=idx,
                            break_type=bt,
                            direction=new_bias,
                            level=prev_sl.price,
                            broken_swing=prev_sl,
                            timestamp=c.timestamp,
                        ))
                        current_bias = new_bias
                        break
            prev_sl = swing

    return breaks


# ── Premium / Discount calculation ───────────────────────────────────

def get_premium_discount(
    candles: list[Candle],
    lookback: int = 50,
) -> tuple[Decimal, Decimal, Decimal]:
    """
    Calculate premium (60%), equilibrium (50%), and discount (40%) levels
    based on the range of the last `lookback` candles.

    Returns: (premium_level, equilibrium, discount_level)
    """
    recent = candles[-lookback:] if len(candles) >= lookback else candles
    if not recent:
        return Decimal("0"), Decimal("0"), Decimal("0")
    range_high = max(c.high for c in recent)
    range_low = min(c.low for c in recent)
    rng = range_high - range_low
    eq = range_low + rng * Decimal("0.5")
    premium = range_low + rng * Decimal("0.6")
    discount = range_low + rng * Decimal("0.4")
    return premium, eq, discount


def classify_zone(price: Decimal, premium: Decimal, discount: Decimal) -> PriceZone:
    if price >= premium:
        return PriceZone.PREMIUM
    if price <= discount:
        return PriceZone.DISCOUNT
    return PriceZone.EQUILIBRIUM


# ── Protected highs / lows ────────────────────────────────────────────

def get_protected_levels(
    swings: list[SwingPoint],
    current_bias: Bias,
) -> tuple[Optional[SwingPoint], Optional[SwingPoint]]:
    """
    The 'protected' high is the most recent swing high that, if broken,
    would confirm a bullish BOS (for a bearish bias).
    Vice-versa for lows.

    Returns: (protected_high, protected_low)
    """
    highs = [s for s in swings if s.swing_type == SwingType.HIGH]
    lows = [s for s in swings if s.swing_type == SwingType.LOW]

    protected_high = highs[-1] if highs else None
    protected_low = lows[-1] if lows else None

    return protected_high, protected_low


# ── Full structure analysis ───────────────────────────────────────────

def analyze_structure(
    candles: list[Candle],
    lookback: Optional[int] = None,
    n_key_levels: int = 5,
) -> StructureState:
    """
    Run the full structure analysis pipeline on a candle series.

    Returns a StructureState with:
      - All swing points
      - All BOS / CHoCH events
      - Per-candle bias series
      - Key levels (most recent N highs + N lows)
      - Protected high / low
      - Premium / Equilibrium / Discount levels
    """
    swings = detect_swings(candles, lookback)
    breaks = detect_structure_breaks(candles, swings)

    # Build per-candle bias series (bias at each candle)
    bias_series: list[Bias] = []
    current = Bias.NEUTRAL
    brk_idx = 0
    for i in range(len(candles)):
        while brk_idx < len(breaks) and breaks[brk_idx].index <= i:
            current = breaks[brk_idx].direction
            brk_idx += 1
        bias_series.append(current)

    final_bias = bias_series[-1] if bias_series else Bias.NEUTRAL

    # Key levels — most recent N swing highs + N swing lows
    recent_highs = [s for s in swings if s.swing_type == SwingType.HIGH][-n_key_levels:]
    recent_lows = [s for s in swings if s.swing_type == SwingType.LOW][-n_key_levels:]
    key_levels = sorted(recent_highs + recent_lows, key=lambda s: s.index)

    protected_high, protected_low = get_protected_levels(swings, final_bias)
    premium, eq, discount = get_premium_discount(candles)

    return StructureState(
        swings=swings,
        breaks=breaks,
        current_bias=final_bias,
        key_levels=key_levels,
        bias_series=bias_series,
        protected_high=protected_high,
        protected_low=protected_low,
        premium_level=premium,
        equilibrium=eq,
        discount_level=discount,
    )


# ── HTF / LTF wrappers ────────────────────────────────────────────────

def get_current_bias(candles: list[Candle]) -> Bias:
    """Quick helper — return just the current bias for a candle series."""
    if len(candles) < 3:
        return Bias.NEUTRAL
    state = analyze_structure(candles)
    return state.current_bias
