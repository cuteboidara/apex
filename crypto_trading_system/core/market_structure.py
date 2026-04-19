"""
Market structure detection — swing points, BOS, CHoCH, bias tracking.

All bias is determined by structure breaks, not arbitrary % thresholds.
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


# ── Types ────────────────────────────────────────────────────────────


class Bias(str, enum.Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"
    NEUTRAL = "NEUTRAL"


class SwingType(str, enum.Enum):
    HIGH = "HIGH"
    LOW = "LOW"


class BreakType(str, enum.Enum):
    BOS = "BOS"     # Break of Structure — continuation
    CHOCH = "CHOCH"  # Change of Character — reversal


@dataclass(slots=True)
class SwingPoint:
    index: int
    price: Decimal
    swing_type: SwingType
    timestamp: object  # dt.datetime

    def __repr__(self) -> str:
        return f"Swing({self.swing_type.value}@{self.price}, idx={self.index})"


@dataclass(slots=True)
class StructureBreak:
    index: int
    break_type: BreakType
    direction: Bias  # resulting bias after break
    level: Decimal  # the swing level that was broken
    timestamp: object


@dataclass(slots=True)
class StructureState:
    """Complete structure analysis output for a candle series."""
    swings: list[SwingPoint] = field(default_factory=list)
    breaks: list[StructureBreak] = field(default_factory=list)
    current_bias: Bias = Bias.NEUTRAL
    key_levels: list[SwingPoint] = field(default_factory=list)
    # per-candle bias tags (same length as input candles)
    bias_series: list[Bias] = field(default_factory=list)


# ── Swing detection ──────────────────────────────────────────────────


def detect_swings(candles: list[Candle], lookback: int | None = None) -> list[SwingPoint]:
    """
    Detect swing highs and lows.

    A swing high at index i requires candle[i].high to be the highest
    high in the window [i-lookback, i+lookback].  Same logic inverted
    for swing lows.
    """
    lb = lookback or settings.get("swing_lookback")
    swings: list[SwingPoint] = []
    n = len(candles)
    if n < 2 * lb + 1:
        return swings

    for i in range(lb, n - lb):
        # swing high
        is_sh = True
        for j in range(i - lb, i + lb + 1):
            if j == i:
                continue
            if candles[j].high >= candles[i].high:
                is_sh = False
                break
        if is_sh:
            swings.append(SwingPoint(
                index=i,
                price=candles[i].high,
                swing_type=SwingType.HIGH,
                timestamp=candles[i].timestamp,
            ))

        # swing low
        is_sl = True
        for j in range(i - lb, i + lb + 1):
            if j == i:
                continue
            if candles[j].low <= candles[i].low:
                is_sl = False
                break
        if is_sl:
            swings.append(SwingPoint(
                index=i,
                price=candles[i].low,
                swing_type=SwingType.LOW,
                timestamp=candles[i].timestamp,
            ))

    swings.sort(key=lambda s: s.index)
    return swings


# ── Structure breaks (BOS / CHoCH) ──────────────────────────────────


def detect_structure_breaks(
    candles: list[Candle],
    swings: list[SwingPoint],
    require_body_close: bool | None = None,
) -> list[StructureBreak]:
    """
    Detect BOS and CHoCH from a sequence of swings.

    BOS  = price breaks a swing in the SAME direction as prevailing bias
           (continuation).
    CHoCH = price breaks a swing AGAINST the prevailing bias (first reversal
           break).

    If require_body_close is True, the break must be a body close beyond
    the swing level, not just a wick.
    """
    if require_body_close is None:
        require_body_close = settings.get("bos_require_body_close")

    breaks: list[StructureBreak] = []
    if len(swings) < 3:
        return breaks

    # Track the most recent significant swing high and low
    last_sh: Optional[SwingPoint] = None
    last_sl: Optional[SwingPoint] = None
    current_bias = Bias.NEUTRAL

    for swing in swings:
        if swing.swing_type == SwingType.HIGH:
            # Check if this new high breaks the previous swing high
            if last_sh is not None:
                # Find candles between previous SH and this one that break it
                for idx in range(last_sh.index + 1, min(swing.index + 1, len(candles))):
                    c = candles[idx]
                    broken_price = last_sh.price
                    price_to_check = c.close if require_body_close else c.high

                    if price_to_check > broken_price:
                        if current_bias == Bias.BULLISH or current_bias == Bias.NEUTRAL:
                            bt = BreakType.BOS
                            new_bias = Bias.BULLISH
                        else:
                            bt = BreakType.CHOCH
                            new_bias = Bias.BULLISH

                        breaks.append(StructureBreak(
                            index=idx,
                            break_type=bt,
                            direction=new_bias,
                            level=broken_price,
                            timestamp=c.timestamp,
                        ))
                        current_bias = new_bias
                        break  # only record first break per swing

            last_sh = swing

        elif swing.swing_type == SwingType.LOW:
            if last_sl is not None:
                for idx in range(last_sl.index + 1, min(swing.index + 1, len(candles))):
                    c = candles[idx]
                    broken_price = last_sl.price
                    price_to_check = c.close if require_body_close else c.low

                    if price_to_check < broken_price:
                        if current_bias == Bias.BEARISH or current_bias == Bias.NEUTRAL:
                            bt = BreakType.BOS
                            new_bias = Bias.BEARISH
                        else:
                            bt = BreakType.CHOCH
                            new_bias = Bias.BEARISH

                        breaks.append(StructureBreak(
                            index=idx,
                            break_type=bt,
                            direction=new_bias,
                            level=broken_price,
                            timestamp=c.timestamp,
                        ))
                        current_bias = new_bias
                        break

            last_sl = swing

    return breaks


# ── Full structure analysis ──────────────────────────────────────────


def analyze_structure(candles: list[Candle], lookback: int | None = None) -> StructureState:
    """Run full structure analysis: swings → breaks → bias series."""
    swings = detect_swings(candles, lookback)
    breaks = detect_structure_breaks(candles, swings)

    # Build per-candle bias series
    bias_series: list[Bias] = []
    current = Bias.NEUTRAL
    break_idx = 0
    for i in range(len(candles)):
        while break_idx < len(breaks) and breaks[break_idx].index <= i:
            current = breaks[break_idx].direction
            break_idx += 1
        bias_series.append(current)

    # Key levels: the most recent N swing highs/lows
    recent_highs = [s for s in swings if s.swing_type == SwingType.HIGH][-5:]
    recent_lows = [s for s in swings if s.swing_type == SwingType.LOW][-5:]
    key_levels = sorted(recent_highs + recent_lows, key=lambda s: s.index)

    final_bias = bias_series[-1] if bias_series else Bias.NEUTRAL

    return StructureState(
        swings=swings,
        breaks=breaks,
        current_bias=final_bias,
        key_levels=key_levels,
        bias_series=bias_series,
    )
