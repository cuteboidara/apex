import { getApexRuntime } from "@/src/lib/runtime";

export async function getDriftPayload() {
  return getApexRuntime().repository.getCurrentDriftStatus();
}
