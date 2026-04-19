"""
Confluence scoring engine.

Scores a setup from 0-110+ using weighted factors.
Initial weights come from config/settings.py.
After backtesting, the optimizer will replace them with data-driven values.

Factors:
  Core (sum to 100):
    1. HTF bias alignment (Daily + H4)         : 25
    2. Liquidity sweep confirmed                : 20
    3. Price at valid POI (OB / FVG)            : 15
    4. LTF confirmation (CHoCH on M5/M15)       : 15
    5. Session timing (inside killzone)         : 10
    6. Premium/Discount zone                    : 10
    7. Tick volume confirmation                 : 5

  Bonus (can push above 100):
    + Judas swing confirmed                    : +10
    + MTF OB confluence (H4 OB + H1 FVG)       : +10
    + Asian range sweep during London           : +5

  Penalties:
    - Against day-of-week tendency             : -5
    - High spread environment                  : -10
    - Near major news event (within 2h)        : -15
    - Correlated position already open        : -10

Grades:
  A+: 90+   A: 80-89   B: 65-79   C: 50-64   D: 35-49   F: <35
  Only emit signals grade B (65+) or above.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from config import settings
from core.market_structure import Bias, AlignmentStrength
from core.market_structure import PriceZone
from config.sessions import KillzoneName, is_killzone

log = logging.getLogger(__name__)


# ── Result container ──────────────────────────────────────────────────

@dataclass
class ConfluenceResult:
    raw_score: Decimal
    grade: str           # A+, A, B, C, D, F
    breakdown: dict      # factor → points earned
    bonuses: dict        # bonus factor → points
    penalties: dict      # penalty factor → points (negative)

    @property
    def final_score(self) -> Decimal:
        return self.raw_score

    def is_tradeable(self, min_grade: Optional[str] = None) -> bool:
        grade_order = ["F", "D", "C", "B", "A", "A+"]
        min_g = min_grade or settings.get("min_confluence_grade")
        try:
            return grade_order.index(self.grade) >= grade_order.index(min_g)
        except ValueError:
            return False


GRADE_THRESHOLDS: list[tuple[Decimal, str]] = [
    (Decimal("90"), "A+"),
    (Decimal("80"), "A"),
    (Decimal("65"), "B"),
    (Decimal("50"), "C"),
    (Decimal("35"), "D"),
    (Decimal("0"), "F"),
]


def _grade(score: Decimal) -> str:
    for threshold, label in GRADE_THRESHOLDS:
        if score >= threshold:
            return label
    return "F"


# ── Setup context (input to scorer) ──────────────────────────────────

@dataclass
class SetupContext:
    """All the data points needed to score a setup."""
    # HTF
    htf_direction: Bias
    htf_alignment: "AlignmentStrength"   # from mtf_analysis
    daily_bias: Bias
    h4_bias: Bias

    # Sweep
    sweep_found: bool
    sweep_volume_ratio: Decimal   # tick_volume / 20-avg
    sweep_displacement_score: Decimal  # 0-1

    # POI
    price_at_ob: bool
    price_at_fvg: bool
    ob_strength: Decimal          # 0 if N/A
    ob_is_fresh: bool

    # LTF confirmation
    ltf_choch_confirmed: bool
    ltf_bias_matches_htf: bool

    # Session
    killzone: KillzoneName
    session: str

    # Premium/Discount
    price_zone: PriceZone   # DISCOUNT for longs, PREMIUM for shorts
    trade_direction: Bias   # LONG or SHORT being considered

    # Tick volume
    volume_confirms: bool

    # Bonuses
    judas_swing: bool
    htf_ob_confluence: bool      # H4 OB + H1 FVG at same level
    asian_sweep_in_london: bool  # Asian range swept during London killzone

    # Penalties
    against_dow: bool
    spread_too_high: bool
    near_news: bool
    correlated_open: bool

    # Metadata
    pair: str
    spread_pips: Decimal


# ── Confluence calculator ─────────────────────────────────────────────

def calculate_confluence(ctx: SetupContext) -> ConfluenceResult:
    """
    Score a setup and return a ConfluenceResult with full breakdown.
    Weights are loaded from config/settings.py (backtester can override).
    """
    w = {
        "htf_bias": settings.get("weight_htf_bias"),
        "sweep": settings.get("weight_sweep"),
        "poi": settings.get("weight_poi"),
        "ltf_confirm": settings.get("weight_ltf_confirm"),
        "session": settings.get("weight_session"),
        "premium_discount": settings.get("weight_premium_discount"),
        "tick_volume": settings.get("weight_tick_volume"),
    }

    breakdown: dict[str, Decimal] = {}

    # ── 1. HTF Bias Alignment ──
    from core.market_structure import AlignmentStrength as AS
    if ctx.htf_alignment == AS.FULL:
        breakdown["htf_bias"] = w["htf_bias"]
    elif ctx.htf_alignment == AS.PARTIAL:
        breakdown["htf_bias"] = w["htf_bias"] * Decimal("0.6")
    else:
        breakdown["htf_bias"] = Decimal("0")

    # ── 2. Sweep ──
    if ctx.sweep_found:
        vol_ratio_score = min(ctx.sweep_volume_ratio / Decimal("2.5"), Decimal("1"))
        disp_score = ctx.sweep_displacement_score
        sweep_quality = (vol_ratio_score + disp_score) / Decimal("2")
        breakdown["sweep"] = w["sweep"] * sweep_quality
    else:
        breakdown["sweep"] = Decimal("0")

    # ── 3. POI ──
    poi_score = Decimal("0")
    if ctx.price_at_ob and ctx.ob_is_fresh:
        poi_score = w["poi"] * min(ctx.ob_strength / Decimal("3"), Decimal("1"))
    elif ctx.price_at_fvg:
        poi_score = w["poi"] * Decimal("0.8")
    elif ctx.price_at_ob:  # mitigated OB
        poi_score = w["poi"] * Decimal("0.4")
    breakdown["poi"] = poi_score

    # ── 4. LTF Confirmation ──
    if ctx.ltf_choch_confirmed and ctx.ltf_bias_matches_htf:
        breakdown["ltf_confirm"] = w["ltf_confirm"]
    elif ctx.ltf_choch_confirmed:
        breakdown["ltf_confirm"] = w["ltf_confirm"] * Decimal("0.5")
    else:
        breakdown["ltf_confirm"] = Decimal("0")

    # ── 5. Session ──
    high_value_kzs = (KillzoneName.LONDON_OPEN, KillzoneName.NY_OPEN)
    med_value_kzs = (KillzoneName.LONDON_CLOSE,)
    if ctx.killzone in high_value_kzs:
        breakdown["session"] = w["session"]
    elif ctx.killzone in med_value_kzs:
        breakdown["session"] = w["session"] * Decimal("0.5")
    else:
        breakdown["session"] = Decimal("0")  # outside killzone

    # ── 6. Premium / Discount ──
    # Long should be in discount, Short should be in premium
    zone_aligned = (
        (ctx.trade_direction == Bias.BULLISH and ctx.price_zone == PriceZone.DISCOUNT)
        or (ctx.trade_direction == Bias.BEARISH and ctx.price_zone == PriceZone.PREMIUM)
    )
    zone_neutral = ctx.price_zone == PriceZone.EQUILIBRIUM
    if zone_aligned:
        breakdown["premium_discount"] = w["premium_discount"]
    elif zone_neutral:
        breakdown["premium_discount"] = w["premium_discount"] * Decimal("0.5")
    else:
        breakdown["premium_discount"] = Decimal("0")

    # ── 7. Tick Volume ──
    breakdown["tick_volume"] = w["tick_volume"] if ctx.volume_confirms else Decimal("0")

    # ── Bonuses ──
    bonuses: dict[str, Decimal] = {}
    if ctx.judas_swing:
        bonuses["judas_swing"] = settings.get("bonus_judas_swing")
    if ctx.htf_ob_confluence:
        bonuses["mtf_ob_confluence"] = settings.get("bonus_mtf_ob_confluence")
    if ctx.asian_sweep_in_london:
        bonuses["asian_sweep_london"] = settings.get("bonus_asian_sweep_london")

    # ── Penalties ──
    penalties: dict[str, Decimal] = {}
    if ctx.against_dow:
        penalties["dow_tendency"] = settings.get("penalty_dow_tendency")
    if ctx.spread_too_high:
        penalties["high_spread"] = settings.get("penalty_high_spread")
    if ctx.near_news:
        penalties["near_news"] = settings.get("penalty_near_news_hours")
    if ctx.correlated_open:
        penalties["correlated_open"] = settings.get("penalty_correlated_open")

    core_score = sum(breakdown.values())
    bonus_total = sum(bonuses.values())
    penalty_total = sum(penalties.values())  # already negative
    final = max(Decimal("0"), core_score + bonus_total + penalty_total)

    return ConfluenceResult(
        raw_score=final,
        grade=_grade(final),
        breakdown=breakdown,
        bonuses=bonuses,
        penalties=penalties,
    )
