"""
Order block, Fair Value Gap, and Breaker Block detection.

Order Block rules:
  - Bullish OB: last BEARISH candle immediately before a bullish BOS impulse
  - Bearish OB: last BULLISH candle immediately before a bearish BOS impulse
  - OB must precede a BOS — not just any move
  - OB strength = impulse range / OB candle range (must exceed threshold)

FVG (Fair Value Gap / Imbalance):
  - Bullish: candle[i-1].high < candle[i+1].low — gap between candle i-1 high and candle i+1 low
  - Bearish: candle[i-1].low > candle[i+1].high
  - Minimum size: configurable % of ATR (reject tiny FVGs)

Breaker Blocks:
  - An OB that gets violated (price closes through it)
  - Flips polarity: bullish OB becomes resistance, bearish OB becomes support

Mitigation tracking:
  - Fresh OB: price has not returned to it since creation
  - 1-touch OB: partially mitigated — still valid
  - Mitigated: price has fully returned — significantly weaker

Refined entry within OB:
  - Premium entry: top of OB (for bullish OB)
  - Equilibrium entry: 50% of OB (ideal)
  - Discount entry: bottom of OB (widest stop)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional

from config import settings
from core.data_feed import Candle
from core.market_structure import StructureBreak, BreakType, Bias

log = logging.getLogger(__name__)


# ── Enums ─────────────────────────────────────────────────────────────

class OBType(str, Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"


class MitigationStatus(str, Enum):
    FRESH = "FRESH"
    TOUCHED = "TOUCHED"     # 1 partial mitigation
    MITIGATED = "MITIGATED"  # fully returned to — weaker
    BROKEN = "BROKEN"       # becomes breaker block


class FVGType(str, Enum):
    BULLISH = "BULLISH"  # gap to be filled on pullback (support)
    BEARISH = "BEARISH"  # gap to be filled on pullback (resistance)


# ── Data classes ──────────────────────────────────────────────────────

@dataclass
class OrderBlock:
    index: int
    ob_type: OBType
    ob_high: Decimal      # top of OB candle
    ob_low: Decimal       # bottom of OB candle
    ob_open: Decimal
    ob_close: Decimal
    strength: Decimal     # impulse_range / ob_range — higher = stronger
    mitigation: MitigationStatus = MitigationStatus.FRESH
    mitigation_touches: int = 0
    bos_index: int = 0    # index of the BOS that validated this OB
    timestamp: object = None

    @property
    def equilibrium(self) -> Decimal:
        """50% level of the OB — ideal entry."""
        return (self.ob_high + self.ob_low) / 2

    @property
    def premium_entry(self) -> Decimal:
        """For bullish OB: top (worst entry but tightest stop)."""
        return self.ob_high if self.ob_type == OBType.BULLISH else self.ob_low

    @property
    def discount_entry(self) -> Decimal:
        """For bullish OB: bottom (best entry, widest stop)."""
        return self.ob_low if self.ob_type == OBType.BULLISH else self.ob_high

    def is_price_in_ob(self, price: Decimal) -> bool:
        return self.ob_low <= price <= self.ob_high

    def is_valid(self, max_touches: Optional[int] = None) -> bool:
        max_t = max_touches if max_touches is not None else settings.get("ob_max_mitigation_touches")
        return (
            self.mitigation != MitigationStatus.BROKEN
            and self.mitigation != MitigationStatus.MITIGATED
            and self.mitigation_touches <= max_t
        )


@dataclass(slots=True)
class FVG:
    index: int            # middle candle index
    fvg_type: FVGType
    top: Decimal          # upper boundary of gap
    bottom: Decimal       # lower boundary of gap
    size: Decimal         # top - bottom
    mitigated: bool = False
    timestamp: object = None

    def is_price_in_fvg(self, price: Decimal) -> bool:
        return self.bottom <= price <= self.top

    @property
    def midpoint(self) -> Decimal:
        return (self.top + self.bottom) / 2


@dataclass(slots=True)
class BreakerBlock:
    original_ob: OrderBlock
    breaker_type: OBType   # flipped: original bullish OB → bearish breaker
    level_high: Decimal
    level_low: Decimal
    timestamp: object

    def is_price_in_breaker(self, price: Decimal) -> bool:
        return self.level_low <= price <= self.level_high


# ── ATR calculation ───────────────────────────────────────────────────

def _calc_atr(candles: list[Candle], period: Optional[int] = None) -> Decimal:
    p = period or settings.get("atr_period")
    if len(candles) < p + 1:
        return Decimal("0")
    trs: list[Decimal] = []
    for i in range(1, len(candles)):
        prev_close = candles[i - 1].close
        tr = max(
            candles[i].high - candles[i].low,
            abs(candles[i].high - prev_close),
            abs(candles[i].low - prev_close),
        )
        trs.append(tr)
    recent = trs[-p:]
    return sum(recent) / Decimal(str(len(recent)))


# ── Order Block detection ─────────────────────────────────────────────

def detect_order_blocks(
    candles: list[Candle],
    breaks: list[StructureBreak],
    max_age_candles: Optional[int] = None,
) -> list[OrderBlock]:
    """
    Detect order blocks tied to confirmed structure breaks.

    For each BOS event, look back from the BOS candle to find:
    - Bullish OB: last bearish candle before the first bullish impulse
    - Bearish OB: last bullish candle before the first bearish impulse
    """
    max_age = max_age_candles or settings.get("ob_max_age_candles")
    min_strength = settings.get("ob_min_strength")
    obs: list[OrderBlock] = []

    for brk in breaks:
        if brk.break_type == BreakType.CHOCH:
            continue  # Only validate OBs from BOS events initially; CHoCH can be added too
        # No, actually we want OBs from both BOS and CHoCH
        # because CHoCH signals reversal and the OB IS the entry level
        bos_idx = brk.index

        if bos_idx >= len(candles):
            continue
        bos_candle = candles[bos_idx]
        bos_range = bos_candle.range()

        if brk.direction == Bias.BULLISH:
            # Find last bearish candle before bos_idx (within max_age)
            search_start = max(0, bos_idx - max_age)
            ob_candle_idx: Optional[int] = None
            for i in range(bos_idx - 1, search_start - 1, -1):
                if candles[i].is_bearish():
                    ob_candle_idx = i
                    break
            if ob_candle_idx is None:
                continue

            oc = candles[ob_candle_idx]
            ob_range = oc.range()
            if ob_range == 0:
                continue
            strength = bos_range / ob_range
            if strength < min_strength:
                continue

            obs.append(OrderBlock(
                index=ob_candle_idx,
                ob_type=OBType.BULLISH,
                ob_high=oc.high,
                ob_low=oc.low,
                ob_open=oc.open,
                ob_close=oc.close,
                strength=strength,
                bos_index=bos_idx,
                timestamp=oc.timestamp,
            ))

        else:  # Bias.BEARISH
            search_start = max(0, bos_idx - max_age)
            ob_candle_idx = None
            for i in range(bos_idx - 1, search_start - 1, -1):
                if candles[i].is_bullish():
                    ob_candle_idx = i
                    break
            if ob_candle_idx is None:
                continue

            oc = candles[ob_candle_idx]
            ob_range = oc.range()
            if ob_range == 0:
                continue
            strength = bos_range / ob_range
            if strength < min_strength:
                continue

            obs.append(OrderBlock(
                index=ob_candle_idx,
                ob_type=OBType.BEARISH,
                ob_high=oc.high,
                ob_low=oc.low,
                ob_open=oc.open,
                ob_close=oc.close,
                strength=strength,
                bos_index=bos_idx,
                timestamp=oc.timestamp,
            ))

    # Deduplicate (same candle index can appear from multiple BOS)
    seen: set[int] = set()
    unique_obs: list[OrderBlock] = []
    for ob in sorted(obs, key=lambda o: o.index):
        if ob.index not in seen:
            seen.add(ob.index)
            unique_obs.append(ob)

    return unique_obs


# ── FVG detection ─────────────────────────────────────────────────────

def detect_fvgs(
    candles: list[Candle],
    atr_period: Optional[int] = None,
) -> list[FVG]:
    """
    Detect Fair Value Gaps (3-candle imbalances).

    Bullish FVG: candle[i-1].high < candle[i+1].low
    Bearish FVG: candle[i-1].low  > candle[i+1].high

    Minimum size = fvg_min_atr_ratio * ATR.
    """
    min_ratio = settings.get("fvg_min_atr_ratio")
    atr = _calc_atr(candles, atr_period)
    min_size = atr * min_ratio

    fvgs: list[FVG] = []
    if len(candles) < 3:
        return fvgs

    for i in range(1, len(candles) - 1):
        prev = candles[i - 1]
        curr = candles[i]
        nxt = candles[i + 1]

        # Bullish FVG (gap above)
        if prev.high < nxt.low:
            size = nxt.low - prev.high
            if size >= min_size:
                fvgs.append(FVG(
                    index=i,
                    fvg_type=FVGType.BULLISH,
                    top=nxt.low,
                    bottom=prev.high,
                    size=size,
                    timestamp=curr.timestamp,
                ))

        # Bearish FVG (gap below)
        elif prev.low > nxt.high:
            size = prev.low - nxt.high
            if size >= min_size:
                fvgs.append(FVG(
                    index=i,
                    fvg_type=FVGType.BEARISH,
                    top=prev.low,
                    bottom=nxt.high,
                    size=size,
                    timestamp=curr.timestamp,
                ))

    return fvgs


# ── Breaker block detection ───────────────────────────────────────────

def detect_breakers(
    obs: list[OrderBlock],
    candles: list[Candle],
) -> list[BreakerBlock]:
    """
    An OB becomes a Breaker Block when price closes THROUGH it,
    violating the OB entirely.
    """
    breakers: list[BreakerBlock] = []

    for ob in obs:
        # Check candles after the OB was created
        for i in range(ob.bos_index + 1, len(candles)):
            c = candles[i]
            if ob.ob_type == OBType.BULLISH:
                # Bullish OB broken if close < ob_low
                if c.close < ob.ob_low:
                    ob.mitigation = MitigationStatus.BROKEN
                    breakers.append(BreakerBlock(
                        original_ob=ob,
                        breaker_type=OBType.BEARISH,  # flipped
                        level_high=ob.ob_high,
                        level_low=ob.ob_low,
                        timestamp=c.timestamp,
                    ))
                    break
            else:
                # Bearish OB broken if close > ob_high
                if c.close > ob.ob_high:
                    ob.mitigation = MitigationStatus.BROKEN
                    breakers.append(BreakerBlock(
                        original_ob=ob,
                        breaker_type=OBType.BULLISH,  # flipped
                        level_high=ob.ob_high,
                        level_low=ob.ob_low,
                        timestamp=c.timestamp,
                    ))
                    break

    return breakers


# ── Mitigation tracking ───────────────────────────────────────────────

def update_mitigation(
    obs: list[OrderBlock],
    fvgs: list[FVG],
    current_price: Decimal,
) -> None:
    """
    Update mitigation status for all OBs and FVGs based on current price.
    Call this on every new candle close.
    """
    for ob in obs:
        if ob.mitigation == MitigationStatus.BROKEN:
            continue
        if ob.is_price_in_ob(current_price):
            ob.mitigation_touches += 1
            if ob.mitigation_touches > settings.get("ob_max_mitigation_touches"):
                ob.mitigation = MitigationStatus.MITIGATED
            else:
                ob.mitigation = MitigationStatus.TOUCHED

    for fvg in fvgs:
        if not fvg.mitigated and fvg.is_price_in_fvg(current_price):
            fvg.mitigated = True


# ── Entry level calculation ───────────────────────────────────────────

def get_entry_within_ob(
    ob: OrderBlock,
) -> tuple[Decimal, Decimal, Decimal]:
    """
    Returns (premium_entry, equilibrium_entry, discount_entry) for an OB.

    For a bullish OB:
      premium  = ob_high (worst risk-adjusted entry)
      equil    = midpoint (ideal)
      discount = ob_low  (best entry, widest stop)

    For a bearish OB: inverted.
    """
    if ob.ob_type == OBType.BULLISH:
        return ob.ob_high, ob.equilibrium, ob.ob_low
    else:
        return ob.ob_low, ob.equilibrium, ob.ob_high
