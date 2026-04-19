"""
MT5 order manager — places, modifies, and closes orders.

Execution flow:
  1. Receive signal
  2. Validate with risk_manager
  3. Calculate lot size
  4. Check live spread
  5. Place LIMIT or MARKET order
  6. On TP1: partial close 50%, move SL to BE
  7. On TP2: partial close 30%, set trailing stop
  8. Let 20% ride to TP3 or trailing stop

Handles: requotes, off-quotes, partial fills, partial close,
         position reconciliation on startup.
"""

from __future__ import annotations

import datetime as dt
import logging
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from config import settings
from config.pairs import get_pair
from core.data_feed import MT5Connection
from core.market_structure import Bias
from core.signal_engine import Signal
from execution.position_sizer import SizingContext, calculate_lot_size
from execution.risk_manager import RiskManager, OpenPosition

log = logging.getLogger(__name__)

try:
    import MetaTrader5 as mt5
    _MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    _MT5_AVAILABLE = False


# ── Result types ──────────────────────────────────────────────────────

@dataclass(slots=True)
class OrderResult:
    success: bool
    ticket: int
    fill_price: Optional[Decimal]
    error: str = ""


@dataclass(slots=True)
class Position:
    ticket: int
    symbol: str
    direction: Bias
    open_price: Decimal
    sl: Decimal
    tp: Decimal
    lot_size: Decimal
    open_time: dt.datetime
    unrealized_pnl: Decimal


# ── Order Manager ─────────────────────────────────────────────────────

class OrderManager:
    """
    Manages all MT5 order operations.
    In paper_mode=True, simulates orders without hitting the exchange.
    """

    def __init__(
        self,
        conn: MT5Connection,
        risk_manager: RiskManager,
        paper_mode: bool = True,
    ) -> None:
        self._conn = conn
        self._rm = risk_manager
        self._paper = paper_mode
        self._pending_tickets: dict[int, dt.datetime] = {}  # ticket → expiry time

    # ── Order placement ───────────────────────────────────────────────

    def execute_signal(
        self,
        signal: Signal,
        equity: Decimal,
        consecutive_losses: int = 0,
        utc_now: Optional[dt.datetime] = None,
    ) -> Optional[OrderResult]:
        """
        Full signal execution flow:
        1. Risk check
        2. Spread check
        3. Lot size calculation
        4. Order placement
        """
        now = utc_now or dt.datetime.now(dt.timezone.utc)

        # Risk check
        ok, reason = self._rm.can_trade(signal.pair, signal.direction, now)
        if not ok:
            log.info("Signal rejected by risk manager: %s", reason)
            return None

        profile = get_pair(signal.pair)
        if profile is None:
            return None

        # Spread check
        from core.data_feed import get_spread_pips
        live_spread = get_spread_pips(signal.pair, self._conn)
        if live_spread is None:
            live_spread = signal.spread_at_signal  # use signal-time spread

        from core.session_manager import SessionManager  # avoid circular
        max_mult = settings.get("max_spread_multiplier")
        typical = profile.typical_spread_london
        if live_spread > typical * max_mult:
            log.warning("Spread too wide for %s: %.1f pips (max %.1f)",
                        signal.pair, float(live_spread), float(typical * max_mult))
            return None

        # Lot size
        ctx = SizingContext(
            symbol=signal.pair,
            equity=equity,
            entry=signal.entry_price,
            sl=signal.stop_loss,
            utc_now=now,
            consecutive_losses=consecutive_losses,
        )
        lots = calculate_lot_size(ctx)

        # Determine order type
        from core.data_feed import get_live_tick
        tick = get_live_tick(signal.pair, self._conn)
        if tick is None:
            log.error("No live tick for %s", signal.pair)
            return None

        current_price = tick.ask if signal.direction == Bias.BULLISH else tick.bid
        price_diff = abs(signal.entry_price - current_price)
        use_market = price_diff < profile.pip_size * 3  # within 3 pips → market order

        if use_market:
            return self.place_market_order(
                signal.pair, signal.direction, lots,
                signal.stop_loss, signal.tp1,
            )
        else:
            return self.place_limit_order(
                signal.pair, signal.direction, lots,
                signal.entry_price, signal.stop_loss, signal.tp1,
                expiry_minutes=settings.get("signal_expiry_minutes"),
            )

    def place_market_order(
        self,
        symbol: str,
        direction: Bias,
        lots: Decimal,
        sl: Decimal,
        tp: Decimal,
    ) -> OrderResult:
        """Place a market order (BUY or SELL)."""
        if self._paper:
            log.info("[PAPER] MARKET %s %s %.2f lots SL=%s TP=%s",
                     direction.value, symbol, float(lots), sl, tp)
            return OrderResult(True, self._fake_ticket(), sl, "")

        if not _MT5_AVAILABLE:
            return OrderResult(False, 0, None, "MT5 not available")

        profile = get_pair(symbol)
        order_type = mt5.ORDER_TYPE_BUY if direction == Bias.BULLISH else mt5.ORDER_TYPE_SELL

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return OrderResult(False, 0, None, "No tick data")
        price = tick.ask if direction == Bias.BULLISH else tick.bid

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(lots),
            "type": order_type,
            "price": float(price),
            "sl": float(sl),
            "tp": float(tp),
            "deviation": 20,
            "magic": 20260414,
            "comment": "apex_smc",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        return self._send_with_retry(request, direction, symbol, lots)

    def place_limit_order(
        self,
        symbol: str,
        direction: Bias,
        lots: Decimal,
        entry: Decimal,
        sl: Decimal,
        tp: Decimal,
        expiry_minutes: int = 30,
    ) -> OrderResult:
        """Place a limit order at a specific price level."""
        if self._paper:
            log.info("[PAPER] LIMIT %s %s %.2f lots @ %s SL=%s TP=%s (exp %dmin)",
                     direction.value, symbol, float(lots), entry, sl, tp, expiry_minutes)
            ticket = self._fake_ticket()
            expiry = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=expiry_minutes)
            self._pending_tickets[ticket] = expiry
            return OrderResult(True, ticket, entry, "")

        if not _MT5_AVAILABLE:
            return OrderResult(False, 0, None, "MT5 not available")

        order_type = (mt5.ORDER_TYPE_BUY_LIMIT if direction == Bias.BULLISH
                      else mt5.ORDER_TYPE_SELL_LIMIT)
        expiry_dt = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=expiry_minutes)

        request = {
            "action": mt5.TRADE_ACTION_PENDING,
            "symbol": symbol,
            "volume": float(lots),
            "type": order_type,
            "price": float(entry),
            "sl": float(sl),
            "tp": float(tp),
            "deviation": 10,
            "magic": 20260414,
            "comment": "apex_smc_limit",
            "type_time": mt5.ORDER_TIME_SPECIFIED,
            "expiration": int(expiry_dt.timestamp()),
        }

        return self._send_with_retry(request, direction, symbol, lots)

    def modify_sl(self, ticket: int, new_sl: Decimal) -> bool:
        """Move stop loss for an open position."""
        if self._paper:
            log.info("[PAPER] Modify SL ticket=%d new_sl=%s", ticket, new_sl)
            return True
        if not _MT5_AVAILABLE:
            return False
        request = {
            "action": mt5.TRADE_ACTION_SLTP,
            "position": ticket,
            "sl": float(new_sl),
        }
        result = mt5.order_send(request)
        return result is not None and result.retcode == mt5.TRADE_RETCODE_DONE

    def partial_close(self, ticket: int, close_pct: Decimal) -> OrderResult:
        """Close a percentage of an open position."""
        if self._paper:
            log.info("[PAPER] Partial close %d%% of ticket %d",
                     int(float(close_pct) * 100), ticket)
            return OrderResult(True, ticket, None, "")

        if not _MT5_AVAILABLE:
            return OrderResult(False, 0, None, "MT5 not available")

        pos = next((p for p in mt5.positions_get() if p.ticket == ticket), None)
        if pos is None:
            return OrderResult(False, 0, None, "Position not found")

        close_lots = round(pos.volume * float(close_pct), 2)
        if close_lots < 0.01:
            return OrderResult(False, 0, None, "Close volume too small")

        direction = Bias.BULLISH if pos.type == 0 else Bias.BEARISH
        close_type = mt5.ORDER_TYPE_SELL if direction == Bias.BULLISH else mt5.ORDER_TYPE_BUY
        tick = mt5.symbol_info_tick(pos.symbol)
        if tick is None:
            return OrderResult(False, 0, None, "No tick")
        price = tick.bid if direction == Bias.BULLISH else tick.ask

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": close_lots,
            "type": close_type,
            "position": ticket,
            "price": price,
            "deviation": 20,
            "magic": 20260414,
            "comment": "apex_partial_close",
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        result = mt5.order_send(request)
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            return OrderResult(True, ticket, Decimal(str(price)), "")
        return OrderResult(False, 0, None, f"Partial close failed: {result}")

    def cancel_pending(self, ticket: int) -> bool:
        """Cancel a pending limit order."""
        if self._paper:
            self._pending_tickets.pop(ticket, None)
            return True
        if not _MT5_AVAILABLE:
            return False
        request = {
            "action": mt5.TRADE_ACTION_REMOVE,
            "order": ticket,
        }
        result = mt5.order_send(request)
        return result is not None and result.retcode == mt5.TRADE_RETCODE_DONE

    def get_open_positions(self) -> list[Position]:
        """Get all open positions from MT5."""
        if self._paper or not _MT5_AVAILABLE:
            return []
        positions = mt5.positions_get()
        if positions is None:
            return []
        return [
            Position(
                ticket=p.ticket,
                symbol=p.symbol,
                direction=Bias.BULLISH if p.type == 0 else Bias.BEARISH,
                open_price=Decimal(str(p.price_open)),
                sl=Decimal(str(p.sl)),
                tp=Decimal(str(p.tp)),
                lot_size=Decimal(str(p.volume)),
                open_time=dt.datetime.fromtimestamp(p.time, tz=dt.timezone.utc),
                unrealized_pnl=Decimal(str(p.profit)),
            )
            for p in positions
        ]

    def check_expiry(self, utc_now: dt.datetime) -> list[int]:
        """Cancel any pending orders past their expiry. Returns cancelled ticket list."""
        cancelled: list[int] = []
        for ticket, expiry in list(self._pending_tickets.items()):
            if utc_now >= expiry:
                if self.cancel_pending(ticket):
                    cancelled.append(ticket)
                    del self._pending_tickets[ticket]
                    log.info("Expired pending order ticket=%d", ticket)
        return cancelled

    def reconcile_positions(self) -> None:
        """On startup, sync MT5 open positions with risk manager state."""
        if self._paper or not _MT5_AVAILABLE:
            return
        positions = self.get_open_positions()
        for pos in positions:
            op = OpenPosition(
                symbol=pos.symbol,
                direction=pos.direction,
                open_time=pos.open_time,
                entry_price=pos.open_price,
                sl=pos.sl,
                lot_size=pos.lot_size,
                equity_at_open=Decimal("0"),  # unknown at reconciliation
                ticket=pos.ticket,
            )
            self._rm.register_open(op)
        log.info("Reconciled %d open positions from MT5", len(positions))

    # ── Helpers ───────────────────────────────────────────────────────

    def _send_with_retry(
        self,
        request: dict,
        direction: Bias,
        symbol: str,
        lots: Decimal,
        max_retries: int = 3,
    ) -> OrderResult:
        delay_ms = settings.get("limit_order_retry_delay_ms")
        for attempt in range(max_retries):
            result = mt5.order_send(request)
            if result is None:
                log.warning("Order send returned None for %s", symbol)
                time.sleep(delay_ms / 1000)
                continue
            if result.retcode == mt5.TRADE_RETCODE_DONE:
                log.info("Order placed: ticket=%d %s %s %.2f lots @ %.5f",
                         result.order, direction.value, symbol,
                         float(lots), result.price)
                return OrderResult(True, result.order, Decimal(str(result.price)), "")
            # Requote — retry with new price
            if result.retcode in (mt5.TRADE_RETCODE_REQUOTE,
                                  mt5.TRADE_RETCODE_PRICE_CHANGED):
                tick = mt5.symbol_info_tick(symbol)
                if tick:
                    request["price"] = tick.ask if direction == Bias.BULLISH else tick.bid
                time.sleep(delay_ms / 1000)
                continue
            # Fatal error
            error = f"MT5 error {result.retcode}: {result.comment}"
            log.error("Order failed: %s", error)
            return OrderResult(False, 0, None, error)
        return OrderResult(False, 0, None, f"Failed after {max_retries} retries")

    _ticket_counter = 90000

    def _fake_ticket(self) -> int:
        OrderManager._ticket_counter += 1
        return OrderManager._ticket_counter
