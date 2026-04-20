import type { SniperCandle } from "@/src/sniper/types/sniperTypes";

export interface BOSEvent {
  direction: "long" | "short";
  breakLevel: number;
  retestLevel: number;
  triggerIndex: number;
}

export function detectBOSContinuation(candles: SniperCandle[]): BOSEvent[] {
  const events: BOSEvent[] = [];
  if (candles.length < 40) return events;

  for (let i = 20; i < candles.length - 2; i += 1) {
    const window = candles.slice(i - 20, i);
    const rangeHigh = Math.max(...window.map(candle => candle.high));
    const rangeLow = Math.min(...window.map(candle => candle.low));
    const trigger = candles[i];
    const retest = candles[i + 1];

    const bullishBreak = trigger.close > rangeHigh && retest.low <= rangeHigh && retest.close >= rangeHigh;
    if (bullishBreak) {
      events.push({
        direction: "long",
        breakLevel: rangeHigh,
        retestLevel: rangeHigh,
        triggerIndex: i + 1,
      });
      continue;
    }

    const bearishBreak = trigger.close < rangeLow && retest.high >= rangeLow && retest.close <= rangeLow;
    if (bearishBreak) {
      events.push({
        direction: "short",
        breakLevel: rangeLow,
        retestLevel: rangeLow,
        triggerIndex: i + 1,
      });
    }
  }

  return events.filter(event => candles.length - event.triggerIndex <= 5);
}

