import type { PairTradingProfile, TradingSession } from "@/src/config/marketScope";
import { createId } from "@/src/lib/ids";
import { getApexRuntime } from "@/src/lib/runtime";
import type {
  PairProfileConfigView,
  ProposedConfigDiff,
  RecommendationSnapshot,
  SessionLabel,
} from "@/src/interfaces/contracts";

const SESSION_SORT_ORDER: SessionLabel[] = ["asia", "london", "new_york", "overlap", "off_hours"];

function sortSessionLabels(values: readonly SessionLabel[]): SessionLabel[] {
  return [...new Set(values)].sort((left, right) => SESSION_SORT_ORDER.indexOf(left) - SESSION_SORT_ORDER.indexOf(right));
}

function arraysEqual(left: readonly string[] | null, right: readonly string[] | null): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function buildDiffField<T>(current: T | null, proposed: T | null, equals: (left: T | null, right: T | null) => boolean) {
  return {
    current,
    proposed,
    changed: !equals(current, proposed),
  };
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

function toPairProfileConfigView(pair: string, profile: PairTradingProfile | null | undefined): PairProfileConfigView | null {
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
    cooldownMinutes: profile.cooldownMinutes,
    atrToleranceMultiplier: profile.atrToleranceMultiplier,
  };
}

function toTradingSessions(values: readonly SessionLabel[]): TradingSession[] {
  return values.filter((value): value is TradingSession => value === "asia" || value === "london" || value === "new_york");
}

function toPairTradingProfile(profile: PairProfileConfigView): PairTradingProfile {
  const preferredSessions = toTradingSessions(profile.preferredSessions);
  const allowedSessions = toTradingSessions(profile.allowedSessions);
  return {
    minConfidence: profile.minConfidence,
    minRiskReward: profile.minRiskReward,
    allowedSessions: allowedSessions.length > 0 ? allowedSessions : ["london"],
    preferredSessions: preferredSessions.length > 0 ? preferredSessions : (allowedSessions.length > 0 ? allowedSessions : ["london"]),
    avoidSessions: sortSessionLabels(profile.avoidSessions),
    maxSignalsPerDay: profile.maxSignalsPerDay,
    cooldownMinutes: profile.cooldownMinutes,
    atrToleranceMultiplier: profile.atrToleranceMultiplier,
  };
}

function getRuntimePairProfile(pair: string): PairTradingProfile | null {
  const runtime = getApexRuntime();
  return runtime.config.marketScope.pairProfiles[pair as keyof typeof runtime.config.marketScope.pairProfiles] ?? null;
}

function getCurrentProfiles(): PairProfileConfigView[] {
  const runtime = getApexRuntime();
  return runtime.config.activeSymbols
    .map(symbol => toPairProfileConfigView(symbol, runtime.config.marketScope.pairProfiles[symbol] ?? null))
    .filter((profile): profile is PairProfileConfigView => profile != null);
}

function buildLiveDiffs(snapshot: RecommendationSnapshot | null): Record<string, ProposedConfigDiff> {
  if (!snapshot) {
    return {};
  }

  return Object.fromEntries(snapshot.proposals.map(proposal => {
    const currentProfile = toPairProfileConfigView(
      proposal.pair,
      getRuntimePairProfile(proposal.pair),
    );
    return [proposal.pair, buildProposedConfigDiff(currentProfile, proposal.proposed_profile)];
  }));
}

function syncAppliedProfile(pair: string, profile: PairProfileConfigView) {
  const runtime = getApexRuntime();
  const nextProfile = toPairTradingProfile(profile);
  runtime.config.marketScope.pairProfiles[pair as keyof typeof runtime.config.marketScope.pairProfiles] = nextProfile;
  runtime.config.pairProfiles[pair as keyof typeof runtime.config.pairProfiles] = { ...nextProfile };
}

export async function getRecommendationQueuePayload() {
  const runtime = getApexRuntime();
  return {
    active_symbols: runtime.config.activeSymbols,
    current_profiles: getCurrentProfiles(),
    latest_snapshot: runtime.repository.getRecommendationSnapshots(1)[0] ?? null,
    snapshots: runtime.repository.getRecommendationSnapshots(20),
    applied_history: runtime.repository.getAppliedRecommendationHistory(20),
  };
}

export async function generateRecommendationSnapshotPayload() {
  const runtime = getApexRuntime();
  const quality = runtime.repository.getSignalQualityReport({
    symbols: runtime.config.activeSymbols,
    primaryEntryStyle: runtime.config.primaryEntryStyle,
    enabledEntryStyles: runtime.config.enabledEntryStyles,
    pairProfiles: runtime.config.marketScope.pairProfiles,
  });
  const snapshot = runtime.repository.createRecommendationSnapshot({
    qualityReport: quality,
    currentPairProfiles: runtime.config.marketScope.pairProfiles,
  });

  await runtime.repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: Date.now(),
    module: "recommendations",
    type: "snapshot_generated",
    reason: "operator action",
    payload: {
      snapshot_id: snapshot.snapshot_id,
      version: snapshot.version,
      active_symbols: snapshot.active_symbols,
    },
  });

  return {
    snapshot,
    snapshots: runtime.repository.getRecommendationSnapshots(20),
    applied_history: runtime.repository.getAppliedRecommendationHistory(20),
  };
}

export async function getRecommendationDetailPayload(snapshotId: string) {
  const runtime = getApexRuntime();
  const snapshot = runtime.repository.getRecommendationSnapshot(snapshotId);
  const proposalPairs = new Set(snapshot?.proposals.map(proposal => proposal.pair) ?? []);

  return {
    snapshot,
    current_profiles: getCurrentProfiles(),
    live_diffs: buildLiveDiffs(snapshot),
    applied_history: runtime.repository.getAppliedRecommendationHistory(20).filter(entry =>
      entry.snapshot_id === snapshotId || proposalPairs.has(entry.pair),
    ),
  };
}

export async function reviewRecommendationProposalPayload(input: {
  snapshotId: string;
  pair: string;
  action: "approve" | "reject";
}) {
  const runtime = getApexRuntime();
  const quality = runtime.repository.getSignalQualityReport({
    symbols: runtime.config.activeSymbols,
    primaryEntryStyle: runtime.config.primaryEntryStyle,
    enabledEntryStyles: runtime.config.enabledEntryStyles,
    pairProfiles: runtime.config.marketScope.pairProfiles,
  });
  const result = runtime.repository.reviewRecommendationProposal({
    snapshotId: input.snapshotId,
    pair: input.pair,
    action: input.action,
    currentPairProfiles: runtime.config.marketScope.pairProfiles,
    qualityReport: quality,
  });

  if (!result) {
    return null;
  }

  if (input.action === "approve") {
    syncAppliedProfile(input.pair, result.proposal.proposed_profile);
  }

  await runtime.repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: Date.now(),
    module: "recommendations",
    type: input.action === "approve" ? "proposal_applied" : "proposal_rejected",
    reason: "operator action",
    payload: {
      snapshot_id: input.snapshotId,
      pair: input.pair,
      action: input.action,
      analytics_generated_at: result.proposal.analytics_generated_at,
    },
  });

  return {
    snapshot: result.snapshot,
    proposal: result.proposal,
    current_profiles: getCurrentProfiles(),
    live_diffs: buildLiveDiffs(result.snapshot),
    applied_history: runtime.repository.getAppliedRecommendationHistory(20),
  };
}
