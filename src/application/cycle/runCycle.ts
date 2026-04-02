import { evaluateSymbolScope } from "@/src/config/marketScope";
import type {
  CycleOutput,
  ExecutableSignal,
  MarketSnapshot,
  RiskEvaluatedCandidate,
  SignalViewModel,
  TradeCandidate,
} from "@/src/domain/models/signalPipeline";
import { aggregatePodVotes } from "@/src/domain/pods/aggregatePodVotes";
import { identityAdapter } from "@/src/domain/pods/podAdapters";
import type { PodVote } from "@/src/domain/pods/types";
import { buildCycleOutput, toCanonicalSignalLifecycle, toExecutableSignal, toMarketSnapshot, toRiskEvaluatedCandidate, toTradeCandidate } from "@/src/domain/services/signalPipelineMappers";
import { buildViewModel } from "@/src/domain/services/viewModelBuilder";
import type { AuditJournal } from "@/src/audit/AuditJournal";
import type { PortfolioAllocator } from "@/src/allocator/PortfolioAllocator";
import type { DataPlant } from "@/src/data-plant/DataPlant";
import type { ExecutionOrchestrator } from "@/src/execution/ExecutionOrchestrator";
import type { FeatureEngine } from "@/src/feature-engine/FeatureEngine";
import { createId } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import type { ApexConfig } from "@/src/lib/config";
import { hydrateOperatorControlsFromDb } from "@/src/lib/operatorControls";
import type { ApexRepository } from "@/src/lib/repository";
import { writeSchedulerHeartbeat } from "@/src/lib/schedulerHeartbeat";
import { logSignalEmission } from "@/src/lib/signalLogger";
import { TelegramNotifier } from "@/src/lib/telegram";
import { buildTraderPairRuntimeState, enrichTraderPairRuntimeState, gradeMeetsMinimum } from "@/src/lib/trader";
import type { TraderPairRuntimeState, TraderSetupType, TraderSignalGrade, TraderStructureLabel } from "@/src/lib/traderContracts";
import { formatPrice } from "@/src/assets/shared/strategyUtils";
import type { MTFAnalysisResult } from "@/src/assets/shared/mtfAnalysis";
import { runTopDownAnalysis } from "@/src/assets/shared/mtfAnalysis";
import { fetchMTFCandles } from "@/src/assets/shared/mtfDataFetcher";
import type { DriftMonitor } from "@/src/learning/DriftMonitor";
import type {
  AllocationIntent,
  FeatureSnapshot,
  GatingPodOutput,
  IAlphaPod,
  NoTradeReasonCode,
  PodEvaluation,
  RiskDecision,
  SessionLabel,
  SignalLifecycleRecord,
  SignalLifecycleState,
  SignalOutcome,
  SignalRegime,
} from "@/src/interfaces/contracts";
import type { RiskEngine } from "@/src/domain/risk/RiskEngine";
import type { RiskEngineEvaluation } from "@/src/domain/risk/types";
import type { RiskGovernor } from "@/src/risk/RiskGovernor";

export type CycleResult = {
  cycle_id: string;
  timestamp: number;
  symbols: Array<{
    symbol: string;
    snapshot_id?: string;
    direction?: string;
    confidence?: number;
    lifecycle_state?: string;
    risk_status?: string;
    entry_style?: AllocationIntent["entry_style"];
    skip_reason?: string;
    executed: boolean;
  }>;
};

type CandlePathBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  timestampClose: number;
};

type FxFallbackContext = {
  symbol: string;
  snapshot: FeatureSnapshot;
  canonicalMarketSnapshot: MarketSnapshot;
};

type FxFallbackSignal = {
  symbol: string;
  direction: Exclude<AllocationIntent["direction"], "none">;
  confidenceScore: number;
  grade: TraderSignalGrade;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskReward: number;
  reasoning: string;
  candlesFetched: number;
  analysis: MTFAnalysisResult;
};

function resolveFxSmcScore(snapshot: FeatureSnapshot): number | null {
  const score = snapshot.smcAnalysis?.smcScore?.total;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

function resolveFxFallbackRegime(snapshot: FeatureSnapshot): SignalRegime {
  if (snapshot.context.session_features?.sessionCompressionState === "compressed") {
    return "compression";
  }
  if (snapshot.context.session_features?.sessionBreakoutState !== "none") {
    return "breakout";
  }
  if (snapshot.context.market_structure?.structureBias === "neutral") {
    return "range";
  }
  return "trend";
}

function resolveFxFallbackEntryStyle(
  snapshot: FeatureSnapshot,
  direction: Exclude<AllocationIntent["direction"], "none">,
): AllocationIntent["entry_style"] {
  const breakoutState = snapshot.context.session_features?.sessionBreakoutState;
  if (
    breakoutState === "bullish" && direction === "buy"
    || breakoutState === "bearish" && direction === "sell"
  ) {
    return "session_breakout";
  }
  return "trend_pullback";
}

function buildFxFallbackCandidate(input: {
  symbol: string;
  snapshot: FeatureSnapshot;
  fallback: FxFallbackSignal;
}): AllocationIntent {
  const now = Date.now();
  const riskBuffer = Math.max(Math.abs(input.fallback.entry - input.fallback.stopLoss), input.fallback.entry * 0.0006);
  const entryZoneWidth = Math.max(riskBuffer * 0.25, input.fallback.entry * 0.00015);
  const invalidationWidth = Math.max(riskBuffer * 0.2, input.fallback.entry * 0.00015);
  const entryStyle = resolveFxFallbackEntryStyle(input.snapshot, input.fallback.direction);

  return {
    candidate_id: createId("cand"),
    ts: now,
    symbol_canonical: input.symbol,
    timeframe: "15m",
    regime: resolveFxFallbackRegime(input.snapshot),
    session: input.snapshot.context.session.session,
    direction: input.fallback.direction,
    confidence: input.fallback.confidenceScore / 100,
    entry_style: entryStyle,
    selected_pods: ["fx-trend-fallback"],
    pod_weights: { "fx-trend-fallback": 1 },
    pod_vote_summary: {
      directional: [],
      gating: [],
    },
    trade_plan: {
      entry: input.fallback.entry,
      sl: input.fallback.stopLoss,
      tp1: input.fallback.takeProfit1,
      tp2: input.fallback.takeProfit2,
      tp3: input.fallback.takeProfit3,
      risk_reward_ratio: input.fallback.riskReward,
      entry_zone: {
        low: formatPrice(input.fallback.entry - entryZoneWidth, input.symbol),
        high: formatPrice(input.fallback.entry + entryZoneWidth, input.symbol),
        label: "FX MTF entry zone",
      },
      invalidation_zone: {
        low: formatPrice(input.fallback.stopLoss - invalidationWidth, input.symbol),
        high: formatPrice(input.fallback.stopLoss + invalidationWidth, input.symbol),
        label: "FX MTF invalidation",
      },
      pre_entry_invalidation: "Cancel if lower-timeframe MTF structure flips before entry.",
      post_entry_invalidation: "Exit if the MTF invalidation zone breaks after entry.",
      expires_after_bars: 6,
      expires_at: now + (6 * 15 * 60 * 1000),
    },
    entry: input.fallback.entry,
    sl: input.fallback.stopLoss,
    tp1: input.fallback.takeProfit1,
    tp2: input.fallback.takeProfit2,
    tp3: input.fallback.takeProfit3,
    target_position: 0.1,
    reasoning: [input.fallback.reasoning],
    reason_codes: ["FX_MTF_FALLBACK"],
    veto_reasons: [],
    portfolio_context: {
      gross_exposure: 0,
      net_exposure: 0,
      active_symbols: 0,
    },
  };
}

function buildFxFallbackRiskDecision(candidate: AllocationIntent): RiskDecision {
  return {
    ts: Date.now(),
    scope: candidate.symbol_canonical,
    approval_status: "approved",
    approved_size_multiplier: 1,
    risk_check_results: {
      fx_trend_fallback: true,
    },
    veto_reasons: [],
    warning_reasons: [],
    de_risking_action: "none",
    kill_switch_active: false,
  };
}

function countMtfCandles(analysis: Awaited<ReturnType<typeof fetchMTFCandles>>): number {
  return analysis.monthly.length
    + analysis.weekly.length
    + analysis.daily.length
    + analysis.h4.length
    + analysis.h1.length
    + analysis.m15.length
    + analysis.m5.length;
}

export function normalizeFxFallbackAnalysis(input: {
  symbol: string;
  analysis: MTFAnalysisResult;
  mtfCandles: Awaited<ReturnType<typeof fetchMTFCandles>>;
}): MTFAnalysisResult {
  return {
    ...input.analysis,
    takeProfit: formatPrice(input.analysis.takeProfit, input.symbol),
    takeProfit2: input.analysis.takeProfit2 == null ? null : formatPrice(input.analysis.takeProfit2, input.symbol),
  };
}

function mapMtfDirection(
  direction: MTFAnalysisResult["direction"],
): Exclude<AllocationIntent["direction"], "none"> | null {
  if (direction === "LONG") {
    return "buy";
  }
  if (direction === "SHORT") {
    return "sell";
  }
  return null;
}

function mapMtfStructure(result: MTFAnalysisResult): TraderStructureLabel {
  const lastStructure = result.structureBreaks.at(-1);
  if (lastStructure?.type === "CHoCH") {
    return "CHOCH";
  }
  if (lastStructure?.type === "BOS") {
    return "BOS";
  }
  return result.overallBias === "ranging" ? "range" : "trend continuation";
}

function mapMtfSetupType(setupType: string): TraderSetupType {
  if (setupType === "liquidity_sweep" || setupType === "liquidity_sweep_reversal") {
    return "liquidity sweep reversal";
  }
  if (setupType === "sd_zone") {
    return "range reversal";
  }
  if (setupType === "ob_retest" || setupType === "fvg_fill") {
    return "trend pullback";
  }
  return "trend pullback";
}

function normalizeRiskDecision(
  decision: Partial<RiskDecision> & Pick<RiskDecision, "approval_status">,
  fallback: {
    scope: string;
  },
): RiskDecision {
  return {
    ts: typeof decision.ts === "number" ? decision.ts : Date.now(),
    scope: decision.scope ?? fallback.scope,
    approval_status: decision.approval_status,
    approved_size_multiplier: typeof decision.approved_size_multiplier === "number"
      ? decision.approved_size_multiplier
      : 1,
    risk_check_results: decision.risk_check_results ?? {},
    veto_reasons: Array.isArray(decision.veto_reasons) ? [...decision.veto_reasons] : [],
    warning_reasons: Array.isArray(decision.warning_reasons) ? [...decision.warning_reasons] : [],
    override_instructions: decision.override_instructions,
    de_risking_action: decision.de_risking_action ?? "none",
    kill_switch_active: decision.kill_switch_active ?? false,
  };
}

function normalizeRiskEvaluationResult(
  evaluation: Awaited<ReturnType<RiskEngine["evaluate"]>> | RiskDecision,
  candidate: AllocationIntent,
): {
  riskDecision: RiskDecision;
  riskEvaluation?: RiskEngineEvaluation;
} {
  if (
    evaluation
    && typeof evaluation === "object"
    && "legacy_decision" in evaluation
    && evaluation.legacy_decision
  ) {
    return {
      riskDecision: normalizeRiskDecision(evaluation.legacy_decision, {
        scope: candidate.symbol_canonical,
      }),
      riskEvaluation: {
        ...evaluation,
        legacy_decision: normalizeRiskDecision(evaluation.legacy_decision, {
          scope: candidate.symbol_canonical,
        }),
      },
    };
  }

  return {
    riskDecision: normalizeRiskDecision(evaluation as RiskDecision, {
      scope: candidate.symbol_canonical,
    }),
  };
}

function applyFxFallbackToRuntimeState(input: {
  state: TraderPairRuntimeState;
  fallback: FxFallbackSignal;
}): TraderPairRuntimeState {
  if (!input.state.card) {
    return input.state;
  }

  const card = input.state.card;
  const status = gradeMeetsMinimum(input.fallback.grade, "B") ? "active" : "watchlist";
  const direction = input.fallback.direction === "buy" ? "long" : "short";
  const bias = input.fallback.direction === "buy" ? "bullish" : "bearish";
  const mtf = input.fallback.analysis;
  const timeframeAlignment = `${mtf.overallBias} ${mtf.biasStrength}% confluence`;
  const entryTrigger = mtf.entryTrigger === "none"
    ? "no micro trigger yet"
    : mtf.entryTrigger.replaceAll("_", " ");
  const lastStructure = mtf.structureBreaks.at(-1);

  card.direction = direction;
  card.grade = input.fallback.grade;
  card.livePrice = input.fallback.entry;
  card.entry = input.fallback.entry;
  card.sl = input.fallback.stopLoss;
  card.tp1 = input.fallback.takeProfit1;
  card.tp2 = input.fallback.takeProfit2;
  card.tp3 = input.fallback.takeProfit3;
  card.entryTimeframe = mtf.entryTimeframe ?? mtf.timeframe ?? null;
  card.tp1RiskReward = input.fallback.riskReward;
  card.tp2RiskReward = mtf.riskReward2 ?? null;
  card.htfBiasSummary = mtf.htfBiasSummary ?? `${timeframeAlignment}.`;
  card.liquiditySweepDescription = mtf.liquiditySweepDescription ?? null;
  card.confluenceScore = mtf.confluenceScore ?? input.fallback.confidenceScore;
  card.bias = bias;
  card.structure = mapMtfStructure(mtf);
  card.setupType = mapMtfSetupType(mtf.setupType);
  card.status = status;
  card.noTradeReason = null;
  card.noTradeExplanation = null;
  card.whyNotValid = null;
  card.blockedReasons = [];
  card.confidence = input.fallback.confidenceScore / 100;
  card.shortReasoning = input.fallback.reasoning;
  card.detailedReasoning = {
    whyThisIsASetup: mtf.htfBiasSummary ?? `Top-down alignment is ${timeframeAlignment} with ${entryTrigger} supporting the entry.`,
    whyNow: mtf.liquiditySweepDescription ?? `Price is in ${mtf.premiumDiscount.zone} and the most recent structure is ${lastStructure ? `${lastStructure.type} ${lastStructure.direction}` : "still forming"}.`,
    whyThisLevel: `Entry ${input.fallback.entry} on ${mtf.entryTimeframe ?? mtf.timeframe ?? "15m"} confirmation with SL ${input.fallback.stopLoss}, TP1 ${input.fallback.takeProfit1} (${input.fallback.riskReward.toFixed(2)}R), and TP2 ${input.fallback.takeProfit2 ?? "n/a"}${mtf.riskReward2 != null ? ` (${mtf.riskReward2.toFixed(2)}R)` : ""}.`,
    whatWouldInvalidateIt: mtf.managementPlan?.stopAdjustment ?? "Invalidate if the protected MTF zone fails and the lower timeframe reverses against the bias.",
    whyItGotItsGrade: `${input.fallback.grade} grade from HTF alignment, sweep confirmation, tight stop placement, and ${input.fallback.riskReward.toFixed(2)}R to TP1.`,
  };
  card.whyThisSetup = card.detailedReasoning.whyThisIsASetup;
  card.whyNow = card.detailedReasoning.whyNow;
  card.whyThisLevel = card.detailedReasoning.whyThisLevel;
  card.invalidation = card.detailedReasoning.whatWouldInvalidateIt;
  card.whyThisGrade = card.detailedReasoning.whyItGotItsGrade;
  card.marketStructureSummary = mtf.htfBiasSummary ?? `${timeframeAlignment} with ${entryTrigger}.`;
  card.liquiditySummary = mtf.liquiditySweepDescription
    ?? (mtf.liquiditySweeps.length > 0
      ? `Recent liquidity event: ${mtf.liquiditySweeps.at(-1)?.type.replaceAll("_", " ")} ${mtf.liquiditySweeps.at(-1)?.reversed ? "reversed" : "not reversed yet"}.`
      : "No recent liquidity sweep is in control.");
  card.keyLevelsSummary = `Entry ${input.fallback.entry} • SL ${input.fallback.stopLoss} • TP1 ${input.fallback.takeProfit1} (${input.fallback.riskReward.toFixed(2)}R) • TP2 ${input.fallback.takeProfit2 ?? "n/a"}${mtf.riskReward2 != null ? ` (${mtf.riskReward2.toFixed(2)}R)` : ""}`;
  card.marketStateLabels = [...new Set([
    "active session",
    mtf.entryTimeframe ? `${mtf.entryTimeframe} confirmation` : (mtf.entryTrigger === "none" ? "expansion" : "pullback"),
    ...card.marketStateLabels,
  ])] as typeof card.marketStateLabels;

  input.state.liveMarket.livePrice = input.fallback.entry;
  input.state.liveMarket.bias = bias;
  input.state.liveMarket.grade = input.fallback.grade;
  input.state.liveMarket.noTradeReason = null;
  input.state.liveMarket.status = status;
  input.state.liveMarket.marketStateLabels = card.marketStateLabels;

  input.state.marketReasoning.summary = input.fallback.reasoning;
  input.state.marketReasoning.grade = input.fallback.grade;
  input.state.marketReasoning.noTradeReason = null;
  input.state.marketReasoning.status = status;
  input.state.marketReasoning.marketStateLabels = card.marketStateLabels;

  input.state.diagnostics.cardStatus = status;
  input.state.diagnostics.approvalStatus = "approved";
  input.state.diagnostics.noTradeReason = null;
  input.state.diagnostics.blockedReasons = [];

  return input.state;
}

async function buildFxMtfFallbackSignal(input: {
  symbol: string;
  livePrice: number | null;
}): Promise<FxFallbackSignal | null> {
  const mtfCandles = await fetchMTFCandles(input.symbol);
  const fallbackPrice = input.livePrice
    ?? mtfCandles.m5.at(-1)?.close
    ?? mtfCandles.m15.at(-1)?.close
    ?? mtfCandles.h1.at(-1)?.close
    ?? null;

  if (fallbackPrice == null || !Number.isFinite(fallbackPrice) || fallbackPrice <= 0) {
    console.log(`[FX MTF] ${input.symbol}: no live price available for MTF fallback`);
    return null;
  }

  const rawAnalysis = runTopDownAnalysis(input.symbol, mtfCandles, fallbackPrice);
  if (!rawAnalysis) {
    console.log(`[FX MTF] ${input.symbol}: insufficient MTF data for top-down analysis`);
    return null;
  }

  const analysis = normalizeFxFallbackAnalysis({
    symbol: input.symbol,
    analysis: rawAnalysis,
    mtfCandles,
  });

  const mappedDirection = mapMtfDirection(analysis.direction);
  if (!mappedDirection) {
    console.log(
      `[FX MTF] ${input.symbol}: neutral MTF read | bias=${analysis.overallBias} strength=${analysis.biasStrength}% trigger=${analysis.entryTrigger}`,
    );
    return null;
  }

  if (!["S", "A", "B", "C"].includes(analysis.grade)) {
    console.log(
      `[FX MTF] ${input.symbol}: grade ${analysis.grade} below actionable floor, skipping | rr=${analysis.riskReward.toFixed(2)} confidence=${analysis.confidence}`,
    );
    return null;
  }

  console.log(
    `[FX MTF] ${input.symbol}: ${analysis.grade} ${analysis.direction} | Bias: ${analysis.overallBias} (${analysis.biasStrength}% confluence)`,
  );

  return {
    symbol: input.symbol,
    direction: mappedDirection,
    confidenceScore: analysis.confidence,
    grade: analysis.grade as TraderSignalGrade,
    entry: analysis.entry,
    stopLoss: analysis.stopLoss,
    takeProfit1: analysis.takeProfit,
    takeProfit2: analysis.takeProfit2 ?? null,
    takeProfit3: null,
    riskReward: analysis.riskReward,
    reasoning: analysis.reasoning,
    candlesFetched: countMtfCandles(mtfCandles),
    analysis,
  };
}

export type FocusedRuntimeCycleHost = {
  engine: {
    queueCycle: (source?: string, options?: ApexCycleExecutionOptions) => Promise<{ queued: boolean; jobId?: string; result?: CycleResult }>;
    runCycle: (options?: ApexCycleExecutionOptions) => Promise<CycleResult>;
  };
};

export type QueuedFocusedRuntimeCycleResult = Awaited<ReturnType<FocusedRuntimeCycleHost["engine"]["queueCycle"]>>;
export type ImmediateFocusedRuntimeCycleResult = Awaited<ReturnType<FocusedRuntimeCycleHost["engine"]["runCycle"]>>;

export type ApexCycleDependencies = {
  config: ApexConfig;
  repository: ApexRepository;
  dataPlant: DataPlant;
  featureEngine: FeatureEngine;
  pods: IAlphaPod[];
  allocator: PortfolioAllocator;
  riskEngine: RiskEngine;
  riskGovernor: RiskGovernor;
  execution: ExecutionOrchestrator;
  driftMonitor: DriftMonitor;
  auditJournal: AuditJournal;
  notifier: TelegramNotifier;
  executionOptions?: ApexCycleExecutionOptions;
};

export type ApexCycleExecutionOptions = {
  activeSymbolsOverride?: readonly string[];
  smokeMode?: boolean;
  maxCycleDurationMs?: number;
  fetchRetryAttempts?: number;
  fetchRetryBaseDelayMs?: number;
  nullPriceCircuitBreakerThreshold?: number;
  nullPriceCircuitBreakerMinAttempts?: number;
};

function getScopedPods(pods: IAlphaPod[], config: ApexConfig): IAlphaPod[] {
  return pods.filter(pod => config.activePods.includes(pod.pod_id) && pod.getStatus() === "active");
}

function toCandlePathBars(featureEngine: FeatureEngine, symbol: string): CandlePathBar[] {
  const state = featureEngine.getLatestState(symbol);
  return (state?.bars ?? []).slice(-4).map(bar => ({
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    timestampClose: bar.timestampClose,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ingestLiveDataWithRetry(
  input: {
    dataPlant: DataPlant;
    repository: ApexRepository;
    cycleId: string;
    symbol: string;
    interval: string;
    retryAttempts: number;
    retryBaseDelayMs: number;
  },
) {
  for (let attempt = 0; attempt <= input.retryAttempts; attempt += 1) {
    const candle = await input.dataPlant.ingestOHLCV(input.symbol, input.interval);
    if (candle) {
      return candle;
    }

    if (attempt >= input.retryAttempts) {
      break;
    }

    const delayMs = input.retryBaseDelayMs * (2 ** attempt);
    await input.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "engine",
      type: "market_data_retry",
      reason: "retry_live_data_fetch",
      payload: {
        cycle_id: input.cycleId,
        symbol: input.symbol,
        interval: input.interval,
        attempt: attempt + 1,
        next_delay_ms: delayMs,
      },
    });
    await sleep(delayMs);
  }

  return null;
}

function resolveCycleSymbols(
  config: ApexConfig,
  options?: ApexCycleExecutionOptions,
): string[] {
  if (options?.activeSymbolsOverride?.length) {
    return [...new Set(options.activeSymbolsOverride)];
  }
  return [...config.activeSymbols];
}

function shouldTripNullPriceCircuitBreaker(input: {
  attemptedCount: number;
  nullPriceCount: number;
  threshold: number;
  minimumAttempts: number;
}): boolean {
  if (input.attemptedCount < input.minimumAttempts) {
    return false;
  }

  return (input.nullPriceCount / Math.max(1, input.attemptedCount)) > input.threshold;
}

async function recordSymbolSkip(
  repository: ApexRepository,
  config: ApexConfig,
  input: {
    cycleId: string;
    symbol: string;
    reason: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  logger.warn({
    module: "engine",
    message: "Symbol skipped during cycle",
    cycle_id: input.cycleId,
    symbol: input.symbol,
    reason: input.reason,
    entry_style: config.primaryEntryStyle,
    ...input.details,
  });
  await repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: Date.now(),
    module: "engine",
    type: "symbol_skipped",
    reason: input.reason,
    payload: {
      cycle_id: input.cycleId,
      symbol: input.symbol,
      entry_style: config.primaryEntryStyle,
      ...(input.details ?? {}),
    },
  });
}

async function appendJournalEntry(
  auditJournal: AuditJournal,
  input: {
    signalId: string;
    snapshotId: string;
    symbol: string;
    session: SessionLabel;
    regime: SignalRegime;
    entryStyle: AllocationIntent["entry_style"];
    direction: AllocationIntent["direction"];
    confidence: number;
    entry: number | null;
    sl: number | null;
    tp1: number | null;
    tp2: number | null;
    tp3: number | null;
    podOutputs: PodEvaluation[];
    allocationRef: string;
    riskDecisionRef: string;
    executionIntentRef: string;
    finalAction: "executed" | "rejected" | "deferred" | "halted";
    vetoReasons: NoTradeReasonCode[];
    reasoning: string[];
    lifecycleState?: SignalLifecycleState;
    outcome?: SignalOutcome;
    maxFavorableExcursion?: number;
    maxAdverseExcursion?: number;
    timeToTp1?: number;
    timeToSl?: number;
  },
): Promise<void> {
  const entry = auditJournal.createDecisionEntry({
    signal_id: input.signalId,
    ts: Date.now(),
    symbol_canonical: input.symbol,
    pair: input.symbol,
    session: input.session,
    regime: input.regime,
    entry_style: input.entryStyle,
    direction: input.direction,
    confidence: input.confidence,
    entry: input.entry,
    sl: input.sl,
    tp1: input.tp1,
    tp2: input.tp2,
    tp3: input.tp3,
    pod_votes: {
      directional: input.podOutputs
        .filter(output => output.pod_category === "directional")
        .map(output => ({
          pod_id: output.pod_id,
          pod_category: output.pod_category,
          direction: output.direction,
          confidence: output.confidence,
          weight: output.confidence,
          score: output.score,
          rationale: output.rationale,
        })),
      gating: input.podOutputs
        .filter((output): output is GatingPodOutput => output.pod_category === "gating")
        .map(output => ({
          pod_id: output.pod_id,
          pod_category: output.pod_category,
          direction: output.advisory_direction ?? "none",
          confidence: output.confidence,
          weight: output.confidence,
          gate_status: output.gate_status,
          veto_reasons: output.veto_reasons,
          rationale: output.rationale,
        })),
    },
    veto_reasons: input.vetoReasons,
    market_snapshot_ref: input.snapshotId,
    pod_output_refs: input.podOutputs.map(output => `${output.pod_id}:${output.ts}`),
    allocation_ref: input.allocationRef,
    risk_decision_ref: input.riskDecisionRef,
    execution_intent_ref: input.executionIntentRef,
    lifecycle_state: input.lifecycleState,
    outcome: input.outcome,
    maxFavorableExcursion: input.maxFavorableExcursion,
    maxAdverseExcursion: input.maxAdverseExcursion,
    timeToTp1: input.timeToTp1,
    timeToSl: input.timeToSl,
    final_action: input.finalAction,
    reasoning: input.reasoning,
  });
  await auditJournal.logDecision(entry);
}

async function persistTraderRuntimeState(
  input: ApexCycleDependencies & {
    cycleId: string;
    symbol: string;
    snapshot: FeatureSnapshot | null;
    candidate: AllocationIntent | null;
    riskDecision: RiskDecision | null;
    lifecycle: SignalLifecycleRecord | null;
    unavailableReason?: string | null;
  },
): Promise<TraderPairRuntimeState> {
  const state = buildTraderPairRuntimeState({
    symbol: input.symbol,
    cycleId: input.cycleId,
    generatedAt: Date.now(),
    snapshot: input.snapshot,
    candidate: input.candidate,
    riskDecision: input.riskDecision,
    lifecycle: input.lifecycle,
    marketData: typeof input.dataPlant.getLatestFetchDiagnostics === "function"
      ? input.dataPlant.getLatestFetchDiagnostics(input.symbol)
      : null,
    config: {
      pairProfiles: input.config.pairProfiles,
    },
    unavailableReason: input.unavailableReason ?? null,
  });
  if (!input.executionOptions?.smokeMode) {
    await enrichTraderPairRuntimeState({
      state,
      snapshot: input.snapshot,
      candidate: input.candidate,
      riskDecision: input.riskDecision,
    });
  }
  await input.repository.upsertTraderPairRuntimeState(state);
  if (state.card) {
    await logSignalEmission(state.card, input.cycleId);
  }
  logger.info({
    module: "engine",
    message: "Trader runtime state updated",
    cycle_id: input.cycleId,
    symbol: input.symbol,
    snapshot_available: state.snapshotAvailable,
    candles_fetched: state.diagnostics.marketData.candlesFetched,
    provider: state.diagnostics.marketData.provider,
    last_candle_ts: state.diagnostics.marketData.lastCandleTimestamp,
    trader_card_created: state.diagnostics.traderCardCreated,
    card_status: state.diagnostics.cardStatus,
    approval_status: state.diagnostics.approvalStatus,
    grade: state.card?.grade ?? null,
    unavailable_reason: state.diagnostics.unavailableReason,
    blocked_reasons: state.diagnostics.blockedReasons,
  });
  return state;
}

async function persistCanonicalCycleOutput(repository: ApexRepository, output: CycleOutput): Promise<void> {
  await repository.appendCycleOutput(output);
  logger.info({
    module: "engine",
    message: "Canonical cycle output persisted",
    cycle_id: output.cycle_id,
    pipeline_status: output.pipeline_status,
    snapshot_count: output.snapshots.length,
    candidate_count: output.candidates.length,
    risk_result_count: output.risk_results.length,
    signal_count: output.signals.length,
    payload_source: output.payload_source,
  });
}

export async function executeApexCycle(input: ApexCycleDependencies): Promise<CycleResult> {
  await hydrateOperatorControlsFromDb(input.repository, {
    defaultRecoveryMode: input.config.defaultRecoveryMode,
  });
  const cycleId = createId("cycle");
  const timestamp = Date.now();
  const cycleSymbols = resolveCycleSymbols(input.config, input.executionOptions);
  const maxCycleDurationMs = input.executionOptions?.maxCycleDurationMs
    ?? (input.executionOptions?.smokeMode ? 45_000 : 90_000);
  const cycleDeadline = timestamp + maxCycleDurationMs;
  const fetchRetryAttempts = Math.max(0, input.executionOptions?.fetchRetryAttempts ?? 2);
  const fetchRetryBaseDelayMs = Math.max(150, input.executionOptions?.fetchRetryBaseDelayMs ?? 500);
  const nullPriceCircuitBreakerThreshold = Math.min(1, Math.max(0.05, input.executionOptions?.nullPriceCircuitBreakerThreshold ?? 0.3));
  const nullPriceCircuitBreakerMinAttempts = Math.max(3, input.executionOptions?.nullPriceCircuitBreakerMinAttempts ?? 4);
  const summaryRows: Array<{ symbol: string; action: string; confidence: number; pods: string[] }> = [];
  const results: CycleResult["symbols"] = [];
  const marketSnapshots: MarketSnapshot[] = [];
  const tradeCandidates: TradeCandidate[] = [];
  const riskEvaluatedCandidates: RiskEvaluatedCandidate[] = [];
  const executableSignals: ExecutableSignal[] = [];
  const signalViewModels: SignalViewModel[] = [];
  const fxFallbackContexts = new Map<string, FxFallbackContext>();
  const fxCandleCounts = new Map<string, {
    candlesFetched: number;
    provider: string | null;
    sourceMode: string | null;
    usedFallback: boolean;
  }>();
  const fxSmcScores = new Map<string, number | null>();
  const fxCandidateDiagnostics: Array<{
    symbol: string;
    direction: AllocationIntent["direction"];
    confidence: number;
    vetoReasons: string[];
  }> = [];
  const fxRiskDiagnostics: Array<{
    symbol: string;
    approvalStatus: RiskDecision["approval_status"];
    vetoReasons: string[];
  }> = [];
  const scopedPods = getScopedPods(input.pods, input.config);
  let approvedCount = 0;
  let rejectedCount = 0;
  let fills = 0;
  let attemptedSymbols = 0;
  let nullPriceIncidents = 0;
  let fxFallbackGenerated = 0;
  let summaryStatus: "completed" | "failed" | "skipped" = "completed";
  let failureReason: string | undefined;

  console.log("[FX CYCLE] Starting...", {
    cycleId,
    activePairs: cycleSymbols,
    smokeMode: input.executionOptions?.smokeMode ?? false,
  });

  const appendSignalViewModelAndNotify = async (symbol: string, signalViewModel: SignalViewModel) => {
    signalViewModels.push(signalViewModel);
    await input.repository.appendSignalViewModel(signalViewModel);
    const telegramCard = {
      id: signalViewModel.id,
      signal_id: signalViewModel.signal_id,
      marketSymbol: signalViewModel.symbol,
      displayName: signalViewModel.symbol,
      direction: signalViewModel.direction,
      grade: signalViewModel.grade,
      status: signalViewModel.status,
      displayCategory: signalViewModel.displayCategory,
      livePrice: signalViewModel.livePrice,
      entry: signalViewModel.entry,
      sl: signalViewModel.sl,
      tp1: signalViewModel.tp1,
      tp2: signalViewModel.tp2,
      tp3: signalViewModel.tp3,
      setupType: signalViewModel.setupType,
      confidence: signalViewModel.confidence,
      shortReasoning: signalViewModel.shortReasoning,
      marketStateLabels: signalViewModel.marketStateLabels,
      noTradeReason: signalViewModel.noTradeReason,
      session: signalViewModel.session,
      ui_sections: signalViewModel.ui_sections,
    } as const;
    const telegramDelivered = typeof input.notifier.sendMarketSignalAlerts === "function"
      ? await input.notifier.sendMarketSignalAlerts([telegramCard], {
        assetLabel: "Forex",
        messageType: "forex_signal",
      })
      : 0;
    logger.info({
      module: "engine",
      message: "Forex telegram alert attempted",
      cycle_id: cycleId,
      symbol,
      delivered: telegramDelivered > 0,
      telegram_alert_count: telegramDelivered,
      signal_id: signalViewModel.signal_id,
      display_category: signalViewModel.displayCategory,
      status: signalViewModel.status,
      grade: signalViewModel.grade,
    });
  };

  const assertCycleBudget = (symbol: string) => {
    if (Date.now() <= cycleDeadline) {
      return;
    }

    throw new Error(`FX_CYCLE_TIMEOUT_EXCEEDED:${symbol}:>${maxCycleDurationMs}ms`);
  };

  await input.repository.verifyPersistenceReadiness(`cycle_start:${cycleId}`);

  try {
    if (input.repository.isKillSwitchActive()) {
      summaryStatus = "skipped";
      logger.warn({
        module: "engine",
        message: "Cycle skipped because kill switch is active",
        cycle_id: cycleId,
      });
      await persistCanonicalCycleOutput(input.repository, buildCycleOutput({
        cycle_id: cycleId,
        started_at: timestamp,
        completed_at: Date.now(),
        symbols_processed: [],
        snapshots: marketSnapshots,
        candidates: tradeCandidates,
        risk_results: riskEvaluatedCandidates,
        signals: executableSignals,
        view_models: signalViewModels,
        metadata: {
          skip_reason: "kill_switch",
          active_symbols: cycleSymbols,
        },
        pipeline_status: "skipped",
      }));
      return {
        cycle_id: cycleId,
        timestamp,
        symbols: [],
      };
    }

    if (input.repository.getRecoveryMode() === "full_stop") {
      summaryStatus = "skipped";
      logger.warn({
        module: "engine",
        message: "Cycle skipped because full_stop is active",
        cycle_id: cycleId,
      });
      await persistCanonicalCycleOutput(input.repository, buildCycleOutput({
        cycle_id: cycleId,
        started_at: timestamp,
        completed_at: Date.now(),
        symbols_processed: [],
        snapshots: marketSnapshots,
        candidates: tradeCandidates,
        risk_results: riskEvaluatedCandidates,
        signals: executableSignals,
        view_models: signalViewModels,
        metadata: {
          skip_reason: "full_stop",
          active_symbols: cycleSymbols,
        },
        pipeline_status: "skipped",
      }));
      return {
        cycle_id: cycleId,
        timestamp,
        symbols: [],
      };
    }

    logger.info({
      module: "engine",
      message: "Cycle started",
      cycle_id: cycleId,
      active_symbols: cycleSymbols,
      primary_entry_style: input.config.primaryEntryStyle,
      enabled_entry_styles: input.config.enabledEntryStyles,
      active_pods: scopedPods.map(pod => pod.pod_id),
      smoke_mode: input.executionOptions?.smokeMode ?? false,
    });
    if (
      !input.executionOptions?.smokeMode
      && typeof (input.dataPlant as DataPlant & { refreshEconomicEvents?: () => Promise<void> }).refreshEconomicEvents === "function"
    ) {
      await (input.dataPlant as DataPlant & { refreshEconomicEvents: () => Promise<void> }).refreshEconomicEvents();
    }
    await input.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: timestamp,
      module: "engine",
      type: "cycle_scope_applied",
      reason: "phase_10_fx_intraday_scope",
      payload: {
        cycle_id: cycleId,
        active_symbols: cycleSymbols,
        primary_entry_style: input.config.primaryEntryStyle,
        enabled_entry_styles: input.config.enabledEntryStyles,
        active_pods: scopedPods.map(pod => pod.pod_id),
        smoke_mode: input.executionOptions?.smokeMode ?? false,
      },
    });

    for (const symbol of cycleSymbols) {
      assertCycleBudget(symbol);
      attemptedSymbols += 1;
      const symbolScope = evaluateSymbolScope(symbol, input.config.activeSymbols, input.config.marketScope);
      if (!symbolScope.allowed) {
        rejectedCount += 1;
        await recordSymbolSkip(input.repository, input.config, {
          cycleId,
          symbol,
          reason: symbolScope.reason!,
        });
        results.push({
          symbol,
          risk_status: "skipped",
          entry_style: input.config.primaryEntryStyle,
          skip_reason: symbolScope.reason,
          executed: false,
        });
        await persistTraderRuntimeState({
          ...input,
          cycleId,
          symbol,
          snapshot: null,
          candidate: null,
          riskDecision: null,
          lifecycle: null,
          unavailableReason: symbolScope.reason,
        });
        continue;
      }

      if (input.repository.getQuarantinedSymbols()[symbol]) {
        rejectedCount += 1;
        await recordSymbolSkip(input.repository, input.config, {
          cycleId,
          symbol,
          reason: "SYMBOL_QUARANTINED",
        });
        results.push({
          symbol,
          risk_status: "quarantined",
          entry_style: input.config.primaryEntryStyle,
          skip_reason: "SYMBOL_QUARANTINED",
          executed: false,
        });
        await persistTraderRuntimeState({
          ...input,
          cycleId,
          symbol,
          snapshot: null,
          candidate: null,
          riskDecision: null,
          lifecycle: null,
          unavailableReason: "SYMBOL_QUARANTINED",
        });
        continue;
      }

      const candle = await ingestLiveDataWithRetry({
        dataPlant: input.dataPlant,
        repository: input.repository,
        cycleId,
        symbol,
        interval: "15min",
        retryAttempts: fetchRetryAttempts,
        retryBaseDelayMs: fetchRetryBaseDelayMs,
      });
      if (!candle) {
        nullPriceIncidents += 1;
        rejectedCount += 1;
        await recordSymbolSkip(input.repository, input.config, {
          cycleId,
          symbol,
          reason: "NO_LIVE_DATA",
          details: {
            retry_attempts: fetchRetryAttempts,
          },
        });
        results.push({
          symbol,
          risk_status: "no_live_data",
          entry_style: input.config.primaryEntryStyle,
          skip_reason: "NO_LIVE_DATA",
          executed: false,
        });
        await persistTraderRuntimeState({
          ...input,
          cycleId,
          symbol,
          snapshot: null,
          candidate: null,
          riskDecision: null,
          lifecycle: null,
          unavailableReason: "NO_LIVE_DATA",
        });
        if (shouldTripNullPriceCircuitBreaker({
          attemptedCount: attemptedSymbols,
          nullPriceCount: nullPriceIncidents,
          threshold: nullPriceCircuitBreakerThreshold,
          minimumAttempts: nullPriceCircuitBreakerMinAttempts,
        })) {
          throw new Error(`FX_NULL_PRICE_CIRCUIT_BREAKER:${nullPriceIncidents}/${attemptedSymbols}`);
        }
        continue;
      }

      const currentState = input.featureEngine.getLatestState(symbol);
      if ((currentState?.prices.length ?? 0) < 20) {
        for (const historicalEvent of input.repository.getMarketEvents(symbol).slice(-64)) {
          input.featureEngine.consume(historicalEvent);
        }
      } else {
        input.featureEngine.consume(candle);
      }
      const snapshot = input.featureEngine.buildSnapshot(symbol, "15m");
      if (!snapshot) {
        nullPriceIncidents += 1;
        rejectedCount += 1;
        await recordSymbolSkip(input.repository, input.config, {
          cycleId,
          symbol,
          reason: "SNAPSHOT_UNAVAILABLE",
        });
        results.push({
          symbol,
          risk_status: "snapshot_unavailable",
          entry_style: input.config.primaryEntryStyle,
          skip_reason: "SNAPSHOT_UNAVAILABLE",
          executed: false,
        });
        await persistTraderRuntimeState({
          ...input,
          cycleId,
          symbol,
          snapshot: null,
          candidate: null,
          riskDecision: null,
          lifecycle: null,
          unavailableReason: "SNAPSHOT_UNAVAILABLE",
        });
        if (shouldTripNullPriceCircuitBreaker({
          attemptedCount: attemptedSymbols,
          nullPriceCount: nullPriceIncidents,
          threshold: nullPriceCircuitBreakerThreshold,
          minimumAttempts: nullPriceCircuitBreakerMinAttempts,
        })) {
          throw new Error(`FX_NULL_PRICE_CIRCUIT_BREAKER:${nullPriceIncidents}/${attemptedSymbols}`);
        }
        continue;
      }

      const snapshotMid = snapshot.features.mid;
      if (!Number.isFinite(snapshotMid) || snapshotMid <= 0) {
        nullPriceIncidents += 1;
        rejectedCount += 1;
        await recordSymbolSkip(input.repository, input.config, {
          cycleId,
          symbol,
          reason: "SNAPSHOT_PRICE_UNAVAILABLE",
        });
        results.push({
          symbol,
          risk_status: "snapshot_price_unavailable",
          entry_style: input.config.primaryEntryStyle,
          skip_reason: "SNAPSHOT_PRICE_UNAVAILABLE",
          executed: false,
        });
        await persistTraderRuntimeState({
          ...input,
          cycleId,
          symbol,
          snapshot,
          candidate: null,
          riskDecision: null,
          lifecycle: null,
          unavailableReason: "SNAPSHOT_PRICE_UNAVAILABLE",
        });
        if (shouldTripNullPriceCircuitBreaker({
          attemptedCount: attemptedSymbols,
          nullPriceCount: nullPriceIncidents,
          threshold: nullPriceCircuitBreakerThreshold,
          minimumAttempts: nullPriceCircuitBreakerMinAttempts,
        })) {
          throw new Error(`FX_NULL_PRICE_CIRCUIT_BREAKER:${nullPriceIncidents}/${attemptedSymbols}`);
        }
        continue;
      }

      const canonicalMarketSnapshot = toMarketSnapshot({
        cycle_id: cycleId,
        snapshot,
        market_data: typeof input.dataPlant.getLatestFetchDiagnostics === "function"
          ? input.dataPlant.getLatestFetchDiagnostics(symbol)
          : null,
      });
      const marketDataDiagnostics = typeof input.dataPlant.getLatestFetchDiagnostics === "function"
        ? input.dataPlant.getLatestFetchDiagnostics(symbol)
        : null;
      fxFallbackContexts.set(symbol, {
        symbol,
        snapshot,
        canonicalMarketSnapshot,
      });
      fxCandleCounts.set(symbol, {
        candlesFetched: marketDataDiagnostics?.candlesFetched ?? 0,
        provider: marketDataDiagnostics?.provider ?? null,
        sourceMode: marketDataDiagnostics?.sourceMode ?? null,
        usedFallback: marketDataDiagnostics?.usedFallback ?? false,
      });
      fxSmcScores.set(symbol, resolveFxSmcScore(snapshot));
      console.log(
        `[FX CYCLE] ${symbol}: candles=${marketDataDiagnostics?.candlesFetched ?? 0} provider=${marketDataDiagnostics?.provider ?? "unknown"} source=${marketDataDiagnostics?.sourceMode ?? "unknown"} fallback=${marketDataDiagnostics?.usedFallback === true}`,
      );
      console.log(`[FX CYCLE] ${symbol}: smcScore=${fxSmcScores.get(symbol) ?? "n/a"}`);
      marketSnapshots.push(canonicalMarketSnapshot);
      await input.repository.appendCanonicalMarketSnapshot(canonicalMarketSnapshot);

      const bars = toCandlePathBars(input.featureEngine, symbol);
      if (typeof input.execution.advanceSignalLifecycles === "function") {
        const lifecycleUpdates = await input.execution.advanceSignalLifecycles(symbol, bars.slice(-1));
        for (const lifecycleUpdate of lifecycleUpdates) {
          const canonicalSignal = input.repository.getLatestExecutableSignalByCandidateId(lifecycleUpdate.signal_id);
          await input.repository.appendCanonicalSignalLifecycle(
            toCanonicalSignalLifecycle(
              lifecycleUpdate,
              canonicalSignal?.signal_id ?? lifecycleUpdate.signal_id,
            ),
          );
        }
      }

      const podOutputs = await Promise.all(scopedPods.map(async pod => {
        const output = await pod.evaluate(snapshot);
        await input.repository.appendPodOutput(output);
        return output;
      }));

      const candidate = input.allocator.allocate(symbol, snapshot, podOutputs);
      await input.repository.appendAllocationIntent(candidate);
      const typedPodVotes = podOutputs.map(output => identityAdapter({
        ...(output as PodEvaluation & PodVote),
        weight: candidate.pod_weights[output.pod_id] ?? (output as PodEvaluation & PodVote).weight,
      }));
      const aggregatedPodDecision = aggregatePodVotes(typedPodVotes);
      logger.info({
        module: "engine",
        message: "Pod aggregation completed",
        cycle_id: cycleId,
        symbol,
        candidate_id: candidate.candidate_id,
        direction: aggregatedPodDecision.direction,
        candidate_direction_count: 1,
        long_score: aggregatedPodDecision.directional_support.long_score,
        short_score: aggregatedPodDecision.directional_support.short_score,
        neutral_score: aggregatedPodDecision.directional_support.neutral_score,
      });
      if (candidate.direction === "none") {
        logger.info({
          module: "engine",
          message: "Candidate remained non-directional",
          cycle_id: cycleId,
          symbol,
          candidate_id: candidate.candidate_id,
          candidate_none_reason_count: 1,
          veto_reasons: candidate.veto_reasons,
          veto_contributors: aggregatedPodDecision.attribution.veto_contributors,
        });
      }
      fxCandidateDiagnostics.push({
        symbol,
        direction: candidate.direction,
        confidence: candidate.confidence,
        vetoReasons: [...candidate.veto_reasons],
      });
      console.log(
        `[FX CYCLE] ${symbol}: candidate=${candidate.direction} confidence=${Math.round(candidate.confidence * 100)} vetoes=${candidate.veto_reasons.join(",") || "none"}`,
      );
      const canonicalTradeCandidate = toTradeCandidate({
        cycle_id: cycleId,
        snapshot: canonicalMarketSnapshot,
        candidate,
        pod_outputs: podOutputs,
        pod_votes: typedPodVotes,
        aggregated_pod_decision: aggregatedPodDecision,
      });
      tradeCandidates.push(canonicalTradeCandidate);
      await input.repository.appendTradeCandidate(canonicalTradeCandidate);

      const price = snapshot.features.mid ?? candle.close ?? 0;
      const riskEvaluation = await input.riskEngine.evaluate({
        cycle_id: cycleId,
        candidate,
        snapshot,
        price,
        repository: input.repository,
        config: input.config,
        legacy_governor: input.riskGovernor,
        aggregated_pod_decision: aggregatedPodDecision,
      });
      const normalizedRisk = normalizeRiskEvaluationResult(riskEvaluation, candidate);
      const riskDecision = normalizedRisk.riskDecision;
      fxRiskDiagnostics.push({
        symbol,
        approvalStatus: riskDecision.approval_status,
        vetoReasons: [...riskDecision.veto_reasons],
      });
      console.log(
        `[FX CYCLE] ${symbol}: risk=${riskDecision.approval_status} vetoes=${riskDecision.veto_reasons.join(",") || "none"}`,
      );
      await input.repository.appendRiskDecision(symbol, riskDecision);
      const canonicalRiskEvaluation = toRiskEvaluatedCandidate({
        cycle_id: cycleId,
        snapshot: canonicalMarketSnapshot,
        candidate,
        risk_decision: riskDecision,
        risk_evaluation: normalizedRisk.riskEvaluation,
      });
      riskEvaluatedCandidates.push(canonicalRiskEvaluation);
      await input.repository.appendRiskEvaluatedCandidate(canonicalRiskEvaluation);

      if (riskDecision.approval_status === "rejected" || candidate.direction === "none") {
        rejectedCount += 1;
        await appendJournalEntry(input.auditJournal, {
          signalId: candidate.candidate_id,
          snapshotId: snapshot.snapshot_id,
          symbol,
          session: candidate.session,
          regime: candidate.regime,
          entryStyle: candidate.entry_style,
          direction: candidate.direction,
          confidence: candidate.confidence,
          entry: candidate.entry,
          sl: candidate.sl,
          tp1: candidate.tp1,
          tp2: candidate.tp2,
          tp3: candidate.tp3,
          podOutputs,
          allocationRef: `${symbol}:${candidate.ts}`,
          riskDecisionRef: `${symbol}:${riskDecision.ts}`,
          executionIntentRef: "none",
          finalAction: input.repository.isKillSwitchActive() ? "halted" : "rejected",
          vetoReasons: riskDecision.veto_reasons,
          reasoning: candidate.reasoning,
        });
        results.push({
          symbol,
          snapshot_id: snapshot.snapshot_id,
          direction: candidate.direction,
          confidence: candidate.confidence,
          risk_status: riskDecision.approval_status,
          entry_style: candidate.entry_style,
          executed: false,
        });
        const traderRuntimeState = await persistTraderRuntimeState({
          ...input,
          cycleId,
          symbol,
          snapshot,
          candidate,
          riskDecision,
          lifecycle: null,
        });
        const signalViewModel = buildViewModel({
          state: traderRuntimeState,
          snapshot: canonicalMarketSnapshot,
          candidate: canonicalTradeCandidate,
          risk: canonicalRiskEvaluation,
          signal: null,
          lifecycle: null,
        });
        if (signalViewModel) {
          await appendSignalViewModelAndNotify(symbol, signalViewModel);
        }
        continue;
      }

      const advisory = podOutputs.find((output): output is GatingPodOutput =>
        output.pod_id === "execution-advisory" && output.pod_category === "gating",
      );
      const executionIntent = input.execution.buildExecutionIntent({
        candidate,
        advisory,
      });

      if (!executionIntent) {
        rejectedCount += 1;
        await appendJournalEntry(input.auditJournal, {
          signalId: candidate.candidate_id,
          snapshotId: snapshot.snapshot_id,
          symbol,
          session: candidate.session,
          regime: candidate.regime,
          entryStyle: candidate.entry_style,
          direction: candidate.direction,
          confidence: candidate.confidence,
          entry: candidate.entry,
          sl: candidate.sl,
          tp1: candidate.tp1,
          tp2: candidate.tp2,
          tp3: candidate.tp3,
          podOutputs,
          allocationRef: `${symbol}:${candidate.ts}`,
          riskDecisionRef: `${symbol}:${riskDecision.ts}`,
          executionIntentRef: "none",
          finalAction: "deferred",
          vetoReasons: [...candidate.veto_reasons, ...riskDecision.veto_reasons],
          reasoning: candidate.reasoning,
        });
        results.push({
          symbol,
          snapshot_id: snapshot.snapshot_id,
          direction: candidate.direction,
          confidence: candidate.confidence,
          risk_status: "execution_intent_unavailable",
          entry_style: candidate.entry_style,
          executed: false,
        });
        const traderRuntimeState = await persistTraderRuntimeState({
          ...input,
          cycleId,
          symbol,
          snapshot,
          candidate,
          riskDecision,
          lifecycle: null,
          unavailableReason: "execution_intent_unavailable",
        });
        const signalViewModel = buildViewModel({
          state: traderRuntimeState,
          snapshot: canonicalMarketSnapshot,
          candidate: canonicalTradeCandidate,
          risk: canonicalRiskEvaluation,
          signal: null,
          lifecycle: null,
        });
        if (signalViewModel) {
          await appendSignalViewModelAndNotify(symbol, signalViewModel);
        }
        continue;
      }

      const executionReport = await input.execution.execute(executionIntent, bars.slice(-1));
      const executableSignal = toExecutableSignal({
        cycle_id: cycleId,
        snapshot: canonicalMarketSnapshot,
        candidate,
        risk_evaluated_candidate: canonicalRiskEvaluation,
        lifecycle: executionReport.lifecycle,
      });
      if (executableSignal) {
        executableSignals.push(executableSignal);
        await input.repository.appendExecutableSignal(executableSignal);
      }
      await input.repository.appendCanonicalSignalLifecycle(
        toCanonicalSignalLifecycle(
          executionReport.lifecycle,
          executableSignal?.signal_id ?? executionReport.lifecycle.signal_id,
        ),
      );
      approvedCount += 1;
      fills += executionReport.rejected ? 0 : executionReport.child_orders.length;
      summaryRows.push({
        symbol,
        action: candidate.direction,
        confidence: candidate.confidence,
        pods: candidate.selected_pods,
      });

      await appendJournalEntry(input.auditJournal, {
        signalId: candidate.candidate_id,
        snapshotId: snapshot.snapshot_id,
        symbol,
        session: candidate.session,
        regime: candidate.regime,
        entryStyle: candidate.entry_style,
        direction: candidate.direction,
        confidence: candidate.confidence,
        entry: candidate.entry,
        sl: candidate.sl,
        tp1: candidate.tp1,
        tp2: candidate.tp2,
        tp3: candidate.tp3,
        podOutputs,
        allocationRef: `${symbol}:${candidate.ts}`,
        riskDecisionRef: `${symbol}:${riskDecision.ts}`,
        executionIntentRef: executionIntent.intent_id,
        finalAction: executionReport.rejected ? "deferred" : "executed",
        vetoReasons: riskDecision.veto_reasons,
        reasoning: candidate.reasoning,
        lifecycleState: executionReport.lifecycle.state,
        outcome: executionReport.lifecycle.outcome,
        maxFavorableExcursion: executionReport.lifecycle.max_favorable_excursion,
        maxAdverseExcursion: executionReport.lifecycle.max_adverse_excursion,
        timeToTp1: executionReport.lifecycle.time_to_tp1_ms,
        timeToSl: executionReport.lifecycle.time_to_sl_ms,
      });

      const traderRuntimeState = await persistTraderRuntimeState({
        ...input,
        cycleId,
        symbol,
        snapshot,
        candidate,
        riskDecision,
        lifecycle: executionReport.lifecycle,
      });
      const signalViewModel = buildViewModel({
        state: traderRuntimeState,
        snapshot: canonicalMarketSnapshot,
        candidate: canonicalTradeCandidate,
        risk: canonicalRiskEvaluation,
        signal: executableSignal,
        lifecycle: executableSignal
          ? toCanonicalSignalLifecycle(executionReport.lifecycle, executableSignal.signal_id)
          : null,
      });
      if (signalViewModel) {
        await appendSignalViewModelAndNotify(symbol, signalViewModel);
      }

      results.push({
        symbol,
        snapshot_id: snapshot.snapshot_id,
        direction: candidate.direction,
        confidence: candidate.confidence,
        lifecycle_state: executionReport.lifecycle.state,
        risk_status: riskDecision.approval_status,
        entry_style: candidate.entry_style,
        executed: !executionReport.rejected,
      });
    }

    console.log("[FX CYCLE] Candles fetched per pair:", Object.fromEntries(fxCandleCounts));
    console.log("[FX CYCLE] SMC scores per pair:", Object.fromEntries(fxSmcScores));
    console.log("[FX CYCLE] Candidates generated:", fxCandidateDiagnostics.length, fxCandidateDiagnostics);
    console.log(
      "[FX CYCLE] After risk filter:",
      fxRiskDiagnostics.filter(diagnostic => diagnostic.approvalStatus !== "rejected").length,
      fxRiskDiagnostics,
    );
    console.log("[FX CYCLE] Executable signals:", executableSignals.length);

    if (executableSignals.length === 0) {
      console.log("[FX CYCLE] SMC produced no executable signals, running MTF fallback...");

      for (const context of fxFallbackContexts.values()) {
        const snapshotLivePrice = typeof context.snapshot.features.mid === "number"
          ? context.snapshot.features.mid
          : typeof context.canonicalMarketSnapshot.features.mid === "number"
            ? context.canonicalMarketSnapshot.features.mid
            : null;
        const fallbackSignal = await buildFxMtfFallbackSignal({
          symbol: context.symbol,
          livePrice: snapshotLivePrice,
        });
        if (!fallbackSignal) {
          continue;
        }

        const fallbackCandidate = buildFxFallbackCandidate({
          symbol: context.symbol,
          snapshot: context.snapshot,
          fallback: fallbackSignal,
        });
        const fallbackRiskDecision = buildFxFallbackRiskDecision(fallbackCandidate);
        const fallbackTradeCandidate = toTradeCandidate({
          cycle_id: cycleId,
          snapshot: context.canonicalMarketSnapshot,
          candidate: fallbackCandidate,
          pod_outputs: [],
        });
        const fallbackRiskEvaluation = toRiskEvaluatedCandidate({
          cycle_id: cycleId,
          snapshot: context.canonicalMarketSnapshot,
          candidate: fallbackCandidate,
          risk_decision: fallbackRiskDecision,
        });
        const fallbackState = applyFxFallbackToRuntimeState({
          state: buildTraderPairRuntimeState({
            symbol: context.symbol,
            cycleId,
            generatedAt: Date.now(),
            snapshot: context.snapshot,
            candidate: fallbackCandidate,
            riskDecision: fallbackRiskDecision,
            lifecycle: null,
            marketData: typeof input.dataPlant.getLatestFetchDiagnostics === "function"
              ? input.dataPlant.getLatestFetchDiagnostics(context.symbol)
              : null,
            config: {
              pairProfiles: input.config.pairProfiles,
            },
          }),
          fallback: fallbackSignal,
        });
        if (!input.executionOptions?.smokeMode) {
          await enrichTraderPairRuntimeState({
            state: fallbackState,
            snapshot: context.snapshot,
            candidate: fallbackCandidate,
            riskDecision: fallbackRiskDecision,
          });
        }
        await input.repository.upsertTraderPairRuntimeState(fallbackState);
        if (fallbackState.card) {
          await logSignalEmission(fallbackState.card, cycleId);
        }

        const fallbackViewModel = buildViewModel({
          state: fallbackState,
          snapshot: context.canonicalMarketSnapshot,
          candidate: fallbackTradeCandidate,
          risk: fallbackRiskEvaluation,
          signal: null,
          lifecycle: null,
        });
        if (!fallbackViewModel) {
          continue;
        }

        const fallbackViewModelWithMtf = {
          ...fallbackViewModel,
          ui_sections: {
            ...fallbackViewModel.ui_sections,
            mtf: fallbackSignal.analysis,
            topDown: {
              entryTimeframe: fallbackSignal.analysis.entryTimeframe ?? fallbackSignal.analysis.timeframe,
              tp1RiskReward: fallbackSignal.analysis.riskReward,
              tp2RiskReward: fallbackSignal.analysis.riskReward2 ?? null,
              htfBiasSummary: fallbackSignal.analysis.htfBiasSummary ?? null,
              liquiditySweepDescription: fallbackSignal.analysis.liquiditySweepDescription ?? null,
              confluenceScore: fallbackSignal.analysis.confluenceScore ?? fallbackSignal.analysis.confidence,
              autoAlert: fallbackSignal.analysis.grade === "S" || fallbackSignal.analysis.grade === "A",
            },
          },
        };

        await appendSignalViewModelAndNotify(context.symbol, fallbackViewModelWithMtf);
        summaryRows.push({
          symbol: context.symbol,
          action: fallbackCandidate.direction,
          confidence: fallbackCandidate.confidence,
          pods: fallbackCandidate.selected_pods,
        });
        const existingResult = results.find(result => result.symbol === context.symbol);
        if (existingResult) {
          existingResult.direction = fallbackCandidate.direction;
          existingResult.confidence = fallbackCandidate.confidence;
          existingResult.risk_status = "fallback_approved";
          existingResult.entry_style = fallbackCandidate.entry_style;
          existingResult.executed = false;
        } else {
          results.push({
            symbol: context.symbol,
            snapshot_id: context.snapshot.snapshot_id,
            direction: fallbackCandidate.direction,
            confidence: fallbackCandidate.confidence,
            risk_status: "fallback_approved",
            entry_style: fallbackCandidate.entry_style,
            executed: false,
          });
        }
        fxFallbackGenerated += 1;
        approvedCount += 1;
        console.log(`[FX MTF] ${context.symbol}: ${fallbackSignal.grade} ${fallbackSignal.direction} written`);
      }
    }

    console.log("[FX CYCLE] SignalViewModel writes:", signalViewModels.length);

    input.repository.setLastCycleTs(timestamp);

    void input.driftMonitor.run().catch(error => {
      logger.warn({
        module: "engine",
        message: "Drift monitor failed without impacting fast path",
        error: String(error),
      });
    });

    logger.info({
      module: "engine",
      message: "Cycle complete",
      cycle_id: cycleId,
      symbol_count: results.length,
      approved_count: approvedCount,
      rejected_count: rejectedCount,
    });

    await persistCanonicalCycleOutput(input.repository, buildCycleOutput({
      cycle_id: cycleId,
      started_at: timestamp,
      completed_at: Date.now(),
      symbols_processed: results.map(result => result.symbol),
      snapshots: marketSnapshots,
      candidates: tradeCandidates,
      risk_results: riskEvaluatedCandidates,
      signals: executableSignals,
      view_models: signalViewModels,
      metadata: {
        summary_rows: summaryRows,
        results,
        attempted_symbols: attemptedSymbols,
        null_price_incidents: nullPriceIncidents,
        fx_fallback_generated: fxFallbackGenerated,
        smoke_mode: input.executionOptions?.smokeMode ?? false,
      },
      pipeline_status: "completed",
    }));

    return {
      cycle_id: cycleId,
      timestamp,
      symbols: results,
    };
  } catch (error) {
    summaryStatus = "failed";
    failureReason = String(error);
    logger.error({
      module: "engine",
      message: "Cycle failed",
      cycle_id: cycleId,
      error: failureReason,
    });
    await input.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "engine",
      type: "cycle_failed",
      reason: failureReason,
      payload: {
        cycle_id: cycleId,
        active_symbols: input.config.activeSymbols,
        primary_entry_style: input.config.primaryEntryStyle,
      },
    });
    await persistCanonicalCycleOutput(input.repository, buildCycleOutput({
      cycle_id: cycleId,
      started_at: timestamp,
      completed_at: Date.now(),
      symbols_processed: results.map(result => result.symbol),
      snapshots: marketSnapshots,
      candidates: tradeCandidates,
      risk_results: riskEvaluatedCandidates,
      signals: executableSignals,
      view_models: signalViewModels,
      metadata: {
        summary_rows: summaryRows,
        results,
        failure_reason: failureReason,
        attempted_symbols: attemptedSymbols,
        null_price_incidents: nullPriceIncidents,
        fx_fallback_generated: fxFallbackGenerated,
      },
      pipeline_status: "failed",
    }));
    throw error;
  } finally {
    const health = input.repository.getExecutionHealth();
    const avgSlippage = health.length === 0
      ? 0
      : health.reduce((sum, metric) => sum + metric.avg_slippage_bps, 0) / health.length;
    const intervalMinutes = input.config.cycleIntervalMinutes;
    const completedAt = Date.now();
    await writeSchedulerHeartbeat({
      mode: "manual",
      lastRunAt: completedAt,
      lastWorkCompletedAt: completedAt,
      nextRunAt: null,
      intervalMinutes,
      lastSource: "cycle_complete",
    });

    const cycleSummaryDelivered = await input.notifier.sendCycleSummary({
      cycleId,
      timestamp: new Date(timestamp).toISOString(),
      mode: input.repository.getRecoveryMode(),
      status: summaryStatus,
      rows: summaryRows.slice(0, 30),
      approvedCount,
      rejectedCount,
      drawdownPct: input.repository.getRiskState().current_drawdown_pct,
      fills,
      avgSlippageBps: avgSlippage,
      failureReason,
    });
    if (cycleSummaryDelivered) {
      logger.info({
        module: "engine",
        message: "Telegram cycle summary delivered",
        cycle_id: cycleId,
        status: summaryStatus,
      });
    } else if (input.notifier.isConfigured()) {
      logger.warn({
        module: "engine",
        message: "Telegram cycle summary delivery failed",
        cycle_id: cycleId,
        status: summaryStatus,
      });
    } else {
      logger.warn({
        module: "engine",
        message: "Telegram cycle summary skipped because notifier is not configured",
        cycle_id: cycleId,
        status: summaryStatus,
      });
    }
  }
}

export async function queueFocusedRuntimeCycle(
  runtime: FocusedRuntimeCycleHost | null | undefined,
  source = "manual",
  options?: ApexCycleExecutionOptions,
): Promise<QueuedFocusedRuntimeCycleResult> {
  const resolvedRuntime = await resolveFocusedRuntimeCycleHost(runtime);
  const runInline = (resolvedRuntime.engine as { runCycle?: FocusedRuntimeCycleHost["engine"]["runCycle"] }).runCycle;
  if (typeof runInline !== "function") {
    return resolvedRuntime.engine.queueCycle(source, options);
  }

  logger.info({
    module: "engine",
    message: "Running focused cycle inline",
    source,
    reason: "manual_only_runtime",
  });
  return {
    queued: false,
    result: await resolvedRuntime.engine.runCycle(options),
  };
}

export async function runFocusedRuntimeCycle(
  runtime: FocusedRuntimeCycleHost | null | undefined,
  options?: ApexCycleExecutionOptions,
): Promise<ImmediateFocusedRuntimeCycleResult> {
  const resolvedRuntime = await resolveFocusedRuntimeCycleHost(runtime);
  return resolvedRuntime.engine.runCycle(options);
}

async function resolveFocusedRuntimeCycleHost(
  runtime?: FocusedRuntimeCycleHost | null,
): Promise<FocusedRuntimeCycleHost> {
  if (runtime?.engine) {
    return runtime;
  }

  const { ensureApexRuntime } = await import("@/src/application/cycle/buildRuntime");
  return ensureApexRuntime();
}

export async function runCycle(trigger = "api"): Promise<void> {
  const runtime = await resolveFocusedRuntimeCycleHost();
  logger.info({
    module: "engine",
    message: "runCycle invoked inline",
    source: trigger,
  });
  await runtime.engine.runCycle();
}
