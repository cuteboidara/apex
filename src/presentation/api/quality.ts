import { getApexRuntime } from "@/src/lib/runtime";

export async function getSignalQualityPayload(filters?: {
  from?: number;
  to?: number;
}) {
  const runtime = getApexRuntime();

  return runtime.repository.getSignalQualityReport({
    // Keep analytics constrained to the intentionally narrow FX runtime scope.
    symbols: runtime.config.activeSymbols,
    fromTs: filters?.from,
    toTs: filters?.to,
    primaryEntryStyle: runtime.config.primaryEntryStyle,
    enabledEntryStyles: runtime.config.enabledEntryStyles,
    pairProfiles: runtime.config.pairProfiles,
  });
}
