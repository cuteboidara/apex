"""
Outcome tracker — monitors every emitted signal (traded or not)
and records what WOULD have happened.

This is the gold dataset for improving the system.
Runs on every candle close, checking if price hit TP1/TP2/TP3/SL.
Expires signals after 48 hours.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from config.pairs import get_pair
from core.data_feed import CandleBuffer
from core.market_structure import Bias
from core.signal_engine import Signal

log = logging.getLogger(__name__)

EXPIRY_HOURS = 48


@dataclass
class PendingSignal:
    signal: Signal
    signal_id: int
    tp1_hit: bool = False
    tp1_time: Optional[dt.datetime] = None
    tp2_hit: bool = False
    tp2_time: Optional[dt.datetime] = None
    tp3_hit: bool = False
    tp3_time: Optional[dt.datetime] = None
    sl_hit: bool = False
    sl_time: Optional[dt.datetime] = None
    mfe_pips: Decimal = Decimal("0")
    mae_pips: Decimal = Decimal("0")
    resolved: bool = False


class OutcomeTracker:
    """
    Tracks all emitted signals and monitors for outcomes.

    Usage:
        tracker = OutcomeTracker(buffer)
        tracker.start_tracking(signal, signal_id)
        # on each candle close:
        tracker.check_all(utc_now)
    """

    def __init__(self, buffer: CandleBuffer) -> None:
        self._buffer = buffer
        self._pending: list[PendingSignal] = []

    def start_tracking(self, signal: Signal, signal_id: int) -> None:
        """Begin tracking a signal's outcome."""
        self._pending.append(PendingSignal(signal=signal, signal_id=signal_id))
        log.debug("Tracking signal id=%d %s %s", signal_id,
                  signal.pair, signal.direction.value)

    def check_all(self, utc_now: dt.datetime) -> None:
        """Check all pending signals. Saves resolved outcomes to DB."""
        for ps in list(self._pending):
            if ps.resolved:
                self._pending.remove(ps)
                continue

            # Expiry check
            age = (utc_now - ps.signal.timestamp).total_seconds() / 3600
            if age > EXPIRY_HOURS:
                ps.resolved = True
                self._save_outcome(ps, utc_now, "EXPIRED")
                self._pending.remove(ps)
                continue

            candle = self._buffer.latest(ps.signal.pair, "M5")
            if candle is None:
                continue

            profile = get_pair(ps.signal.pair)
            if profile is None:
                continue
            pip_size = profile.pip_size

            sig = ps.signal
            direction = sig.direction

            # MFE/MAE tracking
            if direction == Bias.BULLISH:
                fav = (candle.close - sig.entry_price) / pip_size
                adv = (sig.entry_price - candle.close) / pip_size
            else:
                fav = (sig.entry_price - candle.close) / pip_size
                adv = (candle.close - sig.entry_price) / pip_size
            ps.mfe_pips = max(ps.mfe_pips, fav)
            ps.mae_pips = max(ps.mae_pips, adv)

            # Check TP/SL hits
            if direction == Bias.BULLISH:
                if not ps.tp1_hit and candle.high >= sig.tp1:
                    ps.tp1_hit = True
                    ps.tp1_time = utc_now
                if not ps.tp2_hit and candle.high >= sig.tp2:
                    ps.tp2_hit = True
                    ps.tp2_time = utc_now
                if not ps.tp3_hit and candle.high >= sig.tp3:
                    ps.tp3_hit = True
                    ps.tp3_time = utc_now
                    ps.resolved = True
                    self._save_outcome(ps, utc_now, "TP3_HIT")
                    self._pending.remove(ps)
                    continue
                if not ps.sl_hit and candle.low <= sig.stop_loss:
                    ps.sl_hit = True
                    ps.sl_time = utc_now
                    ps.resolved = True
                    self._save_outcome(ps, utc_now, "SL_HIT")
                    self._pending.remove(ps)
                    continue
            else:
                if not ps.tp1_hit and candle.low <= sig.tp1:
                    ps.tp1_hit = True
                    ps.tp1_time = utc_now
                if not ps.tp2_hit and candle.low <= sig.tp2:
                    ps.tp2_hit = True
                    ps.tp2_time = utc_now
                if not ps.tp3_hit and candle.low <= sig.tp3:
                    ps.tp3_hit = True
                    ps.tp3_time = utc_now
                    ps.resolved = True
                    self._save_outcome(ps, utc_now, "TP3_HIT")
                    self._pending.remove(ps)
                    continue
                if not ps.sl_hit and candle.high >= sig.stop_loss:
                    ps.sl_hit = True
                    ps.sl_time = utc_now
                    ps.resolved = True
                    self._save_outcome(ps, utc_now, "SL_HIT")
                    self._pending.remove(ps)
                    continue

    def _save_outcome(
        self,
        ps: PendingSignal,
        utc_now: dt.datetime,
        result: str,
    ) -> None:
        try:
            from database.db import get_session
            from database.models import Outcome, OutcomeResult

            sig = ps.signal
            profile = get_pair(sig.pair)
            pip_size = profile.pip_size if profile else Decimal("0.0001")

            # Calculate realized RR
            if result == "SL_HIT":
                rr = Decimal("-1.0")
            elif result == "TP3_HIT":
                rr = settings_get_rr("tp3_rr")
            elif ps.tp2_hit:
                rr = settings_get_rr("tp2_rr")
            elif ps.tp1_hit:
                rr = settings_get_rr("tp1_rr")
            else:
                rr = Decimal("0")

            duration = int((utc_now - sig.timestamp).total_seconds() / 60)

            with get_session() as db:
                existing = db.query(Outcome).filter_by(
                    signal_id=ps.signal_id
                ).first()
                if existing:
                    existing.result = OutcomeResult[result] if hasattr(OutcomeResult, result) else OutcomeResult.EXPIRED
                    existing.tp1_hit = ps.tp1_hit
                    existing.tp1_time = ps.tp1_time
                    existing.tp2_hit = ps.tp2_hit
                    existing.tp2_time = ps.tp2_time
                    existing.tp3_hit = ps.tp3_hit
                    existing.tp3_time = ps.tp3_time
                    existing.sl_hit = ps.sl_hit
                    existing.sl_time = ps.sl_time
                    existing.mfe_pips = ps.mfe_pips
                    existing.mae_pips = ps.mae_pips
                    existing.duration_minutes = duration
                    existing.realized_rr = rr
                else:
                    db.add(Outcome(
                        signal_id=ps.signal_id,
                        result=OutcomeResult[result] if hasattr(OutcomeResult, result) else OutcomeResult.EXPIRED,
                        tp1_hit=ps.tp1_hit, tp1_time=ps.tp1_time,
                        tp2_hit=ps.tp2_hit, tp2_time=ps.tp2_time,
                        tp3_hit=ps.tp3_hit, tp3_time=ps.tp3_time,
                        sl_hit=ps.sl_hit, sl_time=ps.sl_time,
                        mfe_pips=ps.mfe_pips, mae_pips=ps.mae_pips,
                        duration_minutes=duration, realized_rr=rr,
                    ))

            log.info("Outcome saved: signal_id=%d result=%s RR=%.2f",
                     ps.signal_id, result, float(rr))
        except Exception as e:
            log.error("Failed to save outcome: %s", e)


def settings_get_rr(key: str) -> Decimal:
    from config import settings
    return settings.get(key)
