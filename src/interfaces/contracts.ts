import type { SMCAnalysis } from "@/src/smc/types";

export type AssetClass = "forex" | "commodity" | "equity" | "crypto";
export type MarketEventType = "tick" | "trade" | "book_update" | "ohlcv";
export type FeatureHorizon = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type CandleTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
export type SignalType = "predictive" | "reactive" | "regime" | "execution_advisory";
export type RecommendedAction = "long" | "short" | "flat" | "hold" | null;
export type PodStatus = "active" | "paused" | "quarantined";
export type PodCategory = "directional" | "gating";
export type SessionLabel = "asia" | "london" | "new_york" | "overlap" | "off_hours";
export type StructureBias = "bullish" | "bearish" | "neutral";
export type DirectionalState = "bullish" | "bearish" | "none";
export type SessionCompressionState = "compressed" | "normal";
export type TradeabilityVolatilityState = "too_low" | "acceptable" | "too_high";
export type PairVolatilityRegime = "low" | "normal" | "high";
export type CandleQualityFlag =
  | "clean"
  | "missing_bars"
  | "duplicate_bars"
  | "out_of_order"
  | "stale_last_candle"
  | "abnormal_gap"
  | "synthetic";
export type HighImpactEventType = "CPI" | "NFP" | "FOMC" | "RATE_DECISION" | "PMI" | "OTHER";
export type RecoveryMode =
  | "normal"
  | "reduced_confidence"
  | "reduced_size"
  | "pod_quarantine"
  | "execution_only"
  | "flat_and_observe"
  | "full_stop";
export type VolatilityRegimeState = "low_vol_trending" | "normal" | "high_vol_chaotic" | "compressing";
export type ExecutionStyle = "passive" | "vwap" | "twap" | "is" | "sweep" | "participation";
export type ModelDeploymentStage =
  | "research"
  | "candidate"
  | "shadow"
  | "limited"
  | "production"
  | "deprecated"
  | "retired";
export type SignalDirection = "buy" | "sell" | "none";
export type SignalEntryStyle = "trend_pullback" | "session_breakout" | "range_reversal" | "support";
export type GateStatus = "allow" | "warn" | "block";
export type SignalRegime =
  | "trend"
  | "range"
  | "breakout"
  | "compression"
  | "chaotic"
  | "normal";
export type SignalLifecycleState =
  | "signal_created"
  | "pending_trigger"
  | "activated"
  | "tp1_hit"
  | "tp2_hit"
  | "tp3_hit"
  | "stopped_out"
  | "expired"
  | "cancelled";
export type SignalOutcome =
  | "open"
  | "pending"
  | "tp1_hit"
  | "tp2_hit"
  | "tp3_hit"
  | "stopped_out"
  | "expired"
  | "cancelled"
  | "rejected";
export type NoTradeReasonCode =
  | "NEWS_WINDOW"
  | "LOW_RR"
  | "OFF_SESSION"
  | "VOL_TOO_HIGH"
  | "VOL_TOO_LOW"
  | "CONFLICTING_REGIME"
  | "TOO_CLOSE_TO_STRUCTURE"
  | "DUPLICATE_SIGNAL"
  | "SYMBOL_NOT_ACTIVE"
  | "SYMBOL_NOT_SUPPORTED"
  | "ENTRY_STYLE_DISABLED"
  | "PAIR_CONFIDENCE_BELOW_MIN"
  | "PAIR_RR_BELOW_MIN"
  | "PAIR_SESSION_NOT_ALLOWED"
  | "PAIR_SIGNAL_LIMIT_REACHED"
  | "SL_TOO_TIGHT"
  | "SL_TOO_WIDE"
  | "SPREAD_ABNORMAL"
  | "NO_DIRECTIONAL_CONSENSUS"
  | "NO_TRADEABILITY_EDGE"
  | "MARKET_DATA_DEGRADED"
  | "SESSION_LOCK"
  | "NEWS_LOCK"
  | "SIGNAL_EXPIRED"
  | "HIGHER_TIMEFRAME_CONFLICT";
export const SIGNAL_CONFIDENCE_BUCKETS = [
  "0-49%",
  "50-59%",
  "60-69%",
  "70-79%",
  "80-89%",
  "90-100%",
] as const;
export type SignalConfidenceBucket = typeof SIGNAL_CONFIDENCE_BUCKETS[number];
export const ANALYTICS_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export type AnalyticsWeekday = typeof ANALYTICS_WEEKDAYS[number];

export interface CanonicalMarketEvent {
  event_id: string;
  ts_exchange: number;
  ts_received: number;
  venue: string;
  asset_class: AssetClass;
  symbol_raw: string;
  symbol_canonical: string;
  event_type: MarketEventType;
  sequence_number: number;
  integrity_flags: string[];
  price?: number;
  size?: number;
  side?: "bid" | "ask" | "trade";
  bid?: number;
  ask?: number;
  spread?: number;
  timeframe?: CandleTimeframe;
  timestamp_open?: number;
  timestamp_close?: number;
  source?: string;
  quality_flag?: CandleQualityFlag;
  session?: SessionLabel;
  trading_day?: string;
  hour_bucket?: number;
  minutes_since_session_open?: number;
  major_news_flag?: boolean;
  minutes_to_next_high_impact_event?: number | null;
  minutes_since_last_high_impact_event?: number | null;
  event_type_label?: HighImpactEventType | null;
}

export interface SessionContext {
  session: SessionLabel;
  tradingDay: string;
  hourBucket: number;
  minutesSinceSessionOpen: number;
}

export interface EconomicEventContext {
  majorNewsFlag: boolean;
  minutesToNextHighImpactEvent: number | null;
  minutesSinceLastHighImpactEvent: number | null;
  eventType: HighImpactEventType | null;
}

export interface ProviderHealthMetadata {
  provider: string;
  latencyMs: number;
  missingBars: number;
  duplicateBars: number;
  outOfOrderBars: number;
  staleLastCandle: boolean;
  abnormalGapDetected: boolean;
}

export interface NormalizedCandle extends SessionContext, EconomicEventContext {
  symbol: string;
  timeframe: CandleTimeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  timestampOpen: number;
  timestampClose: number;
  source: string;
  qualityFlag: CandleQualityFlag;
}

export interface MarketStructureContext {
  recentSwingHigh: number | null;
  recentSwingLow: number | null;
  previousSwingHigh: number | null;
  previousSwingLow: number | null;
  higherHighState: boolean;
  lowerLowState: boolean;
  structureBias: StructureBias;
  breakOfStructure: DirectionalState;
  changeOfCharacter: DirectionalState;
  distanceToRecentStructure: number;
  distanceToSessionHigh: number;
  distanceToSessionLow: number;
  distanceToPreviousDayHigh: number;
  distanceToPreviousDayLow: number;
}

export interface SessionFeatureContext {
  asiaRangeSize: number;
  londonRangeSize: number;
  newYorkOpeningExpansion: number;
  sessionBreakoutState: DirectionalState;
  sessionCompressionState: SessionCompressionState;
  atrRelativeToNormal: number;
}

export interface TradeabilityContext {
  spreadEstimateBps: number;
  volatilityState: TradeabilityVolatilityState;
  rewardToRiskFeasible: boolean;
  rewardToRiskPotential: number;
  proximityToKeyStructure: number;
  signalCrowdingOnPair: number;
  pairVolatilityRegime: PairVolatilityRegime;
}

export interface FeatureSnapshot {
  snapshot_id: string;
  ts: number;
  symbol_canonical: string;
  horizon: FeatureHorizon;
  features: Record<string, number>;
  quality: {
    staleness_ms: number;
    completeness: number;
    confidence: number;
  };
  context: {
    timeframe: CandleTimeframe | FeatureHorizon;
    source: string;
    quality_flag: CandleQualityFlag;
    session: SessionContext;
    economic_event: EconomicEventContext;
    market_structure?: MarketStructureContext;
    session_features?: SessionFeatureContext;
    tradeability?: TradeabilityContext;
  };
  smcAnalysis?: SMCAnalysis;
}

export interface PriceZone {
  low: number;
  high: number;
  label: string;
}

export interface PodEvaluationCommon {
  pod_id: string;
  ts: number;
  symbol_canonical: string;
  decision_horizon: string;
  signal_type: SignalType;
  confidence: number;
  recommended_action: RecommendedAction;
  expected_return?: number;
  expected_volatility?: number;
  win_probability?: number;
  urgency?: number;
  state_assessment?: string;
  constraints: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  model_version: string;
  pod_category: PodCategory;
  entry_style: SignalEntryStyle;
  rationale: string[];
}

export interface DirectionalPodOutput extends PodEvaluationCommon {
  pod_category: "directional";
  direction: Exclude<SignalDirection, "none"> | "none";
  score: number;
  regime: SignalRegime;
  regime_alignment: number;
  tradeability_alignment: number;
  entry_zone: PriceZone | null;
  invalidation_zone: PriceZone | null;
}

export interface GatingPodOutput extends PodEvaluationCommon {
  pod_category: "gating";
  gate_status: GateStatus;
  veto_reasons: NoTradeReasonCode[];
  advisory_direction?: SignalDirection;
  preferred_execution_style?: ExecutionStyle;
}

export type PodEvaluation = DirectionalPodOutput | GatingPodOutput;
export type AlphaPodOutput = PodEvaluation;

export interface PodVoteLine {
  pod_id: string;
  pod_category: PodCategory;
  direction: SignalDirection;
  confidence: number;
  weight: number;
  score?: number;
  gate_status?: GateStatus;
  veto_reasons?: NoTradeReasonCode[];
  rationale: string[];
}

export interface PodVoteSummary {
  directional: PodVoteLine[];
  gating: PodVoteLine[];
}

export interface TradePlan {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  tp3: number | null;
  risk_reward_ratio: number | null;
  entry_zone: PriceZone;
  invalidation_zone: PriceZone;
  pre_entry_invalidation: string;
  post_entry_invalidation: string;
  expires_after_bars: number;
  expires_at: number;
}

export interface SignalCandidate {
  candidate_id: string;
  ts: number;
  symbol_canonical: string;
  timeframe: CandleTimeframe | FeatureHorizon;
  regime: SignalRegime;
  session: SessionLabel;
  direction: SignalDirection;
  confidence: number;
  entry_style: SignalEntryStyle;
  selected_pods: string[];
  pod_weights: Record<string, number>;
  pod_vote_summary: PodVoteSummary;
  trade_plan: TradePlan | null;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  target_position: number;
  reasoning: string[];
  reason_codes: string[];
  veto_reasons: NoTradeReasonCode[];
  portfolio_context: {
    gross_exposure: number;
    net_exposure: number;
    active_symbols: number;
  };
}

export type AllocationIntent = SignalCandidate;

export interface RiskDecision {
  ts: number;
  scope: string;
  approval_status: "approved" | "approved_reduced" | "deferred" | "rejected";
  approved_size_multiplier: number;
  risk_check_results: Record<string, boolean>;
  veto_reasons: NoTradeReasonCode[];
  warning_reasons: NoTradeReasonCode[];
  override_instructions?: string;
  de_risking_action?: "none" | "partial_flatten" | "full_flatten" | "halt_symbol" | "halt_pod" | "kill_switch";
  kill_switch_active: boolean;
}

export interface ExecutionIntent {
  intent_id: string;
  signal_id: string;
  ts: number;
  symbol_canonical: string;
  side: "buy" | "sell";
  timeframe: CandleTimeframe | FeatureHorizon;
  entry_style: SignalEntryStyle;
  target_size: number;
  urgency: number;
  execution_style: ExecutionStyle;
  slippage_budget_bps: number;
  lifecycle_state: SignalLifecycleState;
  trade_plan: TradePlan;
  constraints: {
    max_participation_rate: number;
    spread_limit_bps: number;
    blackout_active: boolean;
  };
  fallback_style: string;
}

export interface SignalLifecycleEvent {
  ts: number;
  state: SignalLifecycleState;
  detail: string;
}

export interface SignalLifecycleRecord {
  signal_id: string;
  symbol_canonical: string;
  direction: Exclude<SignalDirection, "none">;
  timeframe: CandleTimeframe | FeatureHorizon;
  entry_style: SignalEntryStyle;
  created_ts: number;
  updated_ts: number;
  expires_at: number;
  state: SignalLifecycleState;
  outcome: SignalOutcome;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number | null;
  tp3: number | null;
  max_favorable_excursion: number;
  max_adverse_excursion: number;
  activated_ts?: number;
  completed_ts?: number;
  time_to_tp1_ms?: number;
  time_to_sl_ms?: number;
  events: SignalLifecycleEvent[];
}

export interface DecisionJournalEntry {
  decision_id: string;
  signal_id: string;
  ts: number;
  symbol_canonical: string;
  pair: string;
  session: SessionLabel;
  regime: SignalRegime;
  entry_style: SignalEntryStyle;
  direction: SignalDirection;
  confidence: number;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  pod_votes: PodVoteSummary;
  veto_reasons: NoTradeReasonCode[];
  market_snapshot_ref: string;
  pod_output_refs: string[];
  allocation_ref: string;
  risk_decision_ref: string;
  execution_intent_ref: string;
  lifecycle_state?: SignalLifecycleState;
  outcome?: SignalOutcome;
  maxFavorableExcursion?: number;
  maxAdverseExcursion?: number;
  timeToTp1?: number;
  timeToSl?: number;
  final_action: "executed" | "rejected" | "deferred" | "halted";
  reasoning: string[];
  human_summary: string;
}

export interface VetoReasonDistributionRow {
  reason: NoTradeReasonCode;
  count: number;
  percentage_of_group_vetoes: number;
}

export interface SignalQualityMetrics {
  signals_issued: number;
  signals_activated: number;
  veto_count: number;
  veto_reason_distribution: VetoReasonDistributionRow[];
  tp1_hit_count: number;
  tp2_hit_count: number;
  tp3_hit_count: number;
  stop_out_count: number;
  expiry_count: number;
  cancellation_count: number;
  tp1_hit_rate: number;
  tp2_hit_rate: number;
  tp3_hit_rate: number;
  stop_out_rate: number;
  expiry_rate: number;
  cancellation_rate: number;
  average_mfe: number | null;
  average_mae: number | null;
  average_time_to_activation_ms: number | null;
  average_time_to_tp1_ms: number | null;
  average_time_to_stop_ms: number | null;
}

export interface PairSignalQualityRow extends SignalQualityMetrics {
  pair: string;
}

export interface SessionSignalQualityRow extends SignalQualityMetrics {
  session: SessionLabel;
}

export interface RegimeSignalQualityRow extends SignalQualityMetrics {
  regime: SignalRegime;
}

export interface ConfidenceBucketSignalQualityRow extends SignalQualityMetrics {
  confidence_bucket: SignalConfidenceBucket;
}

export interface WeekdaySignalQualityRow extends SignalQualityMetrics {
  weekday: AnalyticsWeekday;
}

export interface SignalQualitySliceRow extends SignalQualityMetrics {
  pair: string;
  session: SessionLabel;
  regime: SignalRegime;
  confidence_bucket: SignalConfidenceBucket;
  weekday: AnalyticsWeekday;
}

export interface VetoEffectivenessSlice {
  pair: string;
  session: SessionLabel;
  regime: SignalRegime;
  count: number;
  percentage_of_reason_vetoes: number;
}

export interface VetoEffectivenessPairDistributionRow {
  pair: string;
  count: number;
  percentage_of_reason_vetoes: number;
}

export interface VetoEffectivenessSessionDistributionRow {
  session: SessionLabel;
  count: number;
  percentage_of_reason_vetoes: number;
}

export interface VetoEffectivenessRegimeDistributionRow {
  regime: SignalRegime;
  count: number;
  percentage_of_reason_vetoes: number;
}

export interface VetoEffectivenessConfidenceDistributionRow {
  confidence_bucket: SignalConfidenceBucket;
  count: number;
  percentage_of_reason_vetoes: number;
}

export interface VetoEffectivenessRow {
  reason: NoTradeReasonCode;
  count: number;
  percentage_of_total_vetoes: number;
  pair_distribution: VetoEffectivenessPairDistributionRow[];
  session_distribution: VetoEffectivenessSessionDistributionRow[];
  regime_distribution: VetoEffectivenessRegimeDistributionRow[];
  confidence_distribution: VetoEffectivenessConfidenceDistributionRow[];
  associated_slices: VetoEffectivenessSlice[];
}

export interface ConfidenceCalibrationRow extends SignalQualityMetrics {
  confidence_bucket: SignalConfidenceBucket;
  signals_vetoed: number;
}

export interface PairTuningRecommendation {
  pair: string;
  sample_size: number;
  suggested_minimum_confidence_threshold: number;
  suggested_minimum_rr_threshold: number;
  suggested_atr_tolerance_multiplier: number;
  preferred_sessions: SessionLabel[];
  sessions_to_avoid: SessionLabel[];
  cooldown_recommendation_minutes: number;
  activation_rate: number;
  tp1_hit_rate: number;
  stop_out_rate: number;
  expiry_rate: number;
  notes: string[];
}

export interface SignalTimingDiagnosticRow {
  pair: string;
  session: SessionLabel;
  signals_issued: number;
  signals_activated: number;
  activation_rate: number;
  expiry_before_activation_rate: number;
  average_time_to_activation_ms: number | null;
  average_time_from_activated_to_tp1_ms: number | null;
  average_time_from_activated_to_stop_ms: number | null;
}

export type RecommendationApprovalStatus = "proposed" | "approved" | "rejected" | "superseded";

export interface PairProfileConfigView {
  pair: string;
  minConfidence: number;
  minRiskReward: number;
  allowedSessions: SessionLabel[];
  preferredSessions: SessionLabel[];
  avoidSessions: SessionLabel[];
  maxSignalsPerDay: number;
  cooldownMinutes: number;
  atrToleranceMultiplier: number;
}

export interface ProposedConfigDiffField<T> {
  current: T | null;
  proposed: T | null;
  changed: boolean;
}

export interface ProposedConfigDiff {
  minConfidence: ProposedConfigDiffField<number>;
  minRiskReward: ProposedConfigDiffField<number>;
  allowedSessions: ProposedConfigDiffField<SessionLabel[]>;
  preferredSessions: ProposedConfigDiffField<SessionLabel[]>;
  avoidSessions: ProposedConfigDiffField<SessionLabel[]>;
  maxSignalsPerDay: ProposedConfigDiffField<number>;
  cooldownMinutes: ProposedConfigDiffField<number>;
  atrToleranceMultiplier: ProposedConfigDiffField<number>;
}

export interface PairProfileProposal {
  proposal_id: string;
  pair: string;
  analytics_generated_at: number;
  current_profile: PairProfileConfigView | null;
  proposed_profile: PairProfileConfigView;
  proposed_config_diff: ProposedConfigDiff;
  approval_status: RecommendationApprovalStatus;
  rationale: string[];
  notes: string[];
  observed_metrics: {
    signals_issued: number;
    signals_activated: number;
    activation_rate: number;
    tp1_hit_rate: number;
    stop_out_rate: number;
    expiry_rate: number;
    average_time_to_activation_ms: number | null;
    average_time_to_tp1_ms: number | null;
    average_time_to_stop_ms: number | null;
    dominant_veto_reason: NoTradeReasonCode | null;
  };
}

export interface RecommendationSnapshot {
  snapshot_id: string;
  version: number;
  created_at: number;
  analytics_generated_at: number;
  active_symbols: string[];
  primary_entry_style: SignalEntryStyle;
  enabled_entry_styles: SignalEntryStyle[];
  approval_status: RecommendationApprovalStatus;
  proposals: PairProfileProposal[];
  notes: string[];
}

export interface RecommendationPerformanceBySession {
  session: SessionLabel;
  before: SignalQualityMetrics;
  after: SignalQualityMetrics;
}

export interface RecommendationPerformanceComparison {
  pair: string;
  generated_at: number;
  applied_at: number;
  overall_before: SignalQualityMetrics;
  overall_after: SignalQualityMetrics;
  by_session: RecommendationPerformanceBySession[];
}

export interface AppliedRecommendationHistoryEntry {
  history_id: string;
  snapshot_id: string;
  proposal_id: string;
  pair: string;
  applied_at: number;
  analytics_generated_at: number;
  approval_status: Extract<RecommendationApprovalStatus, "approved">;
  previous_profile: PairProfileConfigView | null;
  applied_profile: PairProfileConfigView;
  applied_config_diff: ProposedConfigDiff;
  rationale: string[];
  notes: string[];
  performance_comparison: RecommendationPerformanceComparison;
}

export type WalkForwardWindowKind = "rolling" | "observation" | "forward";
export type RecommendationEffectivenessVerdict = "beneficial" | "neutral" | "harmful" | "insufficient_data";

export interface WalkForwardWindow {
  window_id: string;
  pair: string;
  kind: WalkForwardWindowKind;
  start_ts: number;
  end_ts: number;
  metrics: SignalQualityMetrics;
  veto_rate: number;
  confidence_calibration: ConfidenceCalibrationRow[];
  session_distribution: SessionSignalQualityRow[];
  timing_diagnostics: SignalTimingDiagnosticRow[];
  veto_effectiveness: VetoEffectivenessRow[];
}

export interface ConfidenceCalibrationChangeRow {
  confidence_bucket: SignalConfidenceBucket;
  in_sample_signals_issued: number;
  out_of_sample_signals_issued: number;
  in_sample_tp1_hit_rate: number;
  out_of_sample_tp1_hit_rate: number;
  tp1_hit_rate_delta: number;
  in_sample_stop_out_rate: number;
  out_of_sample_stop_out_rate: number;
  stop_out_rate_delta: number;
}

export interface SessionDistributionChangeRow {
  session: SessionLabel;
  in_sample_signals_issued: number;
  out_of_sample_signals_issued: number;
  issued_delta: number;
  in_sample_tp1_hit_rate: number;
  out_of_sample_tp1_hit_rate: number;
  tp1_hit_rate_delta: number;
  in_sample_stop_out_rate: number;
  out_of_sample_stop_out_rate: number;
  stop_out_rate_delta: number;
}

export interface RecommendationDeltaSummary {
  signals_issued_delta: number;
  signals_activated_delta: number;
  veto_rate_delta: number;
  tp1_hit_rate_delta: number;
  tp2_hit_rate_delta: number;
  tp3_hit_rate_delta: number;
  stop_out_rate_delta: number;
  expiry_rate_delta: number;
  average_mfe_delta: number | null;
  average_mae_delta: number | null;
  average_time_to_activation_ms_delta: number | null;
  average_time_to_tp1_ms_delta: number | null;
  average_time_to_stop_ms_delta: number | null;
}

export interface PreChangeVsPostChangeComparison {
  pair: string;
  applied_at: number;
  pre_change: WalkForwardWindow;
  post_change: WalkForwardWindow;
  delta_summary: RecommendationDeltaSummary;
}

export interface InSampleVsOutOfSampleComparison {
  pair: string;
  applied_at: number;
  in_sample: WalkForwardWindow;
  out_of_sample: WalkForwardWindow;
  confidence_calibration_change: ConfidenceCalibrationChangeRow[];
  session_distribution_change: SessionDistributionChangeRow[];
}

export interface RecommendationEffectivenessResult {
  history_id: string;
  snapshot_id: string;
  proposal_id: string;
  pair: string;
  applied_at: number;
  applied_config_diff: ProposedConfigDiff;
  verdict: RecommendationEffectivenessVerdict;
  pre_change_vs_post_change: PreChangeVsPostChangeComparison;
  in_sample_vs_out_of_sample: InSampleVsOutOfSampleComparison;
  notes: string[];
}

export interface PairStabilityScore {
  pair: string;
  stability_score: number;
  windows_observed: number;
  tp1_consistency_score: number;
  confidence_calibration_stability_score: number;
  veto_reason_stability_score: number;
  session_consistency_score: number;
  stop_clustering_flag: boolean;
  deterioration_flag: boolean;
  notes: string[];
}

export interface ValidationRun {
  run_id: string;
  generated_at: number;
  active_symbols: string[];
  primary_entry_style: SignalEntryStyle;
  enabled_entry_styles: SignalEntryStyle[];
  observation_window_ms: number;
  forward_window_ms: number;
  rolling_window_ms: number;
  rolling_step_ms: number;
  walk_forward_windows: WalkForwardWindow[];
  recommendation_effectiveness: RecommendationEffectivenessResult[];
  pair_stability: PairStabilityScore[];
  notes: string[];
}

export interface SignalQualityReport {
  generated_at: number;
  active_symbols: string[];
  primary_entry_style: SignalEntryStyle;
  enabled_entry_styles: SignalEntryStyle[];
  totals: SignalQualityMetrics;
  by_pair: PairSignalQualityRow[];
  by_session: SessionSignalQualityRow[];
  by_regime: RegimeSignalQualityRow[];
  by_confidence_bucket: ConfidenceBucketSignalQualityRow[];
  by_weekday: WeekdaySignalQualityRow[];
  by_slice: SignalQualitySliceRow[];
  confidence_calibration: ConfidenceCalibrationRow[];
  pair_tuning_recommendations: PairTuningRecommendation[];
  signal_timing_diagnostics: SignalTimingDiagnosticRow[];
  veto_effectiveness: VetoEffectivenessRow[];
}

export interface LearningFeedbackRecord {
  feedback_id: string;
  decision_ref: string;
  outcome_window: string;
  realized_pnl?: number;
  realized_slippage_bps?: number;
  forecast_accuracy?: number;
  attribution: Record<string, number>;
  drift_flags: string[];
  recommended_update_scope: "none" | "confidence_recalibration" | "shadow_retrain" | "pod_pause";
}

export interface IAlphaPod {
  pod_id: string;
  model_version: string;
  pod_category: PodCategory;
  evaluate(snapshot: FeatureSnapshot): Promise<PodEvaluation>;
  pause(): void;
  resume(): void;
  getStatus(): PodStatus;
  getDiagnostics(): Record<string, unknown>;
}

export interface FeedHealthMetrics {
  symbol_canonical: string;
  latency_ms: number;
  last_received_ts: number | null;
  gap_count: number;
  quarantined: boolean;
  last_reason?: string;
  provider?: string;
  quality_flag?: CandleQualityFlag;
  missing_bars?: number;
  duplicate_bars?: number;
  out_of_order_bars?: number;
  stale_last_candle?: boolean;
  abnormal_gap_detected?: boolean;
}

export interface PairMarketDataDiagnostics {
  symbol: string;
  interval: string;
  provider: string | null;
  candlesFetched: number;
  lastCandleTimestamp: number | null;
  latencyMs: number;
  sourceMode: "live" | "cache" | "synthetic" | "unavailable";
  usedFallback: boolean;
  qualityFlag: CandleQualityFlag | null;
  unavailableReason?: string | null;
}

export interface ChildOrderPlan {
  child_order_id: string;
  intent_id: string;
  ts: number;
  symbol_canonical: string;
  side: "buy" | "sell";
  size: number;
  execution_style: ExecutionStyle;
  limit_price?: number;
  expected_slippage_bps: number;
  status: "planned" | "submitted" | "filled" | "rejected";
  notes?: string;
}

export interface ExecutionReport {
  intent: ExecutionIntent;
  child_orders: ChildOrderPlan[];
  lifecycle: SignalLifecycleRecord;
  simulated_fill_price?: number;
  simulated_slippage_bps?: number;
  rejected?: boolean;
}

export interface DriftMetrics {
  pod_id: string;
  ts: number;
  prediction_accuracy_7d: number;
  prediction_accuracy_30d: number;
  confidence_calibration_error: number;
  feature_distribution_shift: number;
  drift_flags: string[];
  recommended_update_scope: LearningFeedbackRecord["recommended_update_scope"];
}

export interface SystemEventRecord {
  event_id: string;
  ts: number;
  module: string;
  type: string;
  reason: string;
  payload: Record<string, unknown>;
}

export interface ModelRegistryRecord {
  pod_id: string;
  version: string;
  trained_at: number;
  status: string;
  validation_score: number;
  deployment_status: ModelDeploymentStage;
}

export interface ModuleHealth {
  module: string;
  status: "healthy" | "degraded" | "halted";
  detail: string;
  updated_at: number;
}

export interface ReadinessState {
  market_data_status: "healthy" | "degraded";
  provider_latency_ms: number;
  stale_symbols: string[];
  news_lock_active: boolean;
  session_lock_active: boolean;
}

export interface SystemStatusSnapshot {
  mode: RecoveryMode;
  kill_switch_active: boolean;
  last_cycle_ts: number | null;
  active_symbols: string[];
  modules: ModuleHealth[];
  feed_health: FeedHealthMetrics[];
  readiness?: ReadinessState;
}

const VOLATILITY_REGIME_CODE: Record<VolatilityRegimeState, number> = {
  low_vol_trending: 0,
  normal: 1,
  high_vol_chaotic: 2,
  compressing: 3,
};

const SESSION_LABEL_CODE: Record<SessionLabel, number> = {
  asia: 0,
  london: 1,
  new_york: 2,
  overlap: 3,
  off_hours: 4,
};

const VOLATILITY_REGIME_FROM_CODE = new Map<number, VolatilityRegimeState>(
  Object.entries(VOLATILITY_REGIME_CODE).map(([key, value]) => [value, key as VolatilityRegimeState]),
);
const SESSION_LABEL_FROM_CODE = new Map<number, SessionLabel>(
  Object.entries(SESSION_LABEL_CODE).map(([key, value]) => [value, key as SessionLabel]),
);

export function encodeVolatilityRegime(state: VolatilityRegimeState): number {
  return VOLATILITY_REGIME_CODE[state];
}

export function decodeVolatilityRegime(code: number | undefined): VolatilityRegimeState {
  if (code == null) {
    return "normal";
  }

  return VOLATILITY_REGIME_FROM_CODE.get(Math.round(code)) ?? "normal";
}

export function encodeSessionLabel(label: SessionLabel): number {
  return SESSION_LABEL_CODE[label];
}

export function decodeSessionLabel(code: number | undefined): SessionLabel {
  if (code == null) {
    return "off_hours";
  }

  return SESSION_LABEL_FROM_CODE.get(Math.round(code)) ?? "off_hours";
}

export function actionFromDirection(direction: SignalDirection): RecommendedAction {
  if (direction === "buy") return "long";
  if (direction === "sell") return "short";
  return "hold";
}

export function directionFromAction(action: RecommendedAction): SignalDirection {
  if (action === "long") return "buy";
  if (action === "short") return "sell";
  return "none";
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clampSignedUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
