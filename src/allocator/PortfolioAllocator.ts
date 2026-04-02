import { evaluateSymbolScope, getPairTradingProfile } from "@/src/config/marketScope";
import type { ApexConfig } from "@/src/lib/config";
import { createId } from "@/src/lib/ids";
import type { ApexRepository } from "@/src/lib/repository";
import { deriveTradePlan } from "@/src/lib/tradePlan";
import {
  clamp01,
  clampSignedUnit,
  type AllocationIntent,
  type FeatureSnapshot,
  type GatingPodOutput,
  type NoTradeReasonCode,
  type PodEvaluation,
  type SignalDirection,
  type SignalRegime,
} from "@/src/interfaces/contracts";

function directionalScore(direction: SignalDirection): number {
  if (direction === "buy") return 1;
  if (direction === "sell") return -1;
  return 0;
}

const DIRECTIONAL_CONSENSUS_BAND = 0.03;

function classifyRegime(snapshot: FeatureSnapshot, gating: GatingPodOutput[]): SignalRegime {
  const volatilityRegime = gating.find(output => output.pod_id === "volatility-regime")?.state_assessment ?? "normal";
  if (volatilityRegime === "low_vol_trending") return "trend";
  if (volatilityRegime === "compressing") return "compression";
  if (volatilityRegime === "high_vol_chaotic") return "chaotic";
  if (snapshot.context.session_features?.sessionBreakoutState && snapshot.context.session_features.sessionBreakoutState !== "none") {
    return "breakout";
  }
  if (snapshot.context.market_structure?.structureBias === "neutral") {
    return "range";
  }
  return "normal";
}

type LegacyPodLike = Partial<PodEvaluation> & {
  pod_id: string;
  ts: number;
  symbol_canonical: string;
  decision_horizon: string;
  signal_type: PodEvaluation["signal_type"];
  confidence: number;
  model_version: string;
  recommended_action?: PodEvaluation["recommended_action"];
  state_assessment?: string;
  constraints?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
};

function inferEntryStyle(podId: string): PodEvaluation["entry_style"] {
  if (podId === "trend") return "trend_pullback";
  if (podId === "breakout") return "session_breakout";
  if (podId === "mean-reversion") return "range_reversal";
  return "support";
}

function buildFallbackSnapshot(symbol: string): FeatureSnapshot {
  return {
    snapshot_id: createId("snap"),
    ts: Date.now(),
    symbol_canonical: symbol,
    horizon: "15m",
    features: {
      mid: 1.1,
      ema_9: 1.1,
      ema_21: 1.095,
      atr_14: 0.004,
      volatility_regime: 1,
    },
    quality: {
      staleness_ms: 0,
      completeness: 1,
      confidence: 1,
    },
    context: {
      timeframe: "15m",
      source: "compat",
      quality_flag: "clean",
      session: {
        session: "london",
        tradingDay: "1970-01-01",
        hourBucket: 8,
        minutesSinceSessionOpen: 60,
      },
      economic_event: {
        majorNewsFlag: false,
        minutesToNextHighImpactEvent: null,
        minutesSinceLastHighImpactEvent: null,
        eventType: null,
      },
    },
  };
}

function normalizePodOutput(output: PodEvaluation | LegacyPodLike): PodEvaluation {
  if ("pod_category" in output && output.pod_category) {
    return output as PodEvaluation;
  }

  const recommendedAction = output.recommended_action ?? "hold";
  if (output.pod_id === "volatility-regime" || output.pod_id === "execution-advisory") {
    return {
      ...output,
      pod_category: "gating",
      entry_style: "support",
      rationale: [],
      gate_status: "allow",
      veto_reasons: [],
    } as GatingPodOutput;
  }

  const direction: SignalDirection = recommendedAction === "long"
    ? "buy"
    : recommendedAction === "short"
      ? "sell"
      : "none";
  return {
    ...output,
    pod_category: "directional",
    entry_style: inferEntryStyle(output.pod_id),
    rationale: [],
    direction,
    score: output.confidence,
    regime: "normal",
    regime_alignment: output.confidence,
    tradeability_alignment: output.confidence,
    entry_zone: null,
    invalidation_zone: null,
    recommended_action: recommendedAction,
  } as PodEvaluation;
}

export class PortfolioAllocator {
  constructor(
    private readonly repository: ApexRepository,
    private readonly config: ApexConfig,
  ) {}

  allocate(symbol: string, snapshotOrOutputs: FeatureSnapshot | PodEvaluation[], maybeOutputs?: PodEvaluation[]): AllocationIntent {
    const compatMode = Array.isArray(snapshotOrOutputs);
    const snapshot = compatMode ? buildFallbackSnapshot(symbol) : snapshotOrOutputs;
    const outputs = (compatMode ? snapshotOrOutputs : (maybeOutputs ?? [])).map(normalizePodOutput);
    const activePositions = this.repository.getPositions();
    const activeSymbolCount = Object.values(activePositions).filter(position => position !== 0).length;
    const grossExposure = Object.values(activePositions).reduce((sum, position) => sum + Math.abs(position), 0);
    const netExposure = Object.values(activePositions).reduce((sum, position) => sum + position, 0);
    const pairProfile = getPairTradingProfile(symbol, this.config.marketScope);
    const baseReasoning = [
      pairProfile ? "Pair profile filters are configured for this symbol." : "Default pair profile filters are in use.",
    ];
    const baseReasonCodes = [
      `primary_entry_style:${this.config.primaryEntryStyle}`,
      pairProfile ? "pair_profile:configured" : "pair_profile:default",
    ];
    const enabledEntryStyles = new Set(this.config.enabledEntryStyles);
    const symbolScope = evaluateSymbolScope(symbol, this.config.activeSymbols, this.config.marketScope);
    const directionalOutputs = outputs.filter((output): output is Extract<PodEvaluation, { pod_category: "directional" }> => output.pod_category === "directional");
    const gatingOutputs = outputs.filter((output): output is GatingPodOutput => output.pod_category === "gating");
    const regime = classifyRegime(snapshot, gatingOutputs);
    const vetoReasons: NoTradeReasonCode[] = [];
    const weights: Record<string, number> = {};

    if (!symbolScope.allowed) {
      vetoReasons.push(symbolScope.reason!);
    }

    const directionalInputs = directionalOutputs.filter(output =>
      output.entry_style !== "support" && enabledEntryStyles.has(output.entry_style),
    );
    const disabledStyleOutputs = directionalOutputs.filter(output =>
      output.entry_style !== "support" && !enabledEntryStyles.has(output.entry_style),
    );
    if (disabledStyleOutputs.length > 0) {
      for (const output of disabledStyleOutputs) {
        weights[output.pod_id] = 0;
      }
    }

    const directionalVotes = directionalInputs.map(output => {
      let weight = output.confidence;
      if (output.entry_style === this.config.primaryEntryStyle) {
        weight *= 1.25;
      }
      if (regime === "trend" && output.entry_style === "trend_pullback") {
        weight *= 1.25;
      }
      if (regime === "range" && output.entry_style === "range_reversal") {
        weight *= 1.2;
      }
      if (regime === "breakout" && output.entry_style === "session_breakout") {
        weight *= 1.25;
      }
      if (regime === "chaotic") {
        weight *= 0.4;
      }
      if (this.repository.getRecoveryMode() === "reduced_confidence") {
        weight *= 0.5;
      }
      weight *= this.repository.getConfidenceMultiplier(output.pod_id);
      weights[output.pod_id] = weight;
      return {
        pod_id: output.pod_id,
        pod_category: output.pod_category,
        direction: output.direction,
        confidence: output.confidence,
        weight,
        score: output.score,
        rationale: output.rationale,
      };
    });

    const gatingVotes = gatingOutputs.map(output => ({
      pod_id: output.pod_id,
      pod_category: output.pod_category,
      direction: output.advisory_direction ?? "none",
      confidence: output.confidence,
      weight: output.confidence,
      gate_status: output.gate_status,
      veto_reasons: output.veto_reasons,
      rationale: output.rationale,
    }));

    for (const output of gatingOutputs) {
      if (output.gate_status === "block" || output.gate_status === "warn") {
        vetoReasons.push(...output.veto_reasons);
      }
    }

    const weightedDirectionalSum = directionalVotes.reduce((sum, output) => sum + directionalScore(output.direction) * output.weight, 0);
    const directionalWeightSum = directionalVotes.reduce((sum, output) => sum + output.weight, 0);
    let direction: SignalDirection = weightedDirectionalSum > DIRECTIONAL_CONSENSUS_BAND
      ? "buy"
      : weightedDirectionalSum < -DIRECTIONAL_CONSENSUS_BAND
        ? "sell"
        : "none";

    if (direction === "none") {
      vetoReasons.push("NO_DIRECTIONAL_CONSENSUS");
    }

    const topDirectional = [...directionalInputs]
      .filter(output => output.direction === direction)
      .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
    const chosenEntryStyle = topDirectional?.entry_style ?? this.config.primaryEntryStyle;
    const tradePlan = direction === "none"
      ? null
      : deriveTradePlan({
        snapshot,
        direction,
        entryZone: topDirectional?.entry_zone ?? null,
        invalidationZone: topDirectional?.invalidation_zone ?? null,
      });

    if (!tradePlan) {
      direction = "none";
      vetoReasons.push("NO_TRADEABILITY_EDGE");
    }

    const rr = tradePlan?.risk_reward_ratio ?? 0;
    if (!compatMode && pairProfile && direction !== "none") {
      if (directionalWeightSum / Math.max(directionalVotes.length, 1) < pairProfile.minConfidence) {
        vetoReasons.push("PAIR_CONFIDENCE_BELOW_MIN");
      }
      if (rr < pairProfile.minRiskReward) {
        vetoReasons.push("PAIR_RR_BELOW_MIN");
      }
      if (!pairProfile.allowedSessions.includes(snapshot.context.session.session as typeof pairProfile.allowedSessions[number])) {
        vetoReasons.push("PAIR_SESSION_NOT_ALLOWED");
      }
    }

    const rawConfidence = directionalWeightSum === 0
      ? 0
      : directionalVotes
        .filter(output => output.direction === direction)
        .reduce((sum, output) => sum + output.confidence * output.weight, 0) / directionalWeightSum;
    const confidence = direction === "none"
      ? 0
      : clamp01(rawConfidence * (tradePlan?.risk_reward_ratio != null ? Math.min(1.15, tradePlan.risk_reward_ratio / 1.8) : 0.9));
    const noTrade = direction === "none" || vetoReasons.some(reason => [
      "SYMBOL_NOT_ACTIVE",
      "SYMBOL_NOT_SUPPORTED",
      "ENTRY_STYLE_DISABLED",
      "VOL_TOO_HIGH",
      "OFF_SESSION",
      "NEWS_WINDOW",
      "PAIR_CONFIDENCE_BELOW_MIN",
      "PAIR_RR_BELOW_MIN",
      "PAIR_SESSION_NOT_ALLOWED",
      "NO_DIRECTIONAL_CONSENSUS",
      "NO_TRADEABILITY_EDGE",
    ].includes(reason));

    const maxSymbolPosition = Math.min(this.config.maxSymbolPosition, 0.2);
    const volatilityScale = this.repository.getRiskState().portfolio_vol_estimate > this.config.volatilityTarget ? 0.5 : 1;
    const reducedSizeScale = this.repository.getRecoveryMode() === "reduced_size" ? 0.5 : 1;
    const rawTarget = noTrade
      ? 0
      : (direction === "buy" ? 1 : -1) * confidence;
    const target = clampSignedUnit(rawTarget * maxSymbolPosition * volatilityScale * reducedSizeScale);

    return {
      candidate_id: createId("sig"),
      ts: Date.now(),
      symbol_canonical: symbol,
      timeframe: snapshot.context.timeframe,
      regime,
      session: snapshot.context.session.session,
      direction: noTrade ? "none" : direction,
      confidence: noTrade ? 0 : confidence,
      entry_style: chosenEntryStyle,
      selected_pods: directionalVotes.filter(vote => vote.direction !== "none").map(vote => vote.pod_id),
      pod_weights: weights,
      pod_vote_summary: {
        directional: directionalVotes,
        gating: gatingVotes,
      },
      trade_plan: noTrade ? null : tradePlan,
      entry: noTrade ? null : tradePlan?.entry ?? null,
      sl: noTrade ? null : tradePlan?.sl ?? null,
      tp1: noTrade ? null : tradePlan?.tp1 ?? null,
      tp2: noTrade ? null : tradePlan?.tp2 ?? null,
      tp3: noTrade ? null : tradePlan?.tp3 ?? null,
      target_position: target,
      reasoning: [
        ...baseReasoning,
        ...new Set([
          `Selected entry style: ${chosenEntryStyle.replaceAll("_", " ")}.`,
          ...(topDirectional?.rationale ?? ["No primary directional setup reached the active threshold."]),
          ...gatingOutputs.flatMap(output => output.rationale.slice(0, 1)),
        ]),
      ],
      reason_codes: [...new Set([
        ...baseReasonCodes,
        `selected_entry_style:${chosenEntryStyle}`,
        `regime:${regime}`,
        `session:${snapshot.context.session.session}`,
        volatilityScale < 1 ? "portfolio_vol_scaled" : "portfolio_vol_ok",
        reducedSizeScale < 1 ? "recovery_reduced_size" : "recovery_normal_size",
        ...(disabledStyleOutputs.length > 0 ? ["ENTRY_STYLE_DISABLED"] : []),
        ...vetoReasons,
      ])],
      veto_reasons: [...new Set(vetoReasons)],
      portfolio_context: {
        gross_exposure: grossExposure,
        net_exposure: netExposure,
        active_symbols: activeSymbolCount,
      },
    };
  }
}
