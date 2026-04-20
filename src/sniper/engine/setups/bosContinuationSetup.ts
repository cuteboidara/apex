import { detectBOSContinuation } from "@/src/sniper/engine/detectors/bosDetector";
import { detectStructure } from "@/src/sniper/engine/detectors/structureDetector";
import { scoreSniperSetup } from "@/src/sniper/engine/scoring/sniperScorer";
import { buildSniperTradePlan } from "@/src/sniper/engine/tradeManagement/sniperTradeBuilder";
import { getCurrentSession, getSessionScore, isAssetInPreferredSession } from "@/src/sniper/data/fetchers/sessionDetector";
import type { SniperCandle, SniperSetup } from "@/src/sniper/types/sniperTypes";

export function detectBOSContinuationSetups(
  assetId: string,
  candles15m: SniperCandle[],
  candles1h: SniperCandle[],
  pipSize: number,
  preferredSessions: readonly string[],
): SniperSetup[] {
  const setups: SniperSetup[] = [];
  if (candles15m.length < 45) return setups;

  const bosEvents = detectBOSContinuation(candles15m);
  const structure = detectStructure(candles15m, candles1h);
  const currentSession = getCurrentSession();
  const currentPrice = candles15m.at(-1)?.close ?? 0;

  for (const event of bosEvents) {
    const sweepQuality = 18; // BOS setups do not include classical sweep scoring.
    const rejection = 14;

    const trendAligned =
      (event.direction === "long" && structure.trend === "up") ||
      (event.direction === "short" && structure.trend === "down");
    const structurePoints = trendAligned ? 25 : 12;

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
    if (totalScore < 55) continue;

    const structureLevel = event.direction === "long" ? structure.nearestResistance : structure.nearestSupport;
    const sweepPrice = event.direction === "long"
      ? Math.min(event.retestLevel, currentPrice)
      : Math.max(event.retestLevel, currentPrice);

    const trade = buildSniperTradePlan({
      direction: event.direction,
      currentPrice,
      sweepLevel: event.retestLevel,
      sweepPrice,
      structureLevel,
      pipSize,
    });
    if (!trade || trade.riskReward < 1.5) continue;

    setups.push({
      assetId,
      setupType: event.direction === "long" ? "bos_continuation_long" : "bos_continuation_short",
      direction: event.direction,
      score: totalScore,
      sweepQuality,
      rejection,
      structure: structurePoints,
      session: sessionPoints,
      entryPrice: trade.entryPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      riskReward: trade.riskReward,
      sweepLevel: event.retestLevel,
      structureLevel,
      sweepCandleTime: candles15m[event.triggerIndex]?.timestamp ?? new Date(),
      currentSession,
      description: `BOS continuation setup after retest at ${event.retestLevel.toFixed(5)}.`,
    });
  }

  return setups;
}

