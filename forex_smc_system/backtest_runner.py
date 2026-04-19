"""
Backtest Runner — standalone entry point.

Usage:
  python backtest_runner.py               # Run walk-forward backtest
  python backtest_runner.py --optimize    # Run Optuna parameter optimization
  python backtest_runner.py --sensitivity swing_lookback  # Sensitivity analysis
  python backtest_runner.py --csv path/to/EURUSD_H1.csv  # Load CSV data

Output:
  - Full performance report printed to console
  - Results saved to database
  - Equity curve data saved to backtest_results.json

DO NOT proceed to live trading until walk-forward OOS metrics show:
  - Win rate > 48%
  - Profit factor > 1.3
  - Sharpe ratio > 0.8
  - Max drawdown < 15%
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import sys
from decimal import Decimal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("apex.backtest")


def run_backtest(args) -> None:
    from database.db import init_db
    init_db()

    # MT5 connection (optional for backtesting — uses cache if available)
    conn = None
    try:
        from config import secrets
        from core.data_feed import MT5Connection
        if secrets.MT5_LOGIN:
            conn = MT5Connection(secrets.MT5_LOGIN, secrets.MT5_PASSWORD, secrets.MT5_SERVER)
            conn.connect()
    except Exception:
        log.info("MT5 not connected — using cached data only.")

    from backtesting.data_loader import DataLoader
    from backtesting.backtester import Backtester

    loader = DataLoader(mt5_conn=conn)

    # Load CSV if provided
    if args.csv:
        symbol = args.csv_symbol or "EURUSD"
        tf = args.csv_tf or "H1"
        loader.load_from_csv(args.csv, symbol, tf)

    # Prefetch all data
    end = dt.datetime.now(dt.timezone.utc)
    from config import settings
    months = settings.get("backtest_months")
    start = end - dt.timedelta(days=30 * months)
    loader.prefetch_all(start, end)

    bt = Backtester(loader)

    if args.optimize:
        log.info("Running parameter optimization with Optuna…")
        from backtesting.optimizer import Optimizer
        optimizer = Optimizer(loader)
        best_params = optimizer.optimize(n_trials=getattr(args, "trials", 200))
        print("\n" + "="*60)
        print("OPTIMAL PARAMETERS FOUND:")
        for k, v in best_params.items():
            print(f"  {k}: {v}")
        print("="*60)
        return

    if args.sensitivity:
        param = args.sensitivity
        from backtesting.optimizer import Optimizer
        optimizer = Optimizer(loader)
        values = _get_sensitivity_range(param)
        results = optimizer.run_sensitivity_analysis(param, values)
        print(f"\nSensitivity analysis for '{param}':")
        for v, sharpe in sorted(results.items(), key=lambda x: x[1], reverse=True):
            print(f"  {param}={v}: OOS Sharpe={sharpe:.3f}")
        return

    # Standard walk-forward backtest
    log.info("Running walk-forward backtest…")
    result = bt.run_walk_forward()

    _print_report(result)
    _save_results(result)

    # Validate minimum criteria
    oos = result.oos_metrics
    passed = all([
        oos.win_rate >= Decimal("0.48"),
        oos.profit_factor >= Decimal("1.3"),
        oos.sharpe >= Decimal("0.8"),
        oos.max_drawdown_pct <= Decimal("0.15"),
        oos.total_trades >= settings.get("min_backtest_trades"),
    ])

    print("\n" + "=" * 60)
    if passed:
        print("✅ SYSTEM PASSED VALIDATION")
        print("   OOS metrics meet minimum criteria.")
        print("   You may proceed to paper trading.")
        print("   Run for 4+ weeks paper trading before going live.")
    else:
        print("❌ SYSTEM FAILED VALIDATION")
        print("   OOS metrics do not meet minimum criteria.")
        print("   Do NOT proceed to live trading.")
        print("   Review the signal logic and re-run optimization.")
    print("=" * 60)

    if conn:
        conn.disconnect()


def _print_report(result) -> None:
    print("\n" + "=" * 60)
    print("WALK-FORWARD BACKTEST RESULTS")
    print("=" * 60)
    print("\n── OVERALL ──")
    print(result.overall_metrics.summary())
    print("\n── OUT-OF-SAMPLE ──")
    print(result.oos_metrics.summary())
    print(f"   Win rate:      {float(result.oos_metrics.win_rate)*100:.1f}%")
    print(f"   Profit factor: {float(result.oos_metrics.profit_factor):.2f}")
    print(f"   Sharpe:        {float(result.oos_metrics.sharpe):.2f}")
    print(f"   Sortino:       {float(result.oos_metrics.sortino):.2f}")
    print(f"   Max drawdown:  {float(result.oos_metrics.max_drawdown_pct)*100:.1f}%")
    print(f"   Expectancy:    {float(result.oos_metrics.expectancy_pips):.1f} pips/trade")
    print(f"   Avg hold:      {float(result.oos_metrics.avg_hold_minutes):.0f} min")
    print(f"   Net P&L:       {float(result.oos_metrics.net_pnl_usd):.2f} USD")

    print("\n── BY WINDOW ──")
    for w in result.windows:
        tag = "[OOS]" if w.is_oos else "[IS] "
        print(f"   {tag} {w.start}–{w.end}: "
              f"{w.metrics.total_trades} trades, "
              f"WR={float(w.metrics.win_rate)*100:.0f}%, "
              f"PF={float(w.metrics.profit_factor):.2f}, "
              f"Sharpe={float(w.metrics.sharpe):.2f}")


def _save_results(result) -> None:
    try:
        data = {
            "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
            "oos_win_rate": float(result.oos_metrics.win_rate),
            "oos_profit_factor": float(result.oos_metrics.profit_factor),
            "oos_sharpe": float(result.oos_metrics.sharpe),
            "oos_max_drawdown": float(result.oos_metrics.max_drawdown_pct),
            "oos_total_trades": result.oos_metrics.total_trades,
        }
        with open("backtest_results.json", "w") as f:
            json.dump(data, f, indent=2)
        log.info("Results saved to backtest_results.json")
    except Exception as e:
        log.error("Could not save results: %s", e)


def _get_sensitivity_range(param: str) -> list[float]:
    ranges = {
        "swing_lookback": [3, 4, 5, 6, 7, 8, 10],
        "adx_trending_threshold": [20, 22, 25, 27, 30],
        "sweep_tick_volume_multiplier": [1.1, 1.3, 1.5, 1.8, 2.0, 2.5],
        "min_rr_ratio": [1.5, 2.0, 2.5, 3.0],
    }
    return ranges.get(param, [1.0, 1.5, 2.0, 2.5, 3.0])


def parse_args():
    p = argparse.ArgumentParser(description="APEX Forex SMC Backtester")
    p.add_argument("--optimize", action="store_true", help="Run Optuna optimization")
    p.add_argument("--sensitivity", type=str, help="Run sensitivity analysis for a parameter")
    p.add_argument("--trials", type=int, default=200, help="Optuna trials (default 200)")
    p.add_argument("--csv", type=str, help="Path to CSV file to load")
    p.add_argument("--csv-symbol", type=str, help="Symbol for CSV file")
    p.add_argument("--csv-tf", type=str, help="Timeframe for CSV file")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_backtest(args)
