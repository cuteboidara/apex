"""
Multi-timeframe analysis — top-down bias resolution.

Flow: Monthly → Weekly → Daily → H4 → H1 → M15 → M5

Each timeframe contributes to:
  - Directional bias (BULLISH / BEARISH / NEUTRAL)
  - Key Points of Interest (OBs, FVGs)
  - Premium / Discount position

Alignment rules:
  - All major TFs agree → maximum confidence
  - Daily + H4 agree, H1 transitioning → wait
  - H4 disagrees with Daily → NO TRADE
  - H1/M15 showing CHoCH against H4 → potential reversal, reduced size
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional

from core.data_feed import Candle, CandleBuffer
from core.market_structure import (
    Bias, StructureState, analyze_structure, get_premium_discount,
    classify_zone, PriceZone,
)
from core.order_blocks import (
    OrderBlock, FVG, detect_order_blocks, detect_fvgs, OBType,
)

log = logging.getLogger(__name__)


# ── Alignment result ──────────────────────────────────────────────────

class AlignmentStrength(str, Enum):
    FULL = "FULL"          # All HTF agree
    PARTIAL = "PARTIAL"    # 2 of 3 HTF agree, 1 transitioning
    CONFLICTING = "CONFLICTING"  # HTF disagree — no trade


@dataclass
class POI:
    """Point of Interest — an OB or FVG at a specific timeframe."""
    timeframe: str
    poi_type: str        # "OB_BULLISH", "OB_BEARISH", "FVG_BULLISH", "FVG_BEARISH"
    high: Decimal
    low: Decimal
    mid: Decimal
    strength: Decimal    # OB strength or FVG size relative to ATR
    timestamp: object

    def is_price_at_poi(self, price: Decimal, tolerance_pct: Decimal = Decimal("0.001")) -> bool:
        tol = (self.high - self.low) * tolerance_pct
        return (self.low - tol) <= price <= (self.high + tol)


@dataclass
class MTFBias:
    """Aggregated multi-timeframe bias."""
    direction: Bias
    strength: AlignmentStrength
    daily_bias: Bias
    h4_bias: Bias
    h1_bias: Bias
    daily_premium_discount: PriceZone
    h4_premium_discount: PriceZone
    key_pois: list[POI] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class EntryContext:
    """M15/M5 level context for entry timing."""
    ltf_bias: Bias
    ltf_choch_confirmed: bool
    entry_tf: str          # "M5" or "M15"
    entry_ob: Optional[OrderBlock]
    entry_fvg: Optional[FVG]
    current_price: Decimal
    price_zone: PriceZone


# ── HTF Bias resolution ───────────────────────────────────────────────

def _resolve_bias(
    candles: list[Candle],
    tf_label: str,
) -> tuple[Bias, StructureState, list[POI]]:
    """Run structure + OB/FVG analysis for one timeframe."""
    if len(candles) < 20:
        return Bias.NEUTRAL, StructureState(), []

    state = analyze_structure(candles)
    breaks = state.breaks
    obs = detect_order_blocks(candles, breaks)
    fvgs = detect_fvgs(candles)

    pois: list[POI] = []
    for ob in obs[-5:]:  # only most recent 5 OBs
        pois.append(POI(
            timeframe=tf_label,
            poi_type=f"OB_{ob.ob_type.value}",
            high=ob.ob_high,
            low=ob.ob_low,
            mid=ob.equilibrium,
            strength=ob.strength,
            timestamp=ob.timestamp,
        ))
    for fvg in fvgs[-5:]:
        pois.append(POI(
            timeframe=tf_label,
            poi_type=f"FVG_{fvg.fvg_type.value}",
            high=fvg.top,
            low=fvg.bottom,
            mid=fvg.midpoint,
            strength=fvg.size,
            timestamp=fvg.timestamp,
        ))

    return state.current_bias, state, pois


def get_htf_bias(
    symbol: str,
    buffer: CandleBuffer,
) -> MTFBias:
    """
    Compute the multi-timeframe directional bias for a symbol.
    Uses D1, H4, H1 candles from the buffer.
    """
    d1_candles = buffer.get(symbol, "D1", 60)
    h4_candles = buffer.get(symbol, "H4", 120)
    h1_candles = buffer.get(symbol, "H1", 200)

    daily_bias, daily_state, daily_pois = _resolve_bias(d1_candles, "D1")
    h4_bias, h4_state, h4_pois = _resolve_bias(h4_candles, "H4")
    h1_bias, h1_state, h1_pois = _resolve_bias(h1_candles, "H1")

    # ── Determine alignment ──
    biases = [daily_bias, h4_bias, h1_bias]
    bull_count = biases.count(Bias.BULLISH)
    bear_count = biases.count(Bias.BEARISH)

    notes: list[str] = []
    if bull_count == 3:
        direction = Bias.BULLISH
        strength = AlignmentStrength.FULL
    elif bear_count == 3:
        direction = Bias.BEARISH
        strength = AlignmentStrength.FULL
    elif bull_count == 2 and bear_count == 0:
        direction = Bias.BULLISH
        strength = AlignmentStrength.PARTIAL
        notes.append("H1 neutral/transitioning — wait for H1 alignment")
    elif bear_count == 2 and bull_count == 0:
        direction = Bias.BEARISH
        strength = AlignmentStrength.PARTIAL
        notes.append("H1 neutral/transitioning — wait for H1 alignment")
    elif daily_bias != h4_bias and daily_bias != Bias.NEUTRAL and h4_bias != Bias.NEUTRAL:
        direction = Bias.NEUTRAL
        strength = AlignmentStrength.CONFLICTING
        notes.append("Daily/H4 conflict — no trade")
    else:
        direction = daily_bias if daily_bias != Bias.NEUTRAL else h4_bias
        strength = AlignmentStrength.PARTIAL
        notes.append("Partial alignment")

    # Premium / discount zone for each TF
    cur_price = h1_candles[-1].close if h1_candles else Decimal("0")
    d_prem, d_eq, d_disc = get_premium_discount(d1_candles, 50)
    h4_prem, h4_eq, h4_disc = get_premium_discount(h4_candles, 50)
    daily_pd = classify_zone(cur_price, d_prem, d_disc)
    h4_pd = classify_zone(cur_price, h4_prem, h4_disc)

    # Collect POIs — prioritise HTF (D1 > H4 > H1)
    all_pois = daily_pois + h4_pois + h1_pois

    return MTFBias(
        direction=direction,
        strength=strength,
        daily_bias=daily_bias,
        h4_bias=h4_bias,
        h1_bias=h1_bias,
        daily_premium_discount=daily_pd,
        h4_premium_discount=h4_pd,
        key_pois=all_pois,
        notes=notes,
    )


def get_htf_pois(
    symbol: str,
    buffer: CandleBuffer,
) -> list[POI]:
    """Return all active POIs from D1 and H4."""
    bias = get_htf_bias(symbol, buffer)
    return [p for p in bias.key_pois if p.timeframe in ("D1", "H4")]


def check_mtf_alignment(
    symbol: str,
    buffer: CandleBuffer,
) -> MTFBias:
    """Convenience wrapper — returns full MTFBias result."""
    return get_htf_bias(symbol, buffer)


def get_entry_timeframe_context(
    symbol: str,
    buffer: CandleBuffer,
    htf_direction: Bias,
) -> EntryContext:
    """
    Analyse M15 and M5 for entry conditions:
    - LTF CHoCH in the HTF direction
    - Entry OB / FVG formed after the CHoCH
    - Current price zone
    """
    m15_candles = buffer.get(symbol, "M15", 100)
    m5_candles = buffer.get(symbol, "M5", 200)

    m15_state = analyze_structure(m15_candles, lookback=3) if m15_candles else StructureState()
    m5_state = analyze_structure(m5_candles, lookback=3) if m5_candles else StructureState()

    # CHoCH confirmed if last break is a CHoCH aligned with HTF direction
    ltf_choch = False
    entry_tf = "M15"
    for brk in reversed(m5_state.breaks[-5:]):
        from core.market_structure import BreakType
        if brk.break_type == BreakType.CHOCH and brk.direction == htf_direction:
            ltf_choch = True
            entry_tf = "M5"
            break
    if not ltf_choch:
        for brk in reversed(m15_state.breaks[-5:]):
            from core.market_structure import BreakType
            if brk.break_type == BreakType.CHOCH and brk.direction == htf_direction:
                ltf_choch = True
                entry_tf = "M15"
                break

    # Find entry OB/FVG on M5
    entry_ob: Optional[OrderBlock] = None
    entry_fvg: Optional[FVG] = None

    if m5_candles:
        m5_obs = detect_order_blocks(m5_candles, m5_state.breaks)
        m5_fvgs = detect_fvgs(m5_candles)
        cur_price = m5_candles[-1].close

        # Find most recent valid OB aligned with HTF direction
        for ob in reversed(m5_obs[-5:]):
            if htf_direction == Bias.BULLISH and ob.ob_type == OBType.BULLISH:
                if ob.is_valid() and ob.is_price_in_ob(cur_price):
                    entry_ob = ob
                    break
                elif ob.is_valid() and ob.ob_high >= cur_price * Decimal("0.999"):
                    entry_ob = ob
                    break
            elif htf_direction == Bias.BEARISH and ob.ob_type == OBType.BEARISH:
                if ob.is_valid():
                    entry_ob = ob
                    break

        # Find most recent valid FVG aligned with HTF direction
        for fvg in reversed(m5_fvgs[-5:]):
            from core.order_blocks import FVGType
            if htf_direction == Bias.BULLISH and fvg.fvg_type == FVGType.BULLISH:
                if not fvg.mitigated:
                    entry_fvg = fvg
                    break
            elif htf_direction == Bias.BEARISH and fvg.fvg_type == FVGType.BEARISH:
                if not fvg.mitigated:
                    entry_fvg = fvg
                    break

        cur_price_m5 = m5_candles[-1].close
    else:
        cur_price_m5 = Decimal("0")

    prem, eq, disc = get_premium_discount(m5_candles, 50) if m5_candles else (Decimal("0"),) * 3
    price_zone = classify_zone(cur_price_m5, prem, disc)

    ltf_bias = m5_state.current_bias if m5_candles else Bias.NEUTRAL

    return EntryContext(
        ltf_bias=ltf_bias,
        ltf_choch_confirmed=ltf_choch,
        entry_tf=entry_tf,
        entry_ob=entry_ob,
        entry_fvg=entry_fvg,
        current_price=cur_price_m5,
        price_zone=price_zone,
    )
