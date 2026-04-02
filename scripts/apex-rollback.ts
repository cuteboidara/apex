import "./load-env.mjs";

import { getApexRuntime } from "../src/lib/runtime";

async function main() {
  const runtime = getApexRuntime();
  runtime.repository.setKillSwitch(true);
  await runtime.ops.setRecoveryMode("flat_and_observe");
  console.log(JSON.stringify({
    kill_switch_active: runtime.repository.isKillSwitchActive(),
    mode: runtime.repository.getRecoveryMode(),
  }, null, 2));
}

void main();
