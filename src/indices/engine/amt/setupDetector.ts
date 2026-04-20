// src/indices/engine/amt/setupDetector.ts
// Detect all 3 AMT setups and score them 0–100

import type { Candle, MacroContext, OrderBlock, FairValueGap } from '@/src/indices/types';
import type {
  AMTSignal,
  AMTSetupType,
  FairValueArea,
} from '@/src/indices/types/amtTypes';
import { detectFairValueArea, classifyPriceVsFVA } from './fairValueDetector';
import { analyzeCandles, detectSequentialPatterns, computeCandleQualityScore } from './candleAnalyzer';
import { confirmOrderFlow } from './orderFlowConfirmer';
import { integrateOBWithAMT } from '../smc/orderBlockAMTIntegration';
import { analyzeMarketRegime, regimeToAMTMacroScore } from '../macro/marketRegimeAnalyzer';
import { computeAMTSizing } from '../quant/amtSizing';

// ─── Configuration ─────────────────────────────────────────────────────────

const ACCOUNT_SIZE = Number(process.env.ACCOUNT_SIZE ?? 10_000);
const MIN_RR = 1.5; // minimum risk-reward to accept a signal

// ─── Take Profit Calculation ───────────────────────────────────────────────

function computeTPs(
  entry: number,
  stopLoss: number,
  direction: 'long' | 'short',
): { tp1: number; tp2: number; tp3: number } {
  const risk = Math.abs(entry - stopLoss);
  if (direction === 'long') {
    return {
      tp1: entry + risk * 1.0,
      tp2: entry + risk * 2.0,
      tp3: entry + risk * 3.0,
    };
  } else {
    return {
      tp1: entry - risk * 1.0,
      tp2: entry - risk * 2.0,
      tp3: entry - risk * 3.0,
    };
  }
}

function computeRR(
  entry: number,
  stopLoss: number,
  tp2: number,
): number {
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(tp2 - entry);
  return risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;
}

// ─── Correlation Bonus ─────────────────────────────────────────────────────

/**
 * Stub: returns 0–10 based on correlated assets also showing same setup.
 * In production this would compare with a pre-computed correlation matrix.
 */
function computeCorrelationBonus(assetId: string, direction: 'long' | 'short'): number {
  void direction;

  // US indices — high intra-group correlation
  const usIndices = ['NAS100', 'SPX500', 'US30'];
  if (usIndices.includes(assetId)) return 5;

  // European indices — moderate intra-group correlation
  const euIndices = ['DAX', 'FTSE100', 'UK100', 'CAC40'];
  if (euIndices.includes(assetId)) return 4;

  // Asian indices — moderate intra-group correlation
  const asianIndices = ['NIKKEI', 'HANGSENG', 'ASX200'];
  if (asianIndices.includes(assetId)) return 3;

  // FX pairs with USD leg — co-move through broad USD regime
  const usdPairs = ['EURUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCAD', 'USDCHF'];
  if (usdPairs.includes(assetId)) return 3;

  // JPY crosses — moderately correlated in risk-on/off swings
  if (assetId === 'EURJPY' || assetId === 'GBPJPY') return 2;

  // Metals — gold and silver move together
  const metals = ['XAUUSD', 'XAGUSD', 'COPPER'];
  if (metals.includes(assetId)) return 4;

  // Energy — WTI and Brent near-identical
  const energy = ['USOIL', 'UKOIL'];
  if (energy.includes(assetId)) return 5;
  if (assetId === 'NATGAS') return 2; // loosely correlated with energy complex

  // Rates — US rates tend to lead globally
  const usRates = ['US10Y', 'US2Y'];
  if (usRates.includes(assetId)) return 4;

  const globalRates = ['DE10Y', 'JP10Y', 'UK10Y'];
  if (globalRates.includes(assetId)) return 3;

  return 0;
}

// ─── Setup Builders ────────────────────────────────────────────────────────

interface SetupContext {
  assetId: string;
  candles: Candle[];
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  macro: MacroContext;
  fva: FairValueArea;
  currentPrice: number;
}

function buildFailedAuctionLong(ctx: SetupContext): AMTSignal | null {
  const { assetId, candles, orderBlocks, fvgs, macro, fva, currentPrice } = ctx;

  // Only valid if price has probed below FVA and is recovering
  const position = classifyPriceVsFVA(currentPrice, fva);
  const last5 = candles.slice(-5);
  const hadProbeLow = last5.some(c => c.low < fva.lower);
  if (!hadProbeLow) return null;

  const orderFlow = confirmOrderFlow({
    candles,
    fva,
    direction: 'long',
    scenario: 'failed_auction_long',
  });

  if (orderFlow.confidence < 20) return null;

  const obIntegration = integrateOBWithAMT(
    orderBlocks, fvgs, fva, orderFlow, 'long', currentPrice,
  );

  const analyses = analyzeCandles(candles, 10);
  const patterns = detectSequentialPatterns(analyses);
  const candleQuality = computeCandleQualityScore(analyses, patterns);

  const regime = analyzeMarketRegime(macro, 'long', assetId);
  const macroAdj = regimeToAMTMacroScore(regime);

  // Block if calendar risk is high
  if (regime.calendar.eventRisk === 'blocked') return null;

  const smcTa = obIntegration.smcTaAlignmentScore;
  const orderFlowScore = Math.round(orderFlow.confidence * 0.25); // 0–25
  const corrBonus = computeCorrelationBonus(assetId, 'long');

  const totalScore = Math.min(
    100,
    candleQuality + orderFlowScore + smcTa + macroAdj + corrBonus,
  );

  if (totalScore < 30) return null;

  // Entry and risk levels
  const entryZone = obIntegration.refinedEntryZone ?? {
    high: fva.lower + fva.bandWidth * 0.15,
    low: fva.lower - fva.bandWidth * 0.05,
    mid: fva.lower + fva.bandWidth * 0.05,
  };

  const stopLoss = obIntegration.stopLoss ?? entryZone.low * 0.998;
  const { tp1, tp2, tp3 } = computeTPs(entryZone.mid, stopLoss, 'long');
  const rr = computeRR(entryZone.mid, stopLoss, tp2);

  if (rr < MIN_RR) return null;

  const sizing = computeAMTSizing({
    assetId,
    accountSize: ACCOUNT_SIZE,
    totalScore,
    entryPrice: entryZone.mid,
    stopLossPrice: stopLoss,
  });

  return {
    rank: 0, // assigned by ranker
    assetId,
    setupType: 'failed_auction_long',
    direction: 'long',
    candleQuality,
    orderFlowConfidence: orderFlowScore,
    smcTaAlignment: smcTa,
    macroAdjustment: macroAdj,
    correlationBonus: corrBonus,
    totalScore,
    entryZone,
    entryStrategy: orderFlow.confidence >= 60 ? 'aggressive' : 'conservative',
    fairValueArea: fva,
    priceRelativeToFVA: position,
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardRatio: rr,
    positionSize: sizing.lotSize,
    riskAmount: sizing.riskAmount,
    kellyFraction: sizing.kellyFractional,
    confirmationCandles: analyses.slice(-3),
    patterns,
    orderFlowConfirmation: orderFlow,
    setupDescription: 'Failed Auction Below Value — bearish attempt rejected, bullish recovery expected',
    confirmationEvidence: orderFlow.acceptanceSignals,
    macroContext: `DXY ${regime.dxy.trend}, VIX ${regime.vix.regime}, Yields ${regime.yields.trend}`,
    executionPlan: `Enter near ${entryZone.mid.toFixed(4)}, SL ${stopLoss.toFixed(4)}, TP1 ${tp1.toFixed(4)}, TP2 ${tp2.toFixed(4)}, TP3 ${tp3.toFixed(4)}`,
    generatedAt: new Date(),
    invalidationLevel: stopLoss,
    newsRisk: regime.calendar.eventRisk,
    regime,
  };
}

function buildFailedAuctionShort(ctx: SetupContext): AMTSignal | null {
  const { assetId, candles, orderBlocks, fvgs, macro, fva, currentPrice } = ctx;

  const last5 = candles.slice(-5);
  const hadProbeHigh = last5.some(c => c.high > fva.upper);
  if (!hadProbeHigh) return null;

  const orderFlow = confirmOrderFlow({
    candles,
    fva,
    direction: 'short',
    scenario: 'failed_auction_short',
  });

  if (orderFlow.confidence < 20) return null;

  const obIntegration = integrateOBWithAMT(
    orderBlocks, fvgs, fva, orderFlow, 'short', currentPrice,
  );

  const analyses = analyzeCandles(candles, 10);
  const patterns = detectSequentialPatterns(analyses);
  const candleQuality = computeCandleQualityScore(analyses, patterns);

  const regime = analyzeMarketRegime(macro, 'short', assetId);
  const macroAdj = regimeToAMTMacroScore(regime);

  if (regime.calendar.eventRisk === 'blocked') return null;

  const smcTa = obIntegration.smcTaAlignmentScore;
  const orderFlowScore = Math.round(orderFlow.confidence * 0.25);
  const corrBonus = computeCorrelationBonus(assetId, 'short');

  const totalScore = Math.min(
    100,
    candleQuality + orderFlowScore + smcTa + macroAdj + corrBonus,
  );

  if (totalScore < 30) return null;

  const entryZone = obIntegration.refinedEntryZone ?? {
    high: fva.upper + fva.bandWidth * 0.05,
    low: fva.upper - fva.bandWidth * 0.15,
    mid: fva.upper - fva.bandWidth * 0.05,
  };

  const stopLoss = obIntegration.stopLoss ?? entryZone.high * 1.002;
  const { tp1, tp2, tp3 } = computeTPs(entryZone.mid, stopLoss, 'short');
  const rr = computeRR(entryZone.mid, stopLoss, tp2);

  if (rr < MIN_RR) return null;

  const sizing = computeAMTSizing({
    assetId,
    accountSize: ACCOUNT_SIZE,
    totalScore,
    entryPrice: entryZone.mid,
    stopLossPrice: stopLoss,
  });

  const position = classifyPriceVsFVA(currentPrice, fva);

  return {
    rank: 0,
    assetId,
    setupType: 'failed_auction_short',
    direction: 'short',
    candleQuality,
    orderFlowConfidence: orderFlowScore,
    smcTaAlignment: smcTa,
    macroAdjustment: macroAdj,
    correlationBonus: corrBonus,
    totalScore,
    entryZone,
    entryStrategy: orderFlow.confidence >= 60 ? 'aggressive' : 'conservative',
    fairValueArea: fva,
    priceRelativeToFVA: position,
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardRatio: rr,
    positionSize: sizing.lotSize,
    riskAmount: sizing.riskAmount,
    kellyFraction: sizing.kellyFractional,
    confirmationCandles: analyses.slice(-3),
    patterns,
    orderFlowConfirmation: orderFlow,
    setupDescription: 'Failed Auction Above Value — bullish attempt rejected, bearish reversal expected',
    confirmationEvidence: orderFlow.acceptanceSignals,
    macroContext: `DXY ${regime.dxy.trend}, VIX ${regime.vix.regime}, Yields ${regime.yields.trend}`,
    executionPlan: `Enter near ${entryZone.mid.toFixed(4)}, SL ${stopLoss.toFixed(4)}, TP1 ${tp1.toFixed(4)}, TP2 ${tp2.toFixed(4)}, TP3 ${tp3.toFixed(4)}`,
    generatedAt: new Date(),
    invalidationLevel: stopLoss,
    newsRisk: regime.calendar.eventRisk,
    regime,
  };
}

function buildBreakoutAcceptance(
  ctx: SetupContext,
  direction: 'long' | 'short',
): AMTSignal | null {
  const { assetId, candles, orderBlocks, fvgs, macro, fva, currentPrice } = ctx;

  const position = classifyPriceVsFVA(currentPrice, fva);
  const expectedPosition = direction === 'long' ? 'above' : 'below';
  if (position !== expectedPosition) return null;

  const orderFlow = confirmOrderFlow({
    candles,
    fva,
    direction,
    scenario: 'breakout_acceptance',
  });

  if (orderFlow.confidence < 25) return null;

  const obIntegration = integrateOBWithAMT(
    orderBlocks, fvgs, fva, orderFlow, direction, currentPrice,
  );

  const analyses = analyzeCandles(candles, 10);
  const patterns = detectSequentialPatterns(analyses);
  const candleQuality = computeCandleQualityScore(analyses, patterns);

  const regime = analyzeMarketRegime(macro, direction, assetId);
  const macroAdj = regimeToAMTMacroScore(regime);

  if (regime.calendar.eventRisk === 'blocked') return null;

  const smcTa = obIntegration.smcTaAlignmentScore;
  const orderFlowScore = Math.round(orderFlow.confidence * 0.25);
  const corrBonus = computeCorrelationBonus(assetId, direction);

  const totalScore = Math.min(
    100,
    candleQuality + orderFlowScore + smcTa + macroAdj + corrBonus,
  );

  if (totalScore < 30) return null;

  // For breakout: entry is current price, stop is back inside FVA edge
  const fvaEdge = direction === 'long' ? fva.upper : fva.lower;
  const entryZone = {
    high: currentPrice * 1.001,
    low: currentPrice * 0.999,
    mid: currentPrice,
  };

  const stopLoss = direction === 'long'
    ? fvaEdge - fva.bandWidth * 0.25
    : fvaEdge + fva.bandWidth * 0.25;

  const { tp1, tp2, tp3 } = computeTPs(currentPrice, stopLoss, direction);
  const rr = computeRR(currentPrice, stopLoss, tp2);

  if (rr < MIN_RR) return null;

  const sizing = computeAMTSizing({
    assetId,
    accountSize: ACCOUNT_SIZE,
    totalScore,
    entryPrice: currentPrice,
    stopLossPrice: stopLoss,
  });

  return {
    rank: 0,
    assetId,
    setupType: 'breakout_acceptance',
    direction,
    candleQuality,
    orderFlowConfidence: orderFlowScore,
    smcTaAlignment: smcTa,
    macroAdjustment: macroAdj,
    correlationBonus: corrBonus,
    totalScore,
    entryZone,
    entryStrategy: 'aggressive',
    fairValueArea: fva,
    priceRelativeToFVA: position,
    stopLoss,
    tp1,
    tp2,
    tp3,
    riskRewardRatio: rr,
    positionSize: sizing.lotSize,
    riskAmount: sizing.riskAmount,
    kellyFraction: sizing.kellyFractional,
    confirmationCandles: analyses.slice(-3),
    patterns,
    orderFlowConfirmation: orderFlow,
    setupDescription: `Breakout Acceptance — price accepted ${direction === 'long' ? 'above' : 'below'} FVA, continuation expected`,
    confirmationEvidence: orderFlow.acceptanceSignals,
    macroContext: `DXY ${regime.dxy.trend}, VIX ${regime.vix.regime}, Yields ${regime.yields.trend}`,
    executionPlan: `Enter at market ~${currentPrice.toFixed(4)}, SL ${stopLoss.toFixed(4)}, TP1 ${tp1.toFixed(4)}, TP2 ${tp2.toFixed(4)}, TP3 ${tp3.toFixed(4)}`,
    generatedAt: new Date(),
    invalidationLevel: stopLoss,
    newsRisk: regime.calendar.eventRisk,
    regime,
  };
}

// ─── Main Detector ─────────────────────────────────────────────────────────

export interface SetupDetectorInput {
  assetId: string;
  candles: Candle[];            // 4H or 1H candles (20–50 bars)
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  macro: MacroContext;
  currentPrice: number;
}

/**
 * Detect all valid AMT setups for an asset and return scored candidates.
 * Returns up to 3 setups sorted by totalScore descending.
 */
export function detectAMTSetups(input: SetupDetectorInput): AMTSignal[] {
  const { assetId, candles, orderBlocks, fvgs, macro, currentPrice } = input;

  if (candles.length < 10) {
    return [];
  }

  const fva = detectFairValueArea(candles);

  const ctx: SetupContext = {
    assetId,
    candles,
    orderBlocks,
    fvgs,
    macro,
    fva,
    currentPrice,
  };

  const candidates: AMTSignal[] = [];

  // Test all 3 setup types
  const faLong = buildFailedAuctionLong(ctx);
  if (faLong) candidates.push(faLong);

  const faShort = buildFailedAuctionShort(ctx);
  if (faShort) candidates.push(faShort);

  const boLong = buildBreakoutAcceptance(ctx, 'long');
  if (boLong) candidates.push(boLong);

  const boShort = buildBreakoutAcceptance(ctx, 'short');
  if (boShort) candidates.push(boShort);

  // Sort by total score descending, return top 2 per asset
  return candidates
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 2);
}
