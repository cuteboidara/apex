import type { PodVote } from "@/src/domain/pods/types";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function isCalibratedPodConfidenceEnabled(): boolean {
  return process.env.ENABLE_CALIBRATED_POD_CONFIDENCE === "true";
}

export function normalizePodConfidence(vote: PodVote): number {
  const raw = clamp01(vote.rawConfidence ?? vote.raw_confidence ?? vote.confidence);
  const podType = vote.podType ?? vote.pod_type ?? "constraint";
  const typeBias = podType === "alpha"
    ? 1
    : podType === "regime"
      ? 0.97
      : podType === "execution_feasibility"
        ? 0.95
        : 0.93;
  return round4(clamp01(raw * typeBias));
}

export function normalizeAggregateConfidence(votes: PodVote[]): number {
  const directionalVotes = votes.filter(vote => vote.signal !== "neutral");
  if (directionalVotes.length === 0) {
    return 0;
  }

  const totalWeight = directionalVotes.reduce((sum, vote) => sum + Math.max(vote.weight, 0.0001), 0);
  if (totalWeight <= 0) {
    return 0;
  }

  const weighted = directionalVotes.reduce((sum, vote) => (
    sum + normalizePodConfidence(vote) * Math.max(vote.weight, 0.0001)
  ), 0);

  return round4(clamp01(weighted / totalWeight));
}
