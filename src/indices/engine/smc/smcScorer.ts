// src/indices/engine/smc/smcScorer.ts
// Orchestrate SMC analysis and produce SMCSetup with 0-40 score

import type { Candle, SMCSetup, OrderBlock, FairValueGap } from '@/src/indices/types';
import { detectOrderBlocks } from './orderBlockDetector';
import { detectFVGs } from './fvgDetector';
import { detectLiquiditySweeps } from './liquidityDetector';
import { detectSwings } from './swingDetector';

export function runSMCAnalysis(assetId: string, candles: Candle[]): SMCSetup | null {
  if (candles.length < 30) return null;

  const orderBlocks = detectOrderBlocks(assetId, candles);
  const fvgs = detectFVGs(assetId, candles);
  const sweeps = detectLiquiditySweeps(candles);
  const { highs, lows } = detectSwings(candles);

  // Find best bullish and bearish setups
  const bullishOB = orderBlocks.find(b => b.type === 'bullish');
  const bearishOB = orderBlocks.find(b => b.type === 'bearish');
  const bullishFVG = fvgs.find(f => f.type === 'bullish');
  const bearishFVG = fvgs.find(f => f.type === 'bearish');

  // Determine direction from recent sweep confirmation
  const recentBullishSweep = sweeps.find(s => s.side === 'sellside' && s.reversed && s.candlesAgo <= 15);
  const recentBearishSweep = sweeps.find(s => s.side === 'buyside' && s.reversed && s.candlesAgo <= 15);

  let direction: 'bullish' | 'bearish';
  let orderBlock: OrderBlock;
  let fvg: FairValueGap | undefined;

  // Prefer sweep-confirmed direction
  if (recentBullishSweep && bullishOB) {
    direction = 'bullish';
    orderBlock = bullishOB;
    fvg = bullishFVG;
  } else if (recentBearishSweep && bearishOB) {
    direction = 'bearish';
    orderBlock = bearishOB;
    fvg = bearishFVG;
  } else if (bullishOB && (!bearishOB || bullishOB.quality >= bearishOB.quality)) {
    direction = 'bullish';
    orderBlock = bullishOB;
    fvg = bullishFVG;
  } else if (bearishOB) {
    direction = 'bearish';
    orderBlock = bearishOB;
    fvg = bearishFVG;
  } else {
    return null; // No valid setup
  }

  // Entry zone = the order block itself
  const entryZoneHigh = orderBlock.high;
  const entryZoneLow = orderBlock.low;
  const entryZoneMid = orderBlock.mid;

  // Stop loss: just outside the order block with buffer
  const stopLossBuffer = 0.001; // 0.1%
  const stopLossLevel = direction === 'bullish'
    ? orderBlock.low * (1 - stopLossBuffer)
    : orderBlock.high * (1 + stopLossBuffer);

  // Score components
  const orderBlockQuality = scoreOrderBlock(orderBlock, sweeps);
  const fvgQuality = fvg ? scoreFVG(fvg, orderBlock) : 0;
  const liquidityQuality = scoreLiquidity(sweeps, direction);
  const smcScore = Math.min(40, orderBlockQuality + fvgQuality + liquidityQuality);

  const reasoning = buildReasoning({
    direction,
    orderBlock,
    fvg,
    orderBlockQuality,
    fvgQuality,
    liquidityQuality,
    smcScore,
    sweepConfirmed: direction === 'bullish' ? !!recentBullishSweep : !!recentBearishSweep,
  });

  return {
    assetId,
    scanTimestamp: new Date(),
    direction,
    orderBlock,
    fvg,
    entryZoneHigh,
    entryZoneLow,
    entryZoneMid,
    stopLossLevel,
    stopLossBuffer,
    smcScore,
    orderBlockQuality,
    fvgQuality,
    liquidityQuality,
    reasoning,
  };
}

function scoreOrderBlock(
  block: OrderBlock,
  sweeps: ReturnType<typeof detectLiquiditySweeps>,
): number {
  let score = block.quality; // base quality from detector (0-15)

  // Bonus: liquidity sweep into this block
  const swept = sweeps.some(s =>
    s.reversed &&
    s.candlesAgo <= 15 &&
    ((block.type === 'bullish' && s.side === 'sellside') ||
     (block.type === 'bearish' && s.side === 'buyside')),
  );
  if (swept) score += 8;

  // Penalty: heavily touched
  score -= block.depth > 8 ? 3 : 0;

  return Math.max(0, Math.min(15, score));
}

function scoreFVG(fvg: FairValueGap, block: OrderBlock): number {
  let score = fvg.quality; // base (0-10)

  // Bonus: FVG aligns with order block (overlapping zones)
  const overlaps = fvg.gapLow <= block.high && fvg.gapHigh >= block.low;
  if (overlaps) score += 7;

  return Math.max(0, Math.min(10, score));
}

function scoreLiquidity(
  sweeps: ReturnType<typeof detectLiquiditySweeps>,
  direction: 'bullish' | 'bearish',
): number {
  let score = 0;
  const expectedSide = direction === 'bullish' ? 'sellside' : 'buyside';
  const recentSweeps = sweeps.filter(s => s.candlesAgo <= 15 && s.side === expectedSide);

  if (recentSweeps.length === 0) return 0;

  const bestSweep = recentSweeps.find(s => s.reversed);
  if (!bestSweep) return 5; // sweep without reversal = partial confirmation

  score += bestSweep.reversalStrength === 'strong' ? 15 :
           bestSweep.reversalStrength === 'moderate' ? 10 : 8;

  // Double sweep bonus
  if (recentSweeps.filter(s => s.reversed).length >= 2) score += 10;

  return Math.max(0, Math.min(15, score));
}

function buildReasoning(input: {
  direction: 'bullish' | 'bearish';
  orderBlock: OrderBlock;
  fvg?: FairValueGap;
  orderBlockQuality: number;
  fvgQuality: number;
  liquidityQuality: number;
  smcScore: number;
  sweepConfirmed: boolean;
}): string[] {
  const reasons: string[] = [];

  reasons.push(
    `${input.direction === 'bullish' ? 'Bullish' : 'Bearish'} order block at ${input.orderBlock.low.toFixed(2)}–${input.orderBlock.high.toFixed(2)} (${input.orderBlock.daysOld} candles old, quality ${input.orderBlockQuality}/15)`,
  );

  if (input.sweepConfirmed) {
    reasons.push(`Liquidity sweep confirmed ${input.direction === 'bullish' ? 'below' : 'above'} structure — smart money absorbed stops (${input.liquidityQuality}/15)`);
  }

  if (input.fvg) {
    reasons.push(`${input.fvg.type === 'bullish' ? 'Bullish' : 'Bearish'} FVG at ${input.fvg.gapLow.toFixed(2)}–${input.fvg.gapHigh.toFixed(2)}, ${input.fvg.daysOld} candles old (quality ${input.fvgQuality}/10)`);
  }

  reasons.push(`Total SMC score: ${input.smcScore}/40`);
  return reasons;
}
