import assert from "node:assert/strict";
import test from "node:test";

import { computeRuntimeHealthState } from "@/src/application/analytics/liveRuntimeVerification";
import { queueFocusedRuntimeCycle } from "@/src/application/cycle/runCycle";

test("runtime health marks high null-price incidence as broken", () => {
  const state = computeRuntimeHealthState({
    assetClass: "fx",
    providerStatus: "healthy",
    nullPriceCount: 4,
    staleCount: 0,
    stageCounts: {
      symbolsAttempted: 4,
      marketSnapshotCount: 2,
      tradeCandidateCount: 2,
      riskEvaluatedCandidateCount: 2,
      executableSignalCount: 1,
      publishedCount: 0,
      blockedCount: 1,
    },
    notes: [],
  });

  assert.equal(state, "broken");
});

test("runtime health reports market-closed cycles as no_market_context instead of broken", () => {
  const state = computeRuntimeHealthState({
    assetClass: "stock",
    providerStatus: "healthy",
    nullPriceCount: 0,
    staleCount: 0,
    stageCounts: {
      symbolsAttempted: 6,
      marketSnapshotCount: 6,
      tradeCandidateCount: 6,
      riskEvaluatedCandidateCount: 6,
      executableSignalCount: 0,
      publishedCount: 0,
      blockedCount: 0,
    },
    notes: ["market closed", "session unavailable"],
  });

  assert.equal(state, "no_market_context");
});

test("queueFocusedRuntimeCycle preserves engine binding for inline FX cycle runs", async () => {
  const engine = {
    cycleCalls: 0,
    async queueCycle() {
      throw new Error("queueCycle should not be used when runCycle exists");
    },
    async runCycle(this: { cycleCalls: number }) {
      this.cycleCalls += 1;
      return {
        cycle_id: "cycle_fx_binding",
        timestamp: 123,
        symbols: [],
      };
    },
  };

  const result = await queueFocusedRuntimeCycle({ engine } as never, "manual");

  assert.equal(result.queued, false);
  assert.equal(result.result?.cycle_id, "cycle_fx_binding");
  assert.equal(engine.cycleCalls, 1);
});
