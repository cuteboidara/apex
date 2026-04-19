"""
Central configuration — every tunable parameter lives here.
No magic numbers anywhere else in the codebase.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

SETTINGS: dict[str, Any] = {

    # ─── Account ──────────────────────────────────────────────────────
    "initial_equity": Decimal("10000"),
    "account_currency": "USD",

    # ─── Risk Management ──────────────────────────────────────────────
    "risk_per_trade": Decimal("0.01"),          # 1% equity per trade
    "max_daily_loss": Decimal("0.03"),           # 3% → stop for day
    "max_weekly_loss": Decimal("0.05"),          # 5% → stop for week
    "max_drawdown": Decimal("0.10"),             # 10% from peak → halt
    "max_concurrent_positions": 3,
    "max_consecutive_losses": 3,                 # reduce size after N losses
    "consecutive_loss_size_mult": Decimal("0.5"),
    "max_correlated_positions": 2,               # per correlation group
    "max_total_risk_pct": Decimal("0.05"),       # 5% total open risk

    # ─── Signal Filtering ─────────────────────────────────────────────
    "min_confluence_grade": "B",
    "min_rr_ratio": Decimal("2.0"),
    "signal_expiry_minutes": 30,
    "max_spread_multiplier": Decimal("2.0"),     # reject if spread > 2x avg
    "killzone_only": True,

    # ─── Market Structure ─────────────────────────────────────────────
    "swing_lookback": 5,
    "bos_require_body_close": True,
    "internal_structure_tf": "M15",
    "external_structure_tf": "H4",

    # ─── Regime Filter ────────────────────────────────────────────────
    "adx_period": 14,
    "adx_trending_threshold": 25,
    "adx_choppy_threshold": 20,
    "wick_ratio_chop_threshold": Decimal("0.6"),
    "efficiency_ratio_period": 10,
    "bb_period": 20,
    "bb_std": Decimal("2.0"),

    # ─── Liquidity ────────────────────────────────────────────────────
    "equal_level_pip_tolerance": 5,              # pips tolerance for equal H/L
    "sweep_tick_volume_multiplier": Decimal("1.3"),
    "sweep_session_filter_minutes": 10,          # ignore first N min of session
    "sweep_displacement_min_body_ratio": Decimal("0.5"),

    # ─── Order Blocks ─────────────────────────────────────────────────
    "ob_min_strength": Decimal("1.5"),           # impulse / OB range minimum
    "ob_max_mitigation_touches": 1,
    "ob_max_age_candles": 50,
    "fvg_min_atr_ratio": Decimal("0.3"),

    # ─── Confluence Weights (initial — to be optimised by backtester) ─
    "weight_htf_bias": Decimal("25"),
    "weight_sweep": Decimal("20"),
    "weight_poi": Decimal("15"),
    "weight_ltf_confirm": Decimal("15"),
    "weight_session": Decimal("10"),
    "weight_premium_discount": Decimal("10"),
    "weight_tick_volume": Decimal("5"),
    # bonus / penalty defined separately
    "bonus_judas_swing": Decimal("10"),
    "bonus_mtf_ob_confluence": Decimal("10"),
    "bonus_asian_sweep_london": Decimal("5"),
    "penalty_dow_tendency": Decimal("-5"),
    "penalty_high_spread": Decimal("-10"),
    "penalty_near_news_hours": Decimal("-15"),
    "penalty_correlated_open": Decimal("-10"),

    # ─── Execution ────────────────────────────────────────────────────
    "tp1_rr": Decimal("1.5"),
    "tp2_rr": Decimal("3.0"),
    "tp3_rr": Decimal("5.0"),
    "tp1_close_pct": Decimal("0.50"),
    "tp2_close_pct": Decimal("0.30"),
    "trailing_atr_multiplier": Decimal("1.5"),
    "sl_buffer_pips": Decimal("3"),
    "slippage_pips": Decimal("0.5"),
    "limit_order_retry_times": 3,
    "limit_order_retry_delay_ms": 100,

    # ─── Sessions (UTC — adjusted at runtime for DST) ─────────────────
    "killzone_london_start": "07:00",
    "killzone_london_end": "10:00",
    "killzone_ny_start": "12:00",
    "killzone_ny_end": "15:00",
    "killzone_london_close_start": "14:00",
    "killzone_london_close_end": "16:00",
    "friday_cutoff_utc": "19:00",
    "monday_caution_until_utc": "10:00",
    "monday_size_mult": Decimal("0.70"),
    "friday_size_mult": Decimal("0.50"),

    # ─── Data ─────────────────────────────────────────────────────────
    "candle_buffer_size": 500,
    "atr_period": 14,
    "volume_avg_period": 20,

    # ─── Backtesting ──────────────────────────────────────────────────
    "backtest_months": 12,
    "wf_train_months": 8,
    "wf_test_months": 4,
    "wf_step_months": 2,
    "min_backtest_trades": 50,
    "min_profit_factor": Decimal("1.3"),
    "overfit_sharpe_ratio": Decimal("2.0"),      # flag if IS Sharpe > N * OOS Sharpe
    "backtest_spread_asian_mult": Decimal("2.0"), # Asian spread is 2x typical
    "backtest_slippage_market_pips": Decimal("0.5"),

    # ─── Notifications ────────────────────────────────────────────────
    "telegram_enabled": True,
    "telegram_daily_summary_utc": "21:30",
}


def get(key: str) -> Any:
    """Retrieve a setting. Raises KeyError with helpful message if missing."""
    try:
        return SETTINGS[key]
    except KeyError:
        raise KeyError(f"Setting '{key}' not found — check config/settings.py.")
