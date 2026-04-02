import { normalizeAggregateConfidence } from "@/src/domain/pods/confidenceNormalization";
import type { AggregatedPodDecision, PodVote } from "@/src/domain/pods/types";

function weightedScore(vote: PodVote): number {
  return (vote.normalizedConfidence ?? vote.normalized_confidence ?? vote.confidence) * Math.max(vote.weight, 0);
}

function voteSignal(vote: PodVote): PodVote["signal"] {
  if (vote.signal) {
    return vote.signal;
  }
  if (vote.direction === "long") {
    return "buy";
  }
  if (vote.direction === "short") {
    return "sell";
  }
  return "neutral";
}

export function aggregatePodVotes(votes: PodVote[]): AggregatedPodDecision {
  const symbol = votes[0]?.symbol ?? "UNKNOWN";
  const buyVotes = votes.filter(vote => voteSignal(vote) === "buy");
  const sellVotes = votes.filter(vote => voteSignal(vote) === "sell");
  const neutralVotes = votes.filter(vote => voteSignal(vote) === "neutral");
  const vetoVotes = votes.filter(vote => (vote.vetoes?.length ?? 0) > 0 || vote.veto === true);

  const longScore = buyVotes.reduce((sum, vote) => sum + weightedScore(vote), 0);
  const shortScore = sellVotes.reduce((sum, vote) => sum + weightedScore(vote), 0);
  const neutralScore = neutralVotes.reduce((sum, vote) => sum + weightedScore(vote), 0);
  const scoreDelta = longScore - shortScore;

  const direction = vetoVotes.length > 0
    ? "none"
    : scoreDelta > 0.05
      ? "long"
      : scoreDelta < -0.05
        ? "short"
        : "none";

  const signal = direction === "long"
    ? "buy"
    : direction === "short"
      ? "sell"
      : "neutral";

  const directionalVotes = direction === "long"
    ? buyVotes
    : direction === "short"
      ? sellVotes
      : [];

  const averageScore = votes.length === 0
    ? 0
    : votes.reduce((sum, vote) => sum + vote.score, 0) / votes.length;
  const agreement = votes.length === 0
    ? 0
    : votes.filter(vote => voteSignal(vote) === signal).length / votes.length;
  const vetoRuleCodes = [...new Set(vetoVotes.flatMap(vote => vote.vetoes ?? []))];
  const warningRuleCodes = [...new Set(votes.flatMap(vote => vote.warnings ?? []))];

  return {
    symbol,
    direction,
    signal,
    confidence: direction === "none" ? 0 : normalizeAggregateConfidence(directionalVotes),
    score: Math.round(averageScore),
    agreement,
    votes,
    vetoes: vetoRuleCodes,
    warnings: warningRuleCodes,
    reasoning: `${votes.length} pods: ${votes.map(vote => `${vote.podName}=${vote.signal}(${Math.round(vote.confidence * 100)}%)`).join(", ")}`,
    directional_support: {
      long_score: longScore,
      short_score: shortScore,
      neutral_score: neutralScore,
    },
    veto_details: vetoVotes.map(vote => ({
      pod_name: vote.podName,
      reason_codes: vote.vetoes ?? [],
    })),
    contributing_pods: votes,
    attribution: {
      long_contributors: buyVotes.map(vote => vote.podName),
      short_contributors: sellVotes.map(vote => vote.podName),
      veto_contributors: vetoVotes.map(vote => vote.podName),
      regime_contributors: votes.filter(vote => (vote.podType ?? vote.pod_type) === "regime").map(vote => vote.podName),
    },
    metadata: {
      score_delta: scoreDelta,
      calibrated_confidence_enabled: process.env.ENABLE_CALIBRATED_POD_CONFIDENCE === "true",
      raw_confidence_distribution: votes.map(vote => ({
        pod_name: vote.podName,
        raw_confidence: vote.rawConfidence ?? vote.raw_confidence ?? vote.confidence,
      })),
      normalized_confidence_distribution: votes.map(vote => ({
        pod_name: vote.podName,
        normalized_confidence: vote.normalizedConfidence ?? vote.normalized_confidence ?? vote.confidence,
      })),
    },
  };
}
