// src/indices/engine/smc/orderBlockDetector.ts
// Detect consolidation zones (order blocks) before structural breaks

import type { Candle, OrderBlock, SwingPoint } from '@/src/indices/types';
import { detectSwings } from './swingDetector';

const ORDER_BLOCK_MIN_RANGE_PCT = 0.001;  // 0.1% minimum range
const ORDER_BLOCK_MAX_RANGE_PCT = 0.03;   // 3% maximum range
const CONSOLIDATION_DEPTH = 5;           // candles to look back from swing

export function detectOrderBlocks(
  assetId: string,
  candles: Candle[],
  lookback = 5,
): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const { highs, lows } = detectSwings(candles, lookback);

  // Bullish order blocks: consolidation before a swing low (smart money buying zone)
  for (const swingLow of lows) {
    const startIdx = Math.max(0, swingLow.index - CONSOLIDATION_DEPTH);
    const consolidation = candles.slice(startIdx, swingLow.index);
    if (consolidation.length < 2) continue;

    const high = Math.max(...consolidation.map(c => c.high));
    const low = Math.min(...consolidation.map(c => c.low));
    const range = high - low;
    const rangePct = range / swingLow.price;

    if (rangePct < ORDER_BLOCK_MIN_RANGE_PCT || rangePct > ORDER_BLOCK_MAX_RANGE_PCT) continue;

    const age = candles.length - 1 - swingLow.index;
    const quality = scoreOrderBlock({ age, rangePct, touchCount: 0, swept: false });

    blocks.push({
      assetId,
      timestamp: candles[startIdx]!.timestamp,
      type: 'bullish',
      high,
      low,
      mid: (high + low) / 2,
      range,
      depth: consolidation.length,
      liquiditySwept: false,
      quality,
      daysOld: Math.round(age),
    });
  }

  // Bearish order blocks: consolidation before a swing high (smart money selling zone)
  for (const swingHigh of highs) {
    const startIdx = Math.max(0, swingHigh.index - CONSOLIDATION_DEPTH);
    const consolidation = candles.slice(startIdx, swingHigh.index);
    if (consolidation.length < 2) continue;

    const high = Math.max(...consolidation.map(c => c.high));
    const low = Math.min(...consolidation.map(c => c.low));
    const range = high - low;
    const rangePct = range / swingHigh.price;

    if (rangePct < ORDER_BLOCK_MIN_RANGE_PCT || rangePct > ORDER_BLOCK_MAX_RANGE_PCT) continue;

    const age = candles.length - 1 - swingHigh.index;
    const quality = scoreOrderBlock({ age, rangePct, touchCount: 0, swept: false });

    blocks.push({
      assetId,
      timestamp: candles[startIdx]!.timestamp,
      type: 'bearish',
      high,
      low,
      mid: (high + low) / 2,
      range,
      depth: consolidation.length,
      liquiditySwept: false,
      quality,
      daysOld: Math.round(age),
    });
  }

  // Sort by recency (most recent first)
  return blocks.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function scoreOrderBlock(input: {
  age: number;
  rangePct: number;
  touchCount: number;
  swept: boolean;
}): number {
  let score = 0;

  // Recency: 0-15 pts
  if (input.age < 10) score += 15;
  else if (input.age < 30) score += 10;
  else if (input.age < 50) score += 7;
  else score += 3;

  // Range quality: tighter consolidation = stronger block
  if (input.rangePct < 0.005) score += 3;
  else if (input.rangePct < 0.01) score += 2;

  // Swept: if liquidity was swept first, block is more reliable
  if (input.swept) score += 8;

  // Touched multiple times = weakening
  score -= input.touchCount * 3;

  return Math.max(0, Math.min(15, score));
}

export function getRecentOrderBlock(
  assetId: string,
  candles: Candle[],
  direction: 'bullish' | 'bearish',
  lookback = 5,
): OrderBlock | null {
  const blocks = detectOrderBlocks(assetId, candles, lookback);
  return blocks.find(b => b.type === direction) ?? null;
}

// Check how many times price has re-entered the order block
export function countBlockTouches(block: OrderBlock, candles: Candle[]): number {
  let touches = 0;
  for (const candle of candles) {
    if (candle.timestamp <= block.timestamp) continue;
    if (candle.low <= block.high && candle.high >= block.low) {
      touches++;
    }
  }
  return touches;
}
