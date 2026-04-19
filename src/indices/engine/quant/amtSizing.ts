// src/indices/engine/quant/amtSizing.ts
// Kelly criterion + confidence-adjusted position sizing for AMT signals

import type { AMTPositionSizing } from '@/src/indices/types/amtTypes';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Baseline historical win rate for AMT setups (conservative estimate). */
const BASELINE_WIN_RATE = 0.55;

/** Average win/loss ratio for AMT setups at TP2 (1:2 RR). */
const BASELINE_WIN_LOSS_RATIO = 2.0;

/** Maximum fraction of account to risk per trade. */
const MAX_RISK_PCT = 0.02; // 2%

/** Minimum fraction to risk (don't go below 0.25%). */
const MIN_RISK_PCT = 0.0025;

// ─── Kelly Criterion ───────────────────────────────────────────────────────

/**
 * Full Kelly fraction = (p × b − q) / b
 *   where p = win probability, q = 1−p, b = win/loss ratio
 *
 * Half-Kelly = Kelly / 2 (standard risk management adjustment)
 */
function computeKelly(winRate: number, winLossRatio: number): number {
  const q = 1 - winRate;
  const kelly = (winRate * winLossRatio - q) / winLossRatio;
  return Math.max(0, kelly); // Kelly can't go negative in a positive-EV system
}

// ─── Confidence Multiplier ─────────────────────────────────────────────────

/**
 * Scale position size based on signal confidence (total AMT score).
 *
 * Score thresholds:
 * - ≥ 80: full Kelly fraction (1.0×)
 * - 65–79: 0.75×
 * - 50–64: 0.50×
 * - < 50:  0 (don't size — below threshold)
 */
function confidenceMultiplier(totalScore: number): number {
  if (totalScore >= 80) return 1.0;
  if (totalScore >= 65) return 0.75;
  if (totalScore >= 50) return 0.50;
  return 0;
}

// ─── Lot Size ──────────────────────────────────────────────────────────────

/**
 * Compute lot size from risk amount and stop distance.
 *
 * For forex: 1 standard lot = 100,000 units → pip value ≈ $10/pip
 * For indices: lot value depends on point value of instrument
 *
 * @param riskAmount      Dollar amount at risk
 * @param stopDistancePts Stop distance in points/pips
 * @param pointValue      Dollar value per point per lot (e.g. $1 for most forex, $20 for NAS100)
 */
function computeLotSize(
  riskAmount: number,
  stopDistancePts: number,
  pointValue: number,
): number {
  if (stopDistancePts <= 0 || pointValue <= 0) return 0;
  const rawLots = riskAmount / (stopDistancePts * pointValue);
  // Round to 2 decimal places (standard broker precision)
  return Math.round(rawLots * 100) / 100;
}

// ─── Expected Value ────────────────────────────────────────────────────────

/**
 * EV = (winRate × avgWin) − (lossRate × avgLoss)
 * Normalized to risk amount ($).
 */
function computeExpectedValue(
  riskAmount: number,
  winRate: number,
  winLossRatio: number,
): number {
  const avgWin = riskAmount * winLossRatio;
  const avgLoss = riskAmount;
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

// ─── Point Value Lookup ────────────────────────────────────────────────────

/** Approximate point values per lot for common instruments. */
const POINT_VALUES: Record<string, number> = {
  NAS100: 20,    // $20 per point per lot (mini futures equivalent)
  SPX500: 50,    // $50 per point
  DAX: 25,       // €25 ≈ $25 per point
  EURUSD: 10,    // $10 per pip (standard lot)
  GBPUSD: 10,
  USDJPY: 9.09,  // ~$9.09 per pip at 110 USDJPY
  AUDUSD: 10,
  XAUUSD: 100,   // $100 per $1 move (1 oz gold)
  BTCUSD: 1,     // $1 per $1 move
};

function getPointValue(assetId: string): number {
  return POINT_VALUES[assetId] ?? 10; // default $10/point
}

// ─── Main Sizing Function ──────────────────────────────────────────────────

export interface AMTSizingInput {
  assetId: string;
  accountSize: number;
  totalScore: number;          // 0–100 AMT signal score
  entryPrice: number;
  stopLossPrice: number;
  historicalWinRate?: number;  // optional override; defaults to BASELINE_WIN_RATE
}

/**
 * Compute full AMT position sizing using Kelly criterion + confidence adjustment.
 */
export function computeAMTSizing(input: AMTSizingInput): AMTPositionSizing {
  const {
    assetId,
    accountSize,
    totalScore,
    entryPrice,
    stopLossPrice,
    historicalWinRate,
  } = input;

  const winRate = historicalWinRate ?? BASELINE_WIN_RATE;
  const pointValue = getPointValue(assetId);

  // Stop distance
  const stopDistancePts = Math.abs(entryPrice - stopLossPrice);

  // Kelly calculations
  const kellyFraction = computeKelly(winRate, BASELINE_WIN_LOSS_RATIO);
  const kellyFractional = kellyFraction / 2; // half-Kelly

  // Confidence multiplier
  const confMult = confidenceMultiplier(totalScore);

  // Adjusted Kelly (apply confidence multiplier to half-Kelly)
  const adjustedKelly = kellyFractional * confMult;

  // Risk amount: bounded by MAX/MIN risk %
  const kellyRiskPct = Math.min(adjustedKelly, MAX_RISK_PCT);
  const riskPct = Math.max(MIN_RISK_PCT, kellyRiskPct);
  const riskAmount = accountSize * riskPct;

  // Lot size
  const lotSize = computeLotSize(riskAmount, stopDistancePts, pointValue);

  // Expected value
  const expectedValue = computeExpectedValue(riskAmount, winRate, BASELINE_WIN_LOSS_RATIO);

  return {
    accountSize,
    riskPct,
    riskAmount,
    kellyFraction,
    kellyFractional,
    confidenceMultiplier: confMult,
    adjustedKelly,
    stopDistancePts,
    lotSize,
    expectedValue,
  };
}

/**
 * Quick-check: is this signal worth trading from a sizing perspective?
 * Returns false if EV < 0 or lot size rounds to 0.
 */
export function isSizingViable(sizing: AMTPositionSizing): boolean {
  return sizing.expectedValue > 0 && sizing.lotSize > 0;
}
