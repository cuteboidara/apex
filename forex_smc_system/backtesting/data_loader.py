"""
Historical data loader for backtesting.

Sources (in order):
  1. Local SQLite cache (fastest)
  2. MT5 historical data (if connected)
  3. CSV files from Dukascopy/FXCM (if MT5 unavailable)

Stores fetched data in the cache so it's only downloaded once.
"""

from __future__ import annotations

import csv
import datetime as dt
import logging
from decimal import Decimal
from pathlib import Path
from typing import Optional

from core.data_feed import (
    Candle, cache_candles, load_cached_candles,
    get_or_fetch_candles, MT5Connection,
)
from config.pairs import ACTIVE_PAIRS
from config import settings

log = logging.getLogger(__name__)

TIMEFRAMES = ["M5", "M15", "H1", "H4", "D1"]


class DataLoader:
    """
    Loads and caches historical candle data for all active pairs.

    Usage:
        loader = DataLoader(mt5_conn=conn)
        candles = loader.get(symbol="EURUSD", tf="H1", start=..., end=...)
    """

    def __init__(
        self,
        mt5_conn: Optional[MT5Connection] = None,
        cache_db: str = "candle_cache.db",
    ) -> None:
        self._conn = mt5_conn
        self._cache = cache_db

    def get(
        self,
        symbol: str,
        tf: str,
        start: dt.datetime,
        end: dt.datetime,
    ) -> list[Candle]:
        """
        Return candles for a symbol/timeframe/range.
        Uses cache first, falls back to MT5, logs a warning if empty.
        """
        candles = get_or_fetch_candles(symbol, tf, start, end, self._conn, self._cache)
        if not candles:
            log.warning("No candles for %s %s %s–%s", symbol, tf,
                        start.date(), end.date())
        return candles

    def prefetch_all(
        self,
        start: dt.datetime,
        end: dt.datetime,
        symbols: Optional[list[str]] = None,
        timeframes: Optional[list[str]] = None,
    ) -> None:
        """
        Pre-fetch and cache data for all active pairs and timeframes.
        Run this once before starting the backtester.
        """
        syms = symbols or list(ACTIVE_PAIRS.keys())
        tfs = timeframes or TIMEFRAMES
        for sym in syms:
            for tf in tfs:
                log.info("Prefetching %s %s %s–%s…", sym, tf,
                         start.date(), end.date())
                self.get(sym, tf, start, end)

    def load_from_csv(
        self,
        csv_path: str,
        symbol: str,
        tf: str,
        date_col: str = "datetime",
        date_fmt: str = "%Y-%m-%d %H:%M:%S",
    ) -> list[Candle]:
        """
        Load candles from a Dukascopy/FXCM-style CSV and cache them.

        Expected columns: datetime, open, high, low, close, volume
        """
        candles: list[Candle] = []
        path = Path(csv_path)
        if not path.exists():
            log.error("CSV not found: %s", csv_path)
            return candles

        with path.open("r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    ts = dt.datetime.strptime(row[date_col], date_fmt).replace(
                        tzinfo=dt.timezone.utc
                    )
                    c = Candle(
                        timestamp=ts,
                        open=Decimal(row["open"]),
                        high=Decimal(row["high"]),
                        low=Decimal(row["low"]),
                        close=Decimal(row["close"]),
                        tick_volume=int(float(row.get("volume", row.get("tick_volume", "1")))),
                        spread=0,
                    )
                    candles.append(c)
                except (KeyError, ValueError) as e:
                    log.debug("Skipping bad CSV row: %s", e)

        if candles:
            cache_candles(candles, symbol, tf, self._cache)
            log.info("Loaded %d candles from CSV for %s %s", len(candles), symbol, tf)

        return candles
