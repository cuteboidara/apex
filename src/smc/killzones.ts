import type { Candle, KillzoneName, KillzoneState } from "@/src/smc/types";

const KILLZONE_WINDOWS: Record<KillzoneName, { start: number; end: number }> = {
  asian_range: { start: 0, end: 3 },
  london_open: { start: 7, end: 10 },
  new_york_open: { start: 12, end: 15 },
  london_close: { start: 15, end: 16 },
  off_hours: { start: 20, end: 24 },
};

export function getCurrentKillzone(utcHour: number): KillzoneName {
  for (const [name, window] of Object.entries(KILLZONE_WINDOWS)) {
    if (utcHour >= window.start && utcHour < window.end) {
      return name as KillzoneName;
    }
  }
  return "off_hours";
}

export function getMinutesUntilNextKillzone(now: Date): { minutes: number; next: KillzoneName } {
  const currentMinutes = (now.getUTCHours() * 60) + now.getUTCMinutes();
  const starts = [
    { name: "asian_range" as const, minutes: 0 },
    { name: "london_open" as const, minutes: 7 * 60 },
    { name: "new_york_open" as const, minutes: 12 * 60 },
    { name: "london_close" as const, minutes: 15 * 60 },
  ];

  const next = starts
    .map(item => ({
      ...item,
      diff: item.minutes > currentMinutes ? item.minutes - currentMinutes : (24 * 60) - currentMinutes + item.minutes,
    }))
    .sort((left, right) => left.diff - right.diff)[0];

  return {
    minutes: next?.diff ?? 0,
    next: next?.name ?? "asian_range",
  };
}

export function buildKillzoneState(now: Date, candles: Candle[]): KillzoneState {
  const current = getCurrentKillzone(now.getUTCHours());
  const isActive = current !== "off_hours";
  const { minutes, next } = getMinutesUntilNextKillzone(now);

  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const asianStart = dayStart;
  const asianEnd = dayStart + (3 * 60 * 60_000);
  const asianCandles = candles.filter(candle => candle.time >= asianStart && candle.time < asianEnd);
  const asianRangeHigh = asianCandles.length > 0 ? Math.max(...asianCandles.map(candle => candle.high)) : null;
  const asianRangeLow = asianCandles.length > 0 ? Math.min(...asianCandles.map(candle => candle.low)) : null;
  const asianRangeMidpoint = asianRangeHigh != null && asianRangeLow != null
    ? (asianRangeHigh + asianRangeLow) / 2
    : null;

  const sessionWindow = KILLZONE_WINDOWS[current];
  const sessionStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), sessionWindow?.start ?? 0, 0, 0, 0);
  const sessionCandles = candles.filter(candle => candle.time >= sessionStart);

  return {
    current,
    isActive,
    sessionOpen: sessionCandles[0]?.open ?? null,
    sessionHigh: sessionCandles.length > 0 ? Math.max(...sessionCandles.map(candle => candle.high)) : null,
    sessionLow: sessionCandles.length > 0 ? Math.min(...sessionCandles.map(candle => candle.low)) : null,
    minutesUntilNextKillzone: minutes,
    nextKillzone: next,
    asianRangeHigh,
    asianRangeLow,
    asianRangeMidpoint,
  };
}

export function scoreKillzone(killzone: KillzoneState, symbol: string): number {
  const preferences: Record<string, KillzoneName[]> = {
    EURUSD: ["london_open", "new_york_open"],
    GBPUSD: ["london_open", "new_york_open"],
    USDJPY: ["asian_range", "london_open"],
    EURJPY: ["asian_range", "london_open"],
    AUDUSD: ["asian_range", "london_open"],
    NZDUSD: ["asian_range", "london_open"],
    USDCHF: ["london_open", "new_york_open"],
    USDCAD: ["london_open", "new_york_open"],
  };

  const preferred = preferences[symbol] ?? ["london_open", "new_york_open"];
  if (preferred.includes(killzone.current)) {
    return 10;
  }
  if (killzone.current === "london_close") {
    return 4;
  }
  if (killzone.current === "off_hours") {
    return 0;
  }
  return 3;
}
