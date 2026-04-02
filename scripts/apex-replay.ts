import "./load-env.mjs";

import { getApexRuntime } from "../src/lib/runtime";

async function main() {
  const [, , symbol, fromRaw, toRaw] = process.argv;
  if (!symbol || !fromRaw || !toRaw) {
    throw new Error("usage: node --import tsx scripts/apex-replay.ts <symbol> <from_ts> <to_ts>");
  }

  const runtime = getApexRuntime();
  const result = await runtime.ops.replayEvents(symbol, Number(fromRaw), Number(toRaw));
  console.log(JSON.stringify(result, null, 2));
}

void main();
