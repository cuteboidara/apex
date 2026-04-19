"""
Signal generation pipeline.

Runs on every M15 and M5 candle close DURING killzones.

Pipeline:
  1. Market open? → skip if not
  2. In killzone? → skip if not (configurable)
  3. Regime filter → skip if CHOPPY
  4. Risk limits → skip if daily loss / max positions exceeded
  5. HTF bias (D1 + H4 + H1) → skip if NEUTRAL or CONFLICTING
  6. Liquidity sweep scan (H1/M15/M5)
  7. POI check (OB or FVG at sweep level)
  8. LTF confirmation (CHoCH on M5/M15)
  9. Confluence scoring → skip if < grade B
  10. Entry / SL / TP calculation
  11. RR check → skip if < min_rr_ratio after spread
  12. Spread check
  13. Emit Signal

Target: 2-5 signals per day across all pairs.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from config import settings
from config.pairs import get_pair, ACTIVE_PAIRS
from config.sessions import (
    KillzoneName, current_killzone, current_session,
    is_killzone, is_market_open, is_friday_cutoff, is_monday_caution,
)
from core.data_feed import Candle, CandleBuffer
from core.market_structure import Bias, analyze_structure, AlignmentStrength
from core.liquidity import (
    LiquidityPool, SweepEvent, JudasSwing,
    map_liquidity_pools, detect_sweeps, detect_judas_swing,
    SweepDirection,
)
from core.order_blocks import OrderBlock, FVG, OBType, FVGType, detect_order_blocks, detect_fvgs
from core.regime_filter import classify_regime, Regime, get_day_of_week_bias, DayBias
from core.mtf_analysis import get_htf_bias, get_entry_timeframe_context, MTFBias, AlignmentStrength as MAS
from core.confluence import calculate_confluence, SetupContext, ConfluenceResult
from core.market_structure import PriceZone

log = logging.getLogger(__name__)


# ── Signal output ─────────────────────────────────────────────────────

@dataclass
class Signal:
    timestamp: dt.datetime
    pair: str
    direction: Bias
    timeframe_entry: str

    entry_price: Decimal
    stop_loss: Decimal
    tp1: Decimal
    tp2: Decimal
    tp3: Decimal
    sl_pips: Decimal
    rr_ratio: Decimal

    confluence: ConfluenceResult
    regime: Regime
    htf_bias: Bias
    session: str
    killzone: str

    spread_at_signal: Decimal
    day_of_week: int

    sweep_type: Optional[str]
    poi_type: Optional[str]

    judas_swing: Optional[JudasSwing]
    notes: list[str] = field(default_factory=list)


@dataclass
class RejectedSetup:
    """Stored even when a signal is rejected — feeds the outcome tracker."""
    timestamp: dt.datetime
    pair: str
    direction: Bias
    reason: str
    confluence_score: Optional[Decimal]
    confluence_grade: Optional[str]
    entry_price: Optional[Decimal]
    stop_loss: Optional[Decimal]
    tp1: Optional[Decimal]


# ── Level calculation helpers ─────────────────────────────────────────

def _calc_levels(
    direction: Bias,
    entry: Decimal,
    sl: Decimal,
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal]:
    """
    Given entry and stop loss, return (sl_pips, rr_tp1, rr_tp2, rr_tp3, rr).
    """
    from config.pairs import get_pair as gp
    tp1_rr = settings.get("tp1_rr")
    tp2_rr = settings.get("tp2_rr")
    tp3_rr = settings.get("tp3_rr")

    risk = abs(entry - sl)

    if direction == Bias.BULLISH:
        tp1 = entry + risk * tp1_rr
        tp2 = entry + risk * tp2_rr
        tp3 = entry + risk * tp3_rr
    else:
        tp1 = entry - risk * tp1_rr
        tp2 = entry - risk * tp2_rr
        tp3 = entry - risk * tp3_rr

    return tp1, tp2, tp3, risk


def _risk_to_pips(risk: Decimal, pip_size: Decimal) -> Decimal:
    return risk / pip_size


def _rr_after_spread(
    sl_pips: Decimal,
    spread_pips: Decimal,
    tp1_rr: Optional[Decimal] = None,
) -> Decimal:
    """Effective RR after spread is deducted from profit."""
    rr = tp1_rr or settings.get("tp2_rr")
    tp_pips = sl_pips * rr
    effective_tp = tp_pips - spread_pips
    return effective_tp / sl_pips if sl_pips > 0 else Decimal("0")


# ── Core pipeline ─────────────────────────────────────────────────────

class SignalEngine:
    """
    Main signal generation engine.

    Usage:
        engine = SignalEngine(buffer, session_manager)
        signals = engine.scan_all_pairs(utc_now)
    """

    def __init__(
        self,
        buffer: CandleBuffer,
        session_manager,       # SessionManager (imported here to avoid circular)
        risk_manager=None,     # RiskManager (optional at init, checked at runtime)
        paper_mode: bool = True,
    ) -> None:
        self._buffer = buffer
        self._session_mgr = session_manager
        self._risk_mgr = risk_manager
        self._paper = paper_mode
        self._rejected: list[RejectedSetup] = []

    def scan_all_pairs(self, utc_now: dt.datetime) -> list[Signal]:
        """Run the pipeline for all active pairs. Returns emitted signals."""
        signals: list[Signal] = []

        # ── Global checks ──
        if not is_market_open(utc_now):
            return signals

        killzone_only = settings.get("killzone_only")
        if killzone_only and not is_killzone(utc_now):
            return signals

        for symbol in ACTIVE_PAIRS:
            try:
                result = self.run_pipeline(symbol, utc_now)
                if isinstance(result, Signal):
                    signals.append(result)
                elif isinstance(result, RejectedSetup):
                    self._rejected.append(result)
            except Exception as exc:
                log.exception("Pipeline error for %s: %s", symbol, exc)

        return signals

    def run_pipeline(
        self,
        symbol: str,
        utc_now: dt.datetime,
    ) -> Optional[Signal | RejectedSetup]:
        """
        Run the full pipeline for one symbol.
        Returns Signal if emitted, RejectedSetup if vetoed, None if skipped silently.
        """
        profile = get_pair(symbol)
        if profile is None:
            return None

        pip_size = profile.pip_size
        kz = current_killzone(utc_now)
        session = current_session(utc_now)

        # ── Step 1: Regime filter ──
        h1_candles = self._buffer.get(symbol, "H1", 200)
        if len(h1_candles) < 30:
            return None

        regime_details = classify_regime(h1_candles)
        if regime_details.regime == Regime.CHOPPY:
            return None  # Silent skip

        # ── Step 2: HTF Bias ──
        mtf = get_htf_bias(symbol, self._buffer)
        if mtf.direction == Bias.NEUTRAL:
            return None
        if mtf.strength == MAS.CONFLICTING:
            return None

        # ── Step 3: Sweep scan ──
        day_levels = self._session_mgr.get_day_levels(symbol)
        if day_levels is None:
            return None

        h1_candles_full = self._buffer.get(symbol, "H1", 100)
        m15_candles = self._buffer.get(symbol, "M15", 200)

        pools = map_liquidity_pools(symbol, day_levels, h1_candles_full)
        sweeps = detect_sweeps(m15_candles or h1_candles_full, pools, utc_now, symbol)

        if not sweeps:
            return None  # No sweep = no setup

        # Best sweep by total score
        best_sweep = max(sweeps, key=lambda s: s.total_score)

        # Sweep direction must be consistent with HTF direction
        # Buyside sweep → bullish reversal expected → need HTF bullish
        if (best_sweep.direction == SweepDirection.BUYSIDE
                and mtf.direction != Bias.BULLISH):
            return None
        if (best_sweep.direction == SweepDirection.SELLSIDE
                and mtf.direction != Bias.BEARISH):
            return None

        direction = mtf.direction  # the trade direction (reversal after sweep)

        # ── Step 4: POI check ──
        m5_candles = self._buffer.get(symbol, "M5", 200)
        entry_ctx = get_entry_timeframe_context(symbol, self._buffer, direction)

        price_at_ob = entry_ctx.entry_ob is not None
        price_at_fvg = entry_ctx.entry_fvg is not None
        ob_strength = entry_ctx.entry_ob.strength if entry_ctx.entry_ob else Decimal("0")
        ob_fresh = (entry_ctx.entry_ob is not None
                    and entry_ctx.entry_ob.mitigation.value == "FRESH")

        if not price_at_ob and not price_at_fvg:
            return self._reject(symbol, direction, None, None, None,
                                "No valid POI at sweep level")

        # ── Step 5: LTF confirmation ──
        if not entry_ctx.ltf_choch_confirmed:
            return self._reject(symbol, direction, None, None, None,
                                "No LTF CHoCH confirmation")

        # ── Step 6: Determine entry / SL ──
        live_price = (m5_candles[-1].close if m5_candles
                      else h1_candles_full[-1].close if h1_candles_full
                      else None)
        if live_price is None:
            return None

        # Entry: at OB equilibrium or FVG midpoint
        if entry_ctx.entry_ob:
            entry_price = entry_ctx.entry_ob.equilibrium
        elif entry_ctx.entry_fvg:
            entry_price = entry_ctx.entry_fvg.midpoint
        else:
            entry_price = live_price

        # SL: beyond the sweep high/low + buffer
        sl_buffer = settings.get("sl_buffer_pips") * pip_size
        if direction == Bias.BULLISH:
            sl = best_sweep.pool.level - sl_buffer
        else:
            sl = best_sweep.pool.level + sl_buffer

        sl_risk = abs(entry_price - sl)
        if sl_risk == 0:
            return None

        tp1, tp2, tp3, risk = _calc_levels(direction, entry_price, sl)
        sl_pips = _risk_to_pips(risk, pip_size)

        # ── Step 7: Confluence scoring ──
        spread_pips = self._session_mgr._spread_tracker.average(
            symbol, session.value
        ) or profile.typical_spread_london

        dow_bias = get_day_of_week_bias(utc_now)
        against_dow = dow_bias == DayBias.LIKELY_RANGE and regime_details.regime == Regime.TRENDING

        # Check for Judas swing
        judas = detect_judas_swing(
            symbol, m15_candles or [],
            day_levels.asian_high, day_levels.asian_low, utc_now,
        )

        # Asian sweep in London?
        asian_sweep_in_london = (
            judas is not None
            and kz == KillzoneName.LONDON_OPEN
        )

        # HTF OB confluence (H4 OB + H1 FVG near same level)
        htf_obs = [p for p in mtf.key_pois if p.timeframe in ("D1", "H4")]
        h1_fvgs = [p for p in mtf.key_pois if p.timeframe == "H1" and "FVG" in p.poi_type]
        htf_ob_conf = bool(htf_obs and h1_fvgs)

        ctx = SetupContext(
            htf_direction=direction,
            htf_alignment=mtf.strength,
            daily_bias=mtf.daily_bias,
            h4_bias=mtf.h4_bias,
            sweep_found=True,
            sweep_volume_ratio=best_sweep.tick_volume_ratio,
            sweep_displacement_score=best_sweep.displacement_score,
            price_at_ob=price_at_ob,
            price_at_fvg=price_at_fvg,
            ob_strength=ob_strength,
            ob_is_fresh=ob_fresh,
            ltf_choch_confirmed=entry_ctx.ltf_choch_confirmed,
            ltf_bias_matches_htf=entry_ctx.ltf_bias == direction,
            killzone=kz,
            session=session.value,
            price_zone=entry_ctx.price_zone,
            trade_direction=direction,
            volume_confirms=best_sweep.tick_volume_ratio >= settings.get("sweep_tick_volume_multiplier"),
            judas_swing=judas is not None,
            htf_ob_confluence=htf_ob_conf,
            asian_sweep_in_london=asian_sweep_in_london,
            against_dow=against_dow,
            spread_too_high=not self._session_mgr.is_spread_acceptable(symbol, spread_pips),
            near_news=self._check_near_news(utc_now, symbol),
            correlated_open=self._check_correlation(symbol, direction),
            pair=symbol,
            spread_pips=spread_pips,
        )

        conf = calculate_confluence(ctx)
        min_grade = settings.get("min_confluence_grade")
        if not conf.is_tradeable(min_grade):
            return self._reject(symbol, direction, conf.raw_score, conf.grade,
                                entry_price,
                                f"Grade {conf.grade} below minimum {min_grade}")

        # ── Step 8: RR check after spread ──
        effective_rr = _rr_after_spread(sl_pips, spread_pips)
        min_rr = settings.get("min_rr_ratio")
        if effective_rr < min_rr:
            return self._reject(symbol, direction, conf.raw_score, conf.grade,
                                entry_price,
                                f"RR {float(effective_rr):.2f} < minimum {float(min_rr):.2f}")

        # ── Step 9: Risk manager check ──
        if self._risk_mgr is not None:
            can, reason = self._risk_mgr.can_trade(symbol, direction)
            if not can:
                return self._reject(symbol, direction, conf.raw_score, conf.grade,
                                    entry_price, f"Risk: {reason}")

        # ── Emit signal ──
        poi_type_str = None
        if price_at_ob and entry_ctx.entry_ob:
            poi_type_str = f"M5_OB_{entry_ctx.entry_ob.ob_type.value}"
        elif price_at_fvg and entry_ctx.entry_fvg:
            poi_type_str = f"M5_FVG_{entry_ctx.entry_fvg.fvg_type.value}"

        signal = Signal(
            timestamp=utc_now,
            pair=symbol,
            direction=direction,
            timeframe_entry=entry_ctx.entry_tf,
            entry_price=entry_price,
            stop_loss=sl,
            tp1=tp1,
            tp2=tp2,
            tp3=tp3,
            sl_pips=sl_pips,
            rr_ratio=effective_rr,
            confluence=conf,
            regime=regime_details.regime,
            htf_bias=mtf.direction,
            session=session.value,
            killzone=kz.value,
            spread_at_signal=spread_pips,
            day_of_week=utc_now.weekday(),
            sweep_type=best_sweep.pool.liq_type.value,
            poi_type=poi_type_str,
            judas_swing=judas,
        )

        log.info(
            "SIGNAL %s %s %s — Grade:%s Score:%.1f RR:%.1fx SL:%s pips",
            symbol, direction.value, entry_ctx.entry_tf,
            conf.grade, float(conf.raw_score), float(effective_rr),
            float(sl_pips),
        )

        return signal

    def _reject(
        self,
        symbol: str,
        direction: Bias,
        score: Optional[Decimal],
        grade: Optional[str],
        entry: Optional[Decimal],
        reason: str,
    ) -> RejectedSetup:
        log.debug("REJECTED %s %s — %s", symbol, direction.value, reason)
        return RejectedSetup(
            timestamp=dt.datetime.now(dt.timezone.utc),
            pair=symbol,
            direction=direction,
            reason=reason,
            confluence_score=score,
            confluence_grade=grade,
            entry_price=entry,
            stop_loss=None,
            tp1=None,
        )

    def _check_near_news(self, utc_now: dt.datetime, symbol: str) -> bool:
        """True if a high-impact news event is within 2 hours."""
        # Requires news_events table to be populated — returns False if DB unavailable
        try:
            from database.db import get_session
            from database.models import NewsEvent, NewsImpact
            window_start = utc_now - dt.timedelta(hours=0, minutes=30)
            window_end = utc_now + dt.timedelta(hours=2)
            with get_session() as db:
                count = db.query(NewsEvent).filter(
                    NewsEvent.event_time >= window_start,
                    NewsEvent.event_time <= window_end,
                    NewsEvent.impact == NewsImpact.HIGH,
                ).count()
            return count > 0
        except Exception:
            return False

    def _check_correlation(self, symbol: str, direction: Bias) -> bool:
        """True if we already have an open position in a correlated pair."""
        if self._risk_mgr is None:
            return False
        try:
            _, factor = self._risk_mgr.check_correlation(symbol, direction)
            return factor < Decimal("1.0")
        except Exception:
            return False

    def get_rejected(self) -> list[RejectedSetup]:
        return list(self._rejected)
