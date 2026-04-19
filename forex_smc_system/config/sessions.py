"""
Forex session definitions with DST-aware killzone calculations.

All times are in UTC. DST adjustments are applied for London and New York.
The code detects whether UK/US is on summer time and shifts accordingly.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from dateutil import tz


class SessionName(str, Enum):
    SYDNEY = "SYDNEY"
    TOKYO = "TOKYO"
    LONDON = "LONDON"
    NEW_YORK = "NEW_YORK"
    CLOSED = "CLOSED"


class KillzoneName(str, Enum):
    LONDON_OPEN = "LONDON_OPEN"
    NY_OPEN = "NY_OPEN"
    LONDON_CLOSE = "LONDON_CLOSE"
    ASIAN_RANGE = "ASIAN_RANGE"    # analysis only, no signals
    NONE = "NONE"


@dataclass(frozen=True, slots=True)
class SessionWindow:
    name: SessionName
    start_utc: dt.time
    end_utc: dt.time

    def is_active(self, utc_now: dt.datetime) -> bool:
        t = utc_now.time().replace(second=0, microsecond=0)
        if self.start_utc <= self.end_utc:
            return self.start_utc <= t < self.end_utc
        # crosses midnight
        return t >= self.start_utc or t < self.end_utc


@dataclass(frozen=True, slots=True)
class KillzoneWindow:
    name: KillzoneName
    start_utc: dt.time
    end_utc: dt.time

    def is_active(self, utc_now: dt.datetime) -> bool:
        t = utc_now.time().replace(second=0, microsecond=0)
        return self.start_utc <= t < self.end_utc


# ── DST helpers ──────────────────────────────────────────────────────

def _uk_on_dst(date: dt.date) -> bool:
    """True if UK is on BST (UTC+1) — clocks forward last Sunday March, back last Sunday October."""
    london = tz.gettz("Europe/London")
    dt_check = dt.datetime(date.year, date.month, date.day, 12, tzinfo=tz.UTC)
    offset = dt_check.astimezone(london).utcoffset()
    return offset == dt.timedelta(hours=1)


def _us_on_dst(date: dt.date) -> bool:
    """True if US Eastern is on EDT (UTC-4) — second Sunday March to first Sunday November."""
    eastern = tz.gettz("America/New_York")
    dt_check = dt.datetime(date.year, date.month, date.day, 12, tzinfo=tz.UTC)
    offset = dt_check.astimezone(eastern).utcoffset()
    return offset == dt.timedelta(hours=-4)


def _t(h: int, m: int = 0) -> dt.time:
    return dt.time(h, m)


# ── Session windows (winter, adjusted below for DST) ─────────────────

_SYDNEY_WINTER = SessionWindow(SessionName.SYDNEY, _t(21), _t(6))
_TOKYO_WINTER = SessionWindow(SessionName.TOKYO, _t(0), _t(9))
_LONDON_WINTER = SessionWindow(SessionName.LONDON, _t(7), _t(16))
_NEWYORK_WINTER = SessionWindow(SessionName.NEW_YORK, _t(12), _t(21))

# ── Killzone windows (winter) ─────────────────────────────────────────

_KZ_LONDON_OPEN_WINTER = KillzoneWindow(KillzoneName.LONDON_OPEN, _t(7), _t(10))
_KZ_NY_OPEN_WINTER = KillzoneWindow(KillzoneName.NY_OPEN, _t(12), _t(15))
_KZ_LONDON_CLOSE_WINTER = KillzoneWindow(KillzoneName.LONDON_CLOSE, _t(14), _t(16))
_KZ_ASIAN_RANGE = KillzoneWindow(KillzoneName.ASIAN_RANGE, _t(0), _t(6))


def get_sessions(date: dt.date) -> list[SessionWindow]:
    """Return DST-adjusted session windows for a given date."""
    uk_dst = _uk_on_dst(date)
    us_dst = _us_on_dst(date)

    sessions = [
        # Sydney / Tokyo don't observe meaningful DST for our purposes
        _SYDNEY_WINTER,
        _TOKYO_WINTER,
        # London shifts 1h earlier in summer
        SessionWindow(SessionName.LONDON, _t(6), _t(15)) if uk_dst else _LONDON_WINTER,
        # New York shifts 1h earlier in summer
        SessionWindow(SessionName.NEW_YORK, _t(11), _t(20)) if us_dst else _NEWYORK_WINTER,
    ]
    return sessions


def get_killzones(date: dt.date) -> list[KillzoneWindow]:
    """Return DST-adjusted killzone windows for a given date."""
    uk_dst = _uk_on_dst(date)
    us_dst = _us_on_dst(date)

    kzs: list[KillzoneWindow] = [_KZ_ASIAN_RANGE]

    # London open killzone
    if uk_dst:
        kzs.append(KillzoneWindow(KillzoneName.LONDON_OPEN, _t(6), _t(9)))
        kzs.append(KillzoneWindow(KillzoneName.LONDON_CLOSE, _t(13), _t(15)))
    else:
        kzs.append(_KZ_LONDON_OPEN_WINTER)
        kzs.append(_KZ_LONDON_CLOSE_WINTER)

    # NY open killzone
    if us_dst:
        kzs.append(KillzoneWindow(KillzoneName.NY_OPEN, _t(11), _t(14)))
    else:
        kzs.append(_KZ_NY_OPEN_WINTER)

    return kzs


def current_session(utc_now: dt.datetime) -> SessionName:
    """Return the primary session active at utc_now."""
    for session in get_sessions(utc_now.date()):
        if session.is_active(utc_now):
            return session.name
    return SessionName.CLOSED


def current_killzone(utc_now: dt.datetime) -> KillzoneName:
    """Return the active killzone at utc_now, or NONE."""
    for kz in get_killzones(utc_now.date()):
        if kz.is_active(utc_now):
            return kz.name
    return KillzoneName.NONE


def is_killzone(utc_now: dt.datetime) -> bool:
    """True if we are inside a tradeable killzone (not Asian range)."""
    kz = current_killzone(utc_now)
    return kz not in (KillzoneName.NONE, KillzoneName.ASIAN_RANGE)


def is_market_open(utc_now: dt.datetime) -> bool:
    """Forex closes Friday 21:00 UTC, opens Sunday 21:00 UTC."""
    # weekday(): 0=Mon, 4=Fri, 5=Sat, 6=Sun
    wd = utc_now.weekday()
    t = utc_now.time()
    if wd == 5:  # Saturday — always closed
        return False
    if wd == 4 and t >= _t(21):  # Friday after 21:00
        return False
    if wd == 6 and t < _t(21):  # Sunday before 21:00
        return False
    return True


def is_friday_cutoff(utc_now: dt.datetime) -> bool:
    """True after Friday 19:00 UTC — reduce/avoid new positions."""
    return utc_now.weekday() == 4 and utc_now.time() >= _t(19)


def is_monday_caution(utc_now: dt.datetime) -> bool:
    """True Monday before 10:00 UTC — reduce size (gap risk settling)."""
    return utc_now.weekday() == 0 and utc_now.time() < _t(10)


def asian_session_range_window(date: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """Return the UTC start and end of the Asian session (for range capture)."""
    # Asian range = Tokyo session: 00:00 – 09:00 UTC (no DST)
    start = dt.datetime(date.year, date.month, date.day, 0, 0, tzinfo=dt.timezone.utc)
    end = dt.datetime(date.year, date.month, date.day, 9, 0, tzinfo=dt.timezone.utc)
    return start, end
