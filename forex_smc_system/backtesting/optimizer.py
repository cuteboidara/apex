"""
Parameter optimizer using Optuna (Bayesian optimization).

Objective: maximize OOS Sharpe ratio subject to:
  - Minimum 50 trades in backtest
  - Profit factor >= 1.3
  - OOS Sharpe >= 0.5
  - IS Sharpe not more than 2x OOS Sharpe (anti-overfit check)

Usage:
    optimizer = Optimizer(loader)
    best = optimizer.optimize(n_trials=200)
    print(best)
"""

from __future__ import annotations

import datetime as dt
import logging
from decimal import Decimal
from typing import Any, Optional

try:
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    _OPTUNA_AVAILABLE = True
except ImportError:
    _OPTUNA_AVAILABLE = False

from backtesting.backtester import Backtester
from backtesting.data_loader import DataLoader
from backtesting.metrics import PerformanceMetrics
from config import settings

log = logging.getLogger(__name__)


class Optimizer:
    """
    Bayesian parameter optimizer for the Forex SMC system.

    Only optimizes on out-of-sample data to prevent overfitting.
    """

    # Parameter search space
    PARAM_SPACE: dict[str, tuple] = {
        # (type, low, high[, step])
        "swing_lookback":            ("int",     3,    10,   1),
        "adx_trending_threshold":    ("int",    20,    32,   1),
        "adx_choppy_threshold":      ("int",    15,    23,   1),
        "sweep_tick_volume_multiplier": ("float", 1.1, 2.5, 0.1),
        "ob_min_strength":           ("float",  1.2,   3.0, 0.1),
        "fvg_min_atr_ratio":         ("float",  0.2,   0.6, 0.05),
        "min_rr_ratio":              ("float",  1.5,   3.5, 0.25),
        "sl_buffer_pips":            ("float",  1.0,  10.0, 0.5),
        "tp1_rr":                    ("float",  1.2,   2.5, 0.1),
        "tp2_rr":                    ("float",  2.5,   5.0, 0.25),
        "weight_htf_bias":           ("float", 15.0,  35.0, 1.0),
        "weight_sweep":              ("float", 10.0,  30.0, 1.0),
        "weight_poi":                ("float",  8.0,  20.0, 1.0),
        "weight_ltf_confirm":        ("float",  8.0,  20.0, 1.0),
        "weight_session":            ("float",  5.0,  15.0, 1.0),
        "weight_premium_discount":   ("float",  5.0,  15.0, 1.0),
    }

    def __init__(self, loader: DataLoader) -> None:
        if not _OPTUNA_AVAILABLE:
            raise ImportError("optuna is required for parameter optimization. "
                              "Install with: pip install optuna")
        self._loader = loader

    def optimize(
        self,
        n_trials: int = 200,
        start_override: Optional[dt.datetime] = None,
        end_override: Optional[dt.datetime] = None,
    ) -> dict[str, Any]:
        """
        Run Optuna optimization. Returns the best parameter set found.
        """
        study = optuna.create_study(
            direction="maximize",
            sampler=optuna.samplers.TPESampler(seed=42),
            pruner=optuna.pruners.MedianPruner(),
        )
        study.optimize(
            lambda trial: self._objective(trial),
            n_trials=n_trials,
            show_progress_bar=True,
        )

        best = study.best_params
        log.info("Best OOS Sharpe: %.3f | Params: %s",
                 study.best_value, best)

        # Detect overfitting
        best_trial = study.best_trial
        if "is_sharpe" in best_trial.user_attrs:
            is_s = best_trial.user_attrs["is_sharpe"]
            oos_s = study.best_value
            overfit_ratio = settings.get("overfit_sharpe_ratio")
            if is_s > oos_s * float(overfit_ratio):
                log.warning(
                    "OVERFIT WARNING: IS Sharpe %.2f is %.1fx OOS Sharpe %.2f",
                    is_s, is_s / oos_s if oos_s > 0 else 0, oos_s,
                )

        return best

    def _objective(self, trial) -> float:
        """Optuna objective function — returns OOS Sharpe or -1 if invalid."""
        overrides = self._sample_params(trial)
        backtester = Backtester(self._loader, settings_override=overrides)

        try:
            result = backtester.run_walk_forward()
        except Exception as e:
            log.debug("Trial failed: %s", e)
            return -1.0

        oos = result.oos_metrics
        is_m = result.overall_metrics

        # Hard constraints
        min_trades = settings.get("min_backtest_trades")
        min_pf = settings.get("min_profit_factor")
        if oos.total_trades < min_trades:
            return -1.0
        if oos.profit_factor < min_pf:
            return -1.0
        if oos.win_rate < Decimal("0.40"):
            return -1.0

        # Store IS Sharpe for overfit detection
        trial.set_user_attr("is_sharpe", float(is_m.sharpe))
        trial.set_user_attr("oos_trades", oos.total_trades)
        trial.set_user_attr("oos_win_rate", float(oos.win_rate))
        trial.set_user_attr("oos_profit_factor", float(oos.profit_factor))

        return float(oos.sharpe)

    def _sample_params(self, trial) -> dict[str, Any]:
        overrides: dict[str, Any] = {}
        for name, spec in self.PARAM_SPACE.items():
            ptype = spec[0]
            low, high = spec[1], spec[2]
            step = spec[3] if len(spec) > 3 else None
            if ptype == "int":
                overrides[name] = Decimal(str(trial.suggest_int(name, low, high, step=step or 1)))
            elif ptype == "float":
                overrides[name] = Decimal(str(trial.suggest_float(name, low, high, step=step)))
        return overrides

    def run_sensitivity_analysis(
        self,
        param_name: str,
        values: list[float],
    ) -> dict[str, float]:
        """
        Sweep a single parameter across `values` and record OOS Sharpe for each.
        Useful for understanding parameter sensitivity.
        """
        results: dict[str, float] = {}
        for v in values:
            override = {param_name: Decimal(str(v))}
            bt = Backtester(self._loader, settings_override=override)
            try:
                r = bt.run_walk_forward()
                results[str(v)] = float(r.oos_metrics.sharpe)
            except Exception as e:
                log.debug("Sensitivity %s=%s failed: %s", param_name, v, e)
                results[str(v)] = -1.0
        return results
