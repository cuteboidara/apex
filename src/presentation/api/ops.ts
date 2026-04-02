import type { RecoveryMode } from "@/src/interfaces/contracts";
import { persistRecoveryModeToDb } from "@/src/lib/operatorControls";
import { getApexRuntime } from "@/src/lib/runtime";

export async function setRecoveryModePayload(mode: RecoveryMode) {
  const runtime = getApexRuntime();
  await runtime.ops.setRecoveryMode(mode);
  await persistRecoveryModeToDb(mode);
  return runtime.ops.getSystemStatus(runtime.config.activeSymbols);
}

export async function replayPayload(input: { symbol: string; from_ts: number; to_ts: number }) {
  const runtime = getApexRuntime();
  return runtime.ops.replayEvents(input.symbol, input.from_ts, input.to_ts);
}
