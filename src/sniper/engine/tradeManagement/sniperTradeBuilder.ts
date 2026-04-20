import type { SniperDirection } from "@/src/sniper/types/sniperTypes";

export interface SniperTradePlan {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
}

export function buildSniperTradePlan(input: {
  direction: SniperDirection;
  currentPrice: number;
  sweepLevel: number;
  sweepPrice: number;
  structureLevel: number;
  pipSize: number;
}): SniperTradePlan | null {
  const { direction, currentPrice, sweepLevel, sweepPrice, structureLevel, pipSize } = input;
  const buffer = pipSize * 3;

  const entryPrice = direction === "long"
    ? Math.max(currentPrice, sweepLevel)
    : Math.min(currentPrice, sweepLevel);

  const stopLoss = direction === "long"
    ? sweepPrice - buffer
    : sweepPrice + buffer;

  const takeProfit = structureLevel;

  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  if (risk <= 0 || reward <= 0) return null;

  const riskReward = reward / risk;
  return {
    entryPrice,
    stopLoss,
    takeProfit,
    riskReward,
  };
}

