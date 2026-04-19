"""
MT5 data feed — live ticks, historical candles, spread monitoring.

Primary  : MetaTrader5 Python API
Fallback : CSV cache (for backtesting without MT5 connection)

All timestamps are converted to UTC on ingestion.
"""

from __future__ import annotations

import datetime as dt
import logging
import sqlite3
import time
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# ── MT5 availability guard ────────────────────────────────────────────
try:
    import MetaTrader5 as mt5
    _MT5_AVAILABLE = True
except ImportError:
    mt5 = None  # type: ignore
    _MT5_AVAILABLE = False
    log.warning("MetaTrader5 package not installed — live trading disabled.")

import pandas as pd

from config import settings

# ── Timeframe mapping ─────────────────────────────────────────────────

MT5_TF: dict[str, int] = {}
if _MT5_AVAILABLE and mt5 is not None:
    MT5_TF = {
        "M1": mt5.TIMEFRAME_M1,
        "M5": mt5.TIMEFRAME_M5,
        "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30,
        "H1": mt5.TIMEFRAME_H1,
        "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
        "W1": mt5.TIMEFRAME_W1,
        "MN1": mt5.TIMEFRAME_MN1,
    }

# Candle duration in seconds (for buffer management)
TF_SECONDS: dict[str, int] = {
    "M1": 60, "M5": 300, "M15": 900, "M30": 1800,
    "H1": 3600, "H4": 14400, "D1": 86400,
    "W1": 604800, "MN1": 2592000,
}


# ── Data classes ─────────────────────────────────────────────────────

@dataclass(slots=True)
class Candle:
    timestamp: dt.datetime   # UTC, open time
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    tick_volume: int          # proxy for volume in Forex
    spread: int               # broker spread in points at open

    def body(self) -> Decimal:
        return abs(self.close - self.open)

    def range(self) -> Decimal:
        return self.high - self.low

    def upper_wick(self) -> Decimal:
        return self.high - max(self.open, self.close)

    def lower_wick(self) -> Decimal:
        return min(self.open, self.close) - self.low

    def is_bullish(self) -> bool:
        return self.close > self.open

    def is_bearish(self) -> bool:
        return self.close < self.open

    def wick_to_body_ratio(self) -> Decimal:
        b = self.body()
        if b == 0:
            return Decimal("999")
        return (self.upper_wick() + self.lower_wick()) / b


@dataclass(slots=True)
class Tick:
    timestamp: dt.datetime
    bid: Decimal
    ask: Decimal
    last: Decimal
    spread_points: int   # ask - bid in points (1 point = 0.00001 for 5-digit brokers)

    def spread_pips(self, digits: int = 5) -> Decimal:
        """Convert spread from points to pips (1 pip = 10 points for 5-digit)."""
        divisor = Decimal("10") if digits >= 4 else Decimal("1")
        return Decimal(str(self.spread_points)) / divisor


@dataclass
class CandleBuffer:
    """In-memory rolling buffer of candles per symbol/timeframe."""
    _data: dict[str, list[Candle]] = field(default_factory=dict)
    _max_size: int = 500

    def __post_init__(self) -> None:
        self._max_size = settings.get("candle_buffer_size")

    def key(self, symbol: str, tf: str) -> str:
        return f"{symbol}:{tf}"

    def append(self, symbol: str, tf: str, candle: Candle) -> None:
        k = self.key(symbol, tf)
        if k not in self._data:
            self._data[k] = []
        buf = self._data[k]
        # update if same timestamp (candle update), else append
        if buf and buf[-1].timestamp == candle.timestamp:
            buf[-1] = candle
        else:
            buf.append(candle)
        if len(buf) > self._max_size:
            self._data[k] = buf[-self._max_size:]

    def extend(self, symbol: str, tf: str, candles: list[Candle]) -> None:
        for c in candles:
            self.append(symbol, tf, c)

    def get(self, symbol: str, tf: str, n: Optional[int] = None) -> list[Candle]:
        buf = self._data.get(self.key(symbol, tf), [])
        return buf[-n:] if n else list(buf)

    def latest(self, symbol: str, tf: str) -> Optional[Candle]:
        buf = self._data.get(self.key(symbol, tf), [])
        return buf[-1] if buf else None

    def size(self, symbol: str, tf: str) -> int:
        return len(self._data.get(self.key(symbol, tf), []))


# ── Data validation ───────────────────────────────────────────────────

def _validate_candle(c: Candle) -> bool:
    if c.high < c.low:
        return False
    if c.tick_volume < 0:
        return False
    if c.open <= 0 or c.close <= 0:
        return False
    if not (c.low <= c.open <= c.high and c.low <= c.close <= c.high):
        return False
    return True


# ── MT5 connection management ─────────────────────────────────────────

class MT5Connection:
    """Manages the MT5 terminal connection with auto-reconnect."""

    def __init__(self, login: int, password: str, server: str, path: str = "") -> None:
        self._login = login
        self._password = password
        self._server = server
        self._path = path
        self._connected = False

    def connect(self) -> bool:
        """Initialize MT5 and log in."""
        if not _MT5_AVAILABLE:
            log.error("MetaTrader5 package not installed.")
            return False

        kwargs: dict = {}
        if self._path:
            kwargs["path"] = self._path

        if not mt5.initialize(**kwargs):
            log.error("MT5 initialize failed: %s", mt5.last_error())
            return False

        if not mt5.login(self._login, password=self._password, server=self._server):
            log.error("MT5 login failed: %s", mt5.last_error())
            mt5.shutdown()
            return False

        info = mt5.account_info()
        log.info("MT5 connected — account %d, equity %.2f %s",
                 info.login, info.equity, info.currency)
        self._connected = True
        return True

    def disconnect(self) -> None:
        if _MT5_AVAILABLE and self._connected:
            mt5.shutdown()
            self._connected = False
            log.info("MT5 disconnected.")

    def is_connected(self) -> bool:
        if not _MT5_AVAILABLE or not self._connected:
            return False
        info = mt5.terminal_info()
        return info is not None and info.connected

    def ensure_connected(self) -> bool:
        if self.is_connected():
            return True
        log.warning("MT5 disconnected — attempting reconnect…")
        return self.connect()


# ── Candle fetching ───────────────────────────────────────────────────

def _rates_to_candles(rates: object) -> list[Candle]:
    """Convert MT5 rates array to Candle list."""
    candles: list[Candle] = []
    if rates is None:
        return candles
    for r in rates:
        c = Candle(
            timestamp=dt.datetime.fromtimestamp(r["time"], tz=dt.timezone.utc),
            open=Decimal(str(r["open"])),
            high=Decimal(str(r["high"])),
            low=Decimal(str(r["low"])),
            close=Decimal(str(r["close"])),
            tick_volume=int(r["tick_volume"]),
            spread=int(r["spread"]),
        )
        if _validate_candle(c):
            candles.append(c)
    return candles


def get_candles(
    symbol: str,
    timeframe: str,
    count: int = 500,
    conn: Optional[MT5Connection] = None,
) -> list[Candle]:
    """
    Fetch the most recent `count` closed candles from MT5.
    Returns an empty list if MT5 is unavailable (uses cache fallback in backtesting).
    """
    if not _MT5_AVAILABLE:
        return []
    if conn and not conn.ensure_connected():
        return []

    tf_val = MT5_TF.get(timeframe)
    if tf_val is None:
        raise ValueError(f"Unknown timeframe: {timeframe}")

    rates = mt5.copy_rates_from_pos(symbol, tf_val, 0, count)
    return _rates_to_candles(rates)


def get_historical_range(
    symbol: str,
    timeframe: str,
    start: dt.datetime,
    end: dt.datetime,
    conn: Optional[MT5Connection] = None,
) -> list[Candle]:
    """Fetch historical candles in a date range from MT5."""
    if not _MT5_AVAILABLE:
        return []
    if conn and not conn.ensure_connected():
        return []

    tf_val = MT5_TF.get(timeframe)
    if tf_val is None:
        raise ValueError(f"Unknown timeframe: {timeframe}")

    rates = mt5.copy_rates_range(symbol, tf_val, start, end)
    return _rates_to_candles(rates)


def get_live_tick(
    symbol: str,
    conn: Optional[MT5Connection] = None,
) -> Optional[Tick]:
    """Return the latest tick for a symbol."""
    if not _MT5_AVAILABLE:
        return None
    if conn and not conn.ensure_connected():
        return None

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return None
    return Tick(
        timestamp=dt.datetime.fromtimestamp(tick.time, tz=dt.timezone.utc),
        bid=Decimal(str(tick.bid)),
        ask=Decimal(str(tick.ask)),
        last=Decimal(str(tick.last)),
        spread_points=tick.ask_raw - tick.bid_raw if hasattr(tick, "ask_raw") else 0,
    )


def get_spread_pips(
    symbol: str,
    conn: Optional[MT5Connection] = None,
) -> Optional[Decimal]:
    """Return current spread in pips for a symbol."""
    if not _MT5_AVAILABLE:
        return None
    if conn and not conn.ensure_connected():
        return None

    tick = mt5.symbol_info_tick(symbol)
    info = mt5.symbol_info(symbol)
    if tick is None or info is None:
        return None
    spread_pts = int(tick.ask / info.point) - int(tick.bid / info.point)
    # 1 pip = 10 points for 5-digit, 1 point for 3-digit (JPY)
    pip_factor = 10 if info.digits in (4, 5) else 1
    return Decimal(str(spread_pts)) / Decimal(str(pip_factor))


def is_market_open_mt5() -> bool:
    """Check if MT5 terminal reports market is open."""
    if not _MT5_AVAILABLE:
        return False
    info = mt5.terminal_info()
    return info is not None and info.trade_allowed


def get_account_equity() -> Optional[Decimal]:
    """Return current account equity from MT5."""
    if not _MT5_AVAILABLE:
        return None
    info = mt5.account_info()
    if info is None:
        return None
    return Decimal(str(info.equity))


# ── Historical data cache (SQLite) ────────────────────────────────────

_CACHE_DB = "candle_cache.db"


def _ensure_cache_db(db_path: str) -> None:
    con = sqlite3.connect(db_path)
    con.execute("""
        CREATE TABLE IF NOT EXISTS candle_cache (
            symbol TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            ts INTEGER NOT NULL,
            open REAL, high REAL, low REAL, close REAL,
            tick_volume INTEGER, spread INTEGER,
            PRIMARY KEY (symbol, timeframe, ts)
        )
    """)
    con.commit()
    con.close()


def cache_candles(
    candles: list[Candle],
    symbol: str,
    timeframe: str,
    db_path: str = _CACHE_DB,
) -> None:
    """Persist candles to local SQLite cache."""
    _ensure_cache_db(db_path)
    con = sqlite3.connect(db_path)
    rows = [
        (symbol, timeframe, int(c.timestamp.timestamp()),
         float(c.open), float(c.high), float(c.low), float(c.close),
         c.tick_volume, c.spread)
        for c in candles
    ]
    con.executemany(
        "INSERT OR REPLACE INTO candle_cache VALUES (?,?,?,?,?,?,?,?,?)", rows
    )
    con.commit()
    con.close()


def load_cached_candles(
    symbol: str,
    timeframe: str,
    start: dt.datetime,
    end: dt.datetime,
    db_path: str = _CACHE_DB,
) -> list[Candle]:
    """Load candles from local SQLite cache."""
    if not Path(db_path).exists():
        return []
    con = sqlite3.connect(db_path)
    rows = con.execute(
        """SELECT ts, open, high, low, close, tick_volume, spread
           FROM candle_cache
           WHERE symbol=? AND timeframe=? AND ts>=? AND ts<?
           ORDER BY ts""",
        (symbol, timeframe,
         int(start.timestamp()), int(end.timestamp())),
    ).fetchall()
    con.close()
    candles: list[Candle] = []
    for r in rows:
        c = Candle(
            timestamp=dt.datetime.fromtimestamp(r[0], tz=dt.timezone.utc),
            open=Decimal(str(r[1])),
            high=Decimal(str(r[2])),
            low=Decimal(str(r[3])),
            close=Decimal(str(r[4])),
            tick_volume=int(r[5]),
            spread=int(r[6]),
        )
        if _validate_candle(c):
            candles.append(c)
    return candles


def get_or_fetch_candles(
    symbol: str,
    timeframe: str,
    start: dt.datetime,
    end: dt.datetime,
    conn: Optional[MT5Connection] = None,
    db_path: str = _CACHE_DB,
) -> list[Candle]:
    """
    Return candles from cache if available, else fetch from MT5 and cache.
    Used by the backtester so historical data is only fetched once.
    """
    cached = load_cached_candles(symbol, timeframe, start, end, db_path)

    # Check coverage — if we have >= 90% of expected candles, use cache
    tf_s = TF_SECONDS.get(timeframe, 3600)
    expected = max(1, int((end - start).total_seconds() / tf_s))
    if len(cached) >= int(expected * 0.9):
        return cached

    # Fetch from MT5
    live = get_historical_range(symbol, timeframe, start, end, conn)
    if live:
        cache_candles(live, symbol, timeframe, db_path)
        return live

    return cached  # return whatever we have


# ── Weekend gap detection ─────────────────────────────────────────────

def detect_weekend_gap(
    candles: list[Candle],
) -> Optional[tuple[Decimal, Decimal]]:
    """
    Check if the most recent candle open follows a weekend gap.
    Returns (friday_close, monday_open) if gap detected, else None.
    """
    if len(candles) < 2:
        return None
    prev = candles[-2]
    curr = candles[-1]
    # Friday → Monday gap
    if prev.timestamp.weekday() == 4 and curr.timestamp.weekday() == 0:
        gap = abs(curr.open - prev.close)
        if gap > 0:
            return prev.close, curr.open
    return None
