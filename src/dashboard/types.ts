import type {
  AllocationIntent,
  AlphaPodOutput,
  AppliedRecommendationHistoryEntry,
  DecisionJournalEntry,
  DriftMetrics,
  ModelRegistryRecord,
  PairProfileConfigView,
  PairStabilityScore,
  PodVoteSummary,
  PodStatus,
  ProposedConfigDiff,
  RecoveryMode,
  RecommendationEffectivenessResult,
  RecommendationSnapshot,
  RiskDecision,
  SignalQualityReport,
  SignalLifecycleRecord,
  SystemStatusSnapshot,
  ValidationRun,
} from "@/src/interfaces/contracts";
import type { CryptoSignalsPayload } from "@/src/crypto/types";
import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import type { TraderSignalsPayload } from "@/src/lib/traderContracts";
import type { AlphaAnalyticsReport } from "@/src/application/analytics/alphaTypes";

export type ExecutionHealthRow = {
  symbol_canonical: string;
  fill_rate: number;
  avg_slippage_bps: number;
  reject_count: number;
};

export type SystemStatusPayload = SystemStatusSnapshot & {
  execution_health: ExecutionHealthRow[];
  provider: string;
  cycle_interval_minutes: number;
  active_pods: string[];
  active_entry_style: string;
};

export type SignalFeedRow = {
  symbol: string;
  session: string;
  regime: string;
  direction: string;
  entry_style: string;
  confidence: number;
  lifecycle_state: string;
  outcome: string;
  last_updated: number;
  reasoning: string[];
  veto_reasons: string[];
  pod_vote_summary: PodVoteSummary;
  trade_plan: AllocationIntent["trade_plan"];
  latest_lifecycle: SignalLifecycleRecord | null;
};

export type RiskDecisionRow = RiskDecision & {
  reason_codes: string[];
};

export type RiskPositionRow = {
  symbol_canonical: string;
  current_position: number;
  max_position: number;
  utilization: number;
  current_notional_usd: number;
  max_notional_usd: number;
};

export type RiskDashboardPayload = {
  risk_state: {
    current_drawdown_pct: number;
    portfolio_vol_estimate: number;
  };
  exposure: {
    gross: number;
    net: number;
    active_symbols: number;
  };
  limits: {
    max_gross_exposure: number;
    max_net_exposure: number;
    max_symbol_position: number;
    max_notional_usd: number;
    drawdown_warning_pct: number;
    drawdown_hard_limit_pct: number;
    volatility_target: number;
  };
  positions: RiskPositionRow[];
  decisions: RiskDecisionRow[];
  allocations: AllocationIntent[];
};

export type PodDashboardRow = {
  pod_id: string;
  model_version: string;
  pod_category: string;
  status: PodStatus;
  diagnostics: Record<string, unknown>;
  last_output: AlphaPodOutput | null;
  last_updated: number | null;
  confidence_trend: number[];
  drift_flags: string[];
  recommended_update_scope: string;
  diagnostics_url: string;
};

export type PodDetailsPayload = PodDashboardRow & {
  recent_outputs: AlphaPodOutput[];
  model_registry: ModelRegistryRecord[];
};

export type OverviewDashboardPayload = {
  status: SystemStatusPayload;
  signals: TraderSignalDashboardPayload;
  crypto: CryptoSignalsPayload;
  allocations: AllocationIntent[];
  risk: RiskDashboardPayload;
  journal: DecisionJournalEntry[];
  quality: SignalQualityReport;
};

export type TraderSignalDashboardPayload = TraderSignalsPayload & {
  executable: SignalViewModel[];
  monitored: SignalViewModel[];
  rejected: SignalViewModel[];
  cycle_id?: string;
  payload_source?: "canonical";
  versions?: Record<string, unknown>;
};

export type DriftDashboardPayload = {
  mode: RecoveryMode;
  drift: DriftMetrics[];
  models: ModelRegistryRecord[];
};

export type SignalQualityDashboardPayload = SignalQualityReport;

export type RecommendationQueuePayload = {
  active_symbols: string[];
  current_profiles: PairProfileConfigView[];
  latest_snapshot: RecommendationSnapshot | null;
  snapshots: RecommendationSnapshot[];
  applied_history: AppliedRecommendationHistoryEntry[];
};

export type RecommendationDetailPayload = {
  snapshot: RecommendationSnapshot | null;
  current_profiles: PairProfileConfigView[];
  live_diffs: Record<string, ProposedConfigDiff>;
  applied_history: AppliedRecommendationHistoryEntry[];
};

export type ValidationQueuePayload = {
  active_symbols: string[];
  latest_run: ValidationRun | null;
  runs: ValidationRun[];
  recommendation_effectiveness: RecommendationEffectivenessResult[];
  pair_stability: PairStabilityScore[];
  applied_history: AppliedRecommendationHistoryEntry[];
  alpha_analytics: AlphaAnalyticsReport | null;
};

export type ValidationDetailPayload = {
  run: ValidationRun | null;
};
