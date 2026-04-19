// src/indices/engine/macro/marketRegimeAnalyzer.ts
// Build full MarketRegime from macro data — adjustments for AMT scoring

import type { MacroContext } from '@/src/indices/types';
import type {
  MarketRegime,
  DXYTrend,
  VIXRegime,
  YieldTrend,
  CalendarRisk,
  SentimentBias,
} from '@/src/indices/types/amtTypes';

// ─── DXY ──────────────────────────────────────────────────────────────────

function classifyDXYTrend(change24h: number, value: number): DXYTrend {
  if (change24h > 0.5) return 'strong_up';
  if (change24h > 0.15) return 'up';
  if (change24h < -0.5) return 'strong_down';
  if (change24h < -0.15) return 'down';
  return 'neutral';
}

/**
 * DXY alignment for the signal direction.
 *
 * Strong USD (DXY up) → bearish for indices + EUR/GBP/AUD, bullish for USD/JPY
 * Weak USD (DXY down) → bullish for indices + EUR/GBP/AUD, bearish for USD/JPY
 *
 * @returns −10 to +10 adjustment
 */
function computeDXYAlignment(
  trend: DXYTrend,
  direction: 'long' | 'short',
  assetId: string,
): number {
  const isIndex = ['NAS100', 'SPX500', 'DAX'].includes(assetId);
  const hasUsd = assetId.includes('USD');
  const usdIsBase = assetId.startsWith('USD');

  const dxyIsUp = trend === 'up' || trend === 'strong_up';
  const dxyIsDown = trend === 'down' || trend === 'strong_down';
  const isStrong = trend === 'strong_up' || trend === 'strong_down';

  // If the pair has no USD leg (ex: EURJPY/GBPJPY), DXY signal is neutral.
  if (!isIndex && !hasUsd) return 0;

  // DXY up helps long for USD-base pairs, hurts long for indices/USD-quote pairs.
  const usdHelpsLong = isIndex ? false : usdIsBase;
  const magnitude = isStrong ? 10 : 5;

  if (dxyIsUp) {
    if (usdHelpsLong && direction === 'long') return magnitude;
    if (!usdHelpsLong && direction === 'short') return magnitude;
    if (usdHelpsLong && direction === 'short') return -magnitude;
    if (!usdHelpsLong && direction === 'long') return -magnitude;
  }

  if (dxyIsDown) {
    if (!usdHelpsLong && direction === 'long') return magnitude;
    if (usdHelpsLong && direction === 'short') return magnitude;
    if (!usdHelpsLong && direction === 'short') return -magnitude;
    if (usdHelpsLong && direction === 'long') return -magnitude;
  }

  return 0;
}

// ─── VIX ──────────────────────────────────────────────────────────────────

function classifyVIXRegime(vixValue: number): VIXRegime {
  if (vixValue < 15) return 'low';
  if (vixValue <= 25) return 'normal';
  return 'high';
}

/**
 * VIX adjustments:
 * - Low VIX (<15): stable environment, normal confidence → 0 adjustment, SL ×1.0
 * - Normal VIX (15–25): slight caution → −5, SL ×1.2
 * - High VIX (>25): elevated risk → −15, SL ×1.5
 */
function computeVIXAdjustments(
  regime: VIXRegime,
): { confidenceAdjustment: number; volatilityAdjustment: number } {
  switch (regime) {
    case 'low':
      return { confidenceAdjustment: 0, volatilityAdjustment: 1.0 };
    case 'normal':
      return { confidenceAdjustment: -5, volatilityAdjustment: 1.2 };
    case 'high':
      return { confidenceAdjustment: -15, volatilityAdjustment: 1.5 };
  }
}

// ─── Yields ───────────────────────────────────────────────────────────────

function classifyYieldTrend(change5d: number): YieldTrend {
  if (change5d > 5) return 'rising';   // >5bps
  if (change5d < -5) return 'falling';
  return 'stable';
}

/**
 * Yield trend equity bias:
 * - Rising yields → bearish for indices (higher discount rate), bullish for USD pairs
 * - Falling yields → bullish for indices, bearish for USD pairs
 *
 * @returns −10 to +10
 */
function computeYieldEquityBias(
  trend: YieldTrend,
  direction: 'long' | 'short',
  assetId: string,
): number {
  const isIndex = ['NAS100', 'SPX500', 'DAX'].includes(assetId);
  const hasUsd = assetId.includes('USD');
  const usdIsBase = assetId.startsWith('USD');

  if (trend === 'rising') {
    // Bearish for indices, bullish for USD pairs with USD as base
    if (isIndex && direction === 'short') return 5;
    if (isIndex && direction === 'long') return -5;
    // USD-quote pairs: rising yields → USD strong (slightly bearish these pairs)
    if (!isIndex && hasUsd) {
      if (usdIsBase && direction === 'long') return 3;
      if (!usdIsBase && direction === 'short') return 3;
    }
  }

  if (trend === 'falling') {
    if (isIndex && direction === 'long') return 5;
    if (isIndex && direction === 'short') return -5;
    if (!isIndex && hasUsd) {
      if (!usdIsBase && direction === 'long') return 3;
      if (usdIsBase && direction === 'short') return 3;
    }
  }

  return 0;
}

// ─── Calendar Risk ─────────────────────────────────────────────────────────

function computeCalendarRisk(
  macro: MacroContext,
): { risk: CalendarRisk; riskAdjustment: number; timeToEventMin: number } {
  const now = new Date();
  const highImpact = macro.economicEvents.filter(e => e.impact === 'high');

  let nearest = Infinity;
  for (const event of highImpact) {
    const diff = (event.time.getTime() - now.getTime()) / 60_000; // minutes
    if (diff > 0 && diff < nearest) nearest = diff;
  }

  if (nearest < 30) {
    return { risk: 'blocked', riskAdjustment: -30, timeToEventMin: nearest };
  }
  if (nearest < 120) {
    return { risk: 'caution', riskAdjustment: -15, timeToEventMin: nearest };
  }

  return { risk: 'clear', riskAdjustment: 0, timeToEventMin: nearest === Infinity ? 999 : nearest };
}

// ─── Sentiment ────────────────────────────────────────────────────────────

function classifySentiment(fearGreed: number): SentimentBias {
  if (fearGreed <= 20) return 'extreme_fear';
  if (fearGreed <= 40) return 'fear';
  if (fearGreed <= 60) return 'neutral';
  if (fearGreed <= 80) return 'greed';
  return 'extreme_greed';
}

/**
 * Contrarian sentiment bias:
 * - Extreme fear (≤20): buy signal — contrarian long bonus
 * - Fear (21–40): mild long bias
 * - Neutral (41–60): no adjustment
 * - Greed (61–80): mild short bias
 * - Extreme greed (81–100): sell signal — contrarian short bonus
 *
 * @returns −20 to +10 adjustment
 */
function computeContraryBias(
  bias: SentimentBias,
  direction: 'long' | 'short',
): number {
  const contraryFavorLong: Record<SentimentBias, number> = {
    extreme_fear: 10,   // contrarian long
    fear: 5,
    neutral: 0,
    greed: -10,
    extreme_greed: -20,
  };

  const base = contraryFavorLong[bias];
  return direction === 'long' ? base : -base;
}

// ─── Main Builder ──────────────────────────────────────────────────────────

/**
 * Build a complete MarketRegime from macro context.
 *
 * The `combinedAdjustment` is the sum of all sub-adjustments, clamped ±40.
 * This value is added to the AMT base score as the macro component.
 *
 * @param macro      Full macro context from macroFetcher
 * @param direction  Signal direction
 * @param assetId    Asset being analyzed
 */
export function analyzeMarketRegime(
  macro: MacroContext,
  direction: 'long' | 'short',
  assetId: string,
): MarketRegime {
  // ── DXY ──
  const dxyTrend = classifyDXYTrend(macro.dxy.change24h, macro.dxy.price);
  const dxyAlignment = computeDXYAlignment(dxyTrend, direction, assetId);

  // ── VIX ──
  const vixRegime = classifyVIXRegime(macro.vix.price);
  const { confidenceAdjustment, volatilityAdjustment } = computeVIXAdjustments(vixRegime);

  // ── Yields ──
  const yieldTrend = classifyYieldTrend(macro.yield10y.change5d);
  const equityBias = computeYieldEquityBias(yieldTrend, direction, assetId);

  // ── Calendar ──
  const { risk: eventRisk, riskAdjustment, timeToEventMin } = computeCalendarRisk(macro);
  const nextEvent = macro.economicEvents
    .filter(e => e.impact === 'high')
    .sort((a, b) => a.time.getTime() - b.time.getTime())[0] ?? null;

  // ── Sentiment ──
  const sentimentBias = classifySentiment(macro.sentiment.fearGreed);
  const contraryBias = computeContraryBias(sentimentBias, direction);

  // ── Combined ──
  const rawAdjustment =
    dxyAlignment +
    confidenceAdjustment +
    equityBias +
    riskAdjustment +
    contraryBias;

  const combinedAdjustment = Math.max(-40, Math.min(40, rawAdjustment));

  return {
    dxy: {
      trend: dxyTrend,
      value: macro.dxy.price,
      change24h: macro.dxy.change24h,
      alignment: dxyAlignment,
    },
    vix: {
      regime: vixRegime,
      value: macro.vix.price,
      volatilityAdjustment,
      confidenceAdjustment,
    },
    yields: {
      trend: yieldTrend,
      value: macro.yield10y.price,
      change5d: macro.yield10y.change5d,
      equityBias,
    },
    calendar: {
      eventRisk,
      nextEvent,
      timeToEventMinutes: timeToEventMin,
      riskAdjustment,
    },
    sentiment: {
      fearGreed: macro.sentiment.fearGreed,
      bias: sentimentBias,
      contraryBias,
    },
    combinedAdjustment,
  };
}

/**
 * Convert MarketRegime combinedAdjustment to the AMT macro score component.
 * AMT macro component range: −20 to +20.
 * Maps combinedAdjustment (±40) → ±20 by halving.
 */
export function regimeToAMTMacroScore(regime: MarketRegime): number {
  return Math.round(regime.combinedAdjustment / 2);
}
