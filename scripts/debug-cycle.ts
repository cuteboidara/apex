/**
 * Debug script — runs one full analysis cycle and prints all console output.
 * Usage: npx tsx scripts/debug-cycle.ts
 */

// Load .env before anything else
import "dotenv/config";

// Patch fetch options so { next: { revalidate: 0 } } doesn't throw outside Next.js
const _orig = globalThis.fetch as typeof fetch;
(globalThis as Record<string, unknown>).fetch = (url: string, opts?: RequestInit & { next?: unknown }) => {
  if (opts) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { next: _n, ...rest } = opts as { next?: unknown } & RequestInit;
    return _orig(url, rest);
  }
  return _orig(url);
};

void (async () => {
  console.log("=".repeat(70));
  console.log("APEX DEBUG CYCLE");
  console.log("=".repeat(70));

  // ── Env check ──────────────────────────────────────────────────────────────
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY:     process.env.ANTHROPIC_API_KEY     ? "✓ set" : "✗ MISSING",
    ALPHA_VANTAGE_API_KEY: process.env.ALPHA_VANTAGE_API_KEY ? "✓ set" : "✗ MISSING",
    NEWS_API_KEY:          process.env.NEWS_API_KEY           ? "✓ set" : "✗ MISSING",
    FRED_API_KEY:          process.env.FRED_API_KEY           ? "✓ set" : "✗ MISSING",
    FINNHUB_API_KEY:       process.env.FINNHUB_API_KEY        ? "✓ set" : "✗ MISSING",
    DIRECT_DATABASE_URL:   process.env.DIRECT_DATABASE_URL    ? "✓ set" : "✗ MISSING",
  };
  console.log("\n── Env vars ──");
  for (const [k, v] of Object.entries(env)) console.log(`  ${k}: ${v}`);

  // ── Single-asset test first ────────────────────────────────────────────────
  const { ASSETS, analyzeAsset } = await import("../lib/apexEngine");
  const { getStylePerformanceGateState } = await import("../lib/tradePlanDiagnostics");

  console.log("\n── Testing single asset: BTCUSDT ──");
  try {
    const btc = ASSETS.find(a => a.symbol === "BTCUSDT")!;
    const gateState = await getStylePerformanceGateState();
    const result = await analyzeAsset(btc, "debug-run", gateState, null);
    const signal = result.signal;
    console.log("\n✓ BTCUSDT signal:", JSON.stringify({
      rank:      signal.rank,
      total:     signal.total,
      direction: signal.direction,
      entry:     signal.entry,
      brief:     signal.brief?.slice(0, 120),
    }, null, 2));
  } catch (err) {
    console.error("\n✗ BTCUSDT analyzeAsset FAILED:", err);
  }

  console.log("\n" + "=".repeat(70));
  console.log("Single-asset test complete. Set RUN_FULL=1 to run all 7 assets.");
  console.log("=".repeat(70));

  if (process.env.RUN_FULL === "1") {
    console.log("\n── Running full 7-asset cycle ──");
    const { enqueueSignalCycle } = await import("../lib/queue");
    const { runCycle } = await import("../lib/scheduler");
    const { runId } = await enqueueSignalCycle("debug-full-run", { actor: "SYSTEM" });
    const { signals } = await runCycle(runId);
    console.log(`\n✓ Full cycle done — run ${runId} — ${signals.length}/7 signals:`);
    for (const s of signals) {
      console.log(`  ${s.asset}: ${s.rank} (${s.total}) ${s.direction}`);
    }
  }
})();
