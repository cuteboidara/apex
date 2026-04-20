import { calculateATR } from "@/src/scalp/engine/gates/indicators";
import type { ScalpCandle, TradePlan } from "@/src/scalp/types/scalpTypes";

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildScalpTrade(input: {
  direction: "long" | "short";
  entryPrice: number;
  candles15m: ScalpCandle[];
  keyLevelPrice: number;
  pipSize: number;
  riskUsd: number;
}): TradePlan | null {
  const { direction, entryPrice, candles15m, keyLevelPrice, pipSize, riskUsd } = input;
  const last = candles15m[candles15m.length - 1];
  if (!last) return null;

  const atr14 = calculateATR(candles15m.slice(-30), 14);
  const atrBuffer = atr14 > 0 ? Math.min(atr14 * 0.15, pipSize * 4) : pipSize * 2;

  let stopLoss: number;
  let tp1: number;
  let tp2: number;

  if (direction === "long") {
    const slFromCandle = last.low - atrBuffer;
    const slFromLevel = keyLevelPrice - (pipSize * 3);
    stopLoss = Math.min(slFromCandle, slFromLevel);

    let slDistance = entryPrice - stopLoss;
    if (slDistance < pipSize * 8) {
      stopLoss = entryPrice - pipSize * 8;
      slDistance = entryPrice - stopLoss;
    }
    if (slDistance > pipSize * 25) return null;

    const risk = slDistance;
    tp1 = entryPrice + risk;
    tp2 = entryPrice + (risk * 2);
  } else {
    const slFromCandle = last.high + atrBuffer;
    const slFromLevel = keyLevelPrice + (pipSize * 3);
    stopLoss = Math.max(slFromCandle, slFromLevel);

    let slDistance = stopLoss - entryPrice;
    if (slDistance < pipSize * 8) {
      stopLoss = entryPrice + pipSize * 8;
      slDistance = stopLoss - entryPrice;
    }
    if (slDistance > pipSize * 25) return null;

    const risk = slDistance;
    tp1 = entryPrice - risk;
    tp2 = entryPrice - (risk * 2);
  }

  const riskDistance = Math.abs(entryPrice - stopLoss);
  if (!Number.isFinite(riskDistance) || riskDistance <= 0) return null;

  // Simplified default pip value.
  const pipValue = 10;
  const positionSize = riskUsd / (riskDistance * pipValue);

  return {
    entry: round(entryPrice),
    sl: round(stopLoss),
    tp1: round(tp1),
    tp2: round(tp2),
    positionSize: Math.max(0, Math.round(positionSize * 100) / 100),
    riskUsd,
  };
}
