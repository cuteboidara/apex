"""
Liquidity pool mapping and sweep detection — Forex-adapted.

Liquidity pools tracked:
  - Asian session high/low (London's #1 target)
  - Previous day high/low (NY's #1 target)
  - Previous week/month high/low
  - Equal highs/lows (clustered swing points within pip tolerance)
  - Round number psychological levels
  - Trendline liquidity (basic — obvious diagonal lines retail traders use)

Sweep detection (no real volume — uses tick volume proxy):
  - Price wicks THROUGH the level (not just touches)
  - Tick volume elevated (> N × 20-period average)
  - Occurs during a killzone for highest probability
  - Displacement candle follows (large body in opposite direction)
  - Context: sweep at a HTF POI (amplifies signal quality)

Judas swing detection (ICT concept):
  - London opens, initial move sweeps one side of Asian range
  - Reversal targets opposite side of Asian range
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Optional

from config import settings
from config.pairs import get_pair
from config.sessions import KillzoneName, current_killzone, is_killzone
from core.data_feed import Candle
from core.session_manager import DayLevels

log = logging.getLogger(__name__)


# ── Enums ─────────────────────────────────────────────────────────────

class LiquidityType(str, Enum):
    ASIAN_HIGH = "ASIAN_HIGH"
    ASIAN_LOW = "ASIAN_LOW"
    PDH = "PDH"            # Previous Day High
    PDL = "PDL"            # Previous Day Low
    PWH = "PWH"            # Previous Week High
    PWL = "PWL"            # Previous Week Low
    PMH = "PMH"            # Previous Month High
    PML = "PML"            # Previous Month Low
    EQUAL_HIGHS = "EQUAL_HIGHS"
    EQUAL_LOWS = "EQUAL_LOWS"
    ROUND_NUMBER = "ROUND_NUMBER"
    SWING_HIGH = "SWING_HIGH"
    SWING_LOW = "SWING_LOW"


class SweepDirection(str, Enum):
    BUYSIDE = "BUYSIDE"    # highs swept → expect bearish reversal
    SELLSIDE = "SELLSIDE"  # lows swept → expect bullish reversal


# ── Data classes ──────────────────────────────────────────────────────

@dataclass(slots=True)
class LiquidityPool:
    level: Decimal
    liq_type: LiquidityType
    direction: SweepDirection  # which side is resting above/below
    timestamp: object          # when level was created
    mitigated: bool = False
    touches: int = 0


@dataclass(slots=True)
class SweepEvent:
    pool: LiquidityPool
    sweep_candle_index: int
    sweep_candle: Candle
    direction: SweepDirection
    tick_volume_ratio: Decimal        # sweep volume / 20-period avg
    displacement_score: Decimal       # 0-1, how strong is the follow-through
    session: str
    killzone: str
    in_killzone: bool
    context_score: Decimal            # 0-1, is the sweep at a HTF POI?
    timestamp: object

    @property
    def total_score(self) -> Decimal:
        """Combined quality score 0-100."""
        vol_score = min(self.tick_volume_ratio / Decimal("2.5"), Decimal("1")) * 30
        disp_score = self.displacement_score * 40
        ctx_score = self.context_score * 20
        kz_bonus = Decimal("10") if self.in_killzone else Decimal("0")
        return vol_score + disp_score + ctx_score + kz_bonus


@dataclass
class JudasSwing:
    """ICT Judas Swing — London false move before the real direction."""
    direction_of_fake: SweepDirection  # which side was swept first
    sweep_level: Decimal
    sweep_time: dt.datetime
    target_level: Decimal              # opposite Asian range level
    confirmed: bool = False


# ── Liquidity pool mapping ────────────────────────────────────────────

def map_liquidity_pools(
    symbol: str,
    day_levels: DayLevels,
    candles_h1: list[Candle],
    lookback_swings: int = 20,
) -> list[LiquidityPool]:
    """
    Build the current liquidity map for a symbol.
    Combines session levels, day levels, and recent swing clusters.
    """
    from config.pairs import get_pair as gp
    profile = gp(symbol)
    pip_tol = settings.get("equal_level_pip_tolerance")
    pip_size = profile.pip_size if profile else Decimal("0.0001")
    tolerance = Decimal(str(pip_tol)) * pip_size

    pools: list[LiquidityPool] = []
    now_ts = (candles_h1[-1].timestamp if candles_h1
              else dt.datetime.now(dt.timezone.utc))

    # ── Session / Day levels ──
    level_defs: list[tuple[Optional[Decimal], LiquidityType, SweepDirection]] = [
        (day_levels.asian_high, LiquidityType.ASIAN_HIGH, SweepDirection.BUYSIDE),
        (day_levels.asian_low, LiquidityType.ASIAN_LOW, SweepDirection.SELLSIDE),
        (day_levels.pdh, LiquidityType.PDH, SweepDirection.BUYSIDE),
        (day_levels.pdl, LiquidityType.PDL, SweepDirection.SELLSIDE),
        (day_levels.pwh, LiquidityType.PWH, SweepDirection.BUYSIDE),
        (day_levels.pwl, LiquidityType.PWL, SweepDirection.SELLSIDE),
        (day_levels.pmh, LiquidityType.PMH, SweepDirection.BUYSIDE),
        (day_levels.pml, LiquidityType.PML, SweepDirection.SELLSIDE),
    ]
    for lvl, ltype, direction in level_defs:
        if lvl is not None:
            pools.append(LiquidityPool(
                level=lvl,
                liq_type=ltype,
                direction=direction,
                timestamp=now_ts,
            ))

    # ── Equal highs / lows from H1 swing clusters ──
    recent = candles_h1[-lookback_swings:]
    if recent:
        highs = [c.high for c in recent]
        lows = [c.low for c in recent]
        clusters_h = _find_clusters(highs, tolerance)
        clusters_l = _find_clusters(lows, tolerance)
        for lvl in clusters_h:
            pools.append(LiquidityPool(
                level=lvl,
                liq_type=LiquidityType.EQUAL_HIGHS,
                direction=SweepDirection.BUYSIDE,
                timestamp=now_ts,
            ))
        for lvl in clusters_l:
            pools.append(LiquidityPool(
                level=lvl,
                liq_type=LiquidityType.EQUAL_LOWS,
                direction=SweepDirection.SELLSIDE,
                timestamp=now_ts,
            ))

    # ── Round numbers ──
    if candles_h1:
        cur = candles_h1[-1].close
        pools.extend(_get_round_numbers(cur, pip_size, levels=5))

    return pools


def _find_clusters(prices: list[Decimal], tolerance: Decimal) -> list[Decimal]:
    """Find price clusters — groups of 2+ prices within `tolerance` of each other."""
    clusters: list[Decimal] = []
    visited = [False] * len(prices)
    for i, p in enumerate(prices):
        if visited[i]:
            continue
        group = [p]
        for j in range(i + 1, len(prices)):
            if not visited[j] and abs(prices[j] - p) <= tolerance:
                group.append(prices[j])
                visited[j] = True
        if len(group) >= 2:
            clusters.append(sum(group) / Decimal(str(len(group))))
        visited[i] = True
    return clusters


def _get_round_numbers(
    price: Decimal,
    pip_size: Decimal,
    levels: int = 5,
) -> list[LiquidityPool]:
    """Generate round number levels around current price."""
    # For 4-5 digit pairs, round numbers are at .XX00 and .X000
    # e.g. for EURUSD near 1.0850: 1.0900, 1.0800, 1.1000, etc.
    pools: list[LiquidityPool] = []
    # Round to nearest 100 pips
    big_figure = Decimal(str(round(float(price) / (float(pip_size) * 100)) * float(pip_size) * 100))
    step = pip_size * 100
    for i in range(-levels, levels + 1):
        lvl = big_figure + step * i
        if abs(lvl - price) < step * (levels + 1):
            direction = (SweepDirection.BUYSIDE if lvl > price
                         else SweepDirection.SELLSIDE)
            pools.append(LiquidityPool(
                level=lvl,
                liq_type=LiquidityType.ROUND_NUMBER,
                direction=direction,
                timestamp=dt.datetime.now(dt.timezone.utc),
            ))
    return pools


# ── Sweep detection ───────────────────────────────────────────────────

def detect_sweeps(
    candles: list[Candle],
    pools: list[LiquidityPool],
    utc_now: dt.datetime,
    symbol: str,
) -> list[SweepEvent]:
    """
    Scan the most recent candles for sweeps of any liquidity pool.

    A sweep requires:
    1. Candle WICKS through the level (not just touches)
    2. Tick volume elevated vs 20-period average
    3. Displacement — body of sweep candle or next candle is in the opposite direction
    4. Not in the first N minutes of a session (spread-driven fakeouts)
    """
    if not candles or not pools:
        return []

    vol_mult = settings.get("sweep_tick_volume_multiplier")
    filter_min = settings.get("sweep_session_filter_minutes")
    min_body_ratio = settings.get("sweep_displacement_min_body_ratio")
    vol_avg_period = settings.get("volume_avg_period")

    # Compute average tick volume
    vol_window = candles[-vol_avg_period:] if len(candles) >= vol_avg_period else candles
    avg_vol = (sum(c.tick_volume for c in vol_window) / len(vol_window)
               if vol_window else 1)
    avg_vol_d = Decimal(str(max(avg_vol, 1)))

    kz = current_killzone(utc_now)
    in_kz = is_killzone(utc_now)

    # Time filter: skip first N minutes of London open
    minute_of_hour = utc_now.minute
    if kz == KillzoneName.LONDON_OPEN and minute_of_hour < filter_min:
        return []

    events: list[SweepEvent] = []

    # Only check the most recent 3 candles for sweeps (fresh events only)
    recent = candles[-3:]

    for i, c in enumerate(recent):
        candle_idx = len(candles) - len(recent) + i
        vol_ratio = Decimal(str(c.tick_volume)) / avg_vol_d

        for pool in pools:
            if pool.mitigated:
                continue

            # Check: does this candle WIC through the level?
            swept_buyside = (
                pool.direction == SweepDirection.BUYSIDE
                and c.high > pool.level
                and c.close < pool.level  # wick through, closed back below
            )
            swept_sellside = (
                pool.direction == SweepDirection.SELLSIDE
                and c.low < pool.level
                and c.close > pool.level  # wick through, closed back above
            )

            if not (swept_buyside or swept_sellside):
                continue

            # Volume check
            if vol_ratio < vol_mult:
                continue

            # Displacement check — next candle or current candle body
            disp_score = _calc_displacement(c, candles, candle_idx, swept_buyside)

            # Context score — is sweep at a HTF POI? (placeholder: caller sets this)
            context_score = Decimal("0.5")

            event = SweepEvent(
                pool=pool,
                sweep_candle_index=candle_idx,
                sweep_candle=c,
                direction=pool.direction,
                tick_volume_ratio=vol_ratio,
                displacement_score=disp_score,
                session=kz.value,
                killzone=kz.value,
                in_killzone=in_kz,
                context_score=context_score,
                timestamp=c.timestamp,
            )
            events.append(event)

    return events


def _calc_displacement(
    sweep_candle: Candle,
    all_candles: list[Candle],
    sweep_idx: int,
    is_buyside_sweep: bool,
) -> Decimal:
    """
    Score 0-1: how strong is the displacement after the sweep?

    Factors:
    - Body/range ratio of sweep candle itself (pin bar = 0.9+)
    - Next candle direction and body size
    """
    scores: list[Decimal] = []

    rng = sweep_candle.range()
    body = sweep_candle.body()
    if rng > 0:
        # For buyside sweep: we want close < open (bearish close)
        if is_buyside_sweep and sweep_candle.is_bearish():
            scores.append(body / rng)
        elif not is_buyside_sweep and sweep_candle.is_bullish():
            scores.append(body / rng)
        else:
            scores.append(Decimal("0.2"))  # partial credit for indecision

    # Check next candle if available
    if sweep_idx + 1 < len(all_candles):
        nxt = all_candles[sweep_idx + 1]
        nxt_rng = nxt.range()
        if nxt_rng > 0:
            nxt_body = nxt.body()
            if is_buyside_sweep and nxt.is_bearish():
                scores.append(nxt_body / nxt_rng)
            elif not is_buyside_sweep and nxt.is_bullish():
                scores.append(nxt_body / nxt_rng)

    if not scores:
        return Decimal("0")
    return sum(scores) / Decimal(str(len(scores)))


# ── Judas Swing detection ─────────────────────────────────────────────

def detect_judas_swing(
    symbol: str,
    candles_m15: list[Candle],
    asian_high: Optional[Decimal],
    asian_low: Optional[Decimal],
    utc_now: dt.datetime,
) -> Optional[JudasSwing]:
    """
    Detect the Judas Swing pattern:
    - London opens
    - First move sweeps one side of the Asian range
    - Reversal is expected toward the other side

    Requires London open killzone to be active.
    """
    if asian_high is None or asian_low is None:
        return None

    kz = current_killzone(utc_now)
    if kz not in (KillzoneName.LONDON_OPEN,):
        return None

    if not candles_m15:
        return None

    # Look at candles from the London open window
    london_candles = [
        c for c in candles_m15[-24:]  # last 6 hours of M15 candles
        if c.timestamp.hour in range(6, 12)  # approx London open window
    ]
    if len(london_candles) < 3:
        return None

    # Check if any candle swept the Asian high (buyside sweep = Judas going long first)
    for c in london_candles:
        if c.high > asian_high and c.close < asian_high:
            return JudasSwing(
                direction_of_fake=SweepDirection.BUYSIDE,
                sweep_level=asian_high,
                sweep_time=c.timestamp,
                target_level=asian_low,
                confirmed=True,
            )
        if c.low < asian_low and c.close > asian_low:
            return JudasSwing(
                direction_of_fake=SweepDirection.SELLSIDE,
                sweep_level=asian_low,
                sweep_time=c.timestamp,
                target_level=asian_high,
                confirmed=True,
            )

    return None


# ── Nearest liquidity helper ──────────────────────────────────────────

def get_nearest_liquidity(
    pools: list[LiquidityPool],
    current_price: Decimal,
    direction: SweepDirection,
) -> Optional[LiquidityPool]:
    """Return the nearest unmitigated liquidity pool in the given direction."""
    candidates = [
        p for p in pools
        if not p.mitigated and p.direction == direction
    ]
    if not candidates:
        return None

    if direction == SweepDirection.BUYSIDE:
        # Nearest pool ABOVE current price
        above = [p for p in candidates if p.level > current_price]
        return min(above, key=lambda p: p.level - current_price) if above else None
    else:
        # Nearest pool BELOW current price
        below = [p for p in candidates if p.level < current_price]
        return max(below, key=lambda p: current_price - p.level) if below else None
