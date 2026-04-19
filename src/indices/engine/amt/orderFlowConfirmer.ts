// src/indices/engine/amt/orderFlowConfirmer.ts
// Order flow confirmation: failed auction + breakout acceptance detection

import type { Candle } from '@/src/indices/types';
import type {
  FairValueArea,
  CandleAnalysis,
  OrderFlowConfirmation,
  OrderFlowScenario,
} from '@/src/indices/types/amtTypes';
import { analyzeCandles } from './candleAnalyzer';
import { classifyPriceVsFVA, detectFVARejection } from './fairValueDetector';

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Check for failed auction below value (long setup).
 *
 * Conditions:
 * 1. Price probed below FVA lower band
 * 2. Could not sustain closes below → reversal back inside FVA
 * 3. Recent candle quality is bullish and not low aggression
 */
function checkFailedAuctionLong(
  candles: Candle[],
  analyses: CandleAnalysis[],
  fva: FairValueArea,
): {
  score: number;
  acceptance: string[];
  rejection: string[];
  nextAction: number | null;
  invalidation: number;
} {
  const acceptance: string[] = [];
  const rejection: string[] = [];

  const last5 = candles.slice(-5);
  const last5Analysis = analyses.slice(-5);

  // 1. Did price probe below FVA lower?
  const probedBelow = last5.some(c => c.low < fva.lower);
  if (!probedBelow) {
    rejection.push('No probe below FVA lower — no failed auction opportunity');
    return { score: 0, acceptance, rejection, nextAction: null, invalidation: fva.lower };
  }
  acceptance.push('Price probed below FVA lower band');

  // 2. Rejection of lower band
  const { rejected, rejectionStrength } = detectFVARejection(last5, fva, 'long');
  if (rejected) {
    acceptance.push(`FVA lower rejection confirmed (strength: ${rejectionStrength}%)`);
  } else {
    rejection.push('No clear rejection from FVA lower — price still below value');
  }

  // 3. Candle quality check
  const lastAnalysis = last5Analysis[last5Analysis.length - 1];
  const isBullish = lastAnalysis.direction === 'bullish';
  const notWeak = lastAnalysis.aggressiveness !== 'low';

  if (isBullish && notWeak) {
    acceptance.push(`Latest candle: ${lastAnalysis.aggressiveness} bullish aggression`);
  } else {
    rejection.push(
      isBullish
        ? 'Bullish candle but low aggression — weak confirmation'
        : 'Latest candle is not bullish',
    );
  }

  // 4. Close returning inside FVA
  const lastCandle = candles[candles.length - 1];
  const position = classifyPriceVsFVA(lastCandle.close, fva);
  if (position === 'inside' || position === 'above') {
    acceptance.push(`Close returned ${position} FVA`);
  } else {
    rejection.push('Close still below FVA — auction may not have failed yet');
  }

  // Score: 0–100 based on conditions met
  let score = 0;
  if (probedBelow) score += 20;
  if (rejected) score += 30 + Math.round(rejectionStrength * 0.2); // up to 50
  if (isBullish && notWeak) score += 20;
  if (position !== 'below') score += 10;

  score = Math.min(100, score);

  // Next action: entry at mid-FVA or current close
  const nextAction = score >= 50
    ? Math.max(lastCandle.close, fva.lower + (fva.bandWidth * 0.1))
    : null;

  // Invalidation: below lowest wick of last 3 candles
  const lowestLow = Math.min(...last5.map(c => c.low));
  const invalidation = lowestLow - fva.bandWidth * 0.15;

  return { score, acceptance, rejection, nextAction, invalidation };
}

/**
 * Check for failed auction above value (short setup).
 */
function checkFailedAuctionShort(
  candles: Candle[],
  analyses: CandleAnalysis[],
  fva: FairValueArea,
): {
  score: number;
  acceptance: string[];
  rejection: string[];
  nextAction: number | null;
  invalidation: number;
} {
  const acceptance: string[] = [];
  const rejection: string[] = [];

  const last5 = candles.slice(-5);
  const last5Analysis = analyses.slice(-5);

  const probedAbove = last5.some(c => c.high > fva.upper);
  if (!probedAbove) {
    rejection.push('No probe above FVA upper — no failed auction opportunity');
    return { score: 0, acceptance, rejection, nextAction: null, invalidation: fva.upper };
  }
  acceptance.push('Price probed above FVA upper band');

  const { rejected, rejectionStrength } = detectFVARejection(last5, fva, 'short');
  if (rejected) {
    acceptance.push(`FVA upper rejection confirmed (strength: ${rejectionStrength}%)`);
  } else {
    rejection.push('No clear rejection from FVA upper');
  }

  const lastAnalysis = last5Analysis[last5Analysis.length - 1];
  const isBearish = lastAnalysis.direction === 'bearish';
  const notWeak = lastAnalysis.aggressiveness !== 'low';

  if (isBearish && notWeak) {
    acceptance.push(`Latest candle: ${lastAnalysis.aggressiveness} bearish aggression`);
  } else {
    rejection.push(
      isBearish
        ? 'Bearish candle but low aggression'
        : 'Latest candle is not bearish',
    );
  }

  const lastCandle = candles[candles.length - 1];
  const position = classifyPriceVsFVA(lastCandle.close, fva);
  if (position === 'inside' || position === 'below') {
    acceptance.push(`Close returned ${position} FVA`);
  } else {
    rejection.push('Close still above FVA — failed auction not confirmed');
  }

  let score = 0;
  if (probedAbove) score += 20;
  if (rejected) score += 30 + Math.round(rejectionStrength * 0.2);
  if (isBearish && notWeak) score += 20;
  if (position !== 'above') score += 10;
  score = Math.min(100, score);

  const nextAction = score >= 50
    ? Math.min(lastCandle.close, fva.upper - fva.bandWidth * 0.1)
    : null;

  const highestHigh = Math.max(...last5.map(c => c.high));
  const invalidation = highestHigh + fva.bandWidth * 0.15;

  return { score, acceptance, rejection, nextAction, invalidation };
}

/**
 * Check for breakout with acceptance (continuation setup).
 *
 * Breakout acceptance:
 * 1. Price broke decisively outside FVA
 * 2. Subsequent candles close outside (not reverting)
 * 3. High/medium aggression in direction of breakout
 */
function checkBreakoutAcceptance(
  candles: Candle[],
  analyses: CandleAnalysis[],
  fva: FairValueArea,
  direction: 'long' | 'short',
): {
  score: number;
  acceptance: string[];
  rejection: string[];
  nextAction: number | null;
  invalidation: number;
} {
  const acceptance: string[] = [];
  const rejection: string[] = [];

  const last3 = candles.slice(-3);
  const last3Analysis = analyses.slice(-3);
  const lastCandle = candles[candles.length - 1];

  const breakoutSide = direction === 'long' ? 'above' : 'below';
  const boundary = direction === 'long' ? fva.upper : fva.lower;

  // All 3 candles must close outside FVA in breakout direction
  const allOutside = last3.every(c =>
    direction === 'long' ? c.close > fva.upper : c.close < fva.lower,
  );

  if (!allOutside) {
    rejection.push(`Not all last 3 closes are ${breakoutSide} FVA — no acceptance`);
    return {
      score: 0,
      acceptance,
      rejection,
      nextAction: null,
      invalidation: boundary,
    };
  }
  acceptance.push(`All last 3 candles closing ${breakoutSide} FVA — acceptance`);

  // Direction alignment
  const directionMatch = last3Analysis.every(a =>
    a.direction === (direction === 'long' ? 'bullish' : 'bearish') ||
    a.direction === 'indecision',
  );

  if (directionMatch) {
    acceptance.push('Candle direction aligns with breakout');
  } else {
    rejection.push('Mixed candle direction — uncertain acceptance');
  }

  // Aggression check
  const hasHighAggression = last3Analysis.some(a => a.aggressiveness === 'high');
  const hasMediumAggression = last3Analysis.some(a => a.aggressiveness === 'medium');

  if (hasHighAggression) {
    acceptance.push('High aggression candle confirms breakout');
  } else if (hasMediumAggression) {
    acceptance.push('Medium aggression supports breakout');
  } else {
    rejection.push('Low aggression — possible false breakout');
  }

  // No reversion attempt
  const hasReversion = last3.some(c =>
    direction === 'long'
      ? c.low < fva.upper - fva.bandWidth * 0.1
      : c.high > fva.lower + fva.bandWidth * 0.1,
  );

  if (!hasReversion) {
    acceptance.push('No reversion into FVA — clean breakout');
  } else {
    rejection.push('Price dipped back toward FVA — pullback risk');
  }

  let score = 0;
  if (allOutside) score += 35;
  if (directionMatch) score += 25;
  if (hasHighAggression) score += 25;
  else if (hasMediumAggression) score += 15;
  if (!hasReversion) score += 15;
  score = Math.min(100, score);

  const nextAction = score >= 50 ? lastCandle.close : null;
  const invalidation = direction === 'long'
    ? fva.upper - fva.bandWidth * 0.2
    : fva.lower + fva.bandWidth * 0.2;

  return { score, acceptance, rejection, nextAction, invalidation };
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface OrderFlowInput {
  candles: Candle[];
  fva: FairValueArea;
  direction: 'long' | 'short';
  scenario: OrderFlowScenario;
}

/**
 * Confirm order flow for a given AMT scenario and direction.
 *
 * @param input  Candles, FVA, direction, and which scenario to test
 * @returns      OrderFlowConfirmation with confidence score and signals
 */
export function confirmOrderFlow(input: OrderFlowInput): OrderFlowConfirmation {
  const { candles, fva, direction, scenario } = input;

  if (candles.length < 5) {
    return {
      confirmed: false,
      confidence: 0,
      scenario: 'none',
      confirmationCandles: [],
      rejectionSignals: ['Insufficient candle data (need ≥5)'],
      acceptanceSignals: [],
      nextActionPrice: null,
      invalidationLevel: fva.center,
    };
  }

  const analyses = analyzeCandles(candles, 10);
  const confirmationCandles = analyses.slice(-5);

  let result: {
    score: number;
    acceptance: string[];
    rejection: string[];
    nextAction: number | null;
    invalidation: number;
  };

  if (scenario === 'failed_auction_long') {
    result = checkFailedAuctionLong(candles, analyses, fva);
  } else if (scenario === 'failed_auction_short') {
    result = checkFailedAuctionShort(candles, analyses, fva);
  } else if (scenario === 'breakout_acceptance') {
    result = checkBreakoutAcceptance(candles, analyses, fva, direction);
  } else {
    return {
      confirmed: false,
      confidence: 0,
      scenario: 'none',
      confirmationCandles,
      rejectionSignals: ['No scenario specified'],
      acceptanceSignals: [],
      nextActionPrice: null,
      invalidationLevel: fva.center,
    };
  }

  const confirmed = result.score >= 50 && result.acceptance.length >= 2;

  return {
    confirmed,
    confidence: result.score,
    scenario,
    confirmationCandles,
    rejectionSignals: result.rejection,
    acceptanceSignals: result.acceptance,
    nextActionPrice: result.nextAction,
    invalidationLevel: result.invalidation,
  };
}

/**
 * Auto-detect the most likely scenario from current price vs FVA,
 * then confirm order flow for it.
 */
export function detectAndConfirmOrderFlow(
  candles: Candle[],
  fva: FairValueArea,
): OrderFlowConfirmation {
  if (candles.length === 0) {
    return {
      confirmed: false,
      confidence: 0,
      scenario: 'none',
      confirmationCandles: [],
      rejectionSignals: ['No candles provided'],
      acceptanceSignals: [],
      nextActionPrice: null,
      invalidationLevel: fva.center,
    };
  }

  const last = candles[candles.length - 1];
  const position = classifyPriceVsFVA(last.close, fva);
  const last5 = candles.slice(-5);

  // Determine the most plausible scenario
  let scenario: OrderFlowScenario = 'none';
  let direction: 'long' | 'short' = 'long';

  if (position === 'below') {
    // Price is below value — could be failed auction long (reversal up) OR cont. short
    const hadProbeUp = last5.some(c => c.high >= fva.lower);
    scenario = 'failed_auction_long';
    direction = 'long';
  } else if (position === 'above') {
    // Price is above value — could be failed auction short or breakout acceptance
    const allAbove = last5.every(c => c.close > fva.upper);
    scenario = allAbove ? 'breakout_acceptance' : 'failed_auction_short';
    direction = allAbove ? 'long' : 'short';
  } else {
    // Inside value — look for recent probe and rejection
    const recentLow = Math.min(...last5.map(c => c.low));
    const recentHigh = Math.max(...last5.map(c => c.high));
    const priceProbedBelow = recentLow < fva.lower;
    const priceProbedAbove = recentHigh > fva.upper;

    if (priceProbedBelow && last.close > fva.lower) {
      scenario = 'failed_auction_long';
      direction = 'long';
    } else if (priceProbedAbove && last.close < fva.upper) {
      scenario = 'failed_auction_short';
      direction = 'short';
    }
  }

  if (scenario === 'none') {
    const analyses = analyzeCandles(candles, 5);
    return {
      confirmed: false,
      confidence: 0,
      scenario: 'none',
      confirmationCandles: analyses,
      rejectionSignals: ['No clear AMT scenario detected'],
      acceptanceSignals: [],
      nextActionPrice: null,
      invalidationLevel: fva.center,
    };
  }

  return confirmOrderFlow({ candles, fva, direction, scenario });
}
