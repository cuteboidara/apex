import type { CandleBar, Timeframe } from "@/lib/marketData/types";

export type SimulatedTradePlan = {
  symbol: string;
  assetClass: string;
  style: string;
  setupFamily: string | null;
  regimeTag: string | null;
  provider: string | null;
  confidence: number;
  bias: "LONG" | "SHORT";
  timeframe: Timeframe | string;
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  invalidationLevel?: number | null;
};

export type ExecutionSimulatorConfig = {
  spreadBps?: number;
  slippageBps?: number;
  allowPartialTp?: boolean;
};

export type SimulatedTradeResult = {
  symbol: string;
  assetClass: string;
  style: string;
  setupFamily: string | null;
  regimeTag: string | null;
  provider: string | null;
  confidence: number;
  bias: "LONG" | "SHORT";
  outcome: "TP1" | "TP2" | "TP3" | "STOP" | "EXPIRED";
  entryTimestamp: number | null;
  exitTimestamp: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  realizedRR: number | null;
  realizedPnl: number | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  candlesHeld: number;
};

function midpoint(low: number, high: number) {
  return (low + high) / 2;
}

function applyFriction(price: number, bias: "LONG" | "SHORT", side: "ENTRY" | "EXIT", config: ExecutionSimulatorConfig) {
  const spreadFactor = (config.spreadBps ?? 0) / 10_000;
  const slippageFactor = (config.slippageBps ?? 0) / 10_000;
  const total = price * (spreadFactor + slippageFactor);

  if (side === "ENTRY") {
    return bias === "LONG" ? price + total : price - total;
  }
  return bias === "LONG" ? price - total : price + total;
}

function overlapsEntry(plan: SimulatedTradePlan, candle: CandleBar) {
  return candle.low != null && candle.high != null && candle.low <= plan.entryMax && candle.high >= plan.entryMin;
}

function stopHit(plan: SimulatedTradePlan, candle: CandleBar) {
  if (candle.low == null || candle.high == null) return false;
  return plan.bias === "LONG" ? candle.low <= plan.stopLoss : candle.high >= plan.stopLoss;
}

function targetHit(level: number | null | undefined, plan: SimulatedTradePlan, candle: CandleBar) {
  if (level == null || candle.low == null || candle.high == null) return false;
  return plan.bias === "LONG" ? candle.high >= level : candle.low <= level;
}

function riskUnit(plan: SimulatedTradePlan, entryPrice: number) {
  const distance = Math.abs(entryPrice - plan.stopLoss);
  return distance > 0 ? distance : null;
}

export function simulateTradeExecution(
  plan: SimulatedTradePlan,
  candles: CandleBar[],
  config: ExecutionSimulatorConfig = {}
): SimulatedTradeResult {
  let entryTimestamp: number | null = null;
  let exitTimestamp: number | null = null;
  let entryPrice: number | null = null;
  let exitPrice: number | null = null;
  let maxFavorableExcursion: number | null = null;
  let maxAdverseExcursion: number | null = null;
  let deepestTarget = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candle.low == null || candle.high == null || candle.close == null) continue;

    if (entryPrice == null) {
      if (!overlapsEntry(plan, candle)) continue;
      entryTimestamp = candle.timestamp;
      entryPrice = applyFriction(midpoint(plan.entryMin, plan.entryMax), plan.bias, "ENTRY", config);

      if (stopHit(plan, candle)) {
        exitTimestamp = candle.timestamp;
        exitPrice = applyFriction(plan.stopLoss, plan.bias, "EXIT", config);
        break;
      }
      continue;
    }

    const risk = riskUnit(plan, entryPrice);
    if (risk != null) {
      const favorableMove = plan.bias === "LONG"
        ? (candle.high - entryPrice) / risk
        : (entryPrice - candle.low) / risk;
      const adverseMove = plan.bias === "LONG"
        ? (entryPrice - candle.low) / risk
        : (candle.high - entryPrice) / risk;
      maxFavorableExcursion = Math.max(maxFavorableExcursion ?? 0, favorableMove, 0);
      maxAdverseExcursion = Math.max(maxAdverseExcursion ?? 0, adverseMove, 0);
    }

    if (targetHit(plan.takeProfit1, plan, candle)) deepestTarget = Math.max(deepestTarget, 1);
    if (targetHit(plan.takeProfit2, plan, candle)) deepestTarget = Math.max(deepestTarget, 2);
    if (targetHit(plan.takeProfit3, plan, candle)) {
      deepestTarget = 3;
      exitTimestamp = candle.timestamp;
      exitPrice = applyFriction(plan.takeProfit3 ?? plan.takeProfit1, plan.bias, "EXIT", config);
      break;
    }

    if (stopHit(plan, candle)) {
      exitTimestamp = candle.timestamp;
      exitPrice = applyFriction(
        deepestTarget >= 2 ? plan.takeProfit2 ?? plan.stopLoss :
        deepestTarget === 1 ? plan.takeProfit1 :
        plan.stopLoss,
        plan.bias,
        "EXIT",
        config
      );
      break;
    }
  }

  if (entryPrice != null && exitPrice == null) {
    const finalCandle = candles.at(-1);
    if (finalCandle?.close != null) {
      exitTimestamp = finalCandle.timestamp;
      exitPrice = applyFriction(finalCandle.close, plan.bias, "EXIT", config);
    }
  }

  const risk = entryPrice != null ? riskUnit(plan, entryPrice) : null;
  const realizedRR = entryPrice != null && exitPrice != null && risk != null
    ? ((plan.bias === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice) / risk)
    : null;
  const realizedPnl = entryPrice != null && exitPrice != null
    ? (plan.bias === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice)
    : null;

  let outcome: SimulatedTradeResult["outcome"] = "EXPIRED";
  if (entryPrice != null && exitPrice != null) {
    if (deepestTarget === 3) outcome = "TP3";
    else if (deepestTarget === 2) outcome = "TP2";
    else if (deepestTarget === 1) outcome = "TP1";
    else if ((realizedRR ?? 0) < 0) outcome = "STOP";
  }

  return {
    symbol: plan.symbol,
    assetClass: plan.assetClass,
    style: plan.style,
    setupFamily: plan.setupFamily,
    regimeTag: plan.regimeTag,
    provider: plan.provider,
    confidence: plan.confidence,
    bias: plan.bias,
    outcome,
    entryTimestamp,
    exitTimestamp,
    entryPrice,
    exitPrice,
    realizedRR,
    realizedPnl,
    maxFavorableExcursion,
    maxAdverseExcursion,
    candlesHeld: entryTimestamp == null || exitTimestamp == null
      ? 0
      : candles.filter(candle => candle.timestamp >= entryTimestamp && candle.timestamp <= exitTimestamp).length,
  };
}
