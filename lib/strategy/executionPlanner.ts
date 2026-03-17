import type { TradePlanStyle } from "@/lib/assets";
import { calculateTradeLevels } from "@/lib/levelCalculator";
import { scoreRiskReward } from "@/lib/strategy/riskModel";
import type {
  ExecutionPlan,
  LiquidityAssessment,
  MarketSnapshot,
  SetupClassification,
  StructureAssessment,
  TimeframeProfile,
} from "@/lib/strategy/types";

export function planExecution(input: {
  style: TradePlanStyle;
  timeframe: TimeframeProfile;
  snapshot: MarketSnapshot;
  liquidity: LiquidityAssessment;
  structure: StructureAssessment;
  setup: SetupClassification;
}): ExecutionPlan | null {
  const { style, timeframe, snapshot, liquidity, structure, setup } = input;
  if (
    !setup.valid ||
    setup.bias == null ||
    setup.entryType === "NONE" ||
    snapshot.currentPrice == null ||
    snapshot.high14d == null ||
    snapshot.low14d == null
  ) {
    return null;
  }

  const range = snapshot.high14d - snapshot.low14d;
  const volatilityRatio = Math.max(range / snapshot.currentPrice, 0.0045);
  const levels = calculateTradeLevels({
    bias: setup.bias,
    currentPrice: snapshot.currentPrice,
    high14d: snapshot.high14d,
    low14d: snapshot.low14d,
    volatilityRatio,
    style,
    entryType: setup.entryType,
  });

  if (!levels) {
    return null;
  }

  const averageEntry = (levels.entryMin + levels.entryMax) / 2;
  const rr = scoreRiskReward(averageEntry, levels.stopLoss, levels.takeProfit1);
  const entryPrecisionScore =
    liquidity.quality === "high" && structure.reclaim ? 10 :
    liquidity.quality === "high" || structure.breakOfStructure ? 8 :
    5;

  return {
    timeframe: `${timeframe.execution} / ${timeframe.confirmation}`,
    entryType: setup.entryType,
    entryMin: levels.entryMin,
    entryMax: levels.entryMax,
    stopLoss: levels.stopLoss,
    takeProfit1: levels.takeProfit1,
    takeProfit2: levels.takeProfit2,
    takeProfit3: levels.takeProfit3,
    invalidationLevel: levels.invalidationLevel,
    riskUnit: levels.riskUnit,
    riskRewardRatio: rr.ratio,
    executionNotes: `Execute on ${timeframe.execution} with ${timeframe.confirmation} confirmation. Holding period: ${timeframe.holdingPeriod}.`,
    entryPrecisionScore,
    riskRewardScore: rr.score,
  };
}
