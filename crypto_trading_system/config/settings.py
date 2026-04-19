"""
Central configuration — every tunable parameter lives here.
No magic numbers anywhere else in the codebase.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

SETTINGS: dict[str, Any] = {
    # ── Risk Management ──────────────────────────────────────────────
    "risk_per_trade": Decimal("0.01"),           # 1 % of equity per trade
    "max_daily_loss": Decimal("0.03"),            # 3 % daily loss → stop
    "max_weekly_loss": Decimal("0.05"),           # 5 % weekly loss → stop
    "max_drawdown": Decimal("0.10"),              # 10 % from peak → halt
    "max_concurrent_positions": 3,
    "max_consecutive_losses": 5,
    "consecutive_loss_size_mult": Decimal("0.5"), # halve size after streak

    # ── Signal Filtering ─────────────────────────────────────────────
    "min_confluence_grade": "B",                  # minimum to emit
    "min_rr_ratio": Decimal("2.0"),               # minimum risk:reward
    "signal_expiry_minutes": 30,                  # cancel unfilled after

    # ── Market Structure ─────────────────────────────────────────────
    "swing_lookback": 5,                          # candles each side
    "bos_require_body_close": True,               # body close, not wick

    # ── Regime Filter ────────────────────────────────────────────────
    "adx_period": 14,
    "adx_trending_threshold": 25,
    "adx_choppy_threshold": 20,
    "efficiency_ratio_period": 20,
    "wick_ratio_chop_threshold": Decimal("0.6"),
    "bb_period": 20,
    "bb_std": Decimal("2.0"),

    # ── Liquidity ────────────────────────────────────────────────────
    "equal_level_tolerance": Decimal("0.001"),    # 0.1 %
    "sweep_volume_multiplier": Decimal("1.5"),    # vs 20-period avg
    "sweep_session_filter_minutes": 5,
    "sweep_displacement_min_body_ratio": Decimal("0.6"),

    # ── Order Blocks / FVG ───────────────────────────────────────────
    "ob_min_impulse_ratio": Decimal("1.5"),       # impulse / OB range
    "ob_max_mitigation_touches": 1,               # weaker on 2nd touch
    "fvg_min_atr_ratio": Decimal("0.3"),          # gap > 30 % ATR

    # ── Confluence weights (initial — backtester will optimise) ──────
    "cw_htf_bias": Decimal("25"),
    "cw_sweep": Decimal("20"),
    "cw_ob_fvg": Decimal("15"),
    "cw_ltf_confirm": Decimal("15"),
    "cw_session": Decimal("10"),
    "cw_volume": Decimal("10"),
    "cw_news": Decimal("5"),

    # ── Execution ────────────────────────────────────────────────────
    "tp1_rr": Decimal("1.5"),
    "tp2_rr": Decimal("3.0"),
    "tp3_rr": Decimal("5.0"),
    "tp1_close_pct": Decimal("0.50"),
    "tp2_close_pct": Decimal("0.30"),
    "trailing_cb_atr_mult": Decimal("1.0"),
    "slippage_pct": Decimal("0.0005"),
    "maker_fee": Decimal("0.0004"),
    "taker_fee": Decimal("0.0006"),
    "sl_atr_buffer_mult": Decimal("0.5"),

    # ── Data ─────────────────────────────────────────────────────────
    "candle_buffer_size": 500,
    "atr_period": 14,
    "volume_avg_period": 20,

    # ── Backtesting ──────────────────────────────────────────────────
    "backtest_months": 6,
    "wf_train_months": 4,
    "wf_test_months": 2,
    "wf_step_months": 1,

    # ── Timeframes (ordered HTF → LTF) ──────────────────────────────
    "htf_timeframes": ["1d", "4h"],
    "mtf_timeframes": ["1h"],
    "ltf_timeframes": ["15m", "5m"],
    "entry_timeframes": ["15m", "5m"],
}


def get(key: str) -> Any:
    """Retrieve a setting or raise KeyError with a helpful message."""
    try:
        return SETTINGS[key]
    except KeyError:
        raise KeyError(f"Setting '{key}' not found. Check config/settings.py.")
