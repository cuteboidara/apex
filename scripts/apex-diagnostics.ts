import "./load-env.mjs";

import { getApexRuntime } from "../src/lib/runtime";
import { runAlphaAnalyticsRefresh } from "../src/application/analytics/alphaReport";
import { runLiveRuntimeSmokeVerification } from "../src/application/analytics/liveRuntimeVerification";

async function main() {
  const args = new Set(process.argv.slice(2));
  const runtime = getApexRuntime();

  if (args.has("--smoke")) {
    process.env.APEX_DISABLE_LLM ??= "true";
    const report = await runLiveRuntimeSmokeVerification();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (args.has("--alpha")) {
    process.env.APEX_DISABLE_LLM ??= "true";
    const report = await runAlphaAnalyticsRefresh({
      includeSmoke: args.has("--with-smoke"),
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const status = runtime.ops.getSystemStatus(runtime.config.activeSymbols);
  console.log(JSON.stringify(status, null, 2));
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
