"""
Forex position sizer — pip-value aware lot calculation.

Pip values:
  XXX/USD pairs (EURUSD, GBPUSD): pip = $10 per standard lot
  USD/XXX pairs (USDJPY, USDCHF): pip = $10 / current_rate * 100
  Cross pairs: calculated through USD conversion

Sizing formula:
  1. risk_amount = equity * risk_pct
  2. sl_pips = |entry - sl| / pip_size
  3. lot_size = risk_amount / (sl_pips * pip_value_per_lot)

Adjustments:
  - Volatility: if ATR > 1.5x 20-period avg, reduce by 30%
  - Correlation: if correlated pair open, reduce by 50%
  - Consecutive losses: reduce by 50% after N losses
  - Friday: reduce by 50% after 18:00 UTC
  - Monday: reduce by 30% until 10:00 UTC
  - Kelly criterion: applied after 100+ backtest trades
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from config import settings
from config.pairs import get_pair, pip_value
from config.sessions import is_friday_cutoff, is_monday_caution

log = logging.getLogger(__name__)

try:
    import MetaTrader5 as mt5
    _MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    _MT5_AVAILABLE = False


# ── Sizing context ────────────────────────────────────────────────────

@dataclass
class SizingContext:
    symbol: str
    equity: Decimal
    entry: Decimal
    sl: Decimal
    utc_now: dt.datetime
    current_atr: Optional[Decimal] = None
    avg_atr: Optional[Decimal] = None
    consecutive_losses: int = 0
    correlated_open: bool = False
    kelly_win_rate: Optional[Decimal] = None
    kelly_avg_rr: Optional[Decimal] = None


# ── Pip value calculation ─────────────────────────────────────────────

def get_live_pip_value(symbol: str, lot_size: Decimal = Decimal("1.0")) -> Decimal:
    """
    Get pip value in account USD from MT5, or fall back to stored estimate.
    """
    if _MT5_AVAILABLE and mt5 is not None:
        try:
            info = mt5.symbol_info(symbol)
            if info:
                # MT5 returns tick_value for one tick of one standard lot
                tick_value = Decimal(str(info.trade_tick_value))
                tick_size = Decimal(str(info.trade_tick_size))
                point = Decimal(str(info.point))
                pip_size = point * Decimal("10") if info.digits in (4, 5) else point
                pv = tick_value * (pip_size / tick_size)
                return pv * lot_size
        except Exception as e:
            log.debug("MT5 pip value failed for %s: %s", symbol, e)

    # Fallback to stored estimate
    return pip_value(symbol, lot_size)


# ── Kelly criterion ───────────────────────────────────────────────────

def kelly_fraction(win_rate: Decimal, avg_rr: Decimal) -> Decimal:
    """
    Kelly % = W - (1-W)/R   where W=win_rate, R=avg win/avg loss

    Returns half-Kelly for safety (standard practice in trading).
    Capped at 5% to prevent over-sizing.
    """
    if avg_rr <= 0:
        return Decimal("0")
    k = win_rate - (1 - win_rate) / avg_rr
    half_k = k / Decimal("2")
    return max(Decimal("0"), min(half_k, Decimal("0.05")))


# ── Main lot size calculator ──────────────────────────────────────────

def calculate_lot_size(ctx: SizingContext) -> Decimal:
    """
    Calculate lot size applying all adjustments.

    Returns the final lot size rounded to the pair's lot_step.
    """
    profile = get_pair(ctx.symbol)
    if profile is None:
        log.error("Unknown symbol: %s", ctx.symbol)
        return Decimal("0.01")

    # ── Base size ──
    risk_pct = settings.get("risk_per_trade")
    risk_usd = ctx.equity * risk_pct

    sl_distance = abs(ctx.entry - ctx.sl)
    pip_size = profile.pip_size
    sl_pips = sl_distance / pip_size
    if sl_pips == 0:
        log.warning("SL pips is 0 for %s — returning min lot", ctx.symbol)
        return profile.min_lot

    pip_val = get_live_pip_value(ctx.symbol, Decimal("1.0"))
    if pip_val == 0:
        log.warning("Pip value is 0 for %s — returning min lot", ctx.symbol)
        return profile.min_lot

    base_lots = risk_usd / (sl_pips * pip_val)

    # ── Kelly override ──
    if (ctx.kelly_win_rate is not None and ctx.kelly_avg_rr is not None):
        k_frac = kelly_fraction(ctx.kelly_win_rate, ctx.kelly_avg_rr)
        if k_frac > 0:
            kelly_lots = (ctx.equity * k_frac) / (sl_pips * pip_val)
            # Use the lower of base and Kelly
            base_lots = min(base_lots, kelly_lots)

    # ── Adjustments ──
    adj = Decimal("1.0")

    # Volatility adjustment
    if ctx.current_atr is not None and ctx.avg_atr is not None and ctx.avg_atr > 0:
        atr_ratio = ctx.current_atr / ctx.avg_atr
        if atr_ratio > Decimal("1.5"):
            adj *= Decimal("0.70")
            log.debug("%s volatility adj 0.70 (ATR ratio %.2f)", ctx.symbol, float(atr_ratio))

    # Correlation adjustment
    if ctx.correlated_open:
        adj *= Decimal("0.50")
        log.debug("%s correlation adj 0.50", ctx.symbol)

    # Consecutive loss reduction
    max_consec = settings.get("max_consecutive_losses")
    if ctx.consecutive_losses >= max_consec:
        consec_mult = settings.get("consecutive_loss_size_mult")
        adj *= consec_mult
        log.debug("%s consecutive loss adj %.2f (%d losses)",
                  ctx.symbol, float(consec_mult), ctx.consecutive_losses)

    # Friday adjustment
    if is_friday_cutoff(ctx.utc_now):
        adj *= settings.get("friday_size_mult")
        log.debug("%s Friday adj %.2f", ctx.symbol, float(settings.get("friday_size_mult")))

    # Monday adjustment
    elif is_monday_caution(ctx.utc_now):
        adj *= settings.get("monday_size_mult")
        log.debug("%s Monday adj %.2f", ctx.symbol, float(settings.get("monday_size_mult")))

    final_lots = base_lots * adj

    # ── Clamp and round ──
    final_lots = max(profile.min_lot, min(final_lots, profile.max_lot))
    final_lots = (final_lots / profile.lot_step).to_integral_value() * profile.lot_step

    # ── Max 5% total equity risk sanity check ──
    max_total_risk = settings.get("max_total_risk_pct")
    max_lots_by_risk = (ctx.equity * max_total_risk) / (sl_pips * pip_val)
    final_lots = min(final_lots, max_lots_by_risk)

    log.debug(
        "%s lot size: base=%.2f adj=%.2f final=%.2f (SL=%.1f pips, risk=$%.2f)",
        ctx.symbol, float(base_lots), float(adj),
        float(final_lots), float(sl_pips), float(risk_usd),
    )

    return max(profile.min_lot, final_lots)
