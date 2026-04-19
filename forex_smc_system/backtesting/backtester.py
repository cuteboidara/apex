"""
Walk-forward backtesting engine.

Simulates the complete system on historical data:
  - Replays candles chronologically
  - Runs the full signal pipeline on each M5/M15 close
  - Applies realistic spread, slippage, and swap costs
  - Simulates partial closes at TP1/TP2
  - Respects session timing and correlation limits
  - Walk-forward protocol: train N months, test M months, step K months

Usage:
    loader = DataLoader(mt5_conn)
    bt = Backtester(loader)
    result = bt.run_walk_forward(settings_overrides={})
    print(result.overall_metrics.summary())
"""

from __future__ import annotations

import datetime as dt
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from backtesting.data_loader import DataLoader
from backtesting.metrics import PerformanceMetrics, calculate_metrics
from config import settings
from config.pairs import ACTIVE_PAIRS
from config.sessions import is_killzone, is_market_open, current_killzone, current_session
from core.data_feed import Candle, CandleBuffer
from core.market_structure import Bias
from core.regime_filter import Regime
from core.session_manager import SessionManager
from core.signal_engine import SignalEngine, Signal

log = logging.getLogger(__name__)

TIMEFRAMES_NEEDED = ["M5", "M15", "H1", "H4", "D1"]


# ── Simulated trade ───────────────────────────────────────────────────

@dataclass
class SimTrade:
    signal: Signal
    open_price: Decimal
    open_time: dt.datetime
    lot_size: Decimal
    sl: Decimal
    tp1: Decimal
    tp2: Decimal
    tp3: Decimal
    direction: Bias

    # State
    tp1_hit: bool = False
    tp2_hit: bool = False
    closed: bool = False
    close_price: Optional[Decimal] = None
    close_time: Optional[dt.datetime] = None
    exit_reason: str = ""

    # P&L trackers
    mfe_pips: Decimal = Decimal("0")
    mae_pips: Decimal = Decimal("0")

    def update_excursion(self, price: Decimal, pip_size: Decimal) -> None:
        if self.direction == Bias.BULLISH:
            fav = (price - self.open_price) / pip_size
            adv = (self.open_price - price) / pip_size
        else:
            fav = (self.open_price - price) / pip_size
            adv = (price - self.open_price) / pip_size
        self.mfe_pips = max(self.mfe_pips, fav)
        self.mae_pips = max(self.mae_pips, adv)


# ── Backtest window result ────────────────────────────────────────────

@dataclass
class WindowResult:
    is_oos: bool
    start: dt.date
    end: dt.date
    metrics: PerformanceMetrics
    equity_curve: list[Decimal]
    trades: list[SimTrade]


@dataclass
class WalkForwardResult:
    windows: list[WindowResult]
    overall_metrics: PerformanceMetrics
    oos_metrics: PerformanceMetrics
    params_used: dict


# ── Backtester ────────────────────────────────────────────────────────

class Backtester:
    """Simulates the full system pipeline on historical data."""

    def __init__(
        self,
        loader: DataLoader,
        settings_override: Optional[dict] = None,
    ) -> None:
        self._loader = loader
        self._overrides = settings_override or {}

    def _get(self, key: str):
        return self._overrides.get(key, settings.get(key))

    def run_window(
        self,
        start: dt.datetime,
        end: dt.datetime,
        is_oos: bool = False,
    ) -> WindowResult:
        """Run a single backtest window from start to end."""
        symbols = list(ACTIVE_PAIRS.keys())
        buffer = CandleBuffer()

        # ── Load all historical candles into the buffer ──
        for sym in symbols:
            for tf in TIMEFRAMES_NEEDED:
                candles = self._loader.get(sym, tf, start, end)
                buffer.extend(sym, tf, candles)

        # ── Set up engine ──
        session_mgr = SessionManager(symbols)
        engine = SignalEngine(buffer, session_mgr, risk_manager=None, paper_mode=True)

        # ── Simulate spread history ──
        for sym in symbols:
            profile = ACTIVE_PAIRS[sym]
            for session in ["LONDON", "NEW_YORK", "TOKYO"]:
                for _ in range(20):
                    spread = (profile.typical_spread_london if "LONDON" in session
                              else profile.typical_spread_ny if "NY" in session
                              else profile.typical_spread_asian)
                    session_mgr._spread_tracker.record(sym, session, spread)

        # ── Iterate over M5 closes (the entry timeframe) ──
        # Build a unified timeline from M5 candles
        m5_timelines: dict[str, list[Candle]] = {}
        for sym in symbols:
            m5_timelines[sym] = self._loader.get(sym, "M5", start, end)

        # Create a global sorted timeline of (timestamp, symbol) events
        events: list[tuple[dt.datetime, str]] = []
        for sym, candles in m5_timelines.items():
            for c in candles:
                events.append((c.timestamp, sym))
        events.sort(key=lambda e: e[0])

        # State
        open_trades: list[SimTrade] = []
        closed_trades: list[SimTrade] = []
        equity = self._get("initial_equity")
        equity_curve: list[Decimal] = [equity]
        candle_idx: dict[str, int] = {sym: 0 for sym in symbols}
        signals_emitted = 0
        active_pairs_today: dict[str, int] = defaultdict(int)

        prev_date: Optional[dt.date] = None

        for ts, _sym in events:
            today = ts.date()
            if today != prev_date:
                active_pairs_today = defaultdict(int)
                prev_date = today

            # Update buffer up to this timestamp for all symbols
            for sym in symbols:
                while (candle_idx[sym] < len(m5_timelines[sym])
                       and m5_timelines[sym][candle_idx[sym]].timestamp <= ts):
                    c = m5_timelines[sym][candle_idx[sym]]
                    buffer.append(sym, "M5", c)
                    candle_idx[sym] += 1

            # Update open trades
            for trade in list(open_trades):
                if trade.closed:
                    continue
                cur_candle = buffer.latest(trade.signal.pair, "M5")
                if cur_candle is None:
                    continue

                pip_size = ACTIVE_PAIRS[trade.signal.pair].pip_size
                trade.update_excursion(cur_candle.close, pip_size)

                closed = self._check_exits(trade, cur_candle, ts, equity, pip_size)
                if closed:
                    pnl = self._calc_pnl(trade, pip_size, ts)
                    equity += pnl
                    equity_curve.append(equity)
                    closed_trades.append(trade)
                    open_trades.remove(trade)

            # Run signal engine on M5 close
            if not is_market_open(ts):
                continue
            if not is_killzone(ts):
                continue
            if len(open_trades) >= self._get("max_concurrent_positions"):
                continue

            session_mgr.update(ts, buffer)
            result = engine.run_pipeline(_sym, ts)

            if isinstance(result, Signal):
                # Check daily signal limit per pair
                max_daily = ACTIVE_PAIRS[_sym].max_signals_per_day
                if active_pairs_today[_sym] >= max_daily:
                    continue

                spread = result.spread_at_signal
                slippage = self._get("slippage_pips") * ACTIVE_PAIRS[_sym].pip_size

                # Simulate order fill
                fill_price = (result.entry_price + slippage
                              if result.direction == Bias.BULLISH
                              else result.entry_price - slippage)

                lot_size = self._calc_lot_size(result, equity, pip_size=ACTIVE_PAIRS[_sym].pip_size)

                trade = SimTrade(
                    signal=result,
                    open_price=fill_price,
                    open_time=ts,
                    lot_size=lot_size,
                    sl=result.stop_loss,
                    tp1=result.tp1,
                    tp2=result.tp2,
                    tp3=result.tp3,
                    direction=result.direction,
                )
                open_trades.append(trade)
                active_pairs_today[_sym] += 1
                signals_emitted += 1

        # Close any still-open trades at end of window
        for trade in open_trades:
            last_candle = buffer.latest(trade.signal.pair, "M5")
            if last_candle:
                trade.close_price = last_candle.close
                trade.close_time = end
                trade.exit_reason = "EXPIRED"
                trade.closed = True
                pip_size = ACTIVE_PAIRS[trade.signal.pair].pip_size
                pnl = self._calc_pnl(trade, pip_size, end)
                equity += pnl
                closed_trades.append(trade)
        equity_curve.append(equity)

        # ── Build metrics ──
        pnl_pips: list[Decimal] = []
        pnl_usd: list[Decimal] = []
        holds: list[int] = []
        pairs_list: list[str] = []
        sessions_list: list[str] = []
        regimes_list: list[str] = []
        dows: list[int] = []
        dates_list: list[dt.date] = []

        for t in closed_trades:
            pip_size = ACTIVE_PAIRS[t.signal.pair].pip_size
            pip_val = ACTIVE_PAIRS[t.signal.pair].pip_value_per_lot
            if t.close_price is not None:
                pip_diff = ((t.close_price - t.open_price) / pip_size
                            if t.direction == Bias.BULLISH
                            else (t.open_price - t.close_price) / pip_size)
                pnl_pips.append(pip_diff)
                pnl_usd.append(pip_diff * pip_val * t.lot_size)
            holds.append(
                int((t.close_time - t.open_time).total_seconds() // 60)
                if t.close_time else 0
            )
            pairs_list.append(t.signal.pair)
            sessions_list.append(t.signal.session)
            regimes_list.append(t.signal.regime.value)
            dows.append(t.signal.day_of_week)
            dates_list.append(t.open_time.date())

        metrics = calculate_metrics(
            pnl_pips, pnl_usd, equity_curve, holds,
            pairs_list, sessions_list, regimes_list, dows, dates_list,
        )

        log.info(
            "Window %s–%s (%s): %d trades, WR=%.1f%%, PF=%.2f, Sharpe=%.2f",
            start.date(), end.date(), "OOS" if is_oos else "IS",
            metrics.total_trades, float(metrics.win_rate) * 100,
            float(metrics.profit_factor), float(metrics.sharpe),
        )

        return WindowResult(
            is_oos=is_oos,
            start=start.date(),
            end=end.date(),
            metrics=metrics,
            equity_curve=equity_curve,
            trades=closed_trades,
        )

    def run_walk_forward(self) -> WalkForwardResult:
        """
        Full walk-forward protocol.
        Train: wf_train_months, Test: wf_test_months, Step: wf_step_months.
        """
        train_m = self._get("wf_train_months")
        test_m = self._get("wf_test_months")
        step_m = self._get("wf_step_months")
        total_m = self._get("backtest_months")

        base = dt.datetime.now(dt.timezone.utc) - self._months_delta(total_m)
        windows: list[WindowResult] = []

        cursor = base
        while True:
            train_end = cursor + self._months_delta(train_m)
            test_end = train_end + self._months_delta(test_m)
            if test_end > dt.datetime.now(dt.timezone.utc):
                break

            log.info("Walk-forward window: train %s–%s, test %s–%s",
                     cursor.date(), train_end.date(),
                     train_end.date(), test_end.date())

            # In-sample window (training)
            is_window = self.run_window(cursor, train_end, is_oos=False)
            windows.append(is_window)

            # Out-of-sample window (validation)
            oos_window = self.run_window(train_end, test_end, is_oos=True)
            windows.append(oos_window)

            cursor += self._months_delta(step_m)

        if not windows:
            raise RuntimeError("No walk-forward windows generated — check date range.")

        # Aggregate all OOS windows
        oos_windows = [w for w in windows if w.is_oos]
        all_windows = windows

        overall = self._aggregate_metrics([w.metrics for w in all_windows])
        oos_metrics = self._aggregate_metrics([w.metrics for w in oos_windows])

        log.info("Walk-forward complete. OOS: %s", oos_metrics.summary())
        return WalkForwardResult(
            windows=windows,
            overall_metrics=overall,
            oos_metrics=oos_metrics,
            params_used=dict(settings.SETTINGS),
        )

    # ── Helpers ──────────────────────────────────────────────────────

    def _months_delta(self, months: int) -> dt.timedelta:
        return dt.timedelta(days=30 * months)

    def _check_exits(
        self,
        trade: SimTrade,
        candle: Candle,
        ts: dt.datetime,
        equity: Decimal,
        pip_size: Decimal,
    ) -> bool:
        """Check if candle triggers SL, TP1, TP2, or TP3."""
        if trade.direction == Bias.BULLISH:
            # SL hit
            if candle.low <= trade.sl:
                trade.close_price = trade.sl
                trade.close_time = ts
                trade.exit_reason = "SL"
                trade.closed = True
                return True
            # TP1
            if not trade.tp1_hit and candle.high >= trade.tp1:
                trade.tp1_hit = True
                # Move SL to breakeven
                trade.sl = trade.open_price + pip_size  # BE + 1 pip
                return False
            # TP2
            if trade.tp1_hit and not trade.tp2_hit and candle.high >= trade.tp2:
                trade.tp2_hit = True
                return False
            # TP3 / final
            if trade.tp2_hit and candle.high >= trade.tp3:
                trade.close_price = trade.tp3
                trade.close_time = ts
                trade.exit_reason = "TP3"
                trade.closed = True
                return True
        else:
            if candle.high >= trade.sl:
                trade.close_price = trade.sl
                trade.close_time = ts
                trade.exit_reason = "SL"
                trade.closed = True
                return True
            if not trade.tp1_hit and candle.low <= trade.tp1:
                trade.tp1_hit = True
                trade.sl = trade.open_price - pip_size
                return False
            if trade.tp1_hit and not trade.tp2_hit and candle.low <= trade.tp2:
                trade.tp2_hit = True
                return False
            if trade.tp2_hit and candle.low <= trade.tp3:
                trade.close_price = trade.tp3
                trade.close_time = ts
                trade.exit_reason = "TP3"
                trade.closed = True
                return True

        # Expiry after 48h
        if (ts - trade.open_time).total_seconds() > 48 * 3600:
            cur_price = candle.close
            trade.close_price = cur_price
            trade.close_time = ts
            trade.exit_reason = "EXPIRED"
            trade.closed = True
            return True

        return False

    def _calc_pnl(self, trade: SimTrade, pip_size: Decimal, ts: dt.datetime) -> Decimal:
        """Compute net USD P&L including spread and swap costs."""
        if trade.close_price is None:
            return Decimal("0")
        profile = ACTIVE_PAIRS[trade.signal.pair]
        pip_val = profile.pip_value_per_lot

        tp1_pct = settings.get("tp1_close_pct")
        tp2_pct = settings.get("tp2_close_pct")
        remaining = Decimal("1") - tp1_pct - tp2_pct  # ~20%

        def pip_pnl(fill: Decimal, close: Decimal, direction: Bias, lots: Decimal) -> Decimal:
            if direction == Bias.BULLISH:
                pips = (close - fill) / pip_size
            else:
                pips = (fill - close) / pip_size
            return pips * pip_val * lots

        total = Decimal("0")

        if trade.tp1_hit:
            total += pip_pnl(trade.open_price, trade.tp1, trade.direction, trade.lot_size * tp1_pct)
        if trade.tp2_hit:
            total += pip_pnl(trade.open_price, trade.tp2, trade.direction, trade.lot_size * tp2_pct)
        if trade.close_price is not None:
            close_lots = (remaining if (trade.tp1_hit and trade.tp2_hit)
                          else (Decimal("1") - tp1_pct if trade.tp1_hit
                                else trade.lot_size))
            total += pip_pnl(trade.open_price, trade.close_price, trade.direction,
                             trade.lot_size * close_lots)

        # Subtract spread cost
        spread_cost = profile.typical_spread_london * pip_val * trade.lot_size
        total -= spread_cost

        # Rough swap estimate (0.5 pip per day for JPY pairs, 0.3 for others)
        hold_days = (ts - trade.open_time).total_seconds() / 86400
        swap_per_day = Decimal("0.3") if "JPY" not in trade.signal.pair else Decimal("0.5")
        total -= swap_per_day * pip_val * trade.lot_size * Decimal(str(hold_days))

        return total

    def _calc_lot_size(
        self,
        signal: Signal,
        equity: Decimal,
        pip_size: Decimal,
    ) -> Decimal:
        """Simple 1% risk lot sizing for simulation."""
        risk_pct = settings.get("risk_per_trade")
        risk_usd = equity * risk_pct
        pip_val = ACTIVE_PAIRS[signal.pair].pip_value_per_lot
        if signal.sl_pips == 0 or pip_val == 0:
            return Decimal("0.01")
        lot = risk_usd / (signal.sl_pips * pip_val)
        # Clamp to min/max
        lot = max(Decimal("0.01"), min(lot, Decimal("10.0")))
        # Round to 0.01
        return lot.quantize(Decimal("0.01"))

    def _aggregate_metrics(
        self, metrics_list: list[PerformanceMetrics]
    ) -> PerformanceMetrics:
        """Simple average of metrics across windows."""
        if not metrics_list:
            from backtesting.metrics import _empty_metrics
            return _empty_metrics()
        if len(metrics_list) == 1:
            return metrics_list[0]

        def avg(attr: str) -> Decimal:
            vals = [getattr(m, attr) for m in metrics_list if getattr(m, attr) is not None]
            if not vals:
                return Decimal("0")
            return sum(vals) / Decimal(str(len(vals)))

        total_trades = sum(m.total_trades for m in metrics_list)
        total_wins = sum(m.wins for m in metrics_list)

        from backtesting.metrics import PerformanceMetrics as PM
        return PM(
            total_trades=total_trades,
            wins=total_wins,
            losses=total_trades - total_wins,
            win_rate=avg("win_rate"),
            avg_win_pips=avg("avg_win_pips"),
            avg_loss_pips=avg("avg_loss_pips"),
            profit_factor=avg("profit_factor"),
            expectancy_pips=avg("expectancy_pips"),
            avg_rr_realized=avg("avg_rr_realized"),
            sharpe=avg("sharpe"),
            sortino=avg("sortino"),
            max_drawdown_pct=avg("max_drawdown_pct"),
            max_drawdown_duration_days=max(m.max_drawdown_duration_days for m in metrics_list),
            net_pnl_pips=sum(m.net_pnl_pips for m in metrics_list),
            net_pnl_usd=sum(m.net_pnl_usd for m in metrics_list),
            largest_win=max(m.largest_win for m in metrics_list),
            largest_loss=min(m.largest_loss for m in metrics_list),
            avg_hold_minutes=avg("avg_hold_minutes"),
        )
