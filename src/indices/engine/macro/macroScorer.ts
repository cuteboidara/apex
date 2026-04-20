// src/indices/engine/macro/macroScorer.ts
// Score macro context for a given asset + direction

import type { MacroContext, MacroScore, EconomicEvent } from '@/src/indices/types';
import { isIndex } from '@/src/indices/data/fetchers/assetConfig';
import type { AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';

const NEWS_BLOCK_WINDOW_MS = 30 * 60 * 1000;   // 30 min
const NEWS_CAUTION_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function toTimeMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
  }

  return null;
}

function usdExposure(assetId: AssetSymbol): 'base' | 'quote' | 'none' {
  if (!assetId.includes('USD')) return 'none';
  if (assetId.startsWith('USD')) return 'base';
  if (assetId.endsWith('USD')) return 'quote';
  return 'none';
}

export function scoreMacroContext(
  assetId: AssetSymbol,
  direction: 'long' | 'short',
  macro: MacroContext,
): MacroScore {
  const now = new Date();
  const nowMs = now.getTime();
  const assetIsIndex = isIndex(assetId);

  // ─── DXY Alignment (0-8 pts) ────────────────────────────────────────────
  // Indices: DXY weak = bullish indices. DXY strong = bearish indices.
  // Forex USD pairs: depends on pair side
  let dxyAlignment = 0;
  if (assetIsIndex) {
    if (direction === 'long' && macro.dxy.strength === 'weak') dxyAlignment = 8;
    else if (direction === 'short' && macro.dxy.strength === 'strong') dxyAlignment = 8;
    else if (macro.dxy.strength === 'neutral') dxyAlignment = 0;
    else dxyAlignment = -4; // conflicting
  } else {
    // Forex: only apply DXY rules to USD-involved pairs.
    const usdSide = usdExposure(assetId);

    if (usdSide === 'base') {
      if (direction === 'long' && macro.dxy.strength === 'strong') dxyAlignment = 8;
      else if (direction === 'short' && macro.dxy.strength === 'weak') dxyAlignment = 8;
      else if (macro.dxy.strength === 'neutral') dxyAlignment = 0;
      else dxyAlignment = -4;
    } else if (usdSide === 'quote') {
      if (direction === 'long' && macro.dxy.strength === 'weak') dxyAlignment = 8;
      else if (direction === 'short' && macro.dxy.strength === 'strong') dxyAlignment = 8;
      else if (macro.dxy.strength === 'neutral') dxyAlignment = 0;
      else dxyAlignment = -4;
    }
  }

  // ─── VIX Regime (0-5 pts) ──────────────────────────────────────────────
  let vixPoints = 0;
  if (macro.vix.regime === 'low' && direction === 'long') vixPoints = 5;
  else if (macro.vix.regime === 'normal') vixPoints = 0;
  else if (macro.vix.regime === 'high') vixPoints = -3; // risky environment

  // ─── Yield Trend (0-5 pts) ─────────────────────────────────────────────
  let yieldPoints = 0;
  if (assetIsIndex) {
    if (direction === 'long' && macro.yield10y.trend === 'down') yieldPoints = 5;
    else if (direction === 'short' && macro.yield10y.trend === 'up') yieldPoints = 5;
    else if (macro.yield10y.trend === 'stable') yieldPoints = 0;
  } else {
    // Forex: only apply UST-yield rules to USD-involved pairs.
    const usdSide = usdExposure(assetId);
    if (usdSide === 'base') {
      if (direction === 'long' && macro.yield10y.trend === 'up') yieldPoints = 5;
      else if (direction === 'short' && macro.yield10y.trend === 'down') yieldPoints = 5;
    } else if (usdSide === 'quote') {
      if (direction === 'long' && macro.yield10y.trend === 'down') yieldPoints = 5;
      else if (direction === 'short' && macro.yield10y.trend === 'up') yieldPoints = 5;
    }
  }

  // ─── Economic Calendar (0-5 or -10) ────────────────────────────────────
  const upcomingHighImpact = macro.economicEvents.filter(e => {
    if (e.impact !== 'high') return false;
    const eventMs = toTimeMs(e.time);
    return eventMs != null && eventMs > nowMs && eventMs < nowMs + NEWS_CAUTION_WINDOW_MS;
  });
  const imminent = upcomingHighImpact.filter(e => {
    const eventMs = toTimeMs(e.time);
    return eventMs != null && eventMs < nowMs + NEWS_BLOCK_WINDOW_MS;
  });

  let eventRisk: MacroScore['eventRisk'];
  let eventPoints: number;
  let eventDetails: EconomicEvent | undefined;

  if (imminent.length > 0) {
    eventRisk = 'blocked';
    eventPoints = -10;
    eventDetails = imminent[0];
  } else if (upcomingHighImpact.length > 0) {
    eventRisk = 'caution';
    eventPoints = -5;
    eventDetails = upcomingHighImpact[0];
  } else {
    eventRisk = 'clear';
    eventPoints = 5;
  }

  // ─── Sentiment (0-5 pts) ─────────────────────────────────────────────
  let sentimentPoints = 0;
  if (direction === 'long' && macro.sentiment.classification === 'extreme_fear') sentimentPoints = 5;
  else if (direction === 'short' && macro.sentiment.classification === 'extreme_greed') sentimentPoints = 5;
  else if (direction === 'long' && macro.sentiment.classification === 'fear') sentimentPoints = 2;
  else if (direction === 'short' && macro.sentiment.classification === 'greed') sentimentPoints = 2;

  const macroScore = dxyAlignment + vixPoints + yieldPoints + eventPoints + sentimentPoints;

  return {
    assetId,
    timestamp: now,
    dxyStrength: macro.dxy.strength,
    dxyAlignment,
    vixRegime: macro.vix.regime,
    vixPoints,
    yieldTrend: macro.yield10y.trend,
    yieldPoints,
    eventRisk,
    eventPoints,
    eventDetails,
    sentiment: macro.sentiment.classification,
    sentimentPoints,
    macroScore,
  };
}

export function buildMacroSummary(score: MacroScore): string {
  const parts: string[] = [];
  parts.push(`DXY ${score.dxyStrength} (${score.dxyAlignment >= 0 ? '+' : ''}${score.dxyAlignment}pts)`);
  parts.push(`VIX ${score.vixRegime} (${score.vixPoints >= 0 ? '+' : ''}${score.vixPoints}pts)`);
  parts.push(`Yields ${score.yieldTrend} (${score.yieldPoints >= 0 ? '+' : ''}${score.yieldPoints}pts)`);
  parts.push(`Calendar ${score.eventRisk}`);
  if (score.eventDetails) {
    parts.push(`⚠ ${score.eventDetails.event} in ${formatTimeUntil(score.eventDetails.time)}`);
  }
  parts.push(`Sentiment: ${score.sentiment.replace(/_/g, ' ')} (${score.sentimentPoints >= 0 ? '+' : ''}${score.sentimentPoints}pts)`);
  return parts.join(' | ');
}

function formatTimeUntil(time: Date | string | number): string {
  const eventMs = toTimeMs(time);
  if (eventMs == null) return 'unknown';
  const diffMs = eventMs - Date.now();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}min`;
  return `${Math.round(mins / 60)}h`;
}
