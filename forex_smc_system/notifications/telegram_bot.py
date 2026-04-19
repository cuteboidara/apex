"""
Telegram notification bot.

Sends:
  - Signal alerts (on every emitted signal)
  - Trade updates (TP1/TP2/SL hit)
  - Daily P&L summary
  - Risk alerts (drawdown warnings, system halts)
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
from decimal import Decimal
from typing import Optional

from config import settings
from core.signal_engine import Signal
from notifications.formatters import format_signal, format_daily_summary, format_risk_alert

log = logging.getLogger(__name__)

try:
    from telegram import Bot
    from telegram.constants import ParseMode
    _TELEGRAM_AVAILABLE = True
except ImportError:
    _TELEGRAM_AVAILABLE = False
    log.warning("python-telegram-bot not installed — Telegram alerts disabled.")


class TelegramNotifier:
    """
    Sends formatted messages to a Telegram chat.

    Usage:
        notifier = TelegramNotifier(token="...", chat_id="...")
        await notifier.send_signal(signal)
    """

    def __init__(
        self,
        token: Optional[str] = None,
        chat_id: Optional[str] = None,
    ) -> None:
        self._enabled = settings.get("telegram_enabled") and _TELEGRAM_AVAILABLE
        self._token = token
        self._chat_id = chat_id
        self._bot: Optional[object] = None

        if self._enabled and token and chat_id:
            try:
                self._bot = Bot(token=token)
            except Exception as e:
                log.error("Telegram bot init failed: %s", e)
                self._enabled = False

    async def send_signal(self, signal: Signal) -> None:
        """Send a signal alert."""
        if not self._enabled:
            return
        text = format_signal(signal)
        await self._send(text)

    async def send_daily_summary(self, stats: dict) -> None:
        """Send the daily performance summary."""
        if not self._enabled:
            return
        text = format_daily_summary(stats)
        await self._send(text)

    async def send_risk_alert(self, reason: str, equity: Optional[Decimal] = None) -> None:
        """Send a risk warning."""
        if not self._enabled:
            return
        text = format_risk_alert(reason, equity)
        await self._send(text)

    async def send_trade_update(self, message: str) -> None:
        """Send a generic trade update (TP/SL hit, partial close)."""
        if not self._enabled:
            return
        await self._send(message)

    async def _send(self, text: str) -> None:
        if not self._bot or not self._chat_id:
            log.debug("[Telegram disabled] %s", text[:60])
            return
        try:
            await self._bot.send_message(
                chat_id=self._chat_id,
                text=text,
                parse_mode=ParseMode.MARKDOWN,
            )
        except Exception as e:
            log.error("Telegram send failed: %s", e)

    def send_sync(self, text: str) -> None:
        """Synchronous wrapper for use outside async context."""
        try:
            asyncio.run(self._send(text))
        except RuntimeError:
            asyncio.get_event_loop().run_until_complete(self._send(text))
