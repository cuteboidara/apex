import type { SessionContext, SessionLabel } from "@/src/interfaces/contracts";

const FX_TRADING_DAY_ROLLOVER_UTC_HOUR = 22;

function toIsoTradingDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function resolveSession(totalMinutesUtc: number): { session: SessionLabel; sessionOpenMinutes: number } {
  if (totalMinutesUtc >= 0 && totalMinutesUtc < 7 * 60) {
    return { session: "asia", sessionOpenMinutes: 0 };
  }
  if (totalMinutesUtc >= 7 * 60 && totalMinutesUtc < 12 * 60) {
    return { session: "london", sessionOpenMinutes: 7 * 60 };
  }
  if (totalMinutesUtc >= 12 * 60 && totalMinutesUtc < 17 * 60) {
    return { session: "overlap", sessionOpenMinutes: 12 * 60 };
  }
  if (totalMinutesUtc >= 17 * 60 && totalMinutesUtc < 22 * 60) {
    return { session: "new_york", sessionOpenMinutes: 17 * 60 };
  }
  return { session: "off_hours", sessionOpenMinutes: 22 * 60 };
}

export function classifyFxSession(ts: number): SessionContext {
  const date = new Date(ts);
  const hourBucket = date.getUTCHours();
  const totalMinutesUtc = hourBucket * 60 + date.getUTCMinutes();
  const { session, sessionOpenMinutes } = resolveSession(totalMinutesUtc);
  const tradingDayTs = totalMinutesUtc >= FX_TRADING_DAY_ROLLOVER_UTC_HOUR * 60
    ? ts + 24 * 60 * 60_000
    : ts;

  return {
    session,
    tradingDay: toIsoTradingDay(tradingDayTs),
    hourBucket,
    minutesSinceSessionOpen: Math.max(0, totalMinutesUtc - sessionOpenMinutes),
  };
}
