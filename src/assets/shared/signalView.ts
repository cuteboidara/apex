import type { SignalViewModel, SignalViewModelSMC } from "@/src/domain/models/signalPipeline";
import type {
  ModuleHealthState,
  ProviderStatus,
  PublicationStatus,
  SignalAssetClass,
  SignalQualityScores,
  SignalRejectionReasonCode,
} from "@/src/domain/models/signalHealth";
import { buildDataTrust, buildHealthFlags, buildPublicationState, buildQualityScores } from "@/src/domain/services/signalTrust";
import { prepareSignalViewModelForPersistence } from "@/src/assets/shared/persistedSignalViewModel";
import type { SignalReasoningOutput } from "@/src/lib/apex-llm/types";
import { createId } from "@/src/lib/ids";
import type { Candle, SMCAnalysis } from "@/src/smc/types";

export type TradeLevels = Pick<SignalViewModel, "entry" | "sl" | "tp1" | "tp2" | "tp3">;

export function titleCase(value: string): string {
  return value
    .split(" ")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "high conviction";
  if (confidence >= 0.65) return "actionable";
  if (confidence >= 0.5) return "developing";
  return "early";
}

export function gradeFromCompositeScore(
  score: number,
  confidence: number,
  multiplier = 1,
): { grade: string; gradeScore: number } {
  const gradeScore = Math.max(0, Math.min(100, Math.round(((score * 0.6) + (confidence * 100 * 0.4)) * multiplier)));
  if (gradeScore >= 92) return { grade: "S+", gradeScore };
  if (gradeScore >= 84) return { grade: "S", gradeScore };
  if (gradeScore >= 75) return { grade: "A", gradeScore };
  if (gradeScore >= 66) return { grade: "B", gradeScore };
  if (gradeScore >= 56) return { grade: "C", gradeScore };
  if (gradeScore >= 46) return { grade: "D", gradeScore };
  return { grade: "F", gradeScore };
}

export function buildSmcSummary(
  analysis: SMCAnalysis,
  killzoneLabel: string,
): SignalViewModelSMC {
  return {
    nearestOrderBlock: analysis.orderBlocks[0]
      ? {
        type: analysis.orderBlocks[0].type,
        high: analysis.orderBlocks[0].high,
        low: analysis.orderBlocks[0].low,
        strength: analysis.orderBlocks[0].strength,
      }
      : null,
    nearestFVG: analysis.fairValueGaps[0]
      ? {
        type: analysis.fairValueGaps[0].type,
        upper: analysis.fairValueGaps[0].upper,
        lower: analysis.fairValueGaps[0].lower,
        fillPercent: analysis.fairValueGaps[0].fillPercent,
      }
      : null,
    nearestBreaker: analysis.breakerBlocks[0]
      ? {
        type: analysis.breakerBlocks[0].type,
        high: analysis.breakerBlocks[0].high,
        low: analysis.breakerBlocks[0].low,
      }
      : null,
    recentLiquiditySweep: analysis.recentSweeps[0]
      ? {
        side: analysis.recentSweeps[0].side,
        reversal: analysis.recentSweeps[0].reversal,
        reversalStrength: analysis.recentSweeps[0].reversalStrength,
      }
      : null,
    killzone: killzoneLabel,
    minutesToNextKillzone: analysis.killzone.minutesUntilNextKillzone,
    nextKillzone: analysis.killzone.nextKillzone,
    asianRangeHigh: analysis.killzone.asianRangeHigh,
    asianRangeLow: analysis.killzone.asianRangeLow,
    inOTE: analysis.ote?.currentPriceInOTE ?? false,
    oteLevels: analysis.ote
      ? {
        fib62: analysis.ote.fib_62,
        fib705: analysis.ote.fib_705,
        fib79: analysis.ote.fib_79,
      }
      : null,
    pdLocation: analysis.pdArrays.currentLocation,
    pdPercent: analysis.pdArrays.currentPricePercent,
    cotBias: analysis.cot?.smartMoneyBias ?? "unavailable",
    cotStrength: analysis.cot?.smartMoneyBiasStrength ?? "unavailable",
    cotDivergence: analysis.cot?.divergence ?? false,
    smcScore: analysis.smcScore.total,
    smcVerdict: analysis.smcScore.verdict,
  };
}

export function buildKeyLevelsFromCandles(
  candles: Candle[],
  analysis: SMCAnalysis,
): SignalViewModel["keyLevels"] {
  const recent = candles.slice(-96);
  const highs = recent.map(candle => candle.high);
  const lows = recent.map(candle => candle.low);

  return {
    pdh: highs.length > 0 ? Math.max(...highs) : null,
    pdl: lows.length > 0 ? Math.min(...lows) : null,
    sessionHigh: analysis.killzone.sessionHigh,
    sessionLow: analysis.killzone.sessionLow,
  };
}

export function buildFallbackReasoning(input: {
  displayName: string;
  direction: SignalViewModel["direction"];
  grade: string;
  score: number;
  contextLine: string;
  whyThisSetup: string;
  whyNow: string;
  whyThisLevel: string;
  invalidation: string;
  noTradeExplanation: string | null;
}): SignalReasoningOutput {
  const directionalLabel = input.direction === "neutral"
    ? "is still building structure"
    : `${input.direction.toUpperCase()} structure is in play`;

  return {
    shortReasoning: `${input.displayName} ${directionalLabel}. SMC score ${input.score}/100.`,
    detailedReasoning: `${input.displayName} ${directionalLabel}. ${input.contextLine}`.trim(),
    whyThisSetup: input.whyThisSetup,
    whyNow: input.whyNow,
    whyThisLevel: input.whyThisLevel,
    invalidation: input.invalidation,
    whyThisGrade: `The grade combines the SMC score, confidence, and asset-specific context for a ${input.grade} read.`,
    marketStructureSummary: `${input.displayName} is trading with ${directionalLabel.toLowerCase()}.`,
    liquiditySummary: input.contextLine,
    keyLevelsSummary: input.whyThisLevel,
    noTradeExplanation: input.noTradeExplanation,
  };
}

export function buildTopDownReasoning(input: {
  displayName: string;
  result: {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    grade: string;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    takeProfit2?: number | null;
    riskReward: number;
    riskReward2?: number | null;
    htfBiasSummary?: string;
    liquiditySweepDescription?: string;
    tp1Label?: string | null;
    tp2Label?: string | null;
    timeframe: string;
    reasoning: string;
    managementPlan?: {
      partialTakeProfit: string;
      stopAdjustment: string;
      runnerPlan: string;
    };
  };
  noTradeReason: string | null;
}): SignalReasoningOutput {
  const directionLabel = input.result.direction === "LONG"
    ? "LONG"
    : input.result.direction === "SHORT"
      ? "SHORT"
      : "NEUTRAL";
  const tp1Rr = Number.isFinite(input.result.riskReward) ? `${input.result.riskReward.toFixed(2)}R` : "n/a";
  const tp2Rr = typeof input.result.riskReward2 === "number" && Number.isFinite(input.result.riskReward2)
    ? `${input.result.riskReward2.toFixed(2)}R`
    : "n/a";

  return {
    shortReasoning: input.result.reasoning,
    detailedReasoning: `${input.result.reasoning} ${input.result.htfBiasSummary ?? ""}`.trim(),
    whyThisSetup: input.result.htfBiasSummary ?? `${input.displayName} is waiting for aligned higher-timeframe structure.`,
    whyNow: input.result.liquiditySweepDescription ?? "No qualifying sweep has confirmed yet.",
    whyThisLevel: `${directionLabel} entry ${input.result.entry} with SL ${input.result.stopLoss}, TP1 ${input.result.takeProfit} (${tp1Rr}), TP2 ${input.result.takeProfit2 ?? "n/a"} (${tp2Rr}).`,
    invalidation: input.result.managementPlan?.stopAdjustment ?? `Invalidate if price trades through ${input.result.stopLoss}.`,
    whyThisGrade: `${input.result.grade} grade from higher-timeframe bias alignment, a confirmed liquidity sweep, lower-timeframe confirmation, tight stop placement, and reward-to-risk quality.`,
    marketStructureSummary: input.result.htfBiasSummary ?? "No higher-timeframe structure summary available.",
    liquiditySummary: input.result.liquiditySweepDescription ?? "No qualifying sweep description available.",
    keyLevelsSummary: `TP1 ${input.result.tp1Label ?? "structure target"} • TP2 ${input.result.tp2Label ?? "HTF target"} • ${input.result.managementPlan?.partialTakeProfit ?? "Scale at TP1."}`,
    noTradeExplanation: input.noTradeReason,
  };
}

export function buildAssetViewModelBase(input: {
  idPrefix: string;
  symbol: string;
  cycleId: string;
  generatedAt: number;
  displayCategory: SignalViewModel["displayCategory"];
  livePrice: number | null;
  tradeLevels: TradeLevels;
  direction: SignalViewModel["direction"];
  grade: string;
  gradeScore: number;
  setupType: string;
  session: string;
  bias: string;
  structure: string;
  liquidityState: string;
  location: string;
  zoneType: string;
  marketPhase: string;
  confidence: number;
  entryTimeframe?: string | null;
  tp1RiskReward?: number | null;
  tp2RiskReward?: number | null;
  htfBiasSummary?: string | null;
  liquiditySweepDescription?: string | null;
  confluenceScore?: number | null;
  reasoning: SignalReasoningOutput;
  smcAnalysis?: SignalViewModelSMC;
  marketStateLabels: string[];
  noTradeReason: string | null;
  blockedReasons: string[];
  status: SignalViewModel["status"];
  keyLevels: SignalViewModel["keyLevels"];
  riskStatus: SignalViewModel["riskStatus"];
  headline: string;
  summary?: string;
  uiVersion: string;
  uiSections: Record<string, unknown>;
  providerStatus?: ProviderStatus;
  priceSource?: string | null;
  candleSource?: string | null;
  fallbackDepth?: number;
  dataFreshnessMs?: number | null;
  missingBarCount?: number;
  lastSuccessfulProvider?: string | null;
  quoteIntegrity?: boolean;
  universeMembershipConfidence?: number;
  dataTrustScore?: number;
  qualityScores?: SignalQualityScores | null;
  publicationStatus?: PublicationStatus;
  publicationReasons?: SignalRejectionReasonCode[];
  moduleHealth?: ModuleHealthState;
  healthFlags?: string[];
}): SignalViewModel {
  const viewId = createId(input.idPrefix);
  const uiSections = input.uiSections as Record<string, unknown>;
  const assetClass = (uiSections.assetClass as SignalAssetClass | undefined) ?? "fx";
  const inferredProviderStatus = input.providerStatus ?? (
    input.livePrice == null
      ? "broken"
      : (input.fallbackDepth ?? 0) > 0
        ? "fallback"
        : input.noTradeReason === "data unavailable"
          ? "broken"
          : "healthy"
  );
  const dataTrust = buildDataTrust({
    assetClass,
    providerStatus: inferredProviderStatus,
    priceSource: input.priceSource ?? (typeof uiSections.dataSource === "string" ? uiSections.dataSource : null),
    candleSource: input.candleSource ?? (typeof uiSections.dataSource === "string" ? uiSections.dataSource : null),
    fallbackDepth: input.fallbackDepth ?? 0,
    dataFreshnessMs: input.dataFreshnessMs ?? null,
    missingBarCount: input.missingBarCount ?? 0,
    lastSuccessfulProvider: input.lastSuccessfulProvider ?? (typeof uiSections.dataSource === "string" ? uiSections.dataSource : null),
    quoteIntegrity: input.quoteIntegrity ?? input.livePrice != null,
    universeMembershipConfidence: input.universeMembershipConfidence ?? 1,
  });
  const qualityScores = input.qualityScores ?? buildQualityScores({
    structure: input.gradeScore,
    market: input.confidence * 100,
    execution: input.tradeLevels.entry != null && input.tradeLevels.sl != null ? 74 : 42,
    data: input.dataTrustScore ?? dataTrust.dataTrustScore,
    assetFit: assetClass === "memecoin" ? 62 : assetClass === "commodity" || assetClass === "index" ? 72 : 80,
  });
  const publication = input.publicationStatus
    ? {
      status: input.publicationStatus,
      reasons: input.publicationReasons ?? [],
      health: input.moduleHealth,
    }
    : buildPublicationState({
      providerStatus: dataTrust.providerStatus,
      livePrice: input.livePrice,
      quoteIntegrity: input.quoteIntegrity ?? dataTrust.quoteIntegrity,
      dataTrustScore: input.dataTrustScore ?? dataTrust.dataTrustScore,
      qualityScores,
      noTradeReason: input.noTradeReason,
      riskStatus: input.riskStatus,
      blockedReasons: input.blockedReasons,
      forceWatchlist: input.status === "watchlist",
    });
  const healthFlags = input.healthFlags ?? buildHealthFlags({
    providerStatus: dataTrust.providerStatus,
    publicationStatus: publication.status,
    dataTrustScore: input.dataTrustScore ?? dataTrust.dataTrustScore,
    reasons: publication.reasons,
  });

  return prepareSignalViewModelForPersistence({
    id: `${input.idPrefix}-${viewId}`,
    view_id: viewId,
    entity_ref: `${input.symbol}:${input.cycleId}`,
    signal_id: null,
    symbol: input.symbol,
    cycleId: input.cycleId,
    generatedAt: input.generatedAt,
    displayCategory: input.displayCategory,
    display_type: input.displayCategory,
    livePrice: input.livePrice,
    entry: input.tradeLevels.entry,
    sl: input.tradeLevels.sl,
    tp1: input.tradeLevels.tp1,
    tp2: input.tradeLevels.tp2,
    tp3: input.tradeLevels.tp3,
    direction: input.direction,
    grade: input.grade,
    gradeScore: input.gradeScore,
    setupType: input.setupType,
    session: input.session,
    bias: input.bias,
    structure: input.structure,
    liquidityState: input.liquidityState,
    location: input.location,
    zoneType: input.zoneType,
    marketPhase: input.marketPhase,
    confidence: input.confidence,
    entryTimeframe: input.entryTimeframe ?? null,
    tp1RiskReward: input.tp1RiskReward ?? null,
    tp2RiskReward: input.tp2RiskReward ?? null,
    htfBiasSummary: input.htfBiasSummary ?? null,
    liquiditySweepDescription: input.liquiditySweepDescription ?? null,
    confluenceScore: input.confluenceScore ?? null,
    shortReasoning: input.reasoning.shortReasoning,
    detailedReasoning: input.reasoning.detailedReasoning,
    whyThisSetup: input.reasoning.whyThisSetup,
    whyNow: input.reasoning.whyNow,
    whyThisLevel: input.reasoning.whyThisLevel,
    invalidation: input.reasoning.invalidation,
    whyThisGrade: input.reasoning.whyThisGrade,
    noTradeExplanation: input.reasoning.noTradeExplanation,
    smcAnalysis: input.smcAnalysis,
    marketStateLabels: input.marketStateLabels,
    noTradeReason: input.noTradeReason,
    blockedReasons: input.blockedReasons,
    riskStatus: input.riskStatus,
    riskRuleCodes: [],
    riskExplainability: [],
    podVotes: [],
    lifecycleState: null,
    status: input.status,
    keyLevels: input.keyLevels,
    marketStructureSummary: input.reasoning.marketStructureSummary,
    liquiditySummary: input.reasoning.liquiditySummary,
    keyLevelsSummary: input.reasoning.keyLevelsSummary,
    headline: input.headline,
    summary: input.summary ?? input.reasoning.detailedReasoning,
    reason_labels: input.marketStateLabels,
    confidence_label: confidenceLabel(input.confidence),
    ui_sections: input.uiSections,
    commentary: null,
    ui_version: input.uiVersion,
    generated_at: input.generatedAt,
    assetClass: assetClass,
    providerStatus: dataTrust.providerStatus,
    priceSource: input.priceSource ?? dataTrust.priceSource,
    candleSource: input.candleSource ?? dataTrust.candleSource,
    fallbackDepth: input.fallbackDepth ?? dataTrust.fallbackDepth,
    dataFreshnessMs: input.dataFreshnessMs ?? dataTrust.dataFreshnessMs,
    missingBarCount: input.missingBarCount ?? dataTrust.missingBarCount,
    lastSuccessfulProvider: input.lastSuccessfulProvider ?? dataTrust.lastSuccessfulProvider,
    quoteIntegrity: input.quoteIntegrity ?? dataTrust.quoteIntegrity,
    universeMembershipConfidence: input.universeMembershipConfidence ?? dataTrust.universeMembershipConfidence,
    dataTrustScore: input.dataTrustScore ?? dataTrust.dataTrustScore,
    qualityScores,
    publicationStatus: publication.status,
    publicationReasons: publication.reasons,
    moduleHealth: input.moduleHealth ?? publication.health,
    healthFlags,
  });
}
