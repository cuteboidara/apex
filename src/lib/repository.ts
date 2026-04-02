import type { PairTradingProfile } from "@/src/config/marketScope";
import type {
  CycleOutput,
  ExecutableSignal,
  MarketSnapshot,
  RiskEvaluatedCandidate,
  SignalLifecycle as CanonicalSignalLifecycle,
  SignalViewModel,
  TradeCandidate,
} from "@/src/domain/models/signalPipeline";
import type {
  AllocationIntent,
  AlphaPodOutput,
  AnalyticsWeekday,
  AppliedRecommendationHistoryEntry,
  CanonicalMarketEvent,
  ChildOrderPlan,
  ConfidenceCalibrationRow,
  ConfidenceBucketSignalQualityRow,
  DecisionJournalEntry,
  DriftMetrics,
  ExecutionIntent,
  FeedHealthMetrics,
  FeatureSnapshot,
  LearningFeedbackRecord,
  ModelRegistryRecord,
  NoTradeReasonCode,
  PairTuningRecommendation,
  PairSignalQualityRow,
  PairProfileConfigView,
  PairProfileProposal,
  ProposedConfigDiff,
  RecommendationDeltaSummary,
  RecommendationApprovalStatus,
  RecommendationEffectivenessResult,
  RecommendationEffectivenessVerdict,
  RecommendationPerformanceComparison,
  RecommendationPerformanceBySession,
  RecommendationSnapshot,
  RecoveryMode,
  RegimeSignalQualityRow,
  RiskDecision,
  SessionLabel,
  SessionSignalQualityRow,
  SignalConfidenceBucket,
  SignalEntryStyle,
  SignalLifecycleRecord,
  SignalLifecycleState,
  SignalQualityMetrics,
  SignalQualityReport,
  SignalQualitySliceRow,
  SignalRegime,
  SignalTimingDiagnosticRow,
  SystemEventRecord,
  ValidationRun,
  VetoEffectivenessRow,
  WalkForwardWindow,
  WalkForwardWindowKind,
  ConfidenceCalibrationChangeRow,
  PairStabilityScore,
  SessionDistributionChangeRow,
  WeekdaySignalQualityRow,
} from "@/src/interfaces/contracts";
import {
  ANALYTICS_WEEKDAYS as ANALYTICS_WEEKDAY_VALUES,
  SIGNAL_CONFIDENCE_BUCKETS,
} from "@/src/interfaces/contracts";

import { prepareSignalViewModelForPersistence } from "@/src/assets/shared/persistedSignalViewModel";
import { createId } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import type { TraderPairRuntimeState } from "@/src/lib/traderContracts";

type PrismaModelLike = {
  create?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  findMany?: (args?: Record<string, unknown>) => Promise<unknown[]>;
  findFirst?: (args?: Record<string, unknown>) => Promise<unknown | null>;
};

type PrismaClientLike = Record<string, PrismaModelLike | undefined>;

type RepositoryMode = "memory" | "database";

type ApexRepositoryOptions = {
  mode?: RepositoryMode;
};

export class RepositoryUnavailableError extends Error {
  declare cause?: unknown;

  constructor(operation: string, cause?: unknown) {
    super(`Repository unavailable during: ${operation}`);
    this.name = "RepositoryUnavailableError";
    this.cause = cause;
  }
}

function formatRepositoryError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type QualityAccumulator = {
  signalsIssued: number;
  signalsActivated: number;
  vetoCount: number;
  tp1HitCount: number;
  tp2HitCount: number;
  tp3HitCount: number;
  stopOutCount: number;
  expiryCount: number;
  cancellationCount: number;
  mfeSum: number;
  mfeCount: number;
  maeSum: number;
  maeCount: number;
  timeToActivationSum: number;
  timeToActivationCount: number;
  timeToTp1Sum: number;
  timeToTp1Count: number;
  timeToStopSum: number;
  timeToStopCount: number;
  timeFromActivationToTp1Sum: number;
  timeFromActivationToTp1Count: number;
  timeFromActivationToStopSum: number;
  timeFromActivationToStopCount: number;
  vetoReasonCounts: Map<NoTradeReasonCode, number>;
};

type AnalyticsSnapshot = {
  pair: string;
  session: SessionLabel;
  regime: SignalRegime;
  confidence: number;
  confidenceBucket: SignalConfidenceBucket;
  weekday: AnalyticsWeekday;
  vetoReasons: NoTradeReasonCode[];
  activated: boolean;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  stoppedOut: boolean;
  expired: boolean;
  cancelled: boolean;
  expiredBeforeActivation: boolean;
  mfe: number | null;
  mae: number | null;
  timeToActivation: number | null;
  timeToTp1: number | null;
  timeToStop: number | null;
  timeFromActivationToTp1: number | null;
  timeFromActivationToStop: number | null;
  plannedRiskReward: number | null;
};

type VetoSliceAccumulator = {
  pair: string;
  session: SessionLabel;
  regime: SignalRegime;
  count: number;
};

type TimingAccumulator = {
  pair: string;
  session: SessionLabel;
  signalsIssued: number;
  signalsActivated: number;
  expiredBeforeActivationCount: number;
  timeToActivationSum: number;
  timeToActivationCount: number;
  timeFromActivationToTp1Sum: number;
  timeFromActivationToTp1Count: number;
  timeFromActivationToStopSum: number;
  timeFromActivationToStopCount: number;
};

type PairSessionMetrics = {
  session: SessionLabel;
  metrics: SignalQualityMetrics;
  activationRate: number;
  expiryBeforeActivationRate: number;
};

const ACTIVATED_STATES: SignalLifecycleState[] = [
  "activated",
  "tp1_hit",
  "tp2_hit",
  "tp3_hit",
  "stopped_out",
];

function createQualityAccumulator(): QualityAccumulator {
  return {
    signalsIssued: 0,
    signalsActivated: 0,
    vetoCount: 0,
    tp1HitCount: 0,
    tp2HitCount: 0,
    tp3HitCount: 0,
    stopOutCount: 0,
    expiryCount: 0,
    cancellationCount: 0,
    mfeSum: 0,
    mfeCount: 0,
    maeSum: 0,
    maeCount: 0,
    timeToActivationSum: 0,
    timeToActivationCount: 0,
    timeToTp1Sum: 0,
    timeToTp1Count: 0,
    timeToStopSum: 0,
    timeToStopCount: 0,
    timeFromActivationToTp1Sum: 0,
    timeFromActivationToTp1Count: 0,
    timeFromActivationToStopSum: 0,
    timeFromActivationToStopCount: 0,
    vetoReasonCounts: new Map<NoTradeReasonCode, number>(),
  };
}

function createTimingAccumulator(pair: string, session: SessionLabel): TimingAccumulator {
  return {
    pair,
    session,
    signalsIssued: 0,
    signalsActivated: 0,
    expiredBeforeActivationCount: 0,
    timeToActivationSum: 0,
    timeToActivationCount: 0,
    timeFromActivationToTp1Sum: 0,
    timeFromActivationToTp1Count: 0,
    timeFromActivationToStopSum: 0,
    timeFromActivationToStopCount: 0,
  };
}

function resolveConfidenceBucket(confidence: number): SignalConfidenceBucket {
  const percent = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  if (percent < 50) return "0-49%";
  if (percent < 60) return "50-59%";
  if (percent < 70) return "60-69%";
  if (percent < 80) return "70-79%";
  if (percent < 90) return "80-89%";
  return "90-100%";
}

function resolveWeekday(ts: number): AnalyticsWeekday {
  // Use UTC weekdays to keep the analytics deterministic across operator environments.
  return ANALYTICS_WEEKDAY_VALUES[new Date(ts).getUTCDay()] ?? "Sunday";
}

function hasLifecycleEvent(record: SignalLifecycleRecord | null, state: SignalLifecycleState): boolean {
  if (!record) {
    return false;
  }

  return record.state === state || record.events.some(event => event.state === state);
}

function resolveActivationTs(record: SignalLifecycleRecord | null): number | null {
  if (!record) {
    return null;
  }

  if (record.activated_ts != null) {
    return record.activated_ts;
  }

  return record.events.find(event => event.state === "activated")?.ts ?? null;
}

function wasActivated(record: SignalLifecycleRecord | null): boolean {
  if (!record) {
    return false;
  }

  return resolveActivationTs(record) != null || ACTIVATED_STATES.includes(record.state);
}

function calculatePlannedRiskReward(entry: DecisionJournalEntry): number | null {
  if (entry.entry == null || entry.sl == null || entry.tp1 == null) {
    return null;
  }

  const risk = Math.abs(entry.entry - entry.sl);
  const reward = Math.abs(entry.tp1 - entry.entry);
  if (risk <= 0 || reward <= 0) {
    return null;
  }

  return reward / risk;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function confidenceBucketLowerBound(bucket: SignalConfidenceBucket): number {
  const match = /^(\d+)/.exec(bucket);
  if (!match) {
    return 0;
  }

  return Number(match[1]) / 100;
}

function roundThreshold(value: number): number {
  return Math.round(value * 100) / 100;
}

function finalizeAverage(sum: number, count: number): number | null {
  return count === 0 ? null : sum / count;
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: readonly number[]): number | null {
  const mean = average(values);
  if (mean == null || values.length < 2) {
    return null;
  }

  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function difference(current: number | null, next: number | null): number | null {
  if (current == null || next == null) {
    return null;
  }

  return next - current;
}

function incrementCount<T>(map: Map<T, number>, key: T): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function applyAnalyticsSnapshot(accumulator: QualityAccumulator, snapshot: AnalyticsSnapshot): void {
  accumulator.signalsIssued += 1;
  if (snapshot.activated) {
    accumulator.signalsActivated += 1;
  }
  if (snapshot.vetoReasons.length > 0) {
    accumulator.vetoCount += 1;
  }
  if (snapshot.tp1Hit) {
    accumulator.tp1HitCount += 1;
  }
  if (snapshot.tp2Hit) {
    accumulator.tp2HitCount += 1;
  }
  if (snapshot.tp3Hit) {
    accumulator.tp3HitCount += 1;
  }
  if (snapshot.stoppedOut) {
    accumulator.stopOutCount += 1;
  }
  if (snapshot.expired) {
    accumulator.expiryCount += 1;
  }
  if (snapshot.cancelled) {
    accumulator.cancellationCount += 1;
  }
  if (snapshot.mfe != null) {
    accumulator.mfeSum += snapshot.mfe;
    accumulator.mfeCount += 1;
  }
  if (snapshot.mae != null) {
    accumulator.maeSum += snapshot.mae;
    accumulator.maeCount += 1;
  }
  if (snapshot.timeToActivation != null) {
    accumulator.timeToActivationSum += snapshot.timeToActivation;
    accumulator.timeToActivationCount += 1;
  }
  if (snapshot.timeToTp1 != null) {
    accumulator.timeToTp1Sum += snapshot.timeToTp1;
    accumulator.timeToTp1Count += 1;
  }
  if (snapshot.timeToStop != null) {
    accumulator.timeToStopSum += snapshot.timeToStop;
    accumulator.timeToStopCount += 1;
  }
  if (snapshot.timeFromActivationToTp1 != null) {
    accumulator.timeFromActivationToTp1Sum += snapshot.timeFromActivationToTp1;
    accumulator.timeFromActivationToTp1Count += 1;
  }
  if (snapshot.timeFromActivationToStop != null) {
    accumulator.timeFromActivationToStopSum += snapshot.timeFromActivationToStop;
    accumulator.timeFromActivationToStopCount += 1;
  }

  for (const reason of snapshot.vetoReasons) {
    accumulator.vetoReasonCounts.set(reason, (accumulator.vetoReasonCounts.get(reason) ?? 0) + 1);
  }
}

function applyTimingSnapshot(accumulator: TimingAccumulator, snapshot: AnalyticsSnapshot): void {
  accumulator.signalsIssued += 1;
  if (snapshot.activated) {
    accumulator.signalsActivated += 1;
  }
  if (snapshot.expiredBeforeActivation) {
    accumulator.expiredBeforeActivationCount += 1;
  }
  if (snapshot.timeToActivation != null) {
    accumulator.timeToActivationSum += snapshot.timeToActivation;
    accumulator.timeToActivationCount += 1;
  }
  if (snapshot.timeFromActivationToTp1 != null) {
    accumulator.timeFromActivationToTp1Sum += snapshot.timeFromActivationToTp1;
    accumulator.timeFromActivationToTp1Count += 1;
  }
  if (snapshot.timeFromActivationToStop != null) {
    accumulator.timeFromActivationToStopSum += snapshot.timeFromActivationToStop;
    accumulator.timeFromActivationToStopCount += 1;
  }
}

function finalizeSignalQualityMetrics(accumulator: QualityAccumulator): SignalQualityMetrics {
  const totalVetoReasonCount = [...accumulator.vetoReasonCounts.values()].reduce((sum, count) => sum + count, 0);

  return {
    signals_issued: accumulator.signalsIssued,
    signals_activated: accumulator.signalsActivated,
    veto_count: accumulator.vetoCount,
    veto_reason_distribution: [...accumulator.vetoReasonCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => ({
        reason,
        count,
        percentage_of_group_vetoes: totalVetoReasonCount === 0 ? 0 : count / totalVetoReasonCount,
      })),
    tp1_hit_count: accumulator.tp1HitCount,
    tp2_hit_count: accumulator.tp2HitCount,
    tp3_hit_count: accumulator.tp3HitCount,
    stop_out_count: accumulator.stopOutCount,
    expiry_count: accumulator.expiryCount,
    cancellation_count: accumulator.cancellationCount,
    tp1_hit_rate: accumulator.signalsActivated === 0 ? 0 : accumulator.tp1HitCount / accumulator.signalsActivated,
    tp2_hit_rate: accumulator.signalsActivated === 0 ? 0 : accumulator.tp2HitCount / accumulator.signalsActivated,
    tp3_hit_rate: accumulator.signalsActivated === 0 ? 0 : accumulator.tp3HitCount / accumulator.signalsActivated,
    stop_out_rate: accumulator.signalsActivated === 0 ? 0 : accumulator.stopOutCount / accumulator.signalsActivated,
    expiry_rate: accumulator.signalsIssued === 0 ? 0 : accumulator.expiryCount / accumulator.signalsIssued,
    cancellation_rate: accumulator.signalsIssued === 0 ? 0 : accumulator.cancellationCount / accumulator.signalsIssued,
    average_mfe: finalizeAverage(accumulator.mfeSum, accumulator.mfeCount),
    average_mae: finalizeAverage(accumulator.maeSum, accumulator.maeCount),
    average_time_to_activation_ms: finalizeAverage(accumulator.timeToActivationSum, accumulator.timeToActivationCount),
    average_time_to_tp1_ms: finalizeAverage(accumulator.timeToTp1Sum, accumulator.timeToTp1Count),
    average_time_to_stop_ms: finalizeAverage(accumulator.timeToStopSum, accumulator.timeToStopCount),
  };
}

function finalizeTimingDiagnostic(accumulator: TimingAccumulator): SignalTimingDiagnosticRow {
  return {
    pair: accumulator.pair,
    session: accumulator.session,
    signals_issued: accumulator.signalsIssued,
    signals_activated: accumulator.signalsActivated,
    activation_rate: accumulator.signalsIssued === 0 ? 0 : accumulator.signalsActivated / accumulator.signalsIssued,
    expiry_before_activation_rate: accumulator.signalsIssued === 0 ? 0 : accumulator.expiredBeforeActivationCount / accumulator.signalsIssued,
    average_time_to_activation_ms: finalizeAverage(accumulator.timeToActivationSum, accumulator.timeToActivationCount),
    average_time_from_activated_to_tp1_ms: finalizeAverage(accumulator.timeFromActivationToTp1Sum, accumulator.timeFromActivationToTp1Count),
    average_time_from_activated_to_stop_ms: finalizeAverage(accumulator.timeFromActivationToStopSum, accumulator.timeFromActivationToStopCount),
  };
}

const SESSION_SORT_ORDER: SessionLabel[] = ["asia", "london", "new_york", "overlap", "off_hours"];

function sortSessionLabels(values: readonly SessionLabel[]): SessionLabel[] {
  return [...new Set(values)].sort((left, right) => SESSION_SORT_ORDER.indexOf(left) - SESSION_SORT_ORDER.indexOf(right));
}

function toPairProfileConfigView(pair: string, profile: PairTradingProfile | PairProfileConfigView | null | undefined): PairProfileConfigView | null {
  if (!profile) {
    return null;
  }

  return {
    pair,
    minConfidence: profile.minConfidence,
    minRiskReward: profile.minRiskReward,
    allowedSessions: sortSessionLabels(profile.allowedSessions as SessionLabel[]),
    preferredSessions: sortSessionLabels((profile.preferredSessions ?? profile.allowedSessions) as SessionLabel[]),
    avoidSessions: sortSessionLabels((profile.avoidSessions ?? []) as SessionLabel[]),
    maxSignalsPerDay: profile.maxSignalsPerDay,
    cooldownMinutes: profile.cooldownMinutes ?? 45,
    atrToleranceMultiplier: profile.atrToleranceMultiplier ?? 1,
  };
}

function buildDiffField<T>(current: T | null, proposed: T | null, equals: (left: T | null, right: T | null) => boolean): { current: T | null; proposed: T | null; changed: boolean } {
  return {
    current,
    proposed,
    changed: !equals(current, proposed),
  };
}

function arraysEqual(left: readonly string[] | null, right: readonly string[] | null): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function buildProposedConfigDiff(current: PairProfileConfigView | null, proposed: PairProfileConfigView): ProposedConfigDiff {
  return {
    minConfidence: buildDiffField(current?.minConfidence ?? null, proposed.minConfidence, (left, right) => left === right),
    minRiskReward: buildDiffField(current?.minRiskReward ?? null, proposed.minRiskReward, (left, right) => left === right),
    allowedSessions: buildDiffField(current?.allowedSessions ?? null, proposed.allowedSessions, arraysEqual),
    preferredSessions: buildDiffField(current?.preferredSessions ?? null, proposed.preferredSessions, arraysEqual),
    avoidSessions: buildDiffField(current?.avoidSessions ?? null, proposed.avoidSessions, arraysEqual),
    maxSignalsPerDay: buildDiffField(current?.maxSignalsPerDay ?? null, proposed.maxSignalsPerDay, (left, right) => left === right),
    cooldownMinutes: buildDiffField(current?.cooldownMinutes ?? null, proposed.cooldownMinutes, (left, right) => left === right),
    atrToleranceMultiplier: buildDiffField(current?.atrToleranceMultiplier ?? null, proposed.atrToleranceMultiplier, (left, right) => left === right),
  };
}

function getPairProfile<T>(profiles: Partial<Record<string, T>>, pair: string): T | null {
  return profiles[pair] ?? null;
}

function isTradingSessionLabel(session: SessionLabel): session is Extract<SessionLabel, "asia" | "london" | "new_york"> {
  return session === "asia" || session === "london" || session === "new_york";
}

function resolveSnapshotApprovalStatus(statuses: RecommendationApprovalStatus[]): RecommendationApprovalStatus {
  if (statuses.some(status => status === "proposed")) {
    return "proposed";
  }
  if (statuses.some(status => status === "approved")) {
    return "approved";
  }
  if (statuses.every(status => status === "superseded")) {
    return "superseded";
  }
  return "rejected";
}

function emptySignalQualityMetrics(): SignalQualityMetrics {
  return finalizeSignalQualityMetrics(createQualityAccumulator());
}

function getVetoRate(metrics: SignalQualityMetrics): number {
  return metrics.signals_issued === 0 ? 0 : metrics.veto_count / metrics.signals_issued;
}

function dominantReason(rows: readonly VetoEffectivenessRow[]): NoTradeReasonCode | null {
  return rows[0]?.reason ?? null;
}

function confidenceBucketMidpoint(bucket: SignalConfidenceBucket): number {
  switch (bucket) {
    case "0-49%":
      return 0.245;
    case "50-59%":
      return 0.545;
    case "60-69%":
      return 0.645;
    case "70-79%":
      return 0.745;
    case "80-89%":
      return 0.845;
    case "90-100%":
      return 0.95;
  }
}

export type ExecutionHealth = {
  symbol_canonical: string;
  fill_rate: number;
  avg_slippage_bps: number;
  reject_count: number;
};

export type RiskState = {
  current_drawdown_pct: number;
  portfolio_vol_estimate: number;
};

export class ApexRepository {
  private readonly marketEvents: CanonicalMarketEvent[] = [];
  private readonly featureSnapshots: FeatureSnapshot[] = [];
  private readonly podOutputs: AlphaPodOutput[] = [];
  private readonly allocationIntents: AllocationIntent[] = [];
  private readonly riskDecisions: RiskDecision[] = [];
  private readonly executionIntents: ExecutionIntent[] = [];
  private readonly childOrders: ChildOrderPlan[] = [];
  private readonly signalLifecycles: SignalLifecycleRecord[] = [];
  private readonly canonicalMarketSnapshots: MarketSnapshot[] = [];
  private readonly canonicalTradeCandidates: TradeCandidate[] = [];
  private readonly canonicalRiskEvaluatedCandidates: RiskEvaluatedCandidate[] = [];
  private readonly executableSignals: ExecutableSignal[] = [];
  private readonly canonicalSignalLifecycles: CanonicalSignalLifecycle[] = [];
  private readonly signalViewModels: SignalViewModel[] = [];
  private readonly cycleOutputs: CycleOutput[] = [];
  private readonly decisionJournal: DecisionJournalEntry[] = [];
  private readonly learningFeedback: LearningFeedbackRecord[] = [];
  private readonly recommendationSnapshots: RecommendationSnapshot[] = [];
  private readonly appliedRecommendationHistory: AppliedRecommendationHistoryEntry[] = [];
  private readonly validationRuns: ValidationRun[] = [];
  private readonly modelRegistry: ModelRegistryRecord[] = [];
  private readonly driftLogs: DriftMetrics[] = [];
  private readonly systemEvents: SystemEventRecord[] = [];
  private readonly pairRuntimeStates = new Map<string, TraderPairRuntimeState>();
  private readonly feedHealth = new Map<string, FeedHealthMetrics>();
  private readonly positions = new Map<string, number>();
  private readonly executionHealth = new Map<string, ExecutionHealth>();
  private readonly confidenceMultipliers = new Map<string, number>();
  private readonly quarantinedModules = new Map<string, string>();
  private readonly quarantinedSymbols = new Map<string, string>();

  private readonly mode: RepositoryMode;
  private prismaPromise?: Promise<PrismaClientLike | null>;
  private lastCycleTs: number | null = null;
  private killSwitchActive = false;
  private recoveryMode: RecoveryMode = "normal";
  private readonly riskState: RiskState = {
    current_drawdown_pct: 0,
    portfolio_vol_estimate: 0,
  };

  constructor(options: ApexRepositoryOptions = {}) {
    this.mode = options.mode ?? "memory";
  }

  private async getPrisma() {
    if (this.mode === "memory") {
      return null;
    }

    this.prismaPromise ??= (async () => {
      try {
        const mod = await import("@/lib/prisma");
        return mod.prisma as unknown as PrismaClientLike;
      } catch (error) {
        this.prismaPromise = undefined;
        throw new RepositoryUnavailableError("prisma import", error);
      }
    })();

    return this.prismaPromise;
  }

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private async mirror(model: string, data: Record<string, unknown>) {
    const prisma = await this.getPrisma();
    if (this.mode === "memory") {
      return;
    }
    const target = prisma?.[model];
    if (!target?.create) {
      throw new RepositoryUnavailableError(`${model}.create`);
    }

    try {
      await target.create({ data });
    } catch (error) {
      throw new RepositoryUnavailableError(`${model}.create`, error);
    }
  }

  async verifyPersistenceReadiness(context = "cycle_start"): Promise<boolean> {
    if (this.mode === "memory") {
      return true;
    }

    try {
      const prisma = await this.getPrisma();
      const target = prisma?.systemEvent;
      if (!target?.findFirst) {
        throw new RepositoryUnavailableError("systemEvent.findFirst");
      }

      await target.findFirst({
        select: { id: true },
        orderBy: { ts: "desc" },
      });
      return true;
    } catch (error) {
      logger.error({
        module: "repository",
        message: "Repository persistence preflight failed",
        context,
        error: formatRepositoryError(error),
        cause: error instanceof RepositoryUnavailableError && error.cause != null
          ? formatRepositoryError(error.cause)
          : undefined,
        database_url_configured: Boolean(process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL),
      });
      return false;
    }
  }

  async appendMarketEvent(event: CanonicalMarketEvent, payload: Record<string, unknown>) {
    this.marketEvents.push(event);
    await this.mirror("marketEvent", {
      id: event.event_id,
      eventId: event.event_id,
      tsExchange: new Date(event.ts_exchange),
      tsReceived: new Date(event.ts_received),
      venue: event.venue,
      symbolCanonical: event.symbol_canonical,
      assetClass: event.asset_class,
      eventType: event.event_type,
      sequenceNumber: event.sequence_number,
      payload: this.cloneJson(payload),
      integrityFlags: event.integrity_flags,
    });
  }

  async appendFeatureSnapshot(snapshot: FeatureSnapshot) {
    this.featureSnapshots.push(snapshot);
    await this.mirror("featureSnapshot", {
      id: snapshot.snapshot_id,
      snapshotId: snapshot.snapshot_id,
      ts: new Date(snapshot.ts),
      symbolCanonical: snapshot.symbol_canonical,
      horizon: snapshot.horizon,
      features: this.cloneJson(snapshot.features),
      quality: this.cloneJson(snapshot.quality),
    });
  }

  async appendPodOutput(output: AlphaPodOutput) {
    this.podOutputs.push(output);
    await this.mirror("podOutput", {
      id: createId("dbpod"),
      podId: output.pod_id,
      ts: new Date(output.ts),
      symbolCanonical: output.symbol_canonical,
      decisionHorizon: output.decision_horizon,
      signalType: output.signal_type,
      confidence: output.confidence,
      recommendedAction: output.recommended_action,
      expectedReturn: output.expected_return,
      expectedVolatility: output.expected_volatility,
      winProbability: output.win_probability,
      urgency: output.urgency,
      stateAssessment: output.state_assessment,
      constraints: this.cloneJson(output.constraints),
      diagnostics: this.cloneJson(output.diagnostics),
      modelVersion: output.model_version,
    });
  }

  async appendAllocationIntent(intent: AllocationIntent) {
    this.allocationIntents.push(intent);
    await this.mirror("allocationIntent", {
      id: createId("dballoc"),
      ts: new Date(intent.ts),
      symbolCanonical: intent.symbol_canonical,
      selectedPods: intent.selected_pods,
      podWeights: this.cloneJson(intent.pod_weights),
      targetPosition: intent.target_position,
      confidence: intent.confidence,
      portfolioContext: this.cloneJson(intent.portfolio_context),
      reasonCodes: intent.reason_codes,
    });
  }

  async appendRiskDecision(symbol: string, decision: RiskDecision) {
    this.riskDecisions.push(decision);
    await this.mirror("riskDecision", {
      id: createId("dbrisk"),
      ts: new Date(decision.ts),
      scope: decision.scope,
      symbolCanonical: symbol,
      approvalStatus: decision.approval_status,
      approvedSizeMultiplier: decision.approved_size_multiplier,
      riskCheckResults: this.cloneJson(decision.risk_check_results),
      overrideInstructions: decision.override_instructions,
      deRiskingAction: decision.de_risking_action ?? "none",
      killSwitchActive: decision.kill_switch_active,
    });
  }

  async appendExecutionIntent(intent: ExecutionIntent) {
    this.executionIntents.push(intent);
    await this.mirror("executionIntent", {
      id: intent.intent_id,
      intentId: intent.intent_id,
      ts: new Date(intent.ts),
      symbolCanonical: intent.symbol_canonical,
      side: intent.side,
      targetSize: intent.target_size,
      urgency: intent.urgency,
      executionStyle: intent.execution_style,
      slippageBudgetBps: intent.slippage_budget_bps,
      constraints: this.cloneJson(intent.constraints),
      fallbackStyle: intent.fallback_style,
    });
  }

  async appendSignalLifecycle(record: SignalLifecycleRecord) {
    this.signalLifecycles.push(record);
  }

  async upsertSignalLifecycle(record: SignalLifecycleRecord) {
    const index = this.signalLifecycles.findIndex(current => current.signal_id === record.signal_id);
    if (index === -1) {
      this.signalLifecycles.push(record);
      return;
    }
    this.signalLifecycles[index] = record;
  }

  async appendCanonicalMarketSnapshot(snapshot: MarketSnapshot) {
    this.canonicalMarketSnapshots.push(this.cloneJson(snapshot));
    await this.mirror("marketSnapshot", {
      snapshot_id: snapshot.snapshot_id,
      cycle_id: snapshot.cycle_id,
      symbol: snapshot.symbol,
      timestamp: new Date(snapshot.timestamp),
      features: this.cloneJson(snapshot.features),
      raw_inputs_metadata: this.cloneJson(snapshot.raw_inputs_metadata),
      data_source: snapshot.data_source,
      data_quality_tier: snapshot.data_quality_tier,
      feature_version: snapshot.feature_version,
      market_session_context: this.cloneJson(snapshot.market_session_context),
      publication_session_window: snapshot.publication_session_window,
      session_context: this.cloneJson(snapshot.session_context),
      data_fetch_timestamps: this.cloneJson(snapshot.data_fetch_timestamps),
      created_at: new Date(snapshot.created_at),
    });
  }

  async appendTradeCandidate(candidate: TradeCandidate) {
    this.canonicalTradeCandidates.push(this.cloneJson(candidate));
    await this.mirror("tradeCandidate", {
      candidate_id: candidate.candidate_id,
      cycle_id: candidate.cycle_id,
      snapshot_id: candidate.snapshot_id,
      symbol: candidate.symbol,
      direction: candidate.direction,
      confidence: candidate.confidence,
      size_hint: candidate.size_hint,
      allocator_version: candidate.allocator_version,
      pod_votes: this.cloneJson(candidate.pod_votes),
      supporting_evidence: this.cloneJson(candidate.supporting_evidence),
      allocator_metadata: this.cloneJson(candidate.allocator_metadata),
      directional_attribution: this.cloneJson(candidate.directional_attribution),
      veto_attribution: this.cloneJson(candidate.veto_attribution),
      confidence_breakdown: this.cloneJson(candidate.confidence_breakdown),
      proposed_trade_plan: this.cloneJson(candidate.proposed_trade_plan),
      status: candidate.status,
      created_at: new Date(candidate.created_at),
    });
  }

  async appendRiskEvaluatedCandidate(candidate: RiskEvaluatedCandidate) {
    this.canonicalRiskEvaluatedCandidates.push(this.cloneJson(candidate));
    await this.mirror("riskEvaluatedCandidate", {
      candidate_id: candidate.candidate_id,
      cycle_id: candidate.cycle_id,
      decision: candidate.decision,
      blocking_rules: candidate.blocking_rules,
      warnings: candidate.warnings,
      size_adjustments: this.cloneJson(candidate.size_adjustments),
      policy_evaluations: this.cloneJson(candidate.policy_evaluations),
      risk_version: candidate.risk_version,
      approved_trade_plan: this.cloneJson(candidate.approved_trade_plan),
      authoritative_source: candidate.authoritative_source,
      shadow_decision: candidate.shadow_decision,
      shadow_mismatch: candidate.shadow_mismatch,
      shadow_blocking_rules: candidate.shadow_blocking_rules,
      shadow_adjustments: this.cloneJson(candidate.shadow_adjustments),
      explainability_score: candidate.explainability_score,
      created_at: new Date(candidate.created_at),
    });
  }

  async appendRiskShadowLog(input: {
    cycleId: string;
    symbol: string;
    legacyDecision: string;
    shadowDecision: string;
    matched: boolean;
    divergentRules: string;
    legacyRuleCodes: string;
    shadowRuleCodes: string;
  }) {
    if (this.mode === "memory") {
      try {
        const mod = await import("@/lib/prisma");
        const target = (mod.prisma as unknown as PrismaClientLike)?.riskShadowLog;
        await target?.create?.({
          data: {
            cycleId: input.cycleId,
            symbol: input.symbol,
            legacyDecision: input.legacyDecision,
            shadowDecision: input.shadowDecision,
            matched: input.matched,
            divergentRules: input.divergentRules,
            legacyRuleCodes: input.legacyRuleCodes,
            shadowRuleCodes: input.shadowRuleCodes,
          },
        });
      } catch {
        return;
      }
      return;
    }

    await this.mirror("riskShadowLog", {
      cycleId: input.cycleId,
      symbol: input.symbol,
      legacyDecision: input.legacyDecision,
      shadowDecision: input.shadowDecision,
      matched: input.matched,
      divergentRules: input.divergentRules,
      legacyRuleCodes: input.legacyRuleCodes,
      shadowRuleCodes: input.shadowRuleCodes,
    });
  }

  async appendExecutableSignal(signal: ExecutableSignal) {
    this.executableSignals.push(this.cloneJson(signal));
    await this.mirror("executableSignal", {
      signal_id: signal.signal_id,
      cycle_id: signal.cycle_id,
      candidate_id: signal.candidate_id,
      symbol: signal.symbol,
      direction: signal.direction,
      size: signal.size,
      entry: signal.entry,
      stop_loss: signal.stop_loss,
      take_profit: this.cloneJson(signal.take_profit),
      status: signal.status,
      created_at: new Date(signal.created_at),
      version: signal.version,
    });
  }

  async appendCanonicalSignalLifecycle(lifecycle: CanonicalSignalLifecycle) {
    this.canonicalSignalLifecycles.push(this.cloneJson(lifecycle));
    await this.mirror("signalLifecycle", {
      signal_id: lifecycle.signal_id,
      current_state: lifecycle.current_state,
      fill_status: lifecycle.fill_status,
      opened_at: lifecycle.opened_at == null ? null : new Date(lifecycle.opened_at),
      updated_at: new Date(lifecycle.updated_at),
      closed_at: lifecycle.closed_at == null ? null : new Date(lifecycle.closed_at),
      pnl: lifecycle.pnl,
      execution_events: this.cloneJson(lifecycle.execution_events),
    });
  }

  async appendSignalViewModel(view: SignalViewModel) {
    const preparedView = prepareSignalViewModelForPersistence(view);
    this.signalViewModels.push(this.cloneJson(preparedView));
    await this.mirror("signalViewModel", {
      view_id: preparedView.view_id,
      entity_ref: preparedView.entity_ref,
      display_type: preparedView.display_type,
      headline: preparedView.headline,
      summary: preparedView.summary,
      reason_labels: preparedView.reason_labels,
      confidence_label: preparedView.confidence_label,
      ui_sections: this.cloneJson(preparedView.ui_sections),
      commentary: this.cloneJson(preparedView.commentary),
      ui_version: preparedView.ui_version,
      generated_at: new Date(preparedView.generated_at),
    });
  }

  async appendCycleOutput(cycleOutput: CycleOutput) {
    const existingIndex = this.cycleOutputs.findIndex(item => item.cycle_id === cycleOutput.cycle_id);
    if (existingIndex === -1) {
      this.cycleOutputs.push(this.cloneJson(cycleOutput));
    } else {
      this.cycleOutputs[existingIndex] = this.cloneJson(cycleOutput);
    }

    await this.mirror("cycleOutput", {
      cycle_id: cycleOutput.cycle_id,
      started_at: new Date(cycleOutput.started_at),
      completed_at: new Date(cycleOutput.completed_at),
      symbols_processed: cycleOutput.symbols_processed,
      snapshots: this.cloneJson(cycleOutput.snapshots),
      candidates: this.cloneJson(cycleOutput.candidates),
      risk_results: this.cloneJson(cycleOutput.risk_results),
      signals: this.cloneJson(cycleOutput.signals),
      metadata: this.cloneJson(cycleOutput.metadata),
      versions: this.cloneJson(cycleOutput.versions),
      pipeline_status: cycleOutput.pipeline_status,
      payload_source: cycleOutput.payload_source,
    });
  }

  async appendChildOrders(orders: ChildOrderPlan[]) {
    this.childOrders.push(...orders);
    for (const order of orders) {
      await this.mirror("childOrder", {
        id: order.child_order_id,
        childOrderId: order.child_order_id,
        intentId: order.intent_id,
        ts: new Date(order.ts),
        symbolCanonical: order.symbol_canonical,
        side: order.side,
        size: order.size,
        executionStyle: order.execution_style,
        limitPrice: order.limit_price,
        expectedSlippageBps: order.expected_slippage_bps,
        status: order.status,
        notes: order.notes,
      });
    }
  }

  async appendDecisionJournal(entry: DecisionJournalEntry) {
    this.decisionJournal.push(entry);
    await this.mirror("decisionJournal", {
      id: entry.decision_id,
      decisionId: entry.decision_id,
      ts: new Date(entry.ts),
      symbolCanonical: entry.symbol_canonical,
      marketSnapshotRef: entry.market_snapshot_ref,
      podOutputRefs: entry.pod_output_refs,
      allocationRef: entry.allocation_ref,
      riskDecisionRef: entry.risk_decision_ref,
      executionIntentRef: entry.execution_intent_ref,
      finalAction: entry.final_action,
      humanSummary: entry.human_summary,
    });
  }

  async appendLearningFeedback(record: LearningFeedbackRecord) {
    this.learningFeedback.push(record);
    await this.mirror("learningFeedback", {
      id: record.feedback_id,
      feedbackId: record.feedback_id,
      decisionRef: record.decision_ref,
      outcomeWindow: record.outcome_window,
      realizedPnl: record.realized_pnl,
      realizedSlippageBps: record.realized_slippage_bps,
      forecastAccuracy: record.forecast_accuracy,
      attribution: this.cloneJson(record.attribution),
      driftFlags: record.drift_flags,
      recommendedUpdateScope: record.recommended_update_scope,
    });
  }

  async appendModelRegistry(record: ModelRegistryRecord) {
    this.modelRegistry.push(record);
    await this.mirror("modelRegistry", {
      id: createId("dbmodel"),
      podId: record.pod_id,
      version: record.version,
      trainedAt: new Date(record.trained_at),
      status: record.status,
      validationScore: record.validation_score,
      deploymentStatus: record.deployment_status,
    });
  }

  async appendDriftLog(log: DriftMetrics) {
    this.driftLogs.push(log);
    await this.mirror("driftLog", {
      id: createId("dbdrift"),
      podId: log.pod_id,
      ts: new Date(log.ts),
      predictionAccuracy7d: log.prediction_accuracy_7d,
      predictionAccuracy30d: log.prediction_accuracy_30d,
      confidenceCalibrationError: log.confidence_calibration_error,
      featureDistributionShift: log.feature_distribution_shift,
      driftFlags: log.drift_flags,
      recommendedUpdateScope: log.recommended_update_scope,
    });
  }

  async appendSystemEvent(event: SystemEventRecord) {
    this.systemEvents.push(event);
    try {
      await this.mirror("systemEvent", {
        id: event.event_id,
        eventId: event.event_id,
        ts: new Date(event.ts),
        module: event.module,
        type: event.type,
        reason: event.reason,
        payload: this.cloneJson(event.payload),
      });
    } catch (error) {
      logger.error({
        module: "repository",
        message: "Failed to persist system event; continuing cycle with in-memory event only",
        event_module: event.module,
        event_type: event.type,
        reason: event.reason,
        error: formatRepositoryError(error),
        cause: error instanceof RepositoryUnavailableError && error.cause != null
          ? formatRepositoryError(error.cause)
          : undefined,
      });
    }
  }

  getSystemEvents(): SystemEventRecord[] {
    return [...this.systemEvents];
  }

  async upsertTraderPairRuntimeState(state: TraderPairRuntimeState): Promise<void> {
    this.pairRuntimeStates.set(state.symbol, this.cloneJson(state));
    await this.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: state.generatedAt,
      module: "trader-runtime",
      type: "pair_runtime_state_updated",
      reason: state.diagnostics.unavailableReason ?? state.card?.status ?? "snapshot_available",
      payload: this.cloneJson(state),
    });
  }

  getLiveTraderPairRuntimeStates(symbols?: string[]): TraderPairRuntimeState[] {
    return [...this.pairRuntimeStates.values()]
      .filter(state => !symbols || symbols.includes(state.symbol))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  private isTraderPairRuntimeState(value: unknown): value is TraderPairRuntimeState {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as Partial<TraderPairRuntimeState>;
    return typeof candidate.symbol === "string"
      && typeof candidate.generatedAt === "number"
      && typeof candidate.cycleId === "string"
      && candidate.liveMarket != null
      && candidate.marketReasoning != null
      && candidate.keyAreas != null
      && candidate.diagnostics != null;
  }

  async getPersistedTraderPairRuntimeStates(symbols?: string[]): Promise<TraderPairRuntimeState[]> {
    if (this.mode === "memory") {
      return this.getLiveTraderPairRuntimeStates(symbols);
    }

    const prisma = await this.getPrisma();
    const target = prisma?.systemEvent;
    if (!target?.findMany) {
      throw new RepositoryUnavailableError("systemEvent.findMany");
    }

    try {
      const rows = await target.findMany({
        where: {
          type: "pair_runtime_state_updated",
        },
        orderBy: {
          ts: "desc",
        },
        take: Math.max(200, (symbols?.length ?? 0) * 20),
      }) as Array<{ payload?: unknown }>;

      const latest = new Map<string, TraderPairRuntimeState>();
      for (const row of rows) {
        const payload = row?.payload;
        if (!this.isTraderPairRuntimeState(payload)) {
          continue;
        }
        if (symbols && !symbols.includes(payload.symbol)) {
          continue;
        }
        const current = latest.get(payload.symbol);
        if (!current || payload.generatedAt >= current.generatedAt) {
          latest.set(payload.symbol, this.cloneJson(payload));
        }
      }

      return [...latest.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
    } catch (error) {
      throw new RepositoryUnavailableError("systemEvent.findMany", error);
    }
  }

  async getLatestTraderPairRuntimeStates(symbols?: string[]): Promise<TraderPairRuntimeState[]> {
    if (this.mode === "memory") {
      return this.getLiveTraderPairRuntimeStates(symbols);
    }

    const merged = new Map<string, TraderPairRuntimeState>();
    for (const state of await this.getPersistedTraderPairRuntimeStates(symbols)) {
      merged.set(state.symbol, state);
    }

    return [...merged.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  setFeedHealth(metric: FeedHealthMetrics) {
    this.feedHealth.set(metric.symbol_canonical, metric);
  }

  getFeedHealth(): FeedHealthMetrics[] {
    return [...this.feedHealth.values()].sort((left, right) => left.symbol_canonical.localeCompare(right.symbol_canonical));
  }

  getLatestFeatureSnapshot(symbol: string): FeatureSnapshot | null {
    return [...this.featureSnapshots].reverse().find(snapshot => snapshot.symbol_canonical === symbol) ?? null;
  }

  getLatestFeatureSnapshots(symbols?: string[]): FeatureSnapshot[] {
    const latest = new Map<string, FeatureSnapshot>();
    for (const snapshot of this.featureSnapshots) {
      if (symbols && !symbols.includes(snapshot.symbol_canonical)) {
        continue;
      }
      latest.set(snapshot.symbol_canonical, snapshot);
    }
    return [...latest.values()];
  }

  getLatestPodOutputs(symbol?: string): AlphaPodOutput[] {
    const latest = new Map<string, AlphaPodOutput>();
    for (const output of this.podOutputs) {
      if (symbol && output.symbol_canonical !== symbol) {
        continue;
      }
      latest.set(`${output.symbol_canonical}:${output.pod_id}`, output);
    }
    return [...latest.values()];
  }

  getPodOutputsForSymbol(symbol: string): AlphaPodOutput[] {
    return this.getLatestPodOutputs(symbol).filter(output => output.symbol_canonical === symbol);
  }

  getPodOutputHistory(input?: {
    pod_id?: string;
    symbol?: string;
    limit?: number;
  }): AlphaPodOutput[] {
    const limit = input?.limit ?? 100;
    return [...this.podOutputs]
      .filter(output => {
        if (input?.pod_id && output.pod_id !== input.pod_id) {
          return false;
        }
        if (input?.symbol && output.symbol_canonical !== input.symbol) {
          return false;
        }
        return true;
      })
      .slice(-limit)
      .reverse();
  }

  getLatestAllocations(limit = 100): AllocationIntent[] {
    return [...this.allocationIntents].slice(-limit).reverse();
  }

  getLatestSignalCandidates(limit = 100): AllocationIntent[] {
    return this.getLatestAllocations(limit);
  }

  getRecentRiskDecisions(limit = 100): RiskDecision[] {
    return [...this.riskDecisions].slice(-limit).reverse();
  }

  getDecisionJournal(limit = 100): DecisionJournalEntry[] {
    return [...this.decisionJournal].slice(-limit).reverse();
  }

  getSignalLifecycles(input?: {
    symbol?: string;
    activeOnly?: boolean;
    limit?: number;
  }): SignalLifecycleRecord[] {
    const limit = input?.limit ?? 100;
    return [...this.signalLifecycles]
      .filter(record => {
        if (input?.symbol && record.symbol_canonical !== input.symbol) {
          return false;
        }
        if (input?.activeOnly) {
          return ["signal_created", "pending_trigger", "activated", "tp1_hit", "tp2_hit"].includes(record.state);
        }
        return true;
      })
      .slice(-limit)
      .reverse();
  }

  getMarketSnapshotsForCycle(cycleId: string): MarketSnapshot[] {
    return this.canonicalMarketSnapshots
      .filter(snapshot => snapshot.cycle_id === cycleId)
      .map(snapshot => this.cloneJson(snapshot));
  }

  getTradeCandidatesForCycle(cycleId: string): TradeCandidate[] {
    return this.canonicalTradeCandidates
      .filter(candidate => candidate.cycle_id === cycleId)
      .map(candidate => this.cloneJson(candidate));
  }

  getRiskEvaluatedCandidatesForCycle(cycleId: string): RiskEvaluatedCandidate[] {
    return this.canonicalRiskEvaluatedCandidates
      .filter(candidate => candidate.cycle_id === cycleId)
      .map(candidate => this.cloneJson(candidate));
  }

  getExecutableSignalsForCycle(cycleId: string): ExecutableSignal[] {
    return this.executableSignals
      .filter(signal => signal.cycle_id === cycleId)
      .map(signal => this.cloneJson(signal));
  }

  getLatestExecutableSignalByCandidateId(candidateId: string): ExecutableSignal | null {
    const signal = [...this.executableSignals]
      .reverse()
      .find(item => item.candidate_id === candidateId || item.signal_id === candidateId);
    return signal ? this.cloneJson(signal) : null;
  }

  getSignalViewModelsForCycle(cycleId: string): SignalViewModel[] {
    const refs = new Set<string>([
      ...this.getMarketSnapshotsForCycle(cycleId).map(snapshot => snapshot.snapshot_id),
      ...this.getTradeCandidatesForCycle(cycleId).map(candidate => candidate.candidate_id),
      ...this.getExecutableSignalsForCycle(cycleId).map(signal => signal.signal_id),
    ]);

    return this.signalViewModels
      .filter(view => refs.has(view.entity_ref))
      .map(view => this.cloneJson(view));
  }

  getCanonicalSignalLifecycle(signalId: string): CanonicalSignalLifecycle[] {
    return this.canonicalSignalLifecycles
      .filter(lifecycle => lifecycle.signal_id === signalId)
      .map(lifecycle => this.cloneJson(lifecycle));
  }

  getCycleOutput(cycleId: string): CycleOutput | null {
    const cycleOutput = this.cycleOutputs.find(item => item.cycle_id === cycleId);
    return cycleOutput ? this.cloneJson(cycleOutput) : null;
  }

  getLatestCycleOutput(): CycleOutput | null {
    const cycleOutput = this.cycleOutputs.at(-1);
    return cycleOutput ? this.cloneJson(cycleOutput) : null;
  }

  queryDecisionJournal(filters: {
    symbol?: string;
    final_action?: DecisionJournalEntry["final_action"];
    from_ts?: number;
    to_ts?: number;
  }): DecisionJournalEntry[] {
    return this.decisionJournal.filter(entry => {
      if (filters.symbol && entry.symbol_canonical !== filters.symbol) {
        return false;
      }
      if (filters.final_action && entry.final_action !== filters.final_action) {
        return false;
      }
      if (filters.from_ts && entry.ts < filters.from_ts) {
        return false;
      }
      if (filters.to_ts && entry.ts > filters.to_ts) {
        return false;
      }
      return true;
    });
  }

  getSignalQualityReport(input?: {
    symbols?: string[];
    fromTs?: number;
    toTs?: number;
    primaryEntryStyle?: SignalEntryStyle;
    enabledEntryStyles?: SignalEntryStyle[];
    pairProfiles?: Partial<Record<string, PairTradingProfile>>;
  }): SignalQualityReport {
    const scopedSymbols = input?.symbols != null && input.symbols.length > 0
      ? [...new Set(input.symbols)]
      : [];
    const lifecycleBySignal = new Map<string, SignalLifecycleRecord>();

    for (const record of this.signalLifecycles) {
      const current = lifecycleBySignal.get(record.signal_id);
      if (!current || record.updated_ts >= current.updated_ts) {
        lifecycleBySignal.set(record.signal_id, record);
      }
    }

    // Keep the operator report aligned to the active FX scope from runtime config.
    const analyticsRows = this.decisionJournal
      .filter(entry => {
        if (scopedSymbols.length > 0 && !scopedSymbols.includes(entry.symbol_canonical)) {
          return false;
        }
        if (input?.fromTs != null && entry.ts < input.fromTs) {
          return false;
        }
        if (input?.toTs != null && entry.ts > input.toTs) {
          return false;
        }
        return true;
      })
      .map(entry => {
        const lifecycle = lifecycleBySignal.get(entry.signal_id) ?? null;
        const activated = wasActivated(lifecycle);
        const activationTs = resolveActivationTs(lifecycle);
        const createdTs = lifecycle?.created_ts ?? entry.ts;
        const timeToActivation = activationTs != null ? Math.max(0, activationTs - createdTs) : null;
        const timeToTp1 = lifecycle?.time_to_tp1_ms ?? null;
        const timeToStop = lifecycle?.time_to_sl_ms ?? null;
        const timeFromActivationToTp1 = activationTs != null && timeToTp1 != null
          ? Math.max(0, timeToTp1 - (activationTs - createdTs))
          : null;
        const timeFromActivationToStop = activationTs != null && timeToStop != null
          ? Math.max(0, timeToStop - (activationTs - createdTs))
          : null;
        const expired = hasLifecycleEvent(lifecycle, "expired");

        return {
          pair: entry.pair || entry.symbol_canonical,
          session: entry.session,
          regime: entry.regime,
          confidence: entry.confidence,
          confidenceBucket: resolveConfidenceBucket(entry.confidence),
          weekday: resolveWeekday(entry.ts),
          vetoReasons: [...entry.veto_reasons],
          activated,
          tp1Hit: hasLifecycleEvent(lifecycle, "tp1_hit") || lifecycle?.time_to_tp1_ms != null,
          tp2Hit: hasLifecycleEvent(lifecycle, "tp2_hit"),
          tp3Hit: hasLifecycleEvent(lifecycle, "tp3_hit"),
          stoppedOut: hasLifecycleEvent(lifecycle, "stopped_out"),
          expired,
          cancelled: hasLifecycleEvent(lifecycle, "cancelled"),
          expiredBeforeActivation: expired && !activated,
          mfe: activated ? lifecycle?.max_favorable_excursion ?? null : null,
          mae: activated ? lifecycle?.max_adverse_excursion ?? null : null,
          timeToActivation,
          timeToTp1,
          timeToStop,
          timeFromActivationToTp1,
          timeFromActivationToStop,
          plannedRiskReward: calculatePlannedRiskReward(entry),
        } satisfies AnalyticsSnapshot;
      });

    const totals = createQualityAccumulator();
    const byPair = new Map<string, QualityAccumulator>();
    const bySession = new Map<SessionLabel, QualityAccumulator>();
    const byRegime = new Map<SignalRegime, QualityAccumulator>();
    const byConfidenceBucket = new Map<SignalConfidenceBucket, QualityAccumulator>();
    const byWeekday = new Map<AnalyticsWeekday, QualityAccumulator>();
    const bySlice = new Map<string, { key: Omit<SignalQualitySliceRow, keyof SignalQualityMetrics>; metrics: QualityAccumulator }>();
    const confidenceCalibration = new Map<SignalConfidenceBucket, QualityAccumulator>();
    const timingDiagnostics = new Map<string, TimingAccumulator>();
    const vetoEffectiveness = new Map<NoTradeReasonCode, {
      count: number;
      pairCounts: Map<string, number>;
      sessionCounts: Map<SessionLabel, number>;
      regimeCounts: Map<SignalRegime, number>;
      confidenceCounts: Map<SignalConfidenceBucket, number>;
      slices: Map<string, VetoSliceAccumulator>;
    }>();

    for (const row of analyticsRows) {
      applyAnalyticsSnapshot(totals, row);

      const pairMetrics = byPair.get(row.pair) ?? createQualityAccumulator();
      applyAnalyticsSnapshot(pairMetrics, row);
      byPair.set(row.pair, pairMetrics);

      const sessionMetrics = bySession.get(row.session) ?? createQualityAccumulator();
      applyAnalyticsSnapshot(sessionMetrics, row);
      bySession.set(row.session, sessionMetrics);

      const regimeMetrics = byRegime.get(row.regime) ?? createQualityAccumulator();
      applyAnalyticsSnapshot(regimeMetrics, row);
      byRegime.set(row.regime, regimeMetrics);

      const confidenceMetrics = byConfidenceBucket.get(row.confidenceBucket) ?? createQualityAccumulator();
      applyAnalyticsSnapshot(confidenceMetrics, row);
      byConfidenceBucket.set(row.confidenceBucket, confidenceMetrics);

      const calibrationMetrics = confidenceCalibration.get(row.confidenceBucket) ?? createQualityAccumulator();
      applyAnalyticsSnapshot(calibrationMetrics, row);
      confidenceCalibration.set(row.confidenceBucket, calibrationMetrics);

      const weekdayMetrics = byWeekday.get(row.weekday) ?? createQualityAccumulator();
      applyAnalyticsSnapshot(weekdayMetrics, row);
      byWeekday.set(row.weekday, weekdayMetrics);

      const sliceKey = [row.pair, row.session, row.regime, row.confidenceBucket, row.weekday].join("|");
      const sliceMetrics = bySlice.get(sliceKey) ?? {
        key: {
          pair: row.pair,
          session: row.session,
          regime: row.regime,
          confidence_bucket: row.confidenceBucket,
          weekday: row.weekday,
        },
        metrics: createQualityAccumulator(),
      };
      applyAnalyticsSnapshot(sliceMetrics.metrics, row);
      bySlice.set(sliceKey, sliceMetrics);

      const timingKey = `${row.pair}|${row.session}`;
      const timingAccumulator = timingDiagnostics.get(timingKey) ?? createTimingAccumulator(row.pair, row.session);
      applyTimingSnapshot(timingAccumulator, row);
      timingDiagnostics.set(timingKey, timingAccumulator);

      for (const reason of row.vetoReasons) {
        const vetoAccumulator = vetoEffectiveness.get(reason) ?? {
          count: 0,
          pairCounts: new Map<string, number>(),
          sessionCounts: new Map<SessionLabel, number>(),
          regimeCounts: new Map<SignalRegime, number>(),
          confidenceCounts: new Map<SignalConfidenceBucket, number>(),
          slices: new Map<string, VetoSliceAccumulator>(),
        };
        vetoAccumulator.count += 1;
        incrementCount(vetoAccumulator.pairCounts, row.pair);
        incrementCount(vetoAccumulator.sessionCounts, row.session);
        incrementCount(vetoAccumulator.regimeCounts, row.regime);
        incrementCount(vetoAccumulator.confidenceCounts, row.confidenceBucket);
        const vetoSliceKey = [row.pair, row.session, row.regime].join("|");
        const vetoSlice = vetoAccumulator.slices.get(vetoSliceKey) ?? {
          pair: row.pair,
          session: row.session,
          regime: row.regime,
          count: 0,
        };
        vetoSlice.count += 1;
        vetoAccumulator.slices.set(vetoSliceKey, vetoSlice);
        vetoEffectiveness.set(reason, vetoAccumulator);
      }
    }

    const sortByIssued = <T extends SignalQualityMetrics>(left: T, right: T) =>
      right.signals_issued - left.signals_issued
      || right.signals_activated - left.signals_activated;
    const totalVetoes = [...vetoEffectiveness.values()].reduce((sum, row) => sum + row.count, 0);
    const timingRows = [...timingDiagnostics.values()]
      .map(accumulator => finalizeTimingDiagnostic(accumulator))
      .sort((left, right) => right.signals_issued - left.signals_issued
        || left.pair.localeCompare(right.pair)
        || left.session.localeCompare(right.session));

    const pairSessionMetrics = new Map<string, PairSessionMetrics[]>();
    for (const row of timingRows) {
      const sessionQualityAccumulator = analyticsRows
        .filter(sample => sample.pair === row.pair && sample.session === row.session)
        .reduce((accumulator, sample) => {
          applyAnalyticsSnapshot(accumulator, sample);
          return accumulator;
        }, createQualityAccumulator());
      const entries = pairSessionMetrics.get(row.pair) ?? [];
      entries.push({
        session: row.session,
        metrics: finalizeSignalQualityMetrics(sessionQualityAccumulator),
        activationRate: row.activation_rate,
        expiryBeforeActivationRate: row.expiry_before_activation_rate,
      });
      pairSessionMetrics.set(row.pair, entries);
    }

    const pairTuningRecommendations = scopedSymbols.map<PairTuningRecommendation>(pair => {
      const pairRows = analyticsRows.filter(row => row.pair === pair);
      const pairMetrics = finalizeSignalQualityMetrics(pairRows.reduce((accumulator, row) => {
        applyAnalyticsSnapshot(accumulator, row);
        return accumulator;
      }, createQualityAccumulator()));
      const profile = input?.pairProfiles?.[pair];
      const bucketRows = SIGNAL_CONFIDENCE_BUCKETS
        .map(bucket => {
          const samples = pairRows.filter(row => row.confidenceBucket === bucket);
          const metrics = finalizeSignalQualityMetrics(samples.reduce((accumulator, row) => {
            applyAnalyticsSnapshot(accumulator, row);
            return accumulator;
          }, createQualityAccumulator()));
          return {
            bucket,
            metrics,
          };
        })
        .filter(row => row.metrics.signals_issued > 0);
      const preferredCandidates = (pairSessionMetrics.get(pair) ?? [])
        .filter(row => row.metrics.signals_issued > 0);

      const preferredSessions = preferredCandidates
        .filter(row =>
          row.metrics.tp1_hit_rate >= row.metrics.stop_out_rate
          && row.activationRate >= 0.35
          && row.expiryBeforeActivationRate <= 0.4,
        )
        .sort((left, right) =>
          (right.metrics.tp1_hit_rate - right.metrics.stop_out_rate + right.activationRate) -
          (left.metrics.tp1_hit_rate - left.metrics.stop_out_rate + left.activationRate),
        )
        .map(row => row.session);

      const sessionsToAvoid = preferredCandidates
        .filter(row =>
          row.expiryBeforeActivationRate >= 0.5
          || row.metrics.stop_out_rate > row.metrics.tp1_hit_rate
          || row.session === "off_hours",
        )
        .sort((left, right) =>
          (right.expiryBeforeActivationRate + right.metrics.stop_out_rate) -
          (left.expiryBeforeActivationRate + left.metrics.stop_out_rate),
        )
        .map(row => row.session);

      const baseConfidence = profile?.minConfidence ?? 0.58;
      const goodBucket = bucketRows.find(row =>
        row.metrics.signals_issued > 0
        && row.metrics.signals_activated > 0
        && row.metrics.tp1_hit_rate >= row.metrics.stop_out_rate,
      );
      const suggestedMinimumConfidence = roundThreshold(clampNumber(
        Math.max(
          baseConfidence
          + (pairMetrics.stop_out_rate > 0.45 ? 0.05 : 0)
          + (pairMetrics.expiry_rate > 0.3 ? 0.03 : 0)
          - (pairMetrics.tp1_hit_rate > 0.65 && pairMetrics.stop_out_rate < 0.2 ? 0.02 : 0),
          goodBucket ? confidenceBucketLowerBound(goodBucket.bucket) : 0,
        ),
        0.5,
        0.95,
      ));

      const baseRiskReward = profile?.minRiskReward ?? 1.75;
      const observedRiskRewards = pairRows
        .map(row => row.plannedRiskReward)
        .filter((value): value is number => value != null);
      const observedAverageRiskReward = observedRiskRewards.length === 0
        ? null
        : observedRiskRewards.reduce((sum, value) => sum + value, 0) / observedRiskRewards.length;
      const suggestedMinimumRiskReward = roundThreshold(clampNumber(
        baseRiskReward
        + (pairMetrics.stop_out_rate > 0.45 ? 0.15 : 0)
        + (pairMetrics.expiry_rate > 0.3 ? 0.1 : 0)
        - (pairMetrics.tp1_hit_rate > 0.65 && pairMetrics.expiry_rate < 0.15 ? 0.05 : 0)
        + (observedAverageRiskReward != null && observedAverageRiskReward < baseRiskReward ? 0.05 : 0),
        1.4,
        3,
      ));

      const cooldownMinutes = Math.round(clampNumber(
        30
        + (pairMetrics.stop_out_rate * 60)
        + (pairMetrics.expiry_rate * 45)
        + ((pairMetrics.average_time_to_activation_ms ?? 0) / 60_000) * 0.2,
        15,
        180,
      ));
      const suggestedAtrToleranceMultiplier = roundThreshold(clampNumber(
        (profile?.atrToleranceMultiplier ?? 1)
        + (pairMetrics.stop_out_rate > 0.45 ? 0.15 : 0)
        - (pairMetrics.expiry_rate > 0.3 ? 0.1 : 0)
        - (pairMetrics.tp1_hit_rate > 0.65 && pairMetrics.stop_out_rate < 0.2 ? 0.05 : 0),
        0.75,
        1.4,
      ));

      const notes: string[] = [];
      if (pairMetrics.stop_out_rate >= 0.5) {
        notes.push("Stop-out pressure is elevated; raise selectivity and widen quality gating before issuing new signals.");
      }
      if (pairMetrics.expiry_rate >= 0.3) {
        notes.push("A large share of signals are expiring before resolution; favor faster sessions and stricter setup confirmation.");
      }
      if ((pairMetrics.average_time_to_activation_ms ?? 0) > 45 * 60_000) {
        notes.push("Signals are activating slowly; use a longer cooldown and avoid chasing repeat entries in the same session.");
      }
      if (preferredSessions.length > 0) {
        notes.push(`Observed strength is concentrated in ${preferredSessions.join(", ")}.`);
      } else if (profile?.allowedSessions?.length) {
        notes.push(`Observed sample is thin; keep current session bias anchored to ${profile.allowedSessions.join(", ")} until more data accumulates.`);
      } else {
        notes.push("Observed sample is thin; keep thresholds conservative until more signal outcomes accumulate.");
      }

      return {
        pair,
        sample_size: pairMetrics.signals_issued,
        suggested_minimum_confidence_threshold: suggestedMinimumConfidence,
        suggested_minimum_rr_threshold: suggestedMinimumRiskReward,
        suggested_atr_tolerance_multiplier: suggestedAtrToleranceMultiplier,
        preferred_sessions: preferredSessions.length > 0
          ? [...new Set(preferredSessions)]
          : ([...(profile?.allowedSessions ?? [])] as SessionLabel[]),
        sessions_to_avoid: [...new Set(sessionsToAvoid)],
        cooldown_recommendation_minutes: cooldownMinutes,
        activation_rate: pairMetrics.signals_issued === 0 ? 0 : pairMetrics.signals_activated / pairMetrics.signals_issued,
        tp1_hit_rate: pairMetrics.tp1_hit_rate,
        stop_out_rate: pairMetrics.stop_out_rate,
        expiry_rate: pairMetrics.expiry_rate,
        notes,
      };
    }).sort((left, right) => right.sample_size - left.sample_size || left.pair.localeCompare(right.pair));

    return {
      generated_at: Date.now(),
      active_symbols: scopedSymbols,
      primary_entry_style: input?.primaryEntryStyle ?? "support",
      enabled_entry_styles: input?.enabledEntryStyles?.length
        ? [...input.enabledEntryStyles]
        : [input?.primaryEntryStyle ?? "support"],
      totals: finalizeSignalQualityMetrics(totals),
      by_pair: [...byPair.entries()]
        .map(([pair, metrics]): PairSignalQualityRow => ({
          pair,
          ...finalizeSignalQualityMetrics(metrics),
        }))
        .sort((left, right) => sortByIssued(left, right) || left.pair.localeCompare(right.pair)),
      by_session: [...bySession.entries()]
        .map(([session, metrics]): SessionSignalQualityRow => ({
          session,
          ...finalizeSignalQualityMetrics(metrics),
        }))
        .sort((left, right) => sortByIssued(left, right) || left.session.localeCompare(right.session)),
      by_regime: [...byRegime.entries()]
        .map(([regime, metrics]): RegimeSignalQualityRow => ({
          regime,
          ...finalizeSignalQualityMetrics(metrics),
        }))
        .sort((left, right) => sortByIssued(left, right) || left.regime.localeCompare(right.regime)),
      by_confidence_bucket: [...byConfidenceBucket.entries()]
        .map(([confidenceBucket, metrics]): ConfidenceBucketSignalQualityRow => ({
          confidence_bucket: confidenceBucket,
          ...finalizeSignalQualityMetrics(metrics),
        }))
        .sort((left, right) => sortByIssued(left, right) || SIGNAL_CONFIDENCE_BUCKETS.indexOf(left.confidence_bucket) - SIGNAL_CONFIDENCE_BUCKETS.indexOf(right.confidence_bucket)),
      by_weekday: [...byWeekday.entries()]
        .map(([weekday, metrics]): WeekdaySignalQualityRow => ({
          weekday,
          ...finalizeSignalQualityMetrics(metrics),
        }))
        .sort((left, right) => sortByIssued(left, right) || ANALYTICS_WEEKDAY_VALUES.indexOf(left.weekday) - ANALYTICS_WEEKDAY_VALUES.indexOf(right.weekday)),
      by_slice: [...bySlice.values()]
        .map(({ key, metrics }): SignalQualitySliceRow => ({
          ...key,
          ...finalizeSignalQualityMetrics(metrics),
        }))
        .sort((left, right) => sortByIssued(left, right)
          || left.pair.localeCompare(right.pair)
          || left.session.localeCompare(right.session)
          || left.regime.localeCompare(right.regime)),
      confidence_calibration: [...confidenceCalibration.entries()]
        .map(([confidenceBucket, metrics]): ConfidenceCalibrationRow => ({
          confidence_bucket: confidenceBucket,
          signals_vetoed: metrics.vetoCount,
          ...finalizeSignalQualityMetrics(metrics),
        }))
        .sort((left, right) => sortByIssued(left, right)
          || SIGNAL_CONFIDENCE_BUCKETS.indexOf(left.confidence_bucket) - SIGNAL_CONFIDENCE_BUCKETS.indexOf(right.confidence_bucket)),
      pair_tuning_recommendations: pairTuningRecommendations,
      signal_timing_diagnostics: timingRows,
      veto_effectiveness: [...vetoEffectiveness.entries()]
        .map(([reason, accumulator]): VetoEffectivenessRow => ({
          reason,
          count: accumulator.count,
          percentage_of_total_vetoes: totalVetoes === 0 ? 0 : accumulator.count / totalVetoes,
          pair_distribution: [...accumulator.pairCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([pair, count]) => ({
              pair,
              count,
              percentage_of_reason_vetoes: accumulator.count === 0 ? 0 : count / accumulator.count,
            })),
          session_distribution: [...accumulator.sessionCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([session, count]) => ({
              session,
              count,
              percentage_of_reason_vetoes: accumulator.count === 0 ? 0 : count / accumulator.count,
            })),
          regime_distribution: [...accumulator.regimeCounts.entries()]
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([regime, count]) => ({
              regime,
              count,
              percentage_of_reason_vetoes: accumulator.count === 0 ? 0 : count / accumulator.count,
            })),
          confidence_distribution: [...accumulator.confidenceCounts.entries()]
            .sort((left, right) =>
              SIGNAL_CONFIDENCE_BUCKETS.indexOf(left[0]) - SIGNAL_CONFIDENCE_BUCKETS.indexOf(right[0]),
            )
            .map(([confidenceBucket, count]) => ({
              confidence_bucket: confidenceBucket,
              count,
              percentage_of_reason_vetoes: accumulator.count === 0 ? 0 : count / accumulator.count,
            })),
          associated_slices: [...accumulator.slices.values()]
            .sort((left, right) => right.count - left.count
              || left.pair.localeCompare(right.pair)
              || left.session.localeCompare(right.session)
              || left.regime.localeCompare(right.regime))
            .map(slice => ({
              ...slice,
              percentage_of_reason_vetoes: accumulator.count === 0 ? 0 : slice.count / accumulator.count,
            })),
        }))
        .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
    };
  }

  private buildRecommendationPerformanceComparison(input: {
    pair: string;
    appliedAt: number;
    beforeReport: SignalQualityReport;
  }): RecommendationPerformanceComparison {
    const afterReport = this.getSignalQualityReport({
      symbols: [input.pair],
      fromTs: input.appliedAt,
      primaryEntryStyle: input.beforeReport.primary_entry_style,
      enabledEntryStyles: input.beforeReport.enabled_entry_styles,
    });
    const beforeBySession = new Map(input.beforeReport.by_session.map(row => [row.session, row]));
    const afterBySession = new Map(afterReport.by_session.map(row => [row.session, row]));
    const sessions = sortSessionLabels([
      ...beforeBySession.keys(),
      ...afterBySession.keys(),
    ]);

    return {
      pair: input.pair,
      generated_at: Date.now(),
      applied_at: input.appliedAt,
      overall_before: input.beforeReport.totals,
      overall_after: afterReport.totals,
      by_session: sessions.map<RecommendationPerformanceBySession>(session => ({
        session,
        before: beforeBySession.get(session) ?? emptySignalQualityMetrics(),
        after: afterBySession.get(session) ?? emptySignalQualityMetrics(),
      })),
    };
  }

  createRecommendationSnapshot(input: {
    qualityReport: SignalQualityReport;
    currentPairProfiles: Partial<Record<string, PairTradingProfile>>;
  }): RecommendationSnapshot {
    const version = (this.recommendationSnapshots.at(-1)?.version ?? 0) + 1;
    const createdAt = Date.now();

    for (const snapshot of this.recommendationSnapshots) {
      let changed = false;
      snapshot.proposals = snapshot.proposals.map(proposal => {
        if (proposal.approval_status !== "proposed") {
          return proposal;
        }
        changed = true;
        return {
          ...proposal,
          approval_status: "superseded",
        };
      });
      if (changed) {
        snapshot.approval_status = resolveSnapshotApprovalStatus(snapshot.proposals.map(proposal => proposal.approval_status));
      }
    }

    const proposals = input.qualityReport.pair_tuning_recommendations.map<PairProfileProposal>(recommendation => {
      const currentProfile = toPairProfileConfigView(
        recommendation.pair,
        getPairProfile(input.currentPairProfiles, recommendation.pair),
      );
      const preferredSessions = sortSessionLabels(recommendation.preferred_sessions);
      const avoidSessions = sortSessionLabels(recommendation.sessions_to_avoid);
      const allowedSessionsFromPreferred = preferredSessions.filter(isTradingSessionLabel);
      const currentAllowedSessions = currentProfile?.allowedSessions.filter(isTradingSessionLabel) ?? [];
      const allowedSessions = sortSessionLabels(
        (allowedSessionsFromPreferred.length > 0 ? allowedSessionsFromPreferred : currentAllowedSessions)
          .filter(session => !avoidSessions.includes(session)),
      ).filter(isTradingSessionLabel);
      const dominantVeto = input.qualityReport.veto_effectiveness.find(row =>
        row.pair_distribution.some(distribution => distribution.pair === recommendation.pair),
      )?.reason ?? null;

      const proposedProfile: PairProfileConfigView = {
        pair: recommendation.pair,
        minConfidence: recommendation.suggested_minimum_confidence_threshold,
        minRiskReward: recommendation.suggested_minimum_rr_threshold,
        allowedSessions: allowedSessions.length > 0
          ? allowedSessions
          : (currentAllowedSessions.length > 0 ? currentAllowedSessions : ["london"]),
        preferredSessions: preferredSessions.length > 0
          ? preferredSessions
          : (currentProfile?.preferredSessions ?? currentProfile?.allowedSessions ?? ["london"]),
        avoidSessions,
        maxSignalsPerDay: currentProfile?.maxSignalsPerDay ?? 4,
        cooldownMinutes: recommendation.cooldown_recommendation_minutes,
        atrToleranceMultiplier: recommendation.suggested_atr_tolerance_multiplier,
      };

      const diff = buildProposedConfigDiff(currentProfile, proposedProfile);
      const notes = [...recommendation.notes];
      if (!Object.values(diff).some(field => field.changed)) {
        notes.unshift("No material config delta versus the current pair profile.");
      }

      return {
        proposal_id: createId("proposal"),
        pair: recommendation.pair,
        analytics_generated_at: input.qualityReport.generated_at,
        current_profile: currentProfile,
        proposed_profile: proposedProfile,
        proposed_config_diff: diff,
        approval_status: "proposed",
        rationale: [
          `Observed TP1 ${Math.round(recommendation.tp1_hit_rate * 100)}%, stop ${Math.round(recommendation.stop_out_rate * 100)}%, expiry ${Math.round(recommendation.expiry_rate * 100)}%.`,
          `Recommended confidence ${recommendation.suggested_minimum_confidence_threshold.toFixed(2)} and RR ${recommendation.suggested_minimum_rr_threshold.toFixed(2)} for ${recommendation.pair}.`,
          dominantVeto ? `Dominant veto pressure is ${dominantVeto}.` : "No dominant veto pressure was observed for this pair.",
        ],
        notes,
        observed_metrics: {
          signals_issued: recommendation.sample_size,
          signals_activated: Math.round(recommendation.sample_size * recommendation.activation_rate),
          activation_rate: recommendation.activation_rate,
          tp1_hit_rate: recommendation.tp1_hit_rate,
          stop_out_rate: recommendation.stop_out_rate,
          expiry_rate: recommendation.expiry_rate,
          average_time_to_activation_ms: input.qualityReport.signal_timing_diagnostics.find(row =>
            row.pair === recommendation.pair,
          )?.average_time_to_activation_ms ?? null,
          average_time_to_tp1_ms: input.qualityReport.by_pair.find(row =>
            row.pair === recommendation.pair,
          )?.average_time_to_tp1_ms ?? null,
          average_time_to_stop_ms: input.qualityReport.by_pair.find(row =>
            row.pair === recommendation.pair,
          )?.average_time_to_stop_ms ?? null,
          dominant_veto_reason: dominantVeto,
        },
      };
    });

    const snapshot: RecommendationSnapshot = {
      snapshot_id: createId("recsnap"),
      version,
      created_at: createdAt,
      analytics_generated_at: input.qualityReport.generated_at,
      active_symbols: [...input.qualityReport.active_symbols],
      primary_entry_style: input.qualityReport.primary_entry_style,
      enabled_entry_styles: [...input.qualityReport.enabled_entry_styles],
      approval_status: resolveSnapshotApprovalStatus(proposals.map(proposal => proposal.approval_status)),
      proposals,
      notes: [
        "Generated from the current FX intraday calibration layer. No proposals are auto-applied.",
        "Operator approval is required before any pair-profile change mutates the live runtime config.",
      ],
    };

    this.recommendationSnapshots.push(snapshot);
    void this.mirror("recommendationSnapshot", {
      id: snapshot.snapshot_id,
      snapshotId: snapshot.snapshot_id,
      version: snapshot.version,
      createdAt: new Date(snapshot.created_at),
      analyticsGeneratedAt: new Date(snapshot.analytics_generated_at),
      approvalStatus: snapshot.approval_status,
      payload: this.cloneJson(snapshot),
    });

    return snapshot;
  }

  getRecommendationSnapshots(limit = 20): RecommendationSnapshot[] {
    return [...this.recommendationSnapshots]
      .slice(-limit)
      .reverse()
      .map(snapshot => ({
        ...snapshot,
        proposals: snapshot.proposals.map(proposal => ({ ...proposal })),
      }));
  }

  getRecommendationSnapshot(snapshotId: string): RecommendationSnapshot | null {
    const snapshot = this.recommendationSnapshots.find(item => item.snapshot_id === snapshotId);
    if (!snapshot) {
      return null;
    }

    return {
      ...snapshot,
      proposals: snapshot.proposals.map(proposal => ({ ...proposal })),
    };
  }

  getAppliedRecommendationHistory(limit = 50): AppliedRecommendationHistoryEntry[] {
    return [...this.appliedRecommendationHistory]
      .slice(-limit)
      .reverse()
      .map(entry => ({
        ...entry,
        performance_comparison: this.buildRecommendationPerformanceComparison({
          pair: entry.pair,
          appliedAt: entry.applied_at,
          beforeReport: {
            generated_at: entry.performance_comparison.generated_at,
            active_symbols: [entry.pair],
            primary_entry_style: "trend_pullback",
            enabled_entry_styles: ["trend_pullback", "session_breakout", "range_reversal"],
            totals: entry.performance_comparison.overall_before,
            by_pair: [],
            by_session: entry.performance_comparison.by_session.map(row => ({
              session: row.session,
              ...row.before,
            })),
            by_regime: [],
            by_confidence_bucket: [],
            by_weekday: [],
            by_slice: [],
            confidence_calibration: [],
            pair_tuning_recommendations: [],
            signal_timing_diagnostics: [],
            veto_effectiveness: [],
          },
        }),
      }));
  }

  private buildWalkForwardWindow(input: {
    pair: string;
    kind: WalkForwardWindowKind;
    startTs: number;
    endTs: number;
    primaryEntryStyle: SignalEntryStyle;
    enabledEntryStyles: SignalEntryStyle[];
  }): WalkForwardWindow {
    const report = this.getSignalQualityReport({
      symbols: [input.pair],
      fromTs: input.startTs,
      toTs: input.endTs,
      primaryEntryStyle: input.primaryEntryStyle,
      enabledEntryStyles: input.enabledEntryStyles,
    });

    return {
      window_id: createId("wfwin"),
      pair: input.pair,
      kind: input.kind,
      start_ts: input.startTs,
      end_ts: input.endTs,
      metrics: report.totals,
      veto_rate: getVetoRate(report.totals),
      confidence_calibration: report.confidence_calibration,
      session_distribution: report.by_session,
      timing_diagnostics: report.signal_timing_diagnostics,
      veto_effectiveness: report.veto_effectiveness,
    };
  }

  private buildRecommendationDeltaSummary(before: WalkForwardWindow, after: WalkForwardWindow): RecommendationDeltaSummary {
    return {
      signals_issued_delta: after.metrics.signals_issued - before.metrics.signals_issued,
      signals_activated_delta: after.metrics.signals_activated - before.metrics.signals_activated,
      veto_rate_delta: after.veto_rate - before.veto_rate,
      tp1_hit_rate_delta: after.metrics.tp1_hit_rate - before.metrics.tp1_hit_rate,
      tp2_hit_rate_delta: after.metrics.tp2_hit_rate - before.metrics.tp2_hit_rate,
      tp3_hit_rate_delta: after.metrics.tp3_hit_rate - before.metrics.tp3_hit_rate,
      stop_out_rate_delta: after.metrics.stop_out_rate - before.metrics.stop_out_rate,
      expiry_rate_delta: after.metrics.expiry_rate - before.metrics.expiry_rate,
      average_mfe_delta: difference(before.metrics.average_mfe, after.metrics.average_mfe),
      average_mae_delta: difference(before.metrics.average_mae, after.metrics.average_mae),
      average_time_to_activation_ms_delta: difference(
        before.metrics.average_time_to_activation_ms,
        after.metrics.average_time_to_activation_ms,
      ),
      average_time_to_tp1_ms_delta: difference(
        before.metrics.average_time_to_tp1_ms,
        after.metrics.average_time_to_tp1_ms,
      ),
      average_time_to_stop_ms_delta: difference(
        before.metrics.average_time_to_stop_ms,
        after.metrics.average_time_to_stop_ms,
      ),
    };
  }

  private buildConfidenceCalibrationChange(
    inSample: readonly ConfidenceCalibrationRow[],
    outOfSample: readonly ConfidenceCalibrationRow[],
  ): ConfidenceCalibrationChangeRow[] {
    const inSampleMap = new Map(inSample.map(row => [row.confidence_bucket, row]));
    const outSampleMap = new Map(outOfSample.map(row => [row.confidence_bucket, row]));

    return SIGNAL_CONFIDENCE_BUCKETS
      .map<ConfidenceCalibrationChangeRow | null>(bucket => {
        const before = inSampleMap.get(bucket);
        const after = outSampleMap.get(bucket);
        const beforeIssued = before?.signals_issued ?? 0;
        const afterIssued = after?.signals_issued ?? 0;
        if (beforeIssued === 0 && afterIssued === 0) {
          return null;
        }

        return {
          confidence_bucket: bucket,
          in_sample_signals_issued: beforeIssued,
          out_of_sample_signals_issued: afterIssued,
          in_sample_tp1_hit_rate: before?.tp1_hit_rate ?? 0,
          out_of_sample_tp1_hit_rate: after?.tp1_hit_rate ?? 0,
          tp1_hit_rate_delta: (after?.tp1_hit_rate ?? 0) - (before?.tp1_hit_rate ?? 0),
          in_sample_stop_out_rate: before?.stop_out_rate ?? 0,
          out_of_sample_stop_out_rate: after?.stop_out_rate ?? 0,
          stop_out_rate_delta: (after?.stop_out_rate ?? 0) - (before?.stop_out_rate ?? 0),
        };
      })
      .filter((row): row is ConfidenceCalibrationChangeRow => row != null);
  }

  private buildSessionDistributionChange(
    inSample: readonly SessionSignalQualityRow[],
    outOfSample: readonly SessionSignalQualityRow[],
  ): SessionDistributionChangeRow[] {
    const inSampleMap = new Map(inSample.map(row => [row.session, row]));
    const outSampleMap = new Map(outOfSample.map(row => [row.session, row]));
    const sessions = sortSessionLabels([
      ...inSampleMap.keys(),
      ...outSampleMap.keys(),
    ]);

    return sessions
      .map<SessionDistributionChangeRow | null>(session => {
        const before = inSampleMap.get(session);
        const after = outSampleMap.get(session);
        const beforeIssued = before?.signals_issued ?? 0;
        const afterIssued = after?.signals_issued ?? 0;
        if (beforeIssued === 0 && afterIssued === 0) {
          return null;
        }

        return {
          session,
          in_sample_signals_issued: beforeIssued,
          out_of_sample_signals_issued: afterIssued,
          issued_delta: afterIssued - beforeIssued,
          in_sample_tp1_hit_rate: before?.tp1_hit_rate ?? 0,
          out_of_sample_tp1_hit_rate: after?.tp1_hit_rate ?? 0,
          tp1_hit_rate_delta: (after?.tp1_hit_rate ?? 0) - (before?.tp1_hit_rate ?? 0),
          in_sample_stop_out_rate: before?.stop_out_rate ?? 0,
          out_of_sample_stop_out_rate: after?.stop_out_rate ?? 0,
          stop_out_rate_delta: (after?.stop_out_rate ?? 0) - (before?.stop_out_rate ?? 0),
        };
      })
      .filter((row): row is SessionDistributionChangeRow => row != null);
  }

  private resolveRecommendationVerdict(
    deltaSummary: RecommendationDeltaSummary,
    forwardWindow: WalkForwardWindow,
  ): RecommendationEffectivenessVerdict {
    if (forwardWindow.metrics.signals_issued === 0) {
      return "insufficient_data";
    }

    let score = 0;
    score += deltaSummary.tp1_hit_rate_delta >= 0.05 ? 2 : deltaSummary.tp1_hit_rate_delta <= -0.05 ? -2 : 0;
    score += deltaSummary.tp2_hit_rate_delta >= 0.05 ? 1 : deltaSummary.tp2_hit_rate_delta <= -0.05 ? -1 : 0;
    score += deltaSummary.tp3_hit_rate_delta >= 0.05 ? 1 : deltaSummary.tp3_hit_rate_delta <= -0.05 ? -1 : 0;
    score += deltaSummary.stop_out_rate_delta <= -0.05 ? 2 : deltaSummary.stop_out_rate_delta >= 0.05 ? -2 : 0;
    score += deltaSummary.expiry_rate_delta <= -0.05 ? 1 : deltaSummary.expiry_rate_delta >= 0.05 ? -1 : 0;
    score += deltaSummary.veto_rate_delta <= -0.05 ? 1 : deltaSummary.veto_rate_delta >= 0.05 ? -1 : 0;
    score += (deltaSummary.average_mfe_delta ?? 0) > 0 ? 1 : (deltaSummary.average_mfe_delta ?? 0) < 0 ? -1 : 0;
    score += (deltaSummary.average_mae_delta ?? 0) < 0 ? 1 : (deltaSummary.average_mae_delta ?? 0) > 0 ? -1 : 0;

    if (score >= 2) {
      return "beneficial";
    }
    if (score <= -2) {
      return "harmful";
    }
    return "neutral";
  }

  private buildRecommendationEffectivenessResult(input: {
    entry: AppliedRecommendationHistoryEntry;
    nextAppliedAt: number | null;
    observationWindowMs: number;
    forwardWindowMs: number;
    primaryEntryStyle: SignalEntryStyle;
    enabledEntryStyles: SignalEntryStyle[];
  }): RecommendationEffectivenessResult {
    const preWindow = this.buildWalkForwardWindow({
      pair: input.entry.pair,
      kind: "observation",
      startTs: Math.max(0, input.entry.applied_at - input.observationWindowMs),
      endTs: input.entry.applied_at,
      primaryEntryStyle: input.primaryEntryStyle,
      enabledEntryStyles: input.enabledEntryStyles,
    });
    const forwardEnd = input.nextAppliedAt != null
      ? Math.min(input.entry.applied_at + input.forwardWindowMs, input.nextAppliedAt)
      : input.entry.applied_at + input.forwardWindowMs;
    const postWindow = this.buildWalkForwardWindow({
      pair: input.entry.pair,
      kind: "forward",
      startTs: input.entry.applied_at,
      endTs: Math.max(input.entry.applied_at, forwardEnd),
      primaryEntryStyle: input.primaryEntryStyle,
      enabledEntryStyles: input.enabledEntryStyles,
    });
    const deltaSummary = this.buildRecommendationDeltaSummary(preWindow, postWindow);
    const confidenceCalibrationChange = this.buildConfidenceCalibrationChange(
      preWindow.confidence_calibration,
      postWindow.confidence_calibration,
    );
    const sessionDistributionChange = this.buildSessionDistributionChange(
      preWindow.session_distribution,
      postWindow.session_distribution,
    );
    const verdict = this.resolveRecommendationVerdict(deltaSummary, postWindow);

    const notes: string[] = [];
    if (verdict === "insufficient_data") {
      notes.push("No forward signals have been recorded yet for the validation window.");
    } else {
      notes.push(`Forward validation classified this recommendation as ${verdict}.`);
    }
    notes.push(
      `Pre-change TP1 ${Math.round(preWindow.metrics.tp1_hit_rate * 100)}% vs forward ${Math.round(postWindow.metrics.tp1_hit_rate * 100)}%.`,
    );
    notes.push(
      `Pre-change stop ${Math.round(preWindow.metrics.stop_out_rate * 100)}% vs forward ${Math.round(postWindow.metrics.stop_out_rate * 100)}%.`,
    );
    const dominantPreVeto = dominantReason(preWindow.veto_effectiveness);
    const dominantPostVeto = dominantReason(postWindow.veto_effectiveness);
    notes.push(
      dominantPreVeto || dominantPostVeto
        ? `Dominant veto shifted from ${dominantPreVeto ?? "none"} to ${dominantPostVeto ?? "none"}.`
        : "No dominant veto reason was recorded in either comparison window.",
    );

    return {
      history_id: input.entry.history_id,
      snapshot_id: input.entry.snapshot_id,
      proposal_id: input.entry.proposal_id,
      pair: input.entry.pair,
      applied_at: input.entry.applied_at,
      applied_config_diff: input.entry.applied_config_diff,
      verdict,
      pre_change_vs_post_change: {
        pair: input.entry.pair,
        applied_at: input.entry.applied_at,
        pre_change: preWindow,
        post_change: postWindow,
        delta_summary: deltaSummary,
      },
      in_sample_vs_out_of_sample: {
        pair: input.entry.pair,
        applied_at: input.entry.applied_at,
        in_sample: preWindow,
        out_of_sample: postWindow,
        confidence_calibration_change: confidenceCalibrationChange,
        session_distribution_change: sessionDistributionChange,
      },
      notes,
    };
  }

  private buildRollingWalkForwardWindows(input: {
    activeSymbols: readonly string[];
    rollingWindowMs: number;
    rollingStepMs: number;
    primaryEntryStyle: SignalEntryStyle;
    enabledEntryStyles: SignalEntryStyle[];
  }): WalkForwardWindow[] {
    const windows: WalkForwardWindow[] = [];

    for (const pair of input.activeSymbols) {
      const pairEntries = this.decisionJournal
        .filter(entry => entry.pair === pair || entry.symbol_canonical === pair)
        .sort((left, right) => left.ts - right.ts);
      if (pairEntries.length === 0) {
        continue;
      }

      const minTs = pairEntries[0]?.ts ?? 0;
      const maxTs = pairEntries.at(-1)?.ts ?? minTs;

      for (let startTs = minTs; startTs <= maxTs; startTs += input.rollingStepMs) {
        const endTs = Math.min(startTs + input.rollingWindowMs, maxTs);
        const window = this.buildWalkForwardWindow({
          pair,
          kind: "rolling",
          startTs,
          endTs,
          primaryEntryStyle: input.primaryEntryStyle,
          enabledEntryStyles: input.enabledEntryStyles,
        });
        if (window.metrics.signals_issued > 0) {
          windows.push(window);
        }
        if (endTs >= maxTs) {
          break;
        }
      }
    }

    return windows.sort((left, right) =>
      left.pair.localeCompare(right.pair) || left.start_ts - right.start_ts,
    );
  }

  private buildPairStabilityScore(pair: string, windows: WalkForwardWindow[]): PairStabilityScore {
    const relevantWindows = windows
      .filter(window => window.pair === pair && window.metrics.signals_issued > 0)
      .sort((left, right) => left.start_ts - right.start_ts);
    const windowCount = relevantWindows.length;
    if (windowCount === 0) {
      return {
        pair,
        stability_score: 0,
        windows_observed: 0,
        tp1_consistency_score: 0,
        confidence_calibration_stability_score: 0,
        veto_reason_stability_score: 0,
        session_consistency_score: 0,
        stop_clustering_flag: false,
        deterioration_flag: false,
        notes: ["No rolling walk-forward windows are available for this pair yet."],
      };
    }

    const tp1Rates = relevantWindows.map(window => window.metrics.tp1_hit_rate);
    const tp1ConsistencyScore = windowCount < 2
      ? 0.5
      : clampNumber(1 - ((stddev(tp1Rates) ?? 0) / 0.25), 0, 1);

    const calibrationErrors = relevantWindows.map(window => {
      const bucketRows = window.confidence_calibration.filter(row => row.signals_issued > 0);
      if (bucketRows.length === 0) {
        return 0;
      }

      const totalIssued = bucketRows.reduce((sum, row) => sum + row.signals_issued, 0);
      if (totalIssued === 0) {
        return 0;
      }

      return bucketRows.reduce((sum, row) =>
        sum + (Math.abs(row.tp1_hit_rate - confidenceBucketMidpoint(row.confidence_bucket)) * row.signals_issued),
      0) / totalIssued;
    });
    const confidenceCalibrationStabilityScore = windowCount < 2
      ? 0.5
      : clampNumber(1 - ((stddev(calibrationErrors) ?? 0) / 0.25), 0, 1);

    const sessionLabels = sortSessionLabels(relevantWindows.flatMap(window =>
      window.session_distribution.map(row => row.session),
    ));
    const sessionDistributions = relevantWindows.map(window => {
      const total = window.metrics.signals_issued;
      const map = new Map(window.session_distribution.map(row => [row.session, row.signals_issued]));
      return sessionLabels.map(session => total === 0 ? 0 : (map.get(session) ?? 0) / total);
    });
    const averageSessionDistribution = sessionLabels.map((_, index) =>
      average(sessionDistributions.map(vector => vector[index] ?? 0)) ?? 0,
    );
    const sessionDistributionDistances = sessionDistributions.map(vector =>
      vector.reduce((sum, value, index) => sum + Math.abs(value - averageSessionDistribution[index]!), 0),
    );
    const sessionConsistencyScore = windowCount < 2
      ? 0.5
      : clampNumber(1 - ((average(sessionDistributionDistances) ?? 0) / 2), 0, 1);

    const vetoReasons = [...new Set(relevantWindows.flatMap(window => window.veto_effectiveness.map(row => row.reason)))];
    const vetoReasonStabilityScore = vetoReasons.length === 0
      ? 1
      : windowCount < 2
        ? 0.5
        : (() => {
          const vetoVectors = relevantWindows.map(window => {
            const total = window.veto_effectiveness.reduce((sum, row) => sum + row.count, 0);
            const map = new Map(window.veto_effectiveness.map(row => [row.reason, row.count]));
            return vetoReasons.map(reason => total === 0 ? 0 : (map.get(reason) ?? 0) / total);
          });
          const averageVetoVector = vetoReasons.map((_, index) =>
            average(vetoVectors.map(vector => vector[index] ?? 0)) ?? 0,
          );
          const distances = vetoVectors.map(vector =>
            vector.reduce((sum, value, index) => sum + Math.abs(value - averageVetoVector[index]!), 0),
          );
          return clampNumber(1 - ((average(distances) ?? 0) / 2), 0, 1);
        })();

    const stopClusteringFlag = relevantWindows.some(window =>
      window.metrics.signals_activated >= 2 && window.metrics.stop_out_rate >= 0.6,
    ) || relevantWindows.some((window, index) =>
      index > 0
      && window.metrics.stop_out_rate > 0.45
      && relevantWindows[index - 1]!.metrics.stop_out_rate > 0.45,
    );
    const firstWindow = relevantWindows[0]!;
    const lastWindow = relevantWindows.at(-1)!;
    const deteriorationFlag =
      (lastWindow.metrics.stop_out_rate - firstWindow.metrics.stop_out_rate) > 0.15
      || (firstWindow.metrics.tp1_hit_rate - lastWindow.metrics.tp1_hit_rate) > 0.15;

    const stabilityScore = clampNumber(
      (tp1ConsistencyScore * 0.35)
      + (confidenceCalibrationStabilityScore * 0.25)
      + (vetoReasonStabilityScore * 0.2)
      + (sessionConsistencyScore * 0.2)
      - (stopClusteringFlag ? 0.1 : 0)
      - (deteriorationFlag ? 0.1 : 0),
      0,
      1,
    );

    const notes: string[] = [];
    if (windowCount < 2) {
      notes.push("Stability is based on a thin walk-forward sample.");
    }
    if (stopClusteringFlag) {
      notes.push("Stop-out clustering was detected in one or more rolling windows.");
    }
    if (deteriorationFlag) {
      notes.push("Recent windows show deterioration versus the earlier baseline.");
    }
    if (notes.length === 0) {
      notes.push("No material stability warning flags were detected across the rolling windows.");
    }

    return {
      pair,
      stability_score: stabilityScore,
      windows_observed: windowCount,
      tp1_consistency_score: tp1ConsistencyScore,
      confidence_calibration_stability_score: confidenceCalibrationStabilityScore,
      veto_reason_stability_score: vetoReasonStabilityScore,
      session_consistency_score: sessionConsistencyScore,
      stop_clustering_flag: stopClusteringFlag,
      deterioration_flag: deteriorationFlag,
      notes,
    };
  }

  createWalkForwardValidationRun(input: {
    activeSymbols: string[];
    primaryEntryStyle: SignalEntryStyle;
    enabledEntryStyles: SignalEntryStyle[];
    observationWindowMs?: number;
    forwardWindowMs?: number;
    rollingWindowMs?: number;
    rollingStepMs?: number;
  }): ValidationRun {
    const observationWindowMs = input.observationWindowMs ?? 14 * 24 * 60 * 60 * 1000;
    const forwardWindowMs = input.forwardWindowMs ?? 14 * 24 * 60 * 60 * 1000;
    const rollingWindowMs = input.rollingWindowMs ?? 7 * 24 * 60 * 60 * 1000;
    const rollingStepMs = input.rollingStepMs ?? 7 * 24 * 60 * 60 * 1000;

    const sortedHistory = [...this.appliedRecommendationHistory]
      .filter(entry => input.activeSymbols.includes(entry.pair))
      .sort((left, right) => left.applied_at - right.applied_at);
    const rollingWindows = this.buildRollingWalkForwardWindows({
      activeSymbols: input.activeSymbols,
      rollingWindowMs,
      rollingStepMs,
      primaryEntryStyle: input.primaryEntryStyle,
      enabledEntryStyles: input.enabledEntryStyles,
    });
    const effectivenessResults = sortedHistory.map((entry, index, entries) => {
      const nextAppliedAt = entries
        .slice(index + 1)
        .find(candidate => candidate.pair === entry.pair)
        ?.applied_at ?? null;

      return this.buildRecommendationEffectivenessResult({
        entry,
        nextAppliedAt,
        observationWindowMs,
        forwardWindowMs,
        primaryEntryStyle: input.primaryEntryStyle,
        enabledEntryStyles: input.enabledEntryStyles,
      });
    }).sort((left, right) => right.applied_at - left.applied_at);
    const pairStability = input.activeSymbols
      .map(pair => this.buildPairStabilityScore(pair, rollingWindows))
      .sort((left, right) => right.stability_score - left.stability_score || left.pair.localeCompare(right.pair));

    const run: ValidationRun = {
      run_id: createId("wfrun"),
      generated_at: Date.now(),
      active_symbols: [...input.activeSymbols],
      primary_entry_style: input.primaryEntryStyle,
      enabled_entry_styles: [...input.enabledEntryStyles],
      observation_window_ms: observationWindowMs,
      forward_window_ms: forwardWindowMs,
      rolling_window_ms: rollingWindowMs,
      rolling_step_ms: rollingStepMs,
      walk_forward_windows: rollingWindows,
      recommendation_effectiveness: effectivenessResults,
      pair_stability: pairStability,
      notes: [
        "Walk-forward validation is constrained to the active FX intraday runtime scope.",
        "Approved recommendations are evaluated out of sample only after their explicit application timestamp.",
      ],
    };

    this.validationRuns.push(run);
    void this.mirror("validationRun", {
      id: run.run_id,
      runId: run.run_id,
      generatedAt: new Date(run.generated_at),
      payload: this.cloneJson(run),
    });

    return run;
  }

  getValidationRuns(limit = 20): ValidationRun[] {
    return [...this.validationRuns]
      .slice(-limit)
      .reverse()
      .map(run => this.cloneJson(run));
  }

  getValidationRun(runId: string): ValidationRun | null {
    const run = this.validationRuns.find(item => item.run_id === runId);
    return run ? this.cloneJson(run) : null;
  }

  reviewRecommendationProposal(input: {
    snapshotId: string;
    pair: string;
    action: "approve" | "reject";
    currentPairProfiles: Partial<Record<string, PairTradingProfile>>;
    qualityReport: SignalQualityReport;
  }): {
    snapshot: RecommendationSnapshot;
    proposal: PairProfileProposal;
    appliedHistory?: AppliedRecommendationHistoryEntry;
  } | null {
    const snapshot = this.recommendationSnapshots.find(item => item.snapshot_id === input.snapshotId);
    if (!snapshot) {
      return null;
    }

    const proposal = snapshot.proposals.find(item => item.pair === input.pair);
    if (!proposal || proposal.approval_status !== "proposed") {
      return null;
    }

    const currentProfile = toPairProfileConfigView(
      input.pair,
      getPairProfile(input.currentPairProfiles, input.pair),
    );
    proposal.current_profile = currentProfile;
    proposal.proposed_config_diff = buildProposedConfigDiff(currentProfile, proposal.proposed_profile);

    if (input.action === "reject") {
      proposal.approval_status = "rejected";
      snapshot.approval_status = resolveSnapshotApprovalStatus(snapshot.proposals.map(item => item.approval_status));
      return { snapshot: { ...snapshot, proposals: snapshot.proposals.map(item => ({ ...item })) }, proposal: { ...proposal } };
    }

    proposal.approval_status = "approved";
    for (const candidateSnapshot of this.recommendationSnapshots) {
      if (candidateSnapshot.snapshot_id === snapshot.snapshot_id) {
        continue;
      }
      const candidateProposal = candidateSnapshot.proposals.find(item => item.pair === input.pair && item.approval_status === "proposed");
      if (candidateProposal) {
        candidateProposal.approval_status = "superseded";
        candidateSnapshot.approval_status = resolveSnapshotApprovalStatus(candidateSnapshot.proposals.map(item => item.approval_status));
      }
    }

    const appliedAt = Date.now();
    const beforeReport = this.getSignalQualityReport({
      symbols: [input.pair],
      toTs: appliedAt,
      primaryEntryStyle: input.qualityReport.primary_entry_style,
      enabledEntryStyles: input.qualityReport.enabled_entry_styles,
    });
    const appliedHistory: AppliedRecommendationHistoryEntry = {
      history_id: createId("rechapplied"),
      snapshot_id: snapshot.snapshot_id,
      proposal_id: proposal.proposal_id,
      pair: input.pair,
      applied_at: appliedAt,
      analytics_generated_at: snapshot.analytics_generated_at,
      approval_status: "approved",
      previous_profile: currentProfile,
      applied_profile: proposal.proposed_profile,
      applied_config_diff: buildProposedConfigDiff(currentProfile, proposal.proposed_profile),
      rationale: [...proposal.rationale],
      notes: [...proposal.notes],
      performance_comparison: this.buildRecommendationPerformanceComparison({
        pair: input.pair,
        appliedAt,
        beforeReport,
      }),
    };

    this.appliedRecommendationHistory.push(appliedHistory);
    snapshot.approval_status = resolveSnapshotApprovalStatus(snapshot.proposals.map(item => item.approval_status));
    void this.mirror("appliedRecommendationHistory", {
      id: appliedHistory.history_id,
      historyId: appliedHistory.history_id,
      snapshotId: appliedHistory.snapshot_id,
      proposalId: appliedHistory.proposal_id,
      pair: appliedHistory.pair,
      appliedAt: new Date(appliedHistory.applied_at),
      approvalStatus: appliedHistory.approval_status,
      payload: this.cloneJson(appliedHistory),
    });

    return {
      snapshot: { ...snapshot, proposals: snapshot.proposals.map(item => ({ ...item })) },
      proposal: { ...proposal },
      appliedHistory: { ...appliedHistory },
    };
  }

  getModelRegistry(): ModelRegistryRecord[] {
    return [...this.modelRegistry].sort((left, right) => right.trained_at - left.trained_at);
  }

  getCurrentDriftStatus(): DriftMetrics[] {
    const latest = new Map<string, DriftMetrics>();
    for (const log of this.driftLogs) {
      latest.set(log.pod_id, log);
    }
    return [...latest.values()];
  }

  getMarketEvents(symbol?: string, fromTs?: number, toTs?: number): CanonicalMarketEvent[] {
    return this.marketEvents.filter(event => {
      if (symbol && event.symbol_canonical !== symbol) {
        return false;
      }
      if (fromTs != null && event.ts_exchange < fromTs) {
        return false;
      }
      if (toTs != null && event.ts_exchange > toTs) {
        return false;
      }
      return true;
    });
  }

  getPosition(symbol: string): number {
    return this.positions.get(symbol) ?? 0;
  }

  getPositions(): Record<string, number> {
    return Object.fromEntries(this.positions.entries());
  }

  updatePosition(symbol: string, delta: number) {
    this.positions.set(symbol, (this.positions.get(symbol) ?? 0) + delta);
  }

  replacePosition(symbol: string, position: number) {
    this.positions.set(symbol, position);
  }

  setKillSwitch(active: boolean) {
    this.killSwitchActive = active;
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  setRecoveryMode(mode: RecoveryMode) {
    this.recoveryMode = mode;
  }

  getRecoveryMode(): RecoveryMode {
    return this.recoveryMode;
  }

  setLastCycleTs(ts: number) {
    this.lastCycleTs = ts;
  }

  getLastCycleTs(): number | null {
    return this.lastCycleTs;
  }

  setRiskState(state: Partial<RiskState>) {
    Object.assign(this.riskState, state);
  }

  getRiskState(): RiskState {
    return { ...this.riskState };
  }

  setConfidenceMultiplier(podId: string, factor: number) {
    this.confidenceMultipliers.set(podId, factor);
  }

  getConfidenceMultiplier(podId: string): number {
    return this.confidenceMultipliers.get(podId) ?? 1;
  }

  quarantineModule(module: string, reason: string) {
    this.quarantinedModules.set(module, reason);
  }

  getQuarantinedModules(): Record<string, string> {
    return Object.fromEntries(this.quarantinedModules.entries());
  }

  quarantineSymbol(symbol: string, reason: string) {
    this.quarantinedSymbols.set(symbol, reason);
  }

  getQuarantinedSymbols(): Record<string, string> {
    return Object.fromEntries(this.quarantinedSymbols.entries());
  }

  recordExecutionHealth(symbol: string, slippageBps: number, rejected = false) {
    const current = this.executionHealth.get(symbol) ?? {
      symbol_canonical: symbol,
      fill_rate: 0,
      avg_slippage_bps: 0,
      reject_count: 0,
    };

    const existingFillCount = current.fill_rate * Math.max(1, current.reject_count + 1);
    const fillCount = rejected ? existingFillCount : existingFillCount + 1;
    const rejectCount = current.reject_count + (rejected ? 1 : 0);
    const avgSlippage = rejected
      ? current.avg_slippage_bps
      : ((current.avg_slippage_bps * existingFillCount) + slippageBps) / Math.max(1, fillCount);

    this.executionHealth.set(symbol, {
      symbol_canonical: symbol,
      fill_rate: fillCount / Math.max(1, fillCount + rejectCount),
      avg_slippage_bps: avgSlippage,
      reject_count: rejectCount,
    });
  }

  getExecutionHealth(): ExecutionHealth[] {
    return [...this.executionHealth.values()];
  }
}
