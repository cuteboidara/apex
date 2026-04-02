import type { BreakerBlock, Candle, OrderBlock } from "@/src/smc/types";
import { detectOrderBlocks } from "@/src/smc/orderBlocks";

function buildBrokenOrderBlocks(candles: Candle[]): OrderBlock[] {
  const recent = candles.slice(-100);
  const lastPrice = recent.at(-1)?.close ?? null;
  if (recent.length < 10 || lastPrice == null) {
    return [];
  }

  const blocks = detectOrderBlocks(recent, 100);
  const broken = blocks.filter(block =>
    block.type === "bullish" ? lastPrice < block.low : lastPrice > block.high,
  );

  if (broken.length > 0) {
    return broken.map(block => ({ ...block, broken: true }));
  }

  return [];
}

export function detectBreakerBlocks(candles: Candle[]): BreakerBlock[] {
  return buildBrokenOrderBlocks(candles)
    .map(orderBlock => ({
      type: (orderBlock.type === "bullish" ? "bearish" : "bullish") as BreakerBlock["type"],
      high: orderBlock.high,
      low: orderBlock.low,
      midpoint: orderBlock.midpoint,
      time: orderBlock.time,
      originalObType: orderBlock.type,
    }))
    .sort((left, right) => right.time - left.time)
    .slice(0, 3);
}

export function scoreBreakerBlock(
  breakerBlocks: BreakerBlock[],
  direction: "buy" | "sell" | "neutral",
  livePrice: number | null,
): number {
  if (!livePrice || direction === "neutral" || breakerBlocks.length === 0) {
    return 0;
  }

  const targetType = direction === "buy" ? "bullish" : "bearish";
  const relevant = breakerBlocks.filter(block => block.type === targetType);
  if (relevant.length === 0) {
    return 0;
  }

  for (const breaker of relevant) {
    const width = Math.max(breaker.high - breaker.low, livePrice * 0.0003);
    const buffer = width * 0.3;
    if (livePrice >= breaker.low - buffer && livePrice <= breaker.high + buffer) {
      return 8;
    }
  }

  return 2;
}
