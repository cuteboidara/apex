import type { Candle, OrderBlock } from "@/src/smc/types";

const MIN_IMPULSE_CANDLES = 3;
const MIN_IMPULSE_MULTIPLIER = 2;
const MIN_IMPULSE_PCT = 0.005;

function scoreStrength(impulseSize: number, range: number): OrderBlock["strength"] {
  if (impulseSize >= range * 4) {
    return "strong";
  }
  if (impulseSize >= range * 2.5) {
    return "moderate";
  }
  return "weak";
}

export function detectOrderBlocks(candles: Candle[], count = 100): OrderBlock[] {
  if (candles.length < 10) {
    return [];
  }

  const recent = candles.slice(-count);
  const lastPrice = recent.at(-1)?.close ?? null;
  if (lastPrice == null) {
    return [];
  }

  const orderBlocks: OrderBlock[] = [];

  for (let index = 2; index < recent.length - MIN_IMPULSE_CANDLES; index += 1) {
    const candle = recent[index];
    if (!candle) {
      continue;
    }

    const range = candle.high - candle.low;
    if (range <= 0) {
      continue;
    }

    const lookahead = recent.slice(index + 1, Math.min(index + 10, recent.length));
    if (lookahead.length < MIN_IMPULSE_CANDLES) {
      continue;
    }

    if (candle.close < candle.open) {
      const highestAfter = Math.max(...lookahead.map(bar => bar.high));
      const impulseSize = highestAfter - candle.high;
      const priceLevel = Math.max(Math.abs(candle.close), Math.abs(candle.open), Number.EPSILON);
      const minImpulseSize = priceLevel * MIN_IMPULSE_PCT;
      if (impulseSize >= minImpulseSize || impulseSize >= range * MIN_IMPULSE_MULTIPLIER) {
        orderBlocks.push({
          type: "bullish",
          high: candle.high,
          low: candle.low,
          midpoint: (candle.high + candle.low) / 2,
          time: candle.time,
          timeframe: "15m",
          broken: lastPrice < candle.low,
          tested: recent.slice(index + MIN_IMPULSE_CANDLES + 1).some(bar =>
            bar.low <= candle.high && bar.high >= candle.low,
          ),
          strength: scoreStrength(impulseSize, range),
        });
      }
    }

    if (candle.close > candle.open) {
      const lowestAfter = Math.min(...lookahead.map(bar => bar.low));
      const impulseSize = candle.low - lowestAfter;
      const priceLevel = Math.max(Math.abs(candle.close), Math.abs(candle.open), Number.EPSILON);
      const minImpulseSize = priceLevel * MIN_IMPULSE_PCT;
      if (impulseSize >= minImpulseSize || impulseSize >= range * MIN_IMPULSE_MULTIPLIER) {
        orderBlocks.push({
          type: "bearish",
          high: candle.high,
          low: candle.low,
          midpoint: (candle.high + candle.low) / 2,
          time: candle.time,
          timeframe: "15m",
          broken: lastPrice > candle.high,
          tested: recent.slice(index + MIN_IMPULSE_CANDLES + 1).some(bar =>
            bar.high >= candle.low && bar.low <= candle.high,
          ),
          strength: scoreStrength(impulseSize, range),
        });
      }
    }
  }

  return orderBlocks
    .sort((left, right) => {
      if (left.broken !== right.broken) {
        return Number(left.broken) - Number(right.broken);
      }
      return right.time - left.time;
    })
    .slice(0, 5);
}

export function scoreOrderBlockAlignment(
  orderBlocks: OrderBlock[],
  direction: "buy" | "sell" | "neutral",
  livePrice: number | null,
): number {
  if (!livePrice || direction === "neutral" || orderBlocks.length === 0) {
    return 0;
  }

  const targetType = direction === "buy" ? "bullish" : "bearish";
  const relevant = orderBlocks.filter(orderBlock => !orderBlock.broken && orderBlock.type === targetType);
  if (relevant.length === 0) {
    return 0;
  }

  for (const orderBlock of relevant) {
    const buffer = Math.max((orderBlock.high - orderBlock.low) * 0.5, livePrice * 0.0004);
    const inside = livePrice >= orderBlock.low - buffer && livePrice <= orderBlock.high + buffer;
    if (inside) {
      return orderBlock.strength === "strong" ? 10 : orderBlock.strength === "moderate" ? 7 : 4;
    }
  }

  const nearest = relevant[0];
  if (!nearest) {
    return 0;
  }
  const reference = direction === "buy" ? nearest.high : nearest.low;
  const distance = Math.abs(livePrice - reference);
  const width = Math.max(nearest.high - nearest.low, livePrice * 0.0005);
  return distance <= width * 2 ? 3 : 0;
}
