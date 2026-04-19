"""
Performance metrics calculations.

All inputs are trade-level P&L in pips (or USD).
Outputs: Sharpe, Sortino, profit factor, max drawdown, expectancy, etc.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional


@dataclass
class PerformanceMetrics:
    total_trades: int
    wins: int
    losses: int
    win_rate: Decimal
    avg_win_pips: Decimal
    avg_loss_pips: Decimal
    profit_factor: Decimal
    expectancy_pips: Decimal
    avg_rr_realized: Decimal
    sharpe: Decimal
    sortino: Decimal
    max_drawdown_pct: Decimal
    max_drawdown_duration_days: int
    net_pnl_pips: Decimal
    net_pnl_usd: Decimal
    largest_win: Decimal
    largest_loss: Decimal
    avg_hold_minutes: Decimal
    by_pair: dict = None
    by_session: dict = None
    by_regime: dict = None
    by_dow: dict = None
    monthly_pnl: dict = None

    def summary(self) -> str:
        return (
            f"Trades:{self.total_trades} WR:{float(self.win_rate)*100:.1f}% "
            f"PF:{float(self.profit_factor):.2f} Exp:{float(self.expectancy_pips):.1f}pips "
            f"Sharpe:{float(self.sharpe):.2f} MaxDD:{float(self.max_drawdown_pct)*100:.1f}%"
        )


def calculate_metrics(
    pnl_pips: list[Decimal],
    pnl_usd: list[Decimal],
    equity_curve: list[Decimal],
    hold_minutes: list[int],
    pairs: Optional[list[str]] = None,
    sessions: Optional[list[str]] = None,
    regimes: Optional[list[str]] = None,
    days_of_week: Optional[list[int]] = None,
    dates: Optional[list[object]] = None,
    risk_free_rate: float = 0.0,
) -> PerformanceMetrics:
    """
    Compute full performance metrics from a list of trade outcomes.

    pnl_pips : profit/loss per trade in pips (+ve = win, -ve = loss)
    pnl_usd  : profit/loss per trade in USD
    equity_curve : running equity after each trade
    hold_minutes : holding duration per trade
    """
    n = len(pnl_pips)
    if n == 0:
        return _empty_metrics()

    wins = [p for p in pnl_pips if p > 0]
    losses = [p for p in pnl_pips if p <= 0]

    win_count = len(wins)
    loss_count = len(losses)
    win_rate = Decimal(str(win_count)) / Decimal(str(n))
    avg_win = sum(wins) / Decimal(str(len(wins))) if wins else Decimal("0")
    avg_loss = abs(sum(losses) / Decimal(str(len(losses)))) if losses else Decimal("0")

    gross_profit = sum(p for p in pnl_pips if p > 0)
    gross_loss = abs(sum(p for p in pnl_pips if p < 0))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else Decimal("999")

    expectancy = win_rate * avg_win - (1 - win_rate) * avg_loss
    avg_rr = avg_win / avg_loss if avg_loss > 0 else Decimal("0")

    net_pnl_pips = sum(pnl_pips)
    net_pnl_usd = sum(pnl_usd)

    largest_win = max(pnl_pips) if pnl_pips else Decimal("0")
    largest_loss = min(pnl_pips) if pnl_pips else Decimal("0")
    avg_hold = (sum(Decimal(str(h)) for h in hold_minutes)
                / Decimal(str(n))) if hold_minutes else Decimal("0")

    # ── Sharpe / Sortino (using USD returns) ──
    sharpe, sortino = _calc_sharpe_sortino(pnl_usd, risk_free_rate)

    # ── Max Drawdown ──
    max_dd_pct, max_dd_days = _calc_max_drawdown(equity_curve, dates)

    # ── Breakdowns ──
    by_pair = _group_metrics(pnl_pips, pairs) if pairs else None
    by_session = _group_metrics(pnl_pips, sessions) if sessions else None
    by_regime = _group_metrics(pnl_pips, regimes) if regimes else None
    by_dow = _group_metrics(pnl_pips, [str(d) for d in days_of_week]) if days_of_week else None
    monthly_pnl = _monthly_pnl(pnl_usd, dates) if dates else None

    return PerformanceMetrics(
        total_trades=n,
        wins=win_count,
        losses=loss_count,
        win_rate=win_rate,
        avg_win_pips=avg_win,
        avg_loss_pips=avg_loss,
        profit_factor=profit_factor,
        expectancy_pips=expectancy,
        avg_rr_realized=avg_rr,
        sharpe=sharpe,
        sortino=sortino,
        max_drawdown_pct=max_dd_pct,
        max_drawdown_duration_days=max_dd_days,
        net_pnl_pips=net_pnl_pips,
        net_pnl_usd=net_pnl_usd,
        largest_win=largest_win,
        largest_loss=largest_loss,
        avg_hold_minutes=avg_hold,
        by_pair=by_pair,
        by_session=by_session,
        by_regime=by_regime,
        by_dow=by_dow,
        monthly_pnl=monthly_pnl,
    )


def _calc_sharpe_sortino(
    pnl_usd: list[Decimal],
    risk_free_rate: float = 0.0,
) -> tuple[Decimal, Decimal]:
    if len(pnl_usd) < 2:
        return Decimal("0"), Decimal("0")
    floats = [float(p) for p in pnl_usd]
    n = len(floats)
    mean = sum(floats) / n
    variance = sum((x - mean) ** 2 for x in floats) / n
    std = math.sqrt(variance)
    if std == 0:
        return Decimal("0"), Decimal("0")

    # Annualise assuming ~250 trading days, ~3 trades/day
    annual_factor = math.sqrt(250 * 3)
    sharpe = Decimal(str((mean - risk_free_rate) / std * annual_factor))

    # Sortino: only downside deviation
    downside = [min(x - risk_free_rate, 0) for x in floats]
    down_var = sum(d ** 2 for d in downside) / n
    down_std = math.sqrt(down_var)
    sortino = Decimal(str((mean - risk_free_rate) / down_std * annual_factor)) if down_std > 0 else Decimal("0")

    return sharpe, sortino


def _calc_max_drawdown(
    equity: list[Decimal],
    dates: Optional[list] = None,
) -> tuple[Decimal, int]:
    """Returns (max_drawdown_pct, duration_in_days)."""
    if not equity:
        return Decimal("0"), 0
    peak = equity[0]
    peak_idx = 0
    max_dd = Decimal("0")
    max_dd_days = 0

    for i, eq in enumerate(equity):
        if eq > peak:
            peak = eq
            peak_idx = i
        dd = (peak - eq) / peak if peak > 0 else Decimal("0")
        if dd > max_dd:
            max_dd = dd
            if dates and peak_idx < len(dates) and i < len(dates):
                try:
                    delta = dates[i] - dates[peak_idx]
                    max_dd_days = delta.days
                except Exception:
                    max_dd_days = i - peak_idx

    return max_dd, max_dd_days


def _group_metrics(pnl: list[Decimal], groups: list[str]) -> dict:
    """Group P&L by a categorical label."""
    grouped: dict[str, list[Decimal]] = {}
    for p, g in zip(pnl, groups):
        if g not in grouped:
            grouped[g] = []
        grouped[g].append(p)
    result: dict[str, dict] = {}
    for g, pnls in grouped.items():
        wins = [p for p in pnls if p > 0]
        result[g] = {
            "trades": len(pnls),
            "win_rate": len(wins) / len(pnls),
            "net_pips": float(sum(pnls)),
        }
    return result


def _monthly_pnl(pnl_usd: list[Decimal], dates: list) -> dict:
    monthly: dict[str, Decimal] = {}
    for p, d in zip(pnl_usd, dates):
        try:
            key = f"{d.year}-{d.month:02d}"
        except AttributeError:
            key = str(d)[:7]
        monthly[key] = monthly.get(key, Decimal("0")) + p
    return {k: float(v) for k, v in monthly.items()}


def _empty_metrics() -> PerformanceMetrics:
    z = Decimal("0")
    return PerformanceMetrics(
        total_trades=0, wins=0, losses=0, win_rate=z,
        avg_win_pips=z, avg_loss_pips=z, profit_factor=z,
        expectancy_pips=z, avg_rr_realized=z, sharpe=z, sortino=z,
        max_drawdown_pct=z, max_drawdown_duration_days=0,
        net_pnl_pips=z, net_pnl_usd=z, largest_win=z, largest_loss=z,
        avg_hold_minutes=z,
    )
