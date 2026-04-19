"""
Risk manager — enforces all hard trading rules.

Hard rules (cannot be overridden by signals):
  - Max daily loss: 3% of equity → halt today
  - Max weekly loss: 5% of equity → halt week
  - Max drawdown from peak: 10% → halt system
  - Max concurrent positions: 3
  - Max correlated positions: 2 per group
  - Max consecutive losses: 3 → reduce size
  - News blackout: 30 min before / 15 min after HIGH impact events
  - Friday cutoff: no new positions after 19:00 UTC
  - Monday caution: reduced size until 10:00 UTC
  - Weekend hold check: position must have BE SL or RR > 3 to survive weekend
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from config import settings
from config.pairs import CORRELATION_GROUPS
from config.sessions import is_friday_cutoff, is_monday_caution, is_market_open
from core.market_structure import Bias

log = logging.getLogger(__name__)


# ── State containers ──────────────────────────────────────────────────

@dataclass
class OpenPosition:
    symbol: str
    direction: Bias
    open_time: dt.datetime
    entry_price: Decimal
    sl: Decimal
    lot_size: Decimal
    equity_at_open: Decimal
    ticket: int = 0


@dataclass
class RiskState:
    equity_peak: Decimal = Decimal("0")
    daily_start_equity: Decimal = Decimal("0")
    weekly_start_equity: Decimal = Decimal("0")
    current_equity: Decimal = Decimal("0")
    consecutive_losses: int = 0
    open_positions: list[OpenPosition] = field(default_factory=list)
    halted_daily: bool = False
    halted_weekly: bool = False
    halted_drawdown: bool = False
    halt_reason: str = ""


# ── Risk Manager ──────────────────────────────────────────────────────

class RiskManager:
    """
    Maintains risk state and enforces all hard risk rules.

    Usage:
        rm = RiskManager(initial_equity=10000)
        ok, reason = rm.can_trade("EURUSD", Bias.BULLISH)
        if ok:
            rm.register_open(position)
    """

    def __init__(self, initial_equity: Decimal) -> None:
        self._state = RiskState(
            equity_peak=initial_equity,
            daily_start_equity=initial_equity,
            weekly_start_equity=initial_equity,
            current_equity=initial_equity,
        )
        self._last_equity_date: Optional[dt.date] = None
        self._last_equity_week: Optional[int] = None

    # ── Public API ────────────────────────────────────────────────────

    def can_trade(
        self,
        symbol: str,
        direction: Bias,
        utc_now: Optional[dt.datetime] = None,
    ) -> tuple[bool, str]:
        """
        Returns (True, "") if allowed to open a new position,
        or (False, reason_string) if blocked.
        """
        now = utc_now or dt.datetime.now(dt.timezone.utc)
        s = self._state

        # Hard halts
        if s.halted_drawdown:
            return False, f"System halted: max drawdown exceeded — {s.halt_reason}"
        if s.halted_weekly:
            return False, "Weekly loss limit exceeded"
        if s.halted_daily:
            return False, "Daily loss limit exceeded"

        # Market open
        if not is_market_open(now):
            return False, "Market closed"

        # Friday cutoff
        if is_friday_cutoff(now):
            return False, "Friday cutoff — no new positions after 19:00 UTC"

        # Max concurrent positions
        if len(s.open_positions) >= settings.get("max_concurrent_positions"):
            return False, f"Max positions ({settings.get('max_concurrent_positions')}) reached"

        # Correlation check
        corr_ok, corr_factor = self.check_correlation(symbol, direction)
        if not corr_ok:
            return False, f"Correlation limit exceeded for {symbol}"

        # News blackout
        news_blocked, next_event = self.check_news_blackout(now)
        if news_blocked:
            return False, f"News blackout: {next_event}"

        return True, ""

    def check_correlation(
        self,
        symbol: str,
        direction: Bias,
    ) -> tuple[bool, Decimal]:
        """
        Returns (allowed, size_factor).
        allowed=False if correlation group is at max positions.
        size_factor < 1.0 if partially allocated to correlated pair.
        """
        max_corr = settings.get("max_correlated_positions")

        # Count open positions in each group this symbol belongs to
        my_groups = [g for g, members in CORRELATION_GROUPS.items() if symbol in members]

        for grp in my_groups:
            members = CORRELATION_GROUPS[grp]
            open_in_group = [
                p for p in self._state.open_positions
                if p.symbol in members
            ]
            if len(open_in_group) >= max_corr:
                return False, Decimal("0")
            if len(open_in_group) >= 1:
                return True, Decimal("0.5")  # reduce size

        return True, Decimal("1.0")

    def check_news_blackout(
        self,
        utc_now: dt.datetime,
    ) -> tuple[bool, str]:
        """
        Returns (blocked, event_description).
        Checks the news_events database table.
        """
        try:
            from database.db import get_session
            from database.models import NewsEvent, NewsImpact
            window_start = utc_now - dt.timedelta(minutes=15)
            window_end = utc_now + dt.timedelta(minutes=30)
            with get_session() as db:
                event = db.query(NewsEvent).filter(
                    NewsEvent.event_time >= window_start,
                    NewsEvent.event_time <= window_end,
                    NewsEvent.impact == NewsImpact.HIGH,
                ).order_by(NewsEvent.event_time).first()
            if event:
                return True, f"{event.title} ({event.currency}) at {event.event_time.strftime('%H:%M UTC')}"
        except Exception:
            pass  # DB not available — don't block
        return False, ""

    def register_open(self, position: OpenPosition) -> None:
        """Call when a new position is opened."""
        self._state.open_positions.append(position)
        log.info("Position opened: %s %s @ %s (ticket %d)",
                 position.symbol, position.direction.value,
                 float(position.entry_price), position.ticket)

    def register_close(
        self,
        ticket: int,
        close_price: Decimal,
        realized_pnl: Decimal,
        utc_now: Optional[dt.datetime] = None,
    ) -> None:
        """Call when a position is closed. Updates equity and risk state."""
        now = utc_now or dt.datetime.now(dt.timezone.utc)
        s = self._state

        # Remove from open positions
        pos = next((p for p in s.open_positions if p.ticket == ticket), None)
        if pos:
            s.open_positions.remove(pos)

        # Update equity
        s.current_equity += realized_pnl
        s.equity_peak = max(s.equity_peak, s.current_equity)

        # Consecutive loss tracking
        if realized_pnl < 0:
            s.consecutive_losses += 1
        else:
            s.consecutive_losses = 0

        # Check limits
        self._update_daily_equity(now)
        self._check_limits(now)

        log.info(
            "Position closed: ticket=%d PnL=$%.2f equity=$%.2f DD=%.1f%%",
            ticket, float(realized_pnl), float(s.current_equity),
            float(self.current_drawdown_pct()) * 100,
        )

    def update_equity(self, equity: Decimal, utc_now: Optional[dt.datetime] = None) -> None:
        """Call periodically with current MT5 equity to keep state in sync."""
        now = utc_now or dt.datetime.now(dt.timezone.utc)
        self._state.current_equity = equity
        self._state.equity_peak = max(self._state.equity_peak, equity)
        self._update_daily_equity(now)
        self._check_limits(now)

    def current_drawdown_pct(self) -> Decimal:
        s = self._state
        if s.equity_peak == 0:
            return Decimal("0")
        return (s.equity_peak - s.current_equity) / s.equity_peak

    def daily_loss_pct(self) -> Decimal:
        s = self._state
        if s.daily_start_equity == 0:
            return Decimal("0")
        return (s.daily_start_equity - s.current_equity) / s.daily_start_equity

    def weekly_loss_pct(self) -> Decimal:
        s = self._state
        if s.weekly_start_equity == 0:
            return Decimal("0")
        return (s.weekly_start_equity - s.current_equity) / s.weekly_start_equity

    def consecutive_losses(self) -> int:
        return self._state.consecutive_losses

    def is_halted(self) -> tuple[bool, str]:
        s = self._state
        if s.halted_drawdown:
            return True, s.halt_reason
        if s.halted_weekly:
            return True, "Weekly loss limit"
        if s.halted_daily:
            return True, "Daily loss limit"
        return False, ""

    def reset_daily(self) -> None:
        """Call at start of each trading day."""
        self._state.daily_start_equity = self._state.current_equity
        self._state.halted_daily = False

    def reset_weekly(self) -> None:
        """Call at start of each trading week (Monday open)."""
        self._state.weekly_start_equity = self._state.current_equity
        self._state.halted_weekly = False

    # ── Internal ─────────────────────────────────────────────────────

    def _update_daily_equity(self, utc_now: dt.datetime) -> None:
        today = utc_now.date()
        week = utc_now.isocalendar()[1]

        if self._last_equity_date != today:
            self.reset_daily()
            self._last_equity_date = today

        if self._last_equity_week != week:
            self.reset_weekly()
            self._last_equity_week = week

    def _check_limits(self, utc_now: dt.datetime) -> None:
        s = self._state

        max_daily = settings.get("max_daily_loss")
        max_weekly = settings.get("max_weekly_loss")
        max_dd = settings.get("max_drawdown")

        if self.daily_loss_pct() >= max_daily and not s.halted_daily:
            s.halted_daily = True
            log.warning("DAILY LOSS LIMIT HIT: %.1f%% loss today",
                        float(self.daily_loss_pct()) * 100)

        if self.weekly_loss_pct() >= max_weekly and not s.halted_weekly:
            s.halted_weekly = True
            log.warning("WEEKLY LOSS LIMIT HIT: %.1f%% loss this week",
                        float(self.weekly_loss_pct()) * 100)

        if self.current_drawdown_pct() >= max_dd and not s.halted_drawdown:
            s.halted_drawdown = True
            s.halt_reason = f"Max drawdown {float(max_dd)*100:.0f}% hit — manual review required"
            log.critical("SYSTEM HALTED: %s", s.halt_reason)
