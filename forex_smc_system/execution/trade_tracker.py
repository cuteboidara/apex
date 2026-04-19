"""
Live trade tracker — monitors open positions for TP/SL hits,
manages partial closes, and updates the risk manager.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from config import settings
from config.pairs import get_pair
from core.data_feed import CandleBuffer
from core.market_structure import Bias
from execution.order_manager import OrderManager
from execution.risk_manager import RiskManager

log = logging.getLogger(__name__)


@dataclass
class TrackedTrade:
    ticket: int
    signal_id: int
    symbol: str
    direction: Bias
    entry_price: Decimal
    sl: Decimal
    tp1: Decimal
    tp2: Decimal
    tp3: Decimal
    lot_size: Decimal
    open_time: dt.datetime
    tp1_hit: bool = False
    tp2_hit: bool = False
    mfe_pips: Decimal = Decimal("0")
    mae_pips: Decimal = Decimal("0")


class TradeTracker:
    """
    Monitors open positions and manages the lifecycle:
      - Checks for TP1/TP2/TP3/SL hits on each candle
      - Triggers partial closes
      - Moves SL to breakeven after TP1
      - Applies trailing stop after TP2
    """

    def __init__(
        self,
        order_mgr: OrderManager,
        risk_mgr: RiskManager,
        buffer: CandleBuffer,
        paper_mode: bool = True,
    ) -> None:
        self._orders = order_mgr
        self._risk = risk_mgr
        self._buffer = buffer
        self._paper = paper_mode
        self._tracked: dict[int, TrackedTrade] = {}  # ticket → TrackedTrade

    def add(self, trade: TrackedTrade) -> None:
        self._tracked[trade.ticket] = trade
        log.info("Tracking trade ticket=%d %s %s",
                 trade.ticket, trade.symbol, trade.direction.value)

    def remove(self, ticket: int) -> None:
        self._tracked.pop(ticket, None)

    def check_all(self, utc_now: dt.datetime) -> list[int]:
        """
        Check all tracked positions against current prices.
        Returns list of closed ticket IDs.
        """
        closed: list[int] = []
        for ticket, trade in list(self._tracked.items()):
            latest = self._buffer.latest(trade.symbol, "M5")
            if latest is None:
                continue

            profile = get_pair(trade.symbol)
            if profile is None:
                continue
            pip_size = profile.pip_size

            # Update MFE/MAE
            if trade.direction == Bias.BULLISH:
                fav = (latest.close - trade.entry_price) / pip_size
                adv = (trade.entry_price - latest.close) / pip_size
            else:
                fav = (trade.entry_price - latest.close) / pip_size
                adv = (latest.close - trade.entry_price) / pip_size
            trade.mfe_pips = max(trade.mfe_pips, fav)
            trade.mae_pips = max(trade.mae_pips, adv)

            was_closed = self._process_trade(trade, latest, utc_now, pip_size)
            if was_closed:
                closed.append(ticket)
                self.remove(ticket)

        # Check pending order expiry
        self._orders.check_expiry(utc_now)
        return closed

    def _process_trade(
        self,
        trade: TrackedTrade,
        candle,
        utc_now: dt.datetime,
        pip_size: Decimal,
    ) -> bool:
        """
        Returns True if the trade was closed.
        """
        if trade.direction == Bias.BULLISH:
            # SL hit
            if candle.low <= trade.sl:
                self._close(trade, trade.sl, "SL", utc_now)
                return True
            # TP1
            if not trade.tp1_hit and candle.high >= trade.tp1:
                trade.tp1_hit = True
                self._orders.partial_close(trade.ticket, settings.get("tp1_close_pct"))
                # Move SL to breakeven + 1 pip
                be = trade.entry_price + pip_size
                self._orders.modify_sl(trade.ticket, be)
                trade.sl = be
                log.info("TP1 hit ticket=%d — partial close, SL → BE", trade.ticket)
            # TP2
            if trade.tp1_hit and not trade.tp2_hit and candle.high >= trade.tp2:
                trade.tp2_hit = True
                self._orders.partial_close(trade.ticket, settings.get("tp2_close_pct"))
                log.info("TP2 hit ticket=%d — partial close", trade.ticket)
            # TP3 or trailing
            if trade.tp2_hit and candle.high >= trade.tp3:
                self._close(trade, trade.tp3, "TP3", utc_now)
                return True

        else:  # SHORT
            if candle.high >= trade.sl:
                self._close(trade, trade.sl, "SL", utc_now)
                return True
            if not trade.tp1_hit and candle.low <= trade.tp1:
                trade.tp1_hit = True
                self._orders.partial_close(trade.ticket, settings.get("tp1_close_pct"))
                be = trade.entry_price - pip_size
                self._orders.modify_sl(trade.ticket, be)
                trade.sl = be
                log.info("TP1 hit ticket=%d — partial close, SL → BE", trade.ticket)
            if trade.tp1_hit and not trade.tp2_hit and candle.low <= trade.tp2:
                trade.tp2_hit = True
                self._orders.partial_close(trade.ticket, settings.get("tp2_close_pct"))
                log.info("TP2 hit ticket=%d — partial close", trade.ticket)
            if trade.tp2_hit and candle.low <= trade.tp3:
                self._close(trade, trade.tp3, "TP3", utc_now)
                return True

        # Weekend close
        from config.sessions import is_friday_cutoff
        if is_friday_cutoff(utc_now) and utc_now.hour >= 20:
            self._close(trade, candle.close, "WEEKEND_CLOSE", utc_now)
            return True

        return False

    def _close(
        self,
        trade: TrackedTrade,
        close_price: Decimal,
        reason: str,
        utc_now: dt.datetime,
    ) -> None:
        profile = get_pair(trade.symbol)
        pip_size = profile.pip_size if profile else Decimal("0.0001")
        pip_val = profile.pip_value_per_lot if profile else Decimal("10")

        if trade.direction == Bias.BULLISH:
            pnl_pips = (close_price - trade.entry_price) / pip_size
        else:
            pnl_pips = (trade.entry_price - close_price) / pip_size

        pnl_usd = pnl_pips * pip_val * trade.lot_size

        self._risk.register_close(trade.ticket, close_price, pnl_usd, utc_now)

        log.info(
            "Trade closed: ticket=%d %s %s → %s | P&L: %.1f pips ($%.2f)",
            trade.ticket, trade.symbol, trade.direction.value,
            reason, float(pnl_pips), float(pnl_usd),
        )

        # Save outcome to database
        self._save_outcome(trade, close_price, reason, pnl_pips, pnl_usd, utc_now)

    def _save_outcome(
        self,
        trade: TrackedTrade,
        close_price: Decimal,
        reason: str,
        pnl_pips: Decimal,
        pnl_usd: Decimal,
        utc_now: dt.datetime,
    ) -> None:
        try:
            from database.db import get_session
            from database.models import Trade as DBTrade, Outcome, OutcomeResult

            duration = int((utc_now - trade.open_time).total_seconds() / 60)

            with get_session() as db:
                db_trade = db.query(DBTrade).filter_by(
                    ticket=trade.ticket
                ).first()
                if db_trade:
                    db_trade.exit_price = close_price
                    db_trade.timestamp_close = utc_now
                    db_trade.realized_pnl = pnl_usd
                    db_trade.realized_pips = pnl_pips
                    db_trade.exit_reason = reason

                # Update outcome
                outcome = db.query(Outcome).filter_by(
                    signal_id=trade.signal_id
                ).first()
                if outcome:
                    outcome.tp1_hit = trade.tp1_hit
                    outcome.tp2_hit = trade.tp2_hit
                    outcome.sl_hit = reason == "SL"
                    if reason == "SL":
                        outcome.sl_time = utc_now
                        outcome.result = OutcomeResult.SL_HIT
                    elif reason == "TP3":
                        outcome.tp3_hit = True
                        outcome.tp3_time = utc_now
                        outcome.result = OutcomeResult.TP3_HIT
                    elif trade.tp2_hit:
                        outcome.result = OutcomeResult.TP2_HIT
                    elif trade.tp1_hit:
                        outcome.result = OutcomeResult.TP1_HIT
                    outcome.mfe_pips = trade.mfe_pips
                    outcome.mae_pips = trade.mae_pips
                    outcome.duration_minutes = duration
                    outcome.realized_rr = pnl_pips / (
                        abs(trade.entry_price - trade.sl)
                        / get_pair(trade.symbol).pip_size
                    ) if trade.sl != trade.entry_price else Decimal("0")
        except Exception as e:
            log.error("Failed to save outcome for ticket %d: %s", trade.ticket, e)
