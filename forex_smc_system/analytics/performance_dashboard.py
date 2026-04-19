"""
Performance dashboard — queries the database and computes live metrics.
"""

from __future__ import annotations

import datetime as dt
import logging
from decimal import Decimal
from typing import Optional

from database.db import get_session
from database.models import Signal, Trade, Outcome, DailyPerformance, OutcomeResult

log = logging.getLogger(__name__)


def get_overall_stats(days: int = 30) -> dict:
    """Return aggregate performance over the last N days."""
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    try:
        with get_session() as db:
            outcomes = (
                db.query(Outcome)
                .join(Signal)
                .filter(Signal.timestamp >= since)
                .filter(Outcome.result != OutcomeResult.PENDING)
                .all()
            )
        if not outcomes:
            return {"error": "No completed outcomes yet"}

        wins = [o for o in outcomes if o.result in (
            OutcomeResult.TP1_HIT, OutcomeResult.TP2_HIT, OutcomeResult.TP3_HIT
        )]
        losses = [o for o in outcomes if o.result == OutcomeResult.SL_HIT]
        n = len(outcomes)
        win_rate = len(wins) / n if n > 0 else 0
        avg_rr = (
            sum(float(o.realized_rr or 0) for o in outcomes) / n if n > 0 else 0
        )
        avg_mfe = (
            sum(float(o.mfe_pips or 0) for o in outcomes) / n if n > 0 else 0
        )
        avg_mae = (
            sum(float(o.mae_pips or 0) for o in outcomes) / n if n > 0 else 0
        )

        return {
            "period_days": days,
            "total_signals": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": round(win_rate * 100, 1),
            "avg_realized_rr": round(avg_rr, 2),
            "avg_mfe_pips": round(avg_mfe, 1),
            "avg_mae_pips": round(avg_mae, 1),
        }
    except Exception as e:
        log.error("Dashboard query failed: %s", e)
        return {"error": str(e)}


def get_stats_by_pair(days: int = 30) -> dict:
    """Win rate and avg RR per pair."""
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    try:
        with get_session() as db:
            outcomes = (
                db.query(Outcome, Signal.pair)
                .join(Signal)
                .filter(Signal.timestamp >= since)
                .filter(Outcome.result != OutcomeResult.PENDING)
                .all()
            )
        result: dict[str, dict] = {}
        for o, pair in outcomes:
            if pair not in result:
                result[pair] = {"trades": 0, "wins": 0, "rr_sum": 0.0}
            result[pair]["trades"] += 1
            if o.result in (OutcomeResult.TP1_HIT, OutcomeResult.TP2_HIT, OutcomeResult.TP3_HIT):
                result[pair]["wins"] += 1
            result[pair]["rr_sum"] += float(o.realized_rr or 0)

        for pair, stats in result.items():
            n = stats["trades"]
            stats["win_rate_pct"] = round(stats["wins"] / n * 100, 1) if n > 0 else 0
            stats["avg_rr"] = round(stats["rr_sum"] / n, 2) if n > 0 else 0
            del stats["rr_sum"]
        return result
    except Exception as e:
        return {"error": str(e)}


def get_stats_by_grade(days: int = 60) -> dict:
    """Performance breakdown by confluence grade."""
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)
    try:
        with get_session() as db:
            rows = (
                db.query(Outcome, Signal.confluence_grade)
                .join(Signal)
                .filter(Signal.timestamp >= since)
                .filter(Outcome.result != OutcomeResult.PENDING)
                .all()
            )
        result: dict[str, dict] = {}
        for o, grade in rows:
            if grade not in result:
                result[grade] = {"trades": 0, "wins": 0}
            result[grade]["trades"] += 1
            if o.result in (OutcomeResult.TP1_HIT, OutcomeResult.TP2_HIT, OutcomeResult.TP3_HIT):
                result[grade]["wins"] += 1
        for grade, stats in result.items():
            n = stats["trades"]
            stats["win_rate_pct"] = round(stats["wins"] / n * 100, 1) if n > 0 else 0
        return result
    except Exception as e:
        return {"error": str(e)}
