import type {
  AllocationIntent,
  FeatureSnapshot,
  PairMarketDataDiagnostics,
  PodEvaluation,
  RiskDecision,
  SessionLabel,
  SignalLifecycleRecord,
  SignalLifecycleState,
} from "@/src/interfaces/contracts";
import type { TraderPairRuntimeState } from "@/src/lib/traderContracts";
import type { AggregatedPodDecision, PodVote } from "@/src/domain/pods/types";
import type {
  CanonicalRiskDecision,
  RiskAdjustment,
  RiskModuleResult,
} from "@/src/domain/risk/types";
import type {
  ModuleHealthState,
  ProviderStatus,
  PublicationStatus,
  SignalAssetClass,
  SignalDataTrust,
  SignalQualityScores,
  SignalRejectionReasonCode,
} from "@/src/domain/models/signalHealth";

export const SIGNAL_PIPELINE_VERSIONS = {
  market_snapshot: "market_snapshot_v1",
  trade_candidate: "trade_candidate_v2",
  risk_evaluated_candidate: "risk_evaluated_candidate_v2",
  executable_signal: "executable_signal_v1",
  signal_view_model: "signal_view_model_v1",
  cycle_output: "cycle_output_v1",
  trade_plan: "trade_plan_v1",
} as const;

export type DataQualityTier = "high" | "degraded" | "synthetic";
export type SignalViewDisplayType = "executable" | "monitored" | "rejected";
export type CyclePipelineStatus = "completed" | "failed" | "skipped";
export type SignalViewRiskStatus = "approved" | "rejected" | "deferred" | "reduced";
export type SignalViewStatus = "active" | "watchlist" | "blocked" | "invalidated" | "expired";

export type SignalViewModelPodVote = {
  podName: string;
  signal: "buy" | "sell" | "neutral";
  confidence: number;
  score: number;
  reasoning: string;
};

export type SignalViewModelSMC = {
  nearestOrderBlock: { type: "bullish" | "bearish"; high: number; low: number; strength: string } | null;
  nearestFVG: { type: "bullish" | "bearish"; upper: number; lower: number; fillPercent: number } | null;
  nearestBreaker: { type: "bullish" | "bearish"; high: number; low: number } | null;
  recentLiquiditySweep: { side: "buyside" | "sellside"; reversal: boolean; reversalStrength: string } | null;
  killzone: string;
  minutesToNextKillzone: number;
  nextKillzone: string;
  asianRangeHigh: number | null;
  asianRangeLow: number | null;
  inOTE: boolean;
  oteLevels: { fib62: number; fib705: number; fib79: number } | null;
  pdLocation: "premium" | "discount" | "equilibrium";
  pdPercent: number;
  cotBias: string;
  cotStrength: string;
  cotDivergence: boolean;
  smcScore: number;
  smcVerdict: string;
};

export type MarketSnapshot = {
  snapshot_id: string;
  cycle_id: string;
  symbol: string;
  timestamp: number;
  features: Record<string, unknown>;
  raw_inputs_metadata: Record<string, unknown>;
  data_source: string;
  data_quality_tier: DataQualityTier;
  feature_version: string;
  market_session_context: {
    session: SessionLabel;
    trading_day: string;
    hour_bucket: number;
    minutes_since_session_open: number;
  };
  publication_session_window: SessionLabel;
  session_context: FeatureSnapshot["context"];
  created_at: number;
  data_fetch_timestamps: number[];
  asset_class?: SignalAssetClass;
  provider_status?: ProviderStatus;
  price_source?: string | null;
  candle_source?: string | null;
  fallback_depth?: number;
  data_freshness_ms?: number | null;
  missing_bar_count?: number;
  last_successful_provider?: string | null;
  quote_integrity?: boolean;
  universe_membership_confidence?: number;
  data_trust_score?: number;
  data_health?: SignalDataTrust;
};

export type CanonicalPodOutput = PodVote;

export type TradeCandidate = {
  candidate_id: string;
  cycle_id: string;
  snapshot_id: string;
  symbol: string;
  direction: string;
  confidence: number;
  size_hint: number;
  allocator_version: string;
  pod_votes: CanonicalPodOutput[];
  supporting_evidence: Record<string, unknown>;
  allocator_metadata: Record<string, unknown>;
  directional_attribution: {
    long_score: number;
    short_score: number;
    neutral_score: number;
    long_contributors: string[];
    short_contributors: string[];
    regime_contributors: string[];
  };
  veto_attribution: {
    vetoes: Array<{
      pod_name: string;
      reason_codes: string[];
    }>;
    veto_contributors: string[];
  };
  confidence_breakdown: {
    legacy_confidence: number;
    raw_aggregate_confidence: number;
    normalized_aggregate_confidence: number;
    calibrated_confidence_enabled: boolean;
    calibrated_confidence_applied: boolean;
  };
  proposed_trade_plan: AllocationIntent["trade_plan"] | null;
  status: "proposed";
  created_at: number;
  quality_scores?: SignalQualityScores | null;
  publication_status?: PublicationStatus;
  publication_reasons?: SignalRejectionReasonCode[];
  module_health?: ModuleHealthState;
};

export type PolicyEvaluation = RiskModuleResult;

export type RiskEvaluatedCandidate = {
  candidate_id: string;
  cycle_id: string;
  decision: CanonicalRiskDecision;
  blocking_rules: string[];
  warnings: string[];
  size_adjustments: {
    original_size: number;
    approved_size: number;
    approved_size_multiplier: number;
  } | null;
  policy_evaluations: PolicyEvaluation[];
  risk_version: string;
  approved_trade_plan: AllocationIntent["trade_plan"] | null;
  authoritative_source: string;
  shadow_decision: CanonicalRiskDecision | null;
  shadow_mismatch: boolean;
  shadow_blocking_rules: string[];
  shadow_adjustments: RiskAdjustment[];
  explainability_score: number | null;
  created_at: number;
  quality_scores?: SignalQualityScores | null;
  publication_status?: PublicationStatus;
  publication_reasons?: SignalRejectionReasonCode[];
  module_health?: ModuleHealthState;
};

export type ExecutableSignal = {
  signal_id: string;
  cycle_id: string;
  candidate_id: string;
  symbol: string;
  direction: "buy" | "sell";
  size: number;
  entry: number;
  stop_loss: number;
  take_profit: {
    tp1: number;
    tp2: number | null;
    tp3: number | null;
  };
  status: SignalLifecycleState;
  created_at: number;
  version: string;
  quality_scores?: SignalQualityScores | null;
  publication_status?: PublicationStatus;
  publication_reasons?: SignalRejectionReasonCode[];
  module_health?: ModuleHealthState;
};

export type SignalLifecycle = {
  signal_id: string;
  current_state: string;
  fill_status: "pending" | "open" | "closed" | "cancelled";
  opened_at: number | null;
  updated_at: number;
  closed_at: number | null;
  pnl: number | null;
  execution_events: SignalLifecycleRecord["events"];
};

export type SignalViewModel = {
  id: string;
  view_id: string;
  entity_ref: string;
  signal_id: string | null;
  symbol: string;
  cycleId: string;
  generatedAt: number;
  displayCategory: SignalViewDisplayType;
  display_type: SignalViewDisplayType;
  livePrice: number | null;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  direction: "buy" | "sell" | "neutral";
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
  shortReasoning: string;
  detailedReasoning: string;
  whyThisSetup: string;
  whyNow: string;
  whyThisLevel: string;
  invalidation: string;
  whyThisGrade: string;
  noTradeExplanation: string | null;
  smcAnalysis?: SignalViewModelSMC;
  marketStateLabels: string[];
  noTradeReason: string | null;
  blockedReasons: string[];
  riskStatus: SignalViewRiskStatus;
  riskRuleCodes: string[];
  riskExplainability: string[];
  podVotes: SignalViewModelPodVote[];
  lifecycleState: string | null;
  status: SignalViewStatus;
  keyLevels: {
    pdh: number | null;
    pdl: number | null;
    sessionHigh: number | null;
    sessionLow: number | null;
  };
  marketStructureSummary: string;
  liquiditySummary: string;
  keyLevelsSummary: string;
  headline: string;
  summary: string;
  reason_labels: string[];
  confidence_label: string | null;
  ui_sections: Record<string, unknown>;
  commentary: Record<string, unknown> | null;
  ui_version: string;
  generated_at: number;
  assetClass?: SignalAssetClass;
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
};

export type CycleOutput = {
  cycle_id: string;
  started_at: number;
  completed_at: number;
  symbols_processed: string[];
  snapshots: MarketSnapshot[];
  candidates: TradeCandidate[];
  risk_results: RiskEvaluatedCandidate[];
  signals: ExecutableSignal[];
  metadata: Record<string, unknown>;
  versions: {
    feature_version: string;
    pod_versions: Record<string, string>;
    allocator_version: string;
    risk_version: string;
    trade_plan_version: string;
    view_model_version: string;
    llm_prompt_version: string | null;
    data_source: string[];
    data_fetch_timestamps: number[];
  };
  pipeline_status: CyclePipelineStatus;
  payload_source: "canonical" | "reconstructed";
};

export type SignalViewModelInput = {
  state: TraderPairRuntimeState;
  snapshot: MarketSnapshot | null;
  candidate: TradeCandidate | null;
  risk_result: RiskEvaluatedCandidate | null;
  executable_signal: ExecutableSignal | null;
};

export type CanonicalPipelineStageArtifacts = {
  market_snapshot: MarketSnapshot | null;
  trade_candidate: TradeCandidate | null;
  risk_evaluated_candidate: RiskEvaluatedCandidate | null;
  executable_signal: ExecutableSignal | null;
  signal_view_model: SignalViewModel | null;
};

export type MarketSnapshotInput = {
  cycle_id: string;
  snapshot: FeatureSnapshot;
  market_data: PairMarketDataDiagnostics | null;
};

export type TradeCandidateInput = {
  cycle_id: string;
  snapshot: MarketSnapshot;
  candidate: AllocationIntent;
  pod_outputs: PodEvaluation[];
  pod_votes?: PodVote[];
  aggregated_pod_decision?: AggregatedPodDecision | null;
};

export type RiskEvaluatedCandidateInput = {
  cycle_id: string;
  snapshot?: MarketSnapshot | null;
  candidate: AllocationIntent;
  risk_decision: RiskDecision;
  risk_evaluation?: {
    decision: CanonicalRiskDecision;
    blocking_rules: string[];
    warnings: string[];
    size_adjustments: RiskEvaluatedCandidate["size_adjustments"];
    policy_evaluations: PolicyEvaluation[];
    risk_version: string;
    approved_trade_plan: AllocationIntent["trade_plan"] | null;
    authoritative_source: string;
    shadow_decision: CanonicalRiskDecision | null;
    shadow_mismatch: boolean;
    shadow_blocking_rules: string[];
    shadow_adjustments: RiskAdjustment[];
    explainability_score: number | null;
  };
};

export type ExecutableSignalInput = {
  cycle_id: string;
  snapshot?: MarketSnapshot | null;
  candidate: AllocationIntent;
  risk_evaluated_candidate: RiskEvaluatedCandidate;
  lifecycle: SignalLifecycleRecord | null;
};
