import { getApexRuntime } from "@/src/lib/runtime";

export async function getModelsPayload() {
  return getApexRuntime().repository.getModelRegistry();
}
