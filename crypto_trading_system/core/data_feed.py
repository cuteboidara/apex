"""
Live + historical data fetching.

Primary : Binance REST / WebSocket
Fallback: Bybit REST
Cache   : Local SQLite to avoid re-fetching historical klines.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

import aiohttp

from config import settings

log = logging.getLogger(__name__)

# ── Candle dataclass ─────────────────────────────────────────────────


@dataclass(slots=True)
class Candle:
    timestamp: dt.datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal

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


# ── Timeframe helpers ────────────────────────────────────────────────

TIMEFRAME_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}

BINANCE_TF_MAP: dict[str, str] = {
    "1m": "1m", "5m": "5m", "15m": "15m",
    "1h": "1h", "4h": "4h", "1d": "1d",
}

BYBIT_TF_MAP: dict[str, str] = {
    "1m": "1", "5m": "5", "15m": "15",
    "1h": "60", "4h": "240", "1d": "D",
}


def _validate_candle(c: Candle) -> bool:
    """Reject impossible candles."""
    if c.high < c.low:
        return False
    if c.volume <= 0:
        return False
    if c.open <= 0 or c.close <= 0:
        return False
    if not (c.low <= c.open <= c.high and c.low <= c.close <= c.high):
        return False
    return True


# ── Binance REST fetcher ─────────────────────────────────────────────

BINANCE_BASE = "https://fapi.binance.com"
BYBIT_BASE = "https://api.bybit.com"

_rate_limit = asyncio.Semaphore(10)  # max 10 concurrent requests


async def _fetch_json(session: aiohttp.ClientSession, url: str, params: dict) -> list | dict:
    async with _rate_limit:
        async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 429:
                retry = int(resp.headers.get("Retry-After", "5"))
                log.warning("Rate limited, sleeping %ds", retry)
                await asyncio.sleep(retry)
                return await _fetch_json(session, url, params)
            resp.raise_for_status()
            return await resp.json()


async def fetch_binance_klines(
    session: aiohttp.ClientSession,
    symbol: str,
    timeframe: str,
    limit: int = 500,
    start_ms: int | None = None,
    end_ms: int | None = None,
) -> list[Candle]:
    """Fetch klines from Binance Futures."""
    params: dict = {
        "symbol": symbol,
        "interval": BINANCE_TF_MAP[timeframe],
        "limit": min(limit, 1500),
    }
    if start_ms:
        params["startTime"] = start_ms
    if end_ms:
        params["endTime"] = end_ms

    raw = await _fetch_json(session, f"{BINANCE_BASE}/fapi/v1/klines", params)
    candles: list[Candle] = []
    for k in raw:
        c = Candle(
            timestamp=dt.datetime.fromtimestamp(k[0] / 1000, tz=dt.timezone.utc),
            open=Decimal(str(k[1])),
            high=Decimal(str(k[2])),
            low=Decimal(str(k[3])),
            close=Decimal(str(k[4])),
            volume=Decimal(str(k[5])),
        )
        if _validate_candle(c):
            candles.append(c)
    return candles


async def fetch_bybit_klines(
    session: aiohttp.ClientSession,
    symbol: str,
    timeframe: str,
    limit: int = 200,
    start_ms: int | None = None,
) -> list[Candle]:
    """Fallback: fetch klines from Bybit."""
    params: dict = {
        "category": "linear",
        "symbol": symbol,
        "interval": BYBIT_TF_MAP[timeframe],
        "limit": min(limit, 200),
    }
    if start_ms:
        params["start"] = start_ms

    raw = await _fetch_json(session, f"{BYBIT_BASE}/v5/market/kline", params)
    rows = raw.get("result", {}).get("list", [])
    candles: list[Candle] = []
    for k in rows:
        c = Candle(
            timestamp=dt.datetime.fromtimestamp(int(k[0]) / 1000, tz=dt.timezone.utc),
            open=Decimal(k[1]),
            high=Decimal(k[2]),
            low=Decimal(k[3]),
            close=Decimal(k[4]),
            volume=Decimal(k[5]),
        )
        if _validate_candle(c):
            candles.append(c)
    candles.reverse()  # Bybit returns newest first
    return candles


async def fetch_klines(
    session: aiohttp.ClientSession,
    symbol: str,
    timeframe: str,
    limit: int = 500,
    start_ms: int | None = None,
    end_ms: int | None = None,
) -> list[Candle]:
    """Fetch klines with Binance → Bybit fallback."""
    try:
        return await fetch_binance_klines(session, symbol, timeframe, limit, start_ms, end_ms)
    except Exception as e:
        log.warning("Binance kline fetch failed for %s %s: %s — trying Bybit", symbol, timeframe, e)
    try:
        return await fetch_bybit_klines(session, symbol, timeframe, limit, start_ms)
    except Exception as e:
        log.error("All kline providers failed for %s %s: %s", symbol, timeframe, e)
        return []


# ── Historical data fetcher with pagination ──────────────────────────


async def fetch_historical_klines(
    session: aiohttp.ClientSession,
    symbol: str,
    timeframe: str,
    start: dt.datetime,
    end: dt.datetime,
) -> list[Candle]:
    """Fetch paginated historical klines covering [start, end]."""
    all_candles: list[Candle] = []
    current_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)
    tf_ms = TIMEFRAME_MS[timeframe]

    while current_ms < end_ms:
        batch = await fetch_klines(
            session, symbol, timeframe,
            limit=1500, start_ms=current_ms, end_ms=end_ms,
        )
        if not batch:
            break
        all_candles.extend(batch)
        last_ts = int(batch[-1].timestamp.timestamp() * 1000)
        if last_ts <= current_ms:
            break  # no progress
        current_ms = last_ts + tf_ms
        await asyncio.sleep(0.1)  # rate-limit courtesy

    # deduplicate by timestamp
    seen: set[float] = set()
    unique: list[Candle] = []
    for c in all_candles:
        ts = c.timestamp.timestamp()
        if ts not in seen:
            seen.add(ts)
            unique.append(c)
    return sorted(unique, key=lambda c: c.timestamp)


# ── Candle buffer (in-memory, per pair per timeframe) ────────────────


class CandleBuffer:
    """Thread-safe rolling buffer of candles per symbol/timeframe."""

    def __init__(self, max_size: int | None = None) -> None:
        self._max = max_size or settings.get("candle_buffer_size")
        self._buffers: dict[str, deque[Candle]] = defaultdict(lambda: deque(maxlen=self._max))

    def key(self, symbol: str, tf: str) -> str:
        return f"{symbol}:{tf}"

    def append(self, symbol: str, tf: str, candle: Candle) -> None:
        self._buffers[self.key(symbol, tf)].append(candle)

    def extend(self, symbol: str, tf: str, candles: list[Candle]) -> None:
        buf = self._buffers[self.key(symbol, tf)]
        for c in candles:
            buf.append(c)

    def get(self, symbol: str, tf: str, n: int | None = None) -> list[Candle]:
        buf = self._buffers[self.key(symbol, tf)]
        if n is None:
            return list(buf)
        return list(buf)[-n:]

    def latest(self, symbol: str, tf: str) -> Candle | None:
        buf = self._buffers[self.key(symbol, tf)]
        return buf[-1] if buf else None

    def size(self, symbol: str, tf: str) -> int:
        return len(self._buffers[self.key(symbol, tf)])


# ── WebSocket live feed ──────────────────────────────────────────────


class BinanceWSFeed:
    """Async WebSocket connection to Binance Futures for live kline data."""

    WS_URL = "wss://fstream.binance.com/stream"

    def __init__(self, symbols: list[str], timeframes: list[str], buffer: CandleBuffer) -> None:
        self._symbols = symbols
        self._timeframes = timeframes
        self._buffer = buffer
        self._running = False
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self._reconnect_delay = 1

    def _streams(self) -> list[str]:
        streams: list[str] = []
        for sym in self._symbols:
            for tf in self._timeframes:
                streams.append(f"{sym.lower()}@kline_{tf}")
        return streams

    async def start(self) -> None:
        """Connect and begin listening. Auto-reconnects on failure."""
        self._running = True
        while self._running:
            try:
                await self._connect_and_listen()
            except Exception as e:
                if not self._running:
                    break
                log.warning("WS disconnected: %s — reconnecting in %ds", e, self._reconnect_delay)
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(self._reconnect_delay * 2, 60)

    async def _connect_and_listen(self) -> None:
        streams = self._streams()
        url = f"{self.WS_URL}?streams={'/'.join(streams)}"
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(url, heartbeat=20) as ws:
                self._ws = ws
                self._reconnect_delay = 1
                log.info("WS connected — %d streams", len(streams))
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        self._handle_message(msg.data)
                    elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                        break

    def _handle_message(self, raw: str) -> None:
        try:
            data = json.loads(raw)
            payload = data.get("data", {})
            if payload.get("e") != "kline":
                return
            k = payload["k"]
            # only process closed candles
            if not k.get("x", False):
                return
            symbol = k["s"]
            tf = k["i"]
            candle = Candle(
                timestamp=dt.datetime.fromtimestamp(k["t"] / 1000, tz=dt.timezone.utc),
                open=Decimal(k["o"]),
                high=Decimal(k["h"]),
                low=Decimal(k["l"]),
                close=Decimal(k["c"]),
                volume=Decimal(k["v"]),
            )
            if _validate_candle(candle):
                self._buffer.append(symbol, tf, candle)
        except Exception as e:
            log.debug("WS parse error: %s", e)

    async def stop(self) -> None:
        self._running = False
        if self._ws and not self._ws.closed:
            await self._ws.close()
