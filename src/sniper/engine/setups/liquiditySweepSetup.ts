import { detectLiquidityLevels } from "@/src/sniper/engine/detectors/liquidityDetector";
import { detectSweeps } from "@/src/sniper/engine/detectors/sweepDetector";
import { detectStructure } from "@/src/sniper/engine/detectors/structureDetector";
import { scoreSniperSetup } from "@/src/sniper/engine/scoring/sniperScorer";
import { buildSniperTradePlan } from "@/src/sniper/engine/tradeManagement/sniperTradeBuilder";
import { getCurrentSession, getSessionScore, isAssetInPreferredSession } from "@/src/sniper/data/fetchers/sessionDetector";
import type { SniperCandle, SniperSetup } from "@/src/sniper/types/sniperTypes";

function structureScoreFromTrend(trend: "up" | "down" | "neutral", sweepType: "bullish" | "bearish"): number {
  if (trend === "neutral") return 12;
  if (sweepType === "bullish" && trend === "up") return 25;
  if (sweepType === "bearish" && trend === "down") return 25;
  return 10;
}

function buildDescription(direction: "long" | "short", sweepLevel: number, target: number, pipSize: number): string {
  const pips = Math.round(Math.abs(target - sweepLevel) / pipSize);
  if (direction === "long") {
    return `Bullish liquidity sweep confirmed near ${sweepLevel.toFixed(5)}. Targeting ${pips} pips toward resistance ${target.toFixed(5)}.`;
  }
  return `Bearish liquidity sweep confirmed near ${sweepLevel.toFixed(5)}. Targeting ${pips} pips toward support ${target.toFixed(5)}.`;
}

export function detectLiquiditySweepSetups(
  assetId: string,
  candles15m: SniperCandle[],
  candles1h: SniperCandle[],
  pipSize: number,
  preferredSessions: readonly string[],
): SniperSetup[] {
  const setups: SniperSetup[] = [];
  if (candles15m.length < 50) return setups;

  const levels = detectLiquidityLevels(candles15m, 5);
  const sweeps = detectSweeps(candles15m, levels);
  const structure = detectStructure(candles15m, candles1h);
  const currentSession = getCurrentSession();

  for (const sweep of sweeps) {
    const sweepCandle = candles15m[sweep.sweepCandleIndex];
    const currentPrice = candles15m.at(-1)?.close ?? 0;

    const distanceFromSweep = Math.abs(currentPrice - sweep.level.price);
    if (distanceFromSweep > pipSize * 30) continue;

    const sweepQuality = Math.min(30, sweep.level.strength * 6);
    const rejection = Math.min(25, Math.round(sweep.rejectionStrength * 0.25));
    const structurePoints = structureScoreFromTrend(structure.trend, sweep.sweepType);

    const sessionBase = getSessionScore(currentSession);
    const sessionPoints = isAssetInPreferredSession(preferredSessions, currentSession)
      ? sessionBase
      : Math.max(0, sessionBase - 10);

    const totalScore = scoreSniperSetup({
      sweepQuality,
      rejection,
      structure: structurePoints,
      session: sessionPoints,
    });

    if (totalScore < 50) continue;

    const direction = sweep.sweepType === "bullish" ? "long" : "short";
    const structureLevel = direction === "long" ? structure.nearestResistance : structure.nearestSupport;

    const trade = buildSniperTradePlan({
      direction,
      currentPrice,
      sweepLevel: sweep.level.price,
      sweepPrice: sweep.sweepPrice,
      structureLevel,
      pipSize,
    });

    if (!trade || trade.riskReward < 1.5) continue;

    setups.push({
      assetId,
      setupType: direction === "long" ? "liquidity_sweep_long" : "liquidity_sweep_short",
      direction,
      score: totalScore,
      sweepQuality,
      rejection,
      structure: structurePoints,
      session: sessionPoints,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      riskReward: trade.riskReward,
      sweepLevel: sweep.level.price,
      structureLevel,
      sweepCandleTime: sweepCandle.timestamp,
      currentSession,
      description: buildDescription(direction, sweep.level.price, structureLevel, pipSize),
    });
  }

  return setups;
}

