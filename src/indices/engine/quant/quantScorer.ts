// src/indices/engine/quant/quantScorer.ts
// Beta, Sharpe ratio, Kelly Criterion, and final quant analysis

import type { Candle, QuantAnalysis, CorrelationPair } from '@/src/indices/types';
import type { AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';
import { getCorrelation, correlationBonus } from './correlationMatrix';

const RISK_FREE_RATE = 0.05; // 5% annual (current approx)
const ASSUMED_WIN_RATE = 0.55;
const TRADING_DAYS_YEAR = 252;

// ─── Beta ─────────────────────────────────────────────────────────────────────

function computeBeta(assetReturns: number[], marketReturns: number[]): number {
  const n = Math.min(assetReturns.length, marketReturns.length);
  if (n < 5) return 1;

  const a = assetReturns.slice(-n);
  const m = marketReturns.slice(-n);
  const meanM = m.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varM = 0;
  for (let i = 0; i < n; i++) {
    const dm = m[i]! - meanM;
    cov += (a[i]! - (a.reduce((s, v) => s + v, 0) / n)) * dm;
    varM += dm * dm;
  }

  return varM === 0 ? 1 : cov / varM;
}

// ─── Sharpe Ratio (per setup) ─────────────────────────────────────────────────

function computeSetupSharpe(entry: number, stopLoss: number, tp2: number): number {
  const expectedReturn = Math.abs(tp2 - entry) / entry;
  const risk = Math.abs(entry - stopLoss) / entry;
  if (risk === 0) return 0;

  const dailyRF = RISK_FREE_RATE / TRADING_DAYS_YEAR;
  return (expectedReturn - dailyRF) / risk;
}

function sharpeInterpretation(sharpe: number): QuantAnalysis['sharpeInterpretation'] {
  if (sharpe >= 2.0) return 'excellent';
  if (sharpe >= 1.5) return 'good';
  if (sharpe >= 1.0) return 'acceptable';
  return 'poor';
}

// ─── Kelly Criterion ──────────────────────────────────────────────────────────

function computeKelly(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0) return 0;
  const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgLoss;
  return Math.max(0, Math.min(1, kelly));
}

// ─── Expected Value ───────────────────────────────────────────────────────────

function computeEV(winRate: number, avgRR: number): number {
  return winRate * avgRR - (1 - winRate) * 1;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function runQuantAnalysis(input: {
  assetId: AssetSymbol;
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  assetCandles: Candle[];
  spxCandles: Candle[];  // market proxy
  correlationPairs: CorrelationPair[];
  signalDirections: Map<string, 'long' | 'short'>;
  accountSize: number;
  riskPct: number;
}): QuantAnalysis {
  const assetReturns = dailyReturns(input.assetCandles);
  const marketReturns = dailyReturns(input.spxCandles);

  const beta = computeBeta(assetReturns, marketReturns);
  const betaInterpretation: QuantAnalysis['betaInterpretation'] =
    beta > 1.2 ? 'high_volatility' : beta < 0.8 ? 'low_volatility' : 'market_level';

  const sharpeRatio = computeSetupSharpe(input.entry, input.stopLoss, input.tp2);
  const rr = Math.abs(input.tp2 - input.entry) / Math.abs(input.entry - input.stopLoss);
  const kellyFraction = computeKelly(ASSUMED_WIN_RATE, rr, 1);
  const kellyFractional = kellyFraction / 2; // half-Kelly for safety

  const riskAmount = input.accountSize * Math.min(kellyFractional, input.riskPct);
  const stopDistance = Math.abs(input.entry - input.stopLoss);
  const suggestedPositionSize = stopDistance > 0 ? riskAmount / stopDistance : 0;

  const expectedValue = computeEV(ASSUMED_WIN_RATE, rr);

  // Correlation bonus (0-10 pts)
  const bonus = correlationBonus(
    input.assetId,
    input.direction,
    input.correlationPairs,
    input.signalDirections,
  );

  // Which other assets are also signaling in aligned direction?
  const correlatedAssets: AssetSymbol[] = [];
  for (const [asset, dir] of input.signalDirections) {
    if (asset === input.assetId) continue;
    const corr = getCorrelation(input.correlationPairs, input.assetId, asset);
    if (dir === input.direction && corr > 0.4) {
      correlatedAssets.push(asset as AssetSymbol);
    }
  }

  return {
    assetId: input.assetId,
    timestamp: new Date(),
    correlations: input.correlationPairs.filter(
      p => p.asset1 === input.assetId || p.asset2 === input.assetId,
    ),
    correlatedAssets,
    correlationBonus: bonus,
    beta,
    betaInterpretation,
    sharpeRatio,
    sharpeInterpretation: sharpeInterpretation(sharpeRatio),
    kellyFraction,
    kellyFractional,
    suggestedPositionSize,
    suggestedRiskAmount: riskAmount,
    expectedValue,
  };
}

function dailyReturns(candles: Candle[]): number[] {
  const closes = candles.slice(-31).map(c => c.close);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i]! - closes[i - 1]!) / closes[i - 1]!);
  }
  return returns;
}
