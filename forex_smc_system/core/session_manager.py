"""
Forex session manager.

Tracks:
  - Current session and killzone
  - Asian session range (high/low) → London's primary targets
  - Previous Day High/Low (PDH/PDL)
  - Previous Week High/Low (PWH/PWL)
  - Midnight open price (ICT daily bias)
  - Live spread monitoring per pair per session

All times are UTC. DST is handled by config/sessions.py.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from config import sessions as sess_cfg
from config.sessions import KillzoneName, SessionName
from config.pairs import get_pair
from core.data_feed import Candle, CandleBuffer

log = logging.getLogger(__name__)


# ── Session info snapshot ─────────────────────────────────────────────

@dataclass(slots=True)
class SessionInfo:
    session: SessionName
    killzone: KillzoneName
    is_tradeable_killzone: bool   # True for London/NY open, not Asian
    utc_now: dt.datetime


# ── Price level containers ────────────────────────────────────────────

@dataclass
class DayLevels:
    """Key daily price levels for a symbol."""
    symbol: str
    date: dt.date

    pdh: Optional[Decimal] = None   # Previous Day High
    pdl: Optional[Decimal] = None   # Previous Day Low
    pwh: Optional[Decimal] = None   # Previous Week High
    pwl: Optional[Decimal] = None   # Previous Week Low
    pmh: Optional[Decimal] = None   # Previous Month High
    pml: Optional[Decimal] = None   # Previous Month Low

    asian_high: Optional[Decimal] = None   # Today's Asian session high
    asian_low: Optional[Decimal] = None    # Today's Asian session low
    asian_locked: bool = False              # True once Asian session ends

    midnight_open: Optional[Decimal] = None  # 00:00 UTC candle open price

    today_high: Optional[Decimal] = None
    today_low: Optional[Decimal] = None


# ── Spread tracker ────────────────────────────────────────────────────

@dataclass
class SpreadTracker:
    """Maintains running spread average per pair per session."""
    _history: dict[str, list[Decimal]] = field(default_factory=dict)
    _window: int = 20

    def _key(self, symbol: str, session: str) -> str:
        return f"{symbol}:{session}"

    def record(self, symbol: str, session: str, spread_pips: Decimal) -> None:
        k = self._key(symbol, session)
        if k not in self._history:
            self._history[k] = []
        self._history[k].append(spread_pips)
        if len(self._history[k]) > self._window:
            self._history[k] = self._history[k][-self._window:]

    def average(self, symbol: str, session: str) -> Optional[Decimal]:
        k = self._key(symbol, session)
        vals = self._history.get(k, [])
        if not vals:
            return None
        return sum(vals) / Decimal(str(len(vals)))

    def is_spread_acceptable(
        self,
        symbol: str,
        session: str,
        current_spread: Decimal,
        max_multiplier: Decimal = Decimal("2.0"),
    ) -> bool:
        avg = self.average(symbol, session)
        if avg is None:
            # No history yet — use pair profile typical spread as baseline
            profile = get_pair(symbol)
            if profile is None:
                return True
            session_lower = session.lower()
            if "london" in session_lower:
                avg = profile.typical_spread_london
            elif "new_york" in session_lower or "ny" in session_lower:
                avg = profile.typical_spread_ny
            else:
                avg = profile.typical_spread_asian

        return current_spread <= avg * max_multiplier


# ── Session Manager ───────────────────────────────────────────────────

class SessionManager:
    """
    Central session state tracker.

    Usage:
        mgr = SessionManager(symbols=["EURUSD", "GBPUSD", "USDJPY"])
        mgr.update(utc_now, candle_buffer)
        info = mgr.get_session_info()
        asian_range = mgr.get_asian_range("EURUSD")
    """

    def __init__(self, symbols: list[str]) -> None:
        self._symbols = symbols
        self._levels: dict[str, DayLevels] = {}
        self._spread_tracker = SpreadTracker()
        self._last_update: Optional[dt.datetime] = None
        self._prev_session: SessionName = SessionName.CLOSED

        for sym in symbols:
            self._levels[sym] = DayLevels(symbol=sym, date=dt.date.today())

    # ── Public API ────────────────────────────────────────────────────

    def get_session_info(self, utc_now: Optional[dt.datetime] = None) -> SessionInfo:
        now = utc_now or dt.datetime.now(dt.timezone.utc)
        session = sess_cfg.current_session(now)
        killzone = sess_cfg.current_killzone(now)
        tradeable = sess_cfg.is_killzone(now)
        return SessionInfo(
            session=session,
            killzone=killzone,
            is_tradeable_killzone=tradeable,
            utc_now=now,
        )

    def get_asian_range(self, symbol: str) -> tuple[Optional[Decimal], Optional[Decimal]]:
        lvl = self._levels.get(symbol)
        if lvl is None:
            return None, None
        return lvl.asian_high, lvl.asian_low

    def get_pdh_pdl(self, symbol: str) -> tuple[Optional[Decimal], Optional[Decimal]]:
        lvl = self._levels.get(symbol)
        if lvl is None:
            return None, None
        return lvl.pdh, lvl.pdl

    def get_pwh_pwl(self, symbol: str) -> tuple[Optional[Decimal], Optional[Decimal]]:
        lvl = self._levels.get(symbol)
        if lvl is None:
            return None, None
        return lvl.pwh, lvl.pwl

    def get_midnight_open(self, symbol: str) -> Optional[Decimal]:
        lvl = self._levels.get(symbol)
        return lvl.midnight_open if lvl else None

    def is_spread_acceptable(self, symbol: str, current_spread: Decimal) -> bool:
        from config import settings
        max_mult = settings.get("max_spread_multiplier")
        session_name = sess_cfg.current_session(dt.datetime.now(dt.timezone.utc)).value
        return self._spread_tracker.is_spread_acceptable(
            symbol, session_name, current_spread, max_mult
        )

    def record_spread(self, symbol: str, spread_pips: Decimal) -> None:
        session_name = sess_cfg.current_session(
            dt.datetime.now(dt.timezone.utc)
        ).value
        self._spread_tracker.record(symbol, session_name, spread_pips)

    def get_day_levels(self, symbol: str) -> Optional[DayLevels]:
        return self._levels.get(symbol)

    # ── Update cycle ──────────────────────────────────────────────────

    def update(
        self,
        utc_now: dt.datetime,
        buffer: CandleBuffer,
        spread_by_symbol: Optional[dict[str, Decimal]] = None,
    ) -> None:
        """
        Call once per minute (or on each new candle).
        Updates session levels, Asian range, and spread history.
        """
        session = sess_cfg.current_session(utc_now)
        today = utc_now.date()

        for symbol in self._symbols:
            lvl = self._levels[symbol]

            # Reset daily levels on date change
            if lvl.date != today:
                self._rollover_daily(symbol, lvl, buffer, today)

            # Update Asian range (only while Asian session is active)
            asian_start, asian_end = sess_cfg.asian_session_range_window(today)
            if asian_start <= utc_now < asian_end:
                self._update_asian_range(symbol, lvl, buffer)
            elif utc_now >= asian_end and not lvl.asian_locked:
                lvl.asian_locked = True
                log.debug("%s Asian range locked: H=%.5s L=%.5s",
                          symbol, lvl.asian_high, lvl.asian_low)

            # Update today high/low from H1 buffer
            h1_candles = buffer.get(symbol, "H1")
            if h1_candles:
                today_candles = [
                    c for c in h1_candles
                    if c.timestamp.date() == today
                ]
                if today_candles:
                    lvl.today_high = max(c.high for c in today_candles)
                    lvl.today_low = min(c.low for c in today_candles)

            # Set midnight open (00:00 UTC candle)
            if lvl.midnight_open is None:
                m5_candles = buffer.get(symbol, "M5")
                for c in m5_candles:
                    if (c.timestamp.date() == today
                            and c.timestamp.hour == 0
                            and c.timestamp.minute == 0):
                        lvl.midnight_open = c.open
                        break

            # Record spread
            if spread_by_symbol and symbol in spread_by_symbol:
                self.record_spread(symbol, spread_by_symbol[symbol])

        self._last_update = utc_now
        self._prev_session = session

    def _rollover_daily(
        self,
        symbol: str,
        lvl: DayLevels,
        buffer: CandleBuffer,
        today: dt.date,
    ) -> None:
        """Roll yesterday's levels into PDH/PDL and reset for today."""
        if lvl.today_high is not None:
            lvl.pdh = lvl.today_high
        if lvl.today_low is not None:
            lvl.pdl = lvl.today_low

        # Compute PWH/PWL from D1 buffer
        d1_candles = buffer.get(symbol, "D1")
        if d1_candles and len(d1_candles) >= 7:
            # Last 7 daily candles excluding today
            prev_week = [
                c for c in d1_candles
                if c.timestamp.date() < today
            ][-7:]
            if prev_week:
                lvl.pwh = max(c.high for c in prev_week)
                lvl.pwl = min(c.low for c in prev_week)

        # Reset today's values
        lvl.date = today
        lvl.today_high = None
        lvl.today_low = None
        lvl.asian_high = None
        lvl.asian_low = None
        lvl.asian_locked = False
        lvl.midnight_open = None

        log.debug("%s daily rollover — PDH=%.5s PDL=%.5s", symbol, lvl.pdh, lvl.pdl)

    def _update_asian_range(
        self,
        symbol: str,
        lvl: DayLevels,
        buffer: CandleBuffer,
    ) -> None:
        """Update Asian session high/low from M15 buffer."""
        today = lvl.date
        m15 = buffer.get(symbol, "M15")
        asian_candles = [
            c for c in m15
            if c.timestamp.date() == today and c.timestamp.hour < 9
        ]
        if not asian_candles:
            return
        new_high = max(c.high for c in asian_candles)
        new_low = min(c.low for c in asian_candles)
        if lvl.asian_high is None or new_high > lvl.asian_high:
            lvl.asian_high = new_high
        if lvl.asian_low is None or new_low < lvl.asian_low:
            lvl.asian_low = new_low
