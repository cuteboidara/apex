// src/indices/engine/tradeManagement/tradeBuilder.ts
// Build complete trade management plan from SMC setup + TA levels

import type { SMCSetup, TradeManagementPlan } from '@/src/indices/types';
import { ASSET_CONFIG } from '@/src/indices/data/fetchers/assetConfig';
import type { AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';

export function buildTradeManagementPlan(
  assetId: AssetSymbol,
  setup: SMCSetup,
  direction: 'long' | 'short',
  riskAmount: number,  // $ at risk
): TradeManagementPlan {
  const config = ASSET_CONFIG[assetId];
  const entry = setup.entryZoneMid;
  const stopLoss = setup.stopLossLevel;
  const stopDistance = Math.abs(entry - stopLoss);

  // 3-tier take profits
  const tp1 = direction === 'long'
    ? entry + stopDistance * 1.0   // 1:1 RR
    : entry - stopDistance * 1.0;

  const tp2 = direction === 'long'
    ? entry + stopDistance * 2.0   // 1:2 RR
    : entry - stopDistance * 2.0;

  const tp3 = direction === 'long'
    ? entry + stopDistance * 3.0   // 1:3 RR
    : entry - stopDistance * 3.0;

  const rr1 = stopDistance > 0 ? Math.abs(tp1 - entry) / stopDistance : 0;
  const rr2 = stopDistance > 0 ? Math.abs(tp2 - entry) / stopDistance : 0;
  const rr3 = stopDistance > 0 ? Math.abs(tp3 - entry) / stopDistance : 0;

  // Position size: risk / stop distance (in points)
  const pointValue = config.pointValue;
  const positionSize = stopDistance > 0 && pointValue > 0
    ? riskAmount / (stopDistance * pointValue)
    : 0;

  // Scale-in levels: re-entry at 0.5% deeper into the block if first entry missed
  const scaleInLevels: number[] = [];
  if (direction === 'long') {
    scaleInLevels.push(setup.entryZoneLow);           // bottom of OB
    scaleInLevels.push(setup.entryZoneLow * 0.9995);  // 0.05% below OB
  } else {
    scaleInLevels.push(setup.entryZoneHigh);
    scaleInLevels.push(setup.entryZoneHigh * 1.0005);
  }

  const scaleOutRules = [
    `At TP1 (${tp1.toFixed(4)}): Close 33% of position, move SL to breakeven`,
    `At TP2 (${tp2.toFixed(4)}): Close 33% of position, move SL to entry`,
    `At TP3 (${tp3.toFixed(4)}): Trail remaining 34% with 2× ATR or close on trend break`,
  ];

  const executionNotes: string[] = [
    `If price misses entry zone by > 2% (${(entry * 0.02).toFixed(4)}), skip this trade`,
    setup.fvg ? `FVG zone ${setup.fvg.gapLow.toFixed(4)}–${setup.fvg.gapHigh.toFixed(4)} may act as additional confluence` : '',
    `Order block range: ${setup.entryZoneLow.toFixed(4)}–${setup.entryZoneHigh.toFixed(4)}`,
    config.assetClass === 'index' ? `VIX > 30: consider doubling SL to ${(stopDistance * 2).toFixed(2)} points` : '',
  ].filter(Boolean);

  return {
    entryZone: {
      high: setup.entryZoneHigh,
      low: setup.entryZoneLow,
      mid: entry,
    },
    stopLoss,
    stopLossBuffer: setup.stopLossBuffer,
    takeProfits: {
      tp1: { level: tp1, closePercentage: 0.33 },
      tp2: { level: tp2, closePercentage: 0.33 },
      tp3: { level: tp3, closePercentage: 0.34 },
    },
    riskRewardRatio: rr2, // report TP2 as the headline RR
    maxReward: Math.abs(tp3 - entry),
    totalRisk: riskAmount,
    scaleInLevels,
    scaleOutRules,
    trailingStopRule: `Trail TP3 with 2× ATR on ${config.assetClass === 'index' ? '4H' : '1H'} timeframe`,
    executionNotes,
  };
}
