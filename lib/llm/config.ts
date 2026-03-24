import { getCoreSignalRuntime } from "@/lib/runtime/featureFlags";

export function getLlmRuntimePolicy() {
  const runtime = getCoreSignalRuntime();

  return {
    disabled: runtime.llmDisabled,
    optional: runtime.llmOptional,
    enabled: !runtime.llmDisabled,
  };
}
