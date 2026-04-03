import assert from "node:assert/strict";
import test from "node:test";

import { pickBestEntryZone } from "@/src/assets/shared/mtfAnalysis";

test("pickBestEntryZone prefers bullish pullback zones at or below price for longs", () => {
  const selected = pickBestEntryZone({
    direction: "LONG",
    livePrice: 100,
    htfZones: [
      { kind: "order_block", timeframe: "1d", direction: "bullish", low: 95, high: 98, weight: 80, label: "below" },
      { kind: "order_block", timeframe: "1d", direction: "bullish", low: 103, high: 105, weight: 95, label: "above" },
    ],
    mtfZones: [
      { kind: "sd_zone", timeframe: "1h", direction: "bullish", low: 96, high: 99, weight: 78, label: "mtf below" },
      { kind: "sd_zone", timeframe: "1h", direction: "bullish", low: 104, high: 106, weight: 99, label: "mtf above" },
    ],
  });

  assert.equal(selected.htfZone?.label, "below");
  assert.equal(selected.mtfZone?.label, "mtf below");
});

test("pickBestEntryZone prefers bearish pullback zones at or above price for shorts", () => {
  const selected = pickBestEntryZone({
    direction: "SHORT",
    livePrice: 100,
    htfZones: [
      { kind: "order_block", timeframe: "4h", direction: "bearish", low: 102, high: 105, weight: 80, label: "above" },
      { kind: "order_block", timeframe: "4h", direction: "bearish", low: 94, high: 97, weight: 95, label: "below" },
    ],
    mtfZones: [
      { kind: "sd_zone", timeframe: "30m", direction: "bearish", low: 101, high: 104, weight: 78, label: "mtf above" },
      { kind: "sd_zone", timeframe: "30m", direction: "bearish", low: 95, high: 98, weight: 99, label: "mtf below" },
    ],
  });

  assert.equal(selected.htfZone?.label, "above");
  assert.equal(selected.mtfZone?.label, "mtf above");
});

test("pickBestEntryZone falls back to any same-direction zone when no corridor zone exists", () => {
  const selected = pickBestEntryZone({
    direction: "LONG",
    livePrice: 100,
    htfZones: [
      { kind: "order_block", timeframe: "1d", direction: "bullish", low: 103, high: 106, weight: 80, label: "only above" },
    ],
    mtfZones: [],
  });

  assert.equal(selected.htfZone?.label, "only above");
  assert.equal(selected.mtfZone, null);
});
