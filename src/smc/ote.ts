import type { Candle, OTELevels } from "@/src/smc/types";

export function calculateOTE(candles: Candle[], livePrice: number | null): OTELevels | null {
  if (candles.length < 20 || livePrice == null) {
    return null;
  }

  const recent = candles.slice(-50);
  let swingHigh = -Infinity;
  let swingHighIndex = -1;
  let swingLow = Infinity;
  let swingLowIndex = -1;

  for (let index = 3; index < recent.length - 3; index += 1) {
    const candle = recent[index];
    if (!candle) {
      continue;
    }

    const isHigh = recent.slice(index - 3, index).every(bar => bar.high <= candle.high)
      && recent.slice(index + 1, index + 4).every(bar => bar.high <= candle.high);
    const isLow = recent.slice(index - 3, index).every(bar => bar.low >= candle.low)
      && recent.slice(index + 1, index + 4).every(bar => bar.low >= candle.low);

    if (isHigh && candle.high > swingHigh) {
      swingHigh = candle.high;
      swingHighIndex = index;
    }
    if (isLow && candle.low < swingLow) {
      swingLow = candle.low;
      swingLowIndex = index;
    }
  }

  if (!Number.isFinite(swingHigh) || !Number.isFinite(swingLow) || swingHigh <= swingLow) {
    return null;
  }

  const range = swingHigh - swingLow;
  const direction: OTELevels["direction"] = swingHighIndex > swingLowIndex ? "bullish" : "bearish";

  const fib62 = direction === "bullish"
    ? swingHigh - (range * 0.62)
    : swingLow + (range * 0.62);
  const fib705 = direction === "bullish"
    ? swingHigh - (range * 0.705)
    : swingLow + (range * 0.705);
  const fib79 = direction === "bullish"
    ? swingHigh - (range * 0.79)
    : swingLow + (range * 0.79);

  const upper = direction === "bullish" ? fib62 : fib79;
  const lower = direction === "bullish" ? fib79 : fib62;
  const zoneLow = Math.min(upper, lower);
  const zoneHigh = Math.max(upper, lower);
  const currentPriceInOTE = livePrice >= zoneLow && livePrice <= zoneHigh;
  const distanceToOTE = currentPriceInOTE
    ? 0
    : Math.min(Math.abs(livePrice - zoneLow), Math.abs(livePrice - zoneHigh));

  return {
    swing_high: swingHigh,
    swing_low: swingLow,
    direction,
    fib_62: fib62,
    fib_705: fib705,
    fib_79: fib79,
    ote_zone_upper: upper,
    ote_zone_lower: lower,
    currentPriceInOTE,
    distanceToOTE,
  };
}

export function scoreOTE(ote: OTELevels | null, direction: "buy" | "sell" | "neutral"): number {
  if (!ote || direction === "neutral") {
    return 0;
  }

  const aligned = (direction === "buy" && ote.direction === "bullish")
    || (direction === "sell" && ote.direction === "bearish");
  if (!aligned) {
    return 0;
  }
  if (ote.currentPriceInOTE) {
    return 10;
  }

  const range = Math.max(ote.swing_high - ote.swing_low, 0);
  if (ote.distanceToOTE != null && ote.distanceToOTE <= range * 0.05) {
    return 6;
  }

  return 2;
}
