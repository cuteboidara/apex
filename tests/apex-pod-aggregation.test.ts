import assert from "node:assert/strict";
import test from "node:test";

import { aggregatePodVotes } from "@/src/domain/pods/aggregatePodVotes";
import { identityAdapter } from "@/src/domain/pods/podAdapters";
import type { PodVote } from "@/src/domain/pods/types";

function makeDirectionalVote(
  podName: string,
  signal: "buy" | "sell" | "neutral",
  confidence: number,
): PodVote {
  return {
    podName,
    version: "2.0.0",
    podType: "alpha",
    symbol: "EURUSD",
    signal,
    confidence,
    score: Math.round(confidence * 100),
    reasoning: `${podName} rationale`,
    weight: confidence,
    rawConfidence: confidence,
    normalizedConfidence: confidence,
    evidence: [{ code: "rationale.1", description: `${podName} rationale` }],
    meta: { legacy_pod_category: "directional" },
    pod_name: podName,
    pod_version: "2.0.0",
    pod_type: "alpha",
    direction: signal === "buy" ? "long" : signal === "sell" ? "short" : "none",
    raw_confidence: confidence,
    normalized_confidence: confidence,
    veto: false,
    metadata: { legacy_pod_category: "directional" },
  };
}

function makeGatingVote(
  gateStatus: "allow" | "warn" | "block",
  vetoReasons: string[],
): PodVote {
  return {
    podName: "execution-advisory",
    version: "2.0.0",
    podType: "execution_feasibility",
    symbol: "EURUSD",
    signal: "buy",
    confidence: 0.7,
    score: 70,
    reasoning: "Execution gate",
    weight: 0.7,
    rawConfidence: 0.7,
    normalizedConfidence: 0.7,
    vetoes: gateStatus === "block" ? vetoReasons : [],
    warnings: gateStatus === "warn" ? vetoReasons : [],
    evidence: [{ code: "rationale.1", description: "Execution gate" }],
    meta: { legacy_pod_category: "gating", gate_status: gateStatus },
    pod_name: "execution-advisory",
    pod_version: "2.0.0",
    pod_type: "execution_feasibility",
    direction: "long",
    raw_confidence: 0.7,
    normalized_confidence: 0.7,
    veto: gateStatus === "block",
    metadata: { legacy_pod_category: "gating", gate_status: gateStatus },
  };
}

test("pod aggregation scores long and short support deterministically", () => {
  const votes = [
    makeDirectionalVote("trend", "buy", 0.8),
    makeDirectionalVote("breakout", "buy", 0.7),
    makeDirectionalVote("mean-reversion", "sell", 0.4),
  ].map(vote => identityAdapter(vote));
  const aggregated = aggregatePodVotes(votes);

  assert.equal(aggregated.direction, "long");
  assert.equal(aggregated.signal, "buy");
  assert.ok(aggregated.directional_support.long_score > aggregated.directional_support.short_score);
  assert.deepEqual(aggregated.attribution.long_contributors.sort(), ["breakout", "trend"]);
  assert.equal(aggregated.votes.length, 3);
});

test("hard vetoes are preserved and force a non-tradable aggregate direction", () => {
  const votes = [
    makeDirectionalVote("trend", "buy", 0.8),
    makeGatingVote("block", ["SPREAD_ABNORMAL"]),
  ].map(vote => identityAdapter(vote));
  const aggregated = aggregatePodVotes(votes);

  assert.equal(aggregated.direction, "none");
  assert.equal(aggregated.vetoes.length, 1);
  assert.deepEqual(aggregated.attribution.veto_contributors, ["execution-advisory"]);
  assert.deepEqual(aggregated.vetoes, ["SPREAD_ABNORMAL"]);
  assert.deepEqual(aggregated.veto_details[0]?.reason_codes, ["SPREAD_ABNORMAL"]);
});
