import type { TradePlanStyle } from "@/lib/assets";

type LevelInput = {
  bias: "LONG" | "SHORT";
  currentPrice: number;
  high14d: number;
  low14d: number;
  volatilityRatio: number;
  style: TradePlanStyle;
  entryType: "LIMIT" | "STOP";
  localInvalidationLow?: number | null;
  localInvalidationHigh?: number | null;
  allowTp2?: boolean;
  allowTp3?: boolean;
};

type TradeLevels = {
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  invalidationLevel: number;
  riskUnit: number;
};

const STYLE_STOP_FACTORS: Record<TradePlanStyle, { min: number; max: number; zone: number }> = {
  SCALP: { min: 0.18, max: 0.55, zone: 0.18 },
  INTRADAY: { min: 0.22, max: 0.8, zone: 0.26 },
  SWING: { min: 0.3, max: 1.15, zone: 0.34 },
};

export function calculateTradeLevels(input: LevelInput): TradeLevels | null {
  const range = input.high14d - input.low14d;
  if (!Number.isFinite(range) || range <= 0) {
    return null;
  }

  const factors = STYLE_STOP_FACTORS[input.style];
  const atrLikeDistance = Math.max(input.currentPrice * input.volatilityRatio * 0.35, input.currentPrice * 0.0012);
  const minStopDistance = Math.max(atrLikeDistance * factors.min, input.currentPrice * 0.0008);
  const maxStopDistance = Math.max(atrLikeDistance * factors.max, input.currentPrice * 0.012);
  const zoneDistance = Math.max(atrLikeDistance * factors.zone, input.currentPrice * 0.0006);
  const targetCapacity = range * 0.85;
  const stopBufferFloor = Math.max(zoneDistance * 0.18, minStopDistance * 0.35);

  if (input.bias === "LONG") {
    const entryMin = input.entryType === "LIMIT" ? input.currentPrice - zoneDistance : input.currentPrice + zoneDistance * 0.2;
    const entryMax = input.entryType === "LIMIT" ? input.currentPrice - zoneDistance * 0.15 : input.currentPrice + zoneDistance * 0.65;
    const averageEntry = (entryMin + entryMax) / 2;
    const invalidationLevel = Math.max(
      Math.min(input.localInvalidationLow ?? entryMin, entryMin),
      averageEntry - maxStopDistance * 0.7
    );
    const stopLoss = invalidationLevel - stopBufferFloor;
    const rawRisk = averageEntry - stopLoss;

    if (!Number.isFinite(rawRisk) || rawRisk <= 0 || rawRisk < minStopDistance || rawRisk > maxStopDistance) {
      return null;
    }

    const tp1 = averageEntry + rawRisk * 2;
    const tp2 = input.allowTp2 && rawRisk * 3.5 <= targetCapacity ? averageEntry + rawRisk * 3.5 : null;
    const tp3 = input.allowTp3 && rawRisk * 5 <= targetCapacity && tp2 != null ? averageEntry + rawRisk * 5 : null;

    return {
      entryMin,
      entryMax,
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      invalidationLevel,
      riskUnit: rawRisk,
    };
  }

  const entryMin = input.entryType === "LIMIT" ? input.currentPrice + zoneDistance * 0.15 : input.currentPrice - zoneDistance * 0.65;
  const entryMax = input.entryType === "LIMIT" ? input.currentPrice + zoneDistance : input.currentPrice - zoneDistance * 0.2;
  const averageEntry = (entryMin + entryMax) / 2;
  const invalidationLevel = Math.min(
    Math.max(input.localInvalidationHigh ?? entryMax, entryMax),
    averageEntry + maxStopDistance * 0.7
  );
  const stopLoss = invalidationLevel + stopBufferFloor;
  const rawRisk = stopLoss - averageEntry;

  if (!Number.isFinite(rawRisk) || rawRisk <= 0 || rawRisk < minStopDistance || rawRisk > maxStopDistance) {
    return null;
  }

  const tp1 = averageEntry - rawRisk * 2;
  const tp2 = input.allowTp2 && rawRisk * 3.5 <= targetCapacity ? averageEntry - rawRisk * 3.5 : null;
  const tp3 = input.allowTp3 && rawRisk * 5 <= targetCapacity && tp2 != null ? averageEntry - rawRisk * 5 : null;

  return {
    entryMin,
    entryMax,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2,
    takeProfit3: tp3,
    invalidationLevel,
    riskUnit: rawRisk,
  };
}
