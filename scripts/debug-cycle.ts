import "./load-env.mjs";

import { getApexRuntime } from "../src/lib/runtime";

void (async () => {
  const runtime = getApexRuntime();
  const result = await runtime.engine.runCycle();

  console.log("=".repeat(70));
  console.log("APEX DEBUG CYCLE");
  console.log("=".repeat(70));
  console.log(JSON.stringify({
    cycle_id: result.cycle_id,
    timestamp: result.timestamp,
    symbols: result.symbols,
  }, null, 2));
})().catch(error => {
  console.error("[debug-cycle] Failed to run cycle:", error);
  process.exit(1);
});
