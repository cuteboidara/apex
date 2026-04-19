"""
Market regime classifier.

Classifies market into TRENDING / RANGING / CHOPPY using a composite
of multiple indicators. No single indicator makes the call.

Components:
  1. ADX (14) — trend strength
  2. Efficiency Ratio — directional movement vs total path
  3. Average wick-to-body ratio — high ratio signals chop
  4. Bollinger Band width — low width signals contraction / ranging
  5. H4 structure clarity — clean swings vs messy overlapping candles

Forex-specific extras:
  - Day-of-week bias (Monday tends to range, Tue-Thu trends)
  - Month-end / quarter-end flag
  - News void detection (no high-impact events in 24h = likely to range)

Rules:
  - CHOPPY  → suppress ALL signals
  - RANGING → only allow signals at defined range boundaries
  - TRENDING → allow qualified signals aligned with trend direction
"""

from __future__ import annotations

import datetime as dt
import logging
import math
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Optional

from config import settings
from core.data_feed import Candle

log = logging.getLogger(__name__)


# ── Enums ─────────────────────────────────────────────────────────────

class Regime(str, Enum):
    TRENDING = "TRENDING"
    RANGING = "RANGING"
    CHOPPY = "CHOPPY"
    UNKNOWN = "UNKNOWN"


class DayBias(str, Enum):
    LIKELY_TREND = "LIKELY_TREND"
    LIKELY_RANGE = "LIKELY_RANGE"
    NEUTRAL = "NEUTRAL"
    AVOID = "AVOID"   # Friday or weekend


# ── Result container ──────────────────────────────────────────────────

@dataclass
class RegimeDetails:
    regime: Regime
    adx: Decimal
    efficiency_ratio: Decimal
    avg_wick_ratio: Decimal
    bb_width: Decimal       # Bollinger Band width normalised
    composite_score: Decimal  # 0 = pure chop, 100 = pure trend
    tradeable: bool
    reason: str


# ── Individual indicator calculations ────────────────────────────────

def _calc_adx(candles: list[Candle], period: Optional[int] = None) -> Decimal:
    """
    Compute ADX (Average Directional Index).

    Uses Wilder smoothing. Returns 0 if insufficient data.
    """
    p = period or settings.get("adx_period")
    if len(candles) < p * 2 + 1:
        return Decimal("0")

    highs = [c.high for c in candles]
    lows = [c.low for c in candles]
    closes = [c.close for c in candles]

    # True Range and Directional Movement
    plus_dm: list[Decimal] = []
    minus_dm: list[Decimal] = []
    trs: list[Decimal] = []

    for i in range(1, len(candles)):
        h_diff = highs[i] - highs[i - 1]
        l_diff = lows[i - 1] - lows[i]
        plus_dm.append(h_diff if h_diff > l_diff and h_diff > 0 else Decimal("0"))
        minus_dm.append(l_diff if l_diff > h_diff and l_diff > 0 else Decimal("0"))
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)

    def wilder_smooth(data: list[Decimal], n: int) -> list[Decimal]:
        if len(data) < n:
            return []
        result = [sum(data[:n])]
        for x in data[n:]:
            result.append(result[-1] - result[-1] / n + x)
        return result

    smoothed_tr = wilder_smooth(trs, p)
    smoothed_pdm = wilder_smooth(plus_dm, p)
    smoothed_mdm = wilder_smooth(minus_dm, p)

    if not smoothed_tr or min(smoothed_tr) == 0:
        return Decimal("0")

    di_plus = [Decimal("100") * pdm / tr for pdm, tr in zip(smoothed_pdm, smoothed_tr)]
    di_minus = [Decimal("100") * mdm / tr for mdm, tr in zip(smoothed_mdm, smoothed_tr)]

    dx_list: list[Decimal] = []
    for dp, dm in zip(di_plus, di_minus):
        denom = dp + dm
        if denom == 0:
            dx_list.append(Decimal("0"))
        else:
            dx_list.append(Decimal("100") * abs(dp - dm) / denom)

    smoothed_dx = wilder_smooth(dx_list, p)
    return smoothed_dx[-1] if smoothed_dx else Decimal("0")


def _calc_efficiency_ratio(
    candles: list[Candle],
    period: Optional[int] = None,
) -> Decimal:
    """
    Kaufman Efficiency Ratio = |price change over N periods| / sum of absolute moves.

    1.0 = perfectly trending, 0.0 = perfectly choppy.
    """
    p = period or settings.get("efficiency_ratio_period")
    if len(candles) < p + 1:
        return Decimal("0")

    recent = candles[-p - 1:]
    net_move = abs(recent[-1].close - recent[0].close)
    path = sum(abs(recent[i].close - recent[i - 1].close) for i in range(1, len(recent)))
    if path == 0:
        return Decimal("0")
    return net_move / path


def _calc_avg_wick_ratio(candles: list[Candle], lookback: int = 20) -> Decimal:
    """Average wick-to-body ratio over last N candles. High ratio = chop."""
    recent = candles[-lookback:] if len(candles) >= lookback else candles
    if not recent:
        return Decimal("0")
    ratios = [c.wick_to_body_ratio() for c in recent if c.body() > 0]
    if not ratios:
        return Decimal("999")
    return sum(ratios) / Decimal(str(len(ratios)))


def _calc_bb_width(candles: list[Candle], period: Optional[int] = None) -> Decimal:
    """
    Bollinger Band width as a fraction of midline.
    Low width = consolidation, high width = expansion.
    """
    p = period or settings.get("bb_period")
    std_mult = settings.get("bb_std")

    if len(candles) < p:
        return Decimal("0")

    recent_closes = [c.close for c in candles[-p:]]
    mean = sum(recent_closes) / Decimal(str(len(recent_closes)))
    variance = sum((c - mean) ** 2 for c in recent_closes) / Decimal(str(len(recent_closes)))
    std_dev = Decimal(str(float(variance) ** 0.5))

    upper = mean + std_mult * std_dev
    lower = mean - std_mult * std_dev
    width = (upper - lower) / mean if mean != 0 else Decimal("0")
    return width


# ── Composite regime classification ──────────────────────────────────

def classify_regime(
    candles_h1: list[Candle],
    adx_trending_threshold: Optional[Decimal] = None,
    adx_choppy_threshold: Optional[Decimal] = None,
) -> RegimeDetails:
    """
    Classify the market regime using a composite of 4 indicators.

    Input: H1 candles (at least 100 recommended).
    """
    trending_thresh = Decimal(str(adx_trending_threshold or settings.get("adx_trending_threshold")))
    choppy_thresh = Decimal(str(adx_choppy_threshold or settings.get("adx_choppy_threshold")))
    wick_thresh = settings.get("wick_ratio_chop_threshold")

    adx = _calc_adx(candles_h1)
    er = _calc_efficiency_ratio(candles_h1)
    wr = _calc_avg_wick_ratio(candles_h1)
    bb = _calc_bb_width(candles_h1)

    # ── Scoring (0=chop, 100=trend) ──
    # ADX component: 0 at 10, 100 at 35+
    adx_score = min((adx - Decimal("10")) / Decimal("25") * Decimal("100"), Decimal("100"))
    adx_score = max(adx_score, Decimal("0"))

    # Efficiency Ratio: 0=chop, 1=trend → scale to 0-100
    er_score = er * Decimal("100")

    # Wick ratio: 0=chop (high wicks), 100=trend (small wicks)
    wick_score = max(Decimal("0"), (Decimal("1") - wr) * Decimal("100"))

    # BB width: moderate width = trending, very low = ranging, very high = explosive
    # Normalize: 0.02=ranging, 0.05=moderate, 0.10=trending
    bb_score = min(bb / Decimal("0.05") * Decimal("60"), Decimal("100"))

    # Weighted composite
    composite = (
        adx_score * Decimal("0.35")
        + er_score * Decimal("0.30")
        + wick_score * Decimal("0.20")
        + bb_score * Decimal("0.15")
    )

    # ── Final classification ──
    if adx >= trending_thresh and er >= Decimal("0.4") and composite >= Decimal("55"):
        regime = Regime.TRENDING
        tradeable = True
        reason = f"Trending — ADX={float(adx):.1f}, ER={float(er):.2f}"

    elif composite < Decimal("30") or wr > wick_thresh:
        regime = Regime.CHOPPY
        tradeable = False
        reason = f"Choppy — composite={float(composite):.1f}, wick_ratio={float(wr):.2f}"

    elif adx < choppy_thresh:
        regime = Regime.RANGING
        # Only tradeable at range extremes — caller decides
        tradeable = True
        reason = f"Ranging — ADX={float(adx):.1f}, BB_width={float(bb):.4f}"

    else:
        regime = Regime.RANGING
        tradeable = True
        reason = f"Ambiguous — composite={float(composite):.1f}"

    return RegimeDetails(
        regime=regime,
        adx=adx,
        efficiency_ratio=er,
        avg_wick_ratio=wr,
        bb_width=bb,
        composite_score=composite,
        tradeable=tradeable,
        reason=reason,
    )


# ── Day-of-week bias ──────────────────────────────────────────────────

def get_day_of_week_bias(utc_now: Optional[dt.datetime] = None) -> DayBias:
    """
    Historical tendencies for Forex:
      Monday  : low volatility, often reverses Friday move, range-heavy
      Tuesday : trend picks up
      Wednesday: typically strong trends
      Thursday: strong trends continue
      Friday  : mixed, reversals before weekend, close early
    """
    now = utc_now or dt.datetime.now(dt.timezone.utc)
    wd = now.weekday()  # 0=Mon … 4=Fri

    if wd == 0:
        return DayBias.LIKELY_RANGE
    elif wd in (1, 2, 3):
        return DayBias.LIKELY_TREND
    elif wd == 4:
        from config.sessions import is_friday_cutoff
        return DayBias.AVOID if is_friday_cutoff(now) else DayBias.NEUTRAL
    else:
        return DayBias.AVOID  # Saturday/Sunday


def is_month_end(utc_now: Optional[dt.datetime] = None) -> bool:
    """True in the last 2 trading days of the month — rebalancing flows distort price."""
    now = utc_now or dt.datetime.now(dt.timezone.utc)
    import calendar
    last_day = calendar.monthrange(now.year, now.month)[1]
    return now.day >= last_day - 2


# ── Full tradeability check ───────────────────────────────────────────

def is_tradeable(
    candles_h1: list[Candle],
    utc_now: Optional[dt.datetime] = None,
    adx_trending_threshold: Optional[Decimal] = None,
    adx_choppy_threshold: Optional[Decimal] = None,
) -> tuple[bool, str]:
    """
    Combined tradeability decision.

    Returns: (tradeable: bool, reason: str)
    """
    now = utc_now or dt.datetime.now(dt.timezone.utc)

    details = classify_regime(candles_h1, adx_trending_threshold, adx_choppy_threshold)

    if not details.tradeable:
        return False, details.reason

    dow = get_day_of_week_bias(now)
    if dow == DayBias.AVOID:
        return False, "Friday cutoff / weekend"

    if is_month_end(now):
        return True, f"{details.reason} [MONTH-END caution — reduce size]"

    return True, details.reason
