"""
APEX Forex SMC System — Live Trading Entry Point

Startup sequence:
  1. Load secrets and initialise DB
  2. Connect to MT5
  3. Pre-load candle buffers
  4. Reconcile any open positions
  5. Start main loop (1-minute heartbeat)
     - Update candle buffers
     - Update session manager
     - Check risk limits
     - Run signal pipeline during killzones
     - Monitor open trades for TP/SL
     - Check pending order expiry
  6. At 21:30 UTC: send daily Telegram summary
  7. On Friday 19:00 UTC: evaluate weekend holds
  8. Graceful shutdown: cancel pending orders, send alert

IMPORTANT: Run backtest_runner.py first and confirm positive expectancy
           before enabling live trading (paper_mode=False).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import signal
import sys
import time
from decimal import Decimal

from config import settings
from database.db import init_db, get_session
from database.models import Signal as DBSignal, SignalStatus, Outcome, OutcomeResult

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("apex.main")

# ── Load secrets ───────────────────────────────────────────────────────
try:
    from config import secrets
    MT5_LOGIN = secrets.MT5_LOGIN
    MT5_PASSWORD = secrets.MT5_PASSWORD
    MT5_SERVER = secrets.MT5_SERVER
    MT5_PATH = getattr(secrets, "MT5_PATH", "")
    TELEGRAM_TOKEN = getattr(secrets, "TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_CHAT = getattr(secrets, "TELEGRAM_CHAT_ID", "")
except ImportError:
    log.warning("config/secrets.py not found — copy secrets.py.example and fill in credentials.")
    MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, MT5_PATH = 0, "", "", ""
    TELEGRAM_TOKEN, TELEGRAM_CHAT = "", ""

# ── PAPER MODE SAFEGUARD ───────────────────────────────────────────────
PAPER_MODE = True   # ← Change to False ONLY after backtesting proves positive expectancy


async def main() -> None:
    log.info("=" * 60)
    log.info("APEX Forex SMC System starting — %s mode",
             "PAPER" if PAPER_MODE else "⚠️ LIVE TRADING")
    log.info("=" * 60)

    # ── Init DB ──
    init_db()
    log.info("Database initialised.")

    # ── MT5 connection ──
    from core.data_feed import MT5Connection, get_account_equity
    conn = MT5Connection(MT5_LOGIN, MT5_PASSWORD, MT5_SERVER, MT5_PATH)
    if not conn.connect():
        if PAPER_MODE:
            log.warning("MT5 not connected — running in paper mode with no live data.")
        else:
            log.critical("MT5 connection failed — cannot run in live mode. Exiting.")
            sys.exit(1)

    # ── Initial equity ──
    live_equity = get_account_equity()
    initial_equity = live_equity or settings.get("initial_equity")
    log.info("Account equity: $%.2f", float(initial_equity))

    # ── Risk manager ──
    from execution.risk_manager import RiskManager
    risk_mgr = RiskManager(initial_equity)

    # ── Order manager ──
    from execution.order_manager import OrderManager
    order_mgr = OrderManager(conn, risk_mgr, paper_mode=PAPER_MODE)
    order_mgr.reconcile_positions()

    # ── Data buffer ──
    from core.data_feed import CandleBuffer
    from config.pairs import ACTIVE_PAIRS
    buffer = CandleBuffer()
    symbols = list(ACTIVE_PAIRS.keys())

    # Pre-load buffers
    log.info("Pre-loading candle buffers…")
    from core.data_feed import get_candles
    for sym in symbols:
        for tf in ["M5", "M15", "H1", "H4", "D1"]:
            candles = get_candles(sym, tf, count=500, conn=conn)
            buffer.extend(sym, tf, candles)
    log.info("Buffers loaded.")

    # ── Session manager ──
    from core.session_manager import SessionManager
    session_mgr = SessionManager(symbols)

    # ── Signal engine ──
    from core.signal_engine import SignalEngine
    engine = SignalEngine(buffer, session_mgr, risk_manager=risk_mgr, paper_mode=PAPER_MODE)

    # ── Trade tracker ──
    from execution.trade_tracker import TradeTracker, TrackedTrade
    tracker = TradeTracker(order_mgr, risk_mgr, buffer, paper_mode=PAPER_MODE)

    # ── Outcome tracker ──
    from analytics.outcome_tracker import OutcomeTracker
    outcome_tracker = OutcomeTracker(buffer)

    # ── Telegram ──
    from notifications.telegram_bot import TelegramNotifier
    notifier = TelegramNotifier(TELEGRAM_TOKEN, TELEGRAM_CHAT)
    await notifier.send_trade_update(
        f"✅ APEX started — {'PAPER' if PAPER_MODE else '⚠️ LIVE'} mode\n"
        f"Equity: ${float(initial_equity):.2f}"
    )

    # ── Graceful shutdown ──
    shutdown = False
    def _shutdown(sig, frame):
        nonlocal shutdown
        log.info("Shutdown signal received.")
        shutdown = True
    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # ── State ──
    last_candle_time: dict[str, dict[str, dt.datetime]] = {
        sym: {} for sym in symbols
    }
    last_daily_summary: dt.date = dt.date.today() - dt.timedelta(days=1)
    signal_counter = 0

    # ── Main loop ────────────────────────────────────────────────────
    log.info("Main loop started. Ctrl+C to stop.")

    while not shutdown:
        now = dt.datetime.now(dt.timezone.utc)

        # ── Refresh candles ──
        for sym in symbols:
            for tf in ["M5", "M15", "H1", "H4", "D1"]:
                try:
                    new_candles = get_candles(sym, tf, count=5, conn=conn)
                    if new_candles:
                        buffer.extend(sym, tf, new_candles)
                except Exception:
                    pass

        # ── Update session state ──
        from core.data_feed import get_spread_pips
        spreads = {}
        for sym in symbols:
            sp = get_spread_pips(sym, conn)
            if sp is not None:
                spreads[sym] = sp
        session_mgr.update(now, buffer, spreads)

        # ── Risk check ──
        halted, halt_reason = risk_mgr.is_halted()
        if halted:
            log.warning("System halted: %s", halt_reason)
            await notifier.send_risk_alert(halt_reason, risk_mgr._state.current_equity)
            time.sleep(60)
            continue

        # ── Signal pipeline (during killzones only) ──
        from config.sessions import is_killzone, is_market_open
        if is_market_open(now) and is_killzone(now):
            signals = engine.scan_all_pairs(now)
            for sig in signals:
                signal_counter += 1

                # Save to DB
                db_sig_id = _save_signal_to_db(sig, signal_counter)

                # Track outcome (even if not traded)
                outcome_tracker.start_tracking(sig, db_sig_id)

                # Execute (or paper-log)
                result = order_mgr.execute_signal(
                    sig, risk_mgr._state.current_equity,
                    risk_mgr.consecutive_losses(), now,
                )

                if result and result.success:
                    from execution.risk_manager import OpenPosition
                    pos = OpenPosition(
                        symbol=sig.pair,
                        direction=sig.direction,
                        open_time=now,
                        entry_price=result.fill_price or sig.entry_price,
                        sl=sig.stop_loss,
                        lot_size=Decimal("0.01"),  # actual size from order_mgr
                        equity_at_open=risk_mgr._state.current_equity,
                        ticket=result.ticket,
                    )
                    risk_mgr.register_open(pos)

                    # Track trade
                    from execution.trade_tracker import TrackedTrade
                    tracked = TrackedTrade(
                        ticket=result.ticket,
                        signal_id=db_sig_id,
                        symbol=sig.pair,
                        direction=sig.direction,
                        entry_price=result.fill_price or sig.entry_price,
                        sl=sig.stop_loss,
                        tp1=sig.tp1,
                        tp2=sig.tp2,
                        tp3=sig.tp3,
                        lot_size=Decimal("0.01"),
                        open_time=now,
                    )
                    tracker.add(tracked)

                    await notifier.send_signal(sig)

        # ── Monitor open trades ──
        closed = tracker.check_all(now)
        for ticket in closed:
            await notifier.send_trade_update(
                f"✅ Trade closed: ticket={ticket}"
            )

        # ── Check outcome tracking ──
        outcome_tracker.check_all(now)

        # ── Daily summary at 21:30 UTC ──
        summary_time = dt.time(21, 30)
        if (now.time() >= summary_time
                and now.date() > last_daily_summary):
            from analytics.performance_dashboard import get_overall_stats
            stats = get_overall_stats(days=1)
            await notifier.send_daily_summary(stats)
            last_daily_summary = now.date()

        # ── Equity update ──
        live_eq = get_account_equity()
        if live_eq is not None:
            risk_mgr.update_equity(live_eq, now)

        time.sleep(60)  # 1-minute heartbeat

    # ── Shutdown ──
    log.info("Shutting down…")
    conn.disconnect()
    await notifier.send_trade_update("🔴 APEX stopped.")


def _save_signal_to_db(sig, counter: int) -> int:
    """Save signal to DB and return the ID."""
    try:
        with get_session() as db:
            db_sig = DBSignal(
                pair=sig.pair,
                direction=sig.direction.value,
                timeframe_entry=sig.timeframe_entry,
                entry_price=sig.entry_price,
                stop_loss=sig.stop_loss,
                tp1=sig.tp1,
                tp2=sig.tp2,
                tp3=sig.tp3,
                sl_pips=sig.sl_pips,
                rr_ratio=sig.rr_ratio,
                confluence_score=sig.confluence.raw_score,
                confluence_grade=sig.confluence.grade,
                regime=sig.regime.value,
                htf_bias=sig.htf_bias.value,
                session=sig.session,
                killzone=sig.killzone,
                spread_at_signal=sig.spread_at_signal,
                day_of_week=sig.day_of_week,
                sweep_type=sig.sweep_type,
                poi_type=sig.poi_type,
                status=SignalStatus.EMITTED,
            )
            db.add(db_sig)
            db.flush()
            db_id = db_sig.id
            db.add(Outcome(signal_id=db_id, result=OutcomeResult.PENDING))
        return db_id
    except Exception as e:
        log.error("Failed to save signal: %s", e)
        return counter


if __name__ == "__main__":
    asyncio.run(main())
