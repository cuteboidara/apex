import { getApexRuntime } from "@/src/lib/runtime";

export async function getAllocationsPayload() {
  return getApexRuntime().repository.getLatestSignalCandidates();
}
