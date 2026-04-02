import assert from "node:assert/strict";
import test from "node:test";

import { isCalibratedPodConfidenceEnabled, normalizePodConfidence } from "@/src/domain/pods/confidenceNormalization";
import { identityAdapter } from "@/src/domain/pods/podAdapters";
import type { PodVote } from "@/src/domain/pods/types";

const directionalVote: PodVote = {
  podName: "trend",
  version: "2.0.0",
  podType: "alpha",
  symbol: "EURUSD",
  signal: "buy",
  confidence: 0.82,
  score: 80,
  reasoning: "Trend remains intact.",
  weight: 0.82,
  rawConfidence: 0.82,
  normalizedConfidence: 0.82,
  evidence: [{ code: "rationale.1", description: "Trend remains intact." }],
  meta: { legacy_pod_category: "directional" },
  pod_name: "trend",
  pod_version: "2.0.0",
  pod_type: "alpha",
  direction: "long",
  raw_confidence: 0.82,
  normalized_confidence: 0.82,
  veto: false,
  metadata: { legacy_pod_category: "directional" },
};

const gatingVote: PodVote = {
  podName: "execution-advisory",
  version: "2.0.0",
  podType: "execution_feasibility",
  symbol: "EURUSD",
  signal: "buy",
  confidence: 0.68,
  score: 68,
  reasoning: "Spread remains acceptable.",
  weight: 0.68,
  rawConfidence: 0.68,
  normalizedConfidence: 0.68,
  vetoes: [],
  warnings: [],
  evidence: [{ code: "rationale.1", description: "Spread remains acceptable." }],
  meta: { legacy_pod_category: "gating" },
  pod_name: "execution-advisory",
  pod_version: "2.0.0",
  pod_type: "execution_feasibility",
  direction: "long",
  raw_confidence: 0.68,
  normalized_confidence: 0.68,
  veto: false,
  metadata: { legacy_pod_category: "gating" },
};

test("all pod outputs normalize into typed PodVote contracts with explicit pod types", () => {
  const directional = identityAdapter(directionalVote);
  const gating = identityAdapter(gatingVote);

  assert.equal(directional.pod_type, "alpha");
  assert.equal(gating.pod_type, "execution_feasibility");
  assert.equal(directional.direction, "long");
  assert.equal(gating.direction, "long");
  assert.equal(typeof directional.normalized_confidence, "number");
  assert.equal(typeof gating.normalized_confidence, "number");
});

test("normalization preserves raw confidence and remains bounded and deterministic", () => {
  const adapted = identityAdapter(directionalVote);
  const normalizedA = normalizePodConfidence(adapted);
  const normalizedB = normalizePodConfidence(adapted);

  assert.equal(adapted.raw_confidence, 0.82);
  assert.equal(normalizedA, normalizedB);
  assert.ok(normalizedA >= 0 && normalizedA <= 1);
});

test("calibration flag stays shadow-only by default", () => {
  const previous = process.env.ENABLE_CALIBRATED_POD_CONFIDENCE;
  delete process.env.ENABLE_CALIBRATED_POD_CONFIDENCE;

  try {
    assert.equal(isCalibratedPodConfidenceEnabled(), false);
  } finally {
    if (previous != null) {
      process.env.ENABLE_CALIBRATED_POD_CONFIDENCE = previous;
    }
  }
});
