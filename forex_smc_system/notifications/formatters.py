"""
Signal and report formatters for Telegram messages.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from core.market_structure import Bias
from core.signal_engine import Signal


def format_signal(signal: Signal) -> str:
    """Format a signal into a clean Telegram message."""
    direction_emoji = "🟢 LONG" if signal.direction == Bias.BULLISH else "🔴 SHORT"
    grade = signal.confluence.grade
    grade_emoji = {"A+": "⭐⭐⭐", "A": "⭐⭐", "B": "⭐"}.get(grade, "")

    lines = [
        f"*{signal.pair}* {direction_emoji} {grade_emoji}",
        f"Grade: `{grade}` ({float(signal.confluence.raw_score):.0f}/100+)",
        f"Session: `{signal.killzone}`",
        "",
        f"📍 Entry:  `{float(signal.entry_price):.5f}`",
        f"🛑 SL:     `{float(signal.stop_loss):.5f}` ({float(signal.sl_pips):.1f} pips)",
        f"🎯 TP1:   `{float(signal.tp1):.5f}` (1:{float(signal.confluence.breakdown.get('tp1_rr', Decimal('1.5'))):.1f})",
        f"🎯 TP2:   `{float(signal.tp2):.5f}`",
        f"🎯 TP3:   `{float(signal.tp3):.5f}`",
        "",
        f"RR: `{float(signal.rr_ratio):.2f}:1` | Spread: `{float(signal.spread_at_signal):.1f}p`",
        f"Regime: `{signal.regime.value}` | HTF: `{signal.htf_bias.value}`",
    ]

    if signal.sweep_type:
        lines.append(f"Sweep: `{signal.sweep_type}`")
    if signal.poi_type:
        lines.append(f"POI: `{signal.poi_type}`")
    if signal.judas_swing:
        lines.append("⚡ *Judas Swing confirmed*")

    lines.append(f"\n_{signal.timestamp.strftime('%H:%M UTC %d %b')}_")
    return "\n".join(lines)


def format_daily_summary(stats: dict) -> str:
    """Format daily performance summary."""
    lines = [
        "📊 *Daily Summary*",
        f"Period: last {stats.get('period_days', 30)} days",
        "",
        f"Signals: {stats.get('total_signals', 0)}",
        f"Wins: {stats.get('wins', 0)} | Losses: {stats.get('losses', 0)}",
        f"Win Rate: *{stats.get('win_rate_pct', 0):.1f}%*",
        f"Avg RR: *{stats.get('avg_realized_rr', 0):.2f}:1*",
        f"Avg MFE: {stats.get('avg_mfe_pips', 0):.1f} pips",
        f"Avg MAE: {stats.get('avg_mae_pips', 0):.1f} pips",
    ]
    return "\n".join(lines)


def format_risk_alert(reason: str, equity: Optional[Decimal] = None) -> str:
    msg = f"⚠️ *RISK ALERT*\n{reason}"
    if equity:
        msg += f"\nCurrent equity: ${float(equity):.2f}"
    return msg
