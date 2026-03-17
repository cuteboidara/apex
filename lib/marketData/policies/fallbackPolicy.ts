export function shouldUseFallback(input: {
  primaryHealthy: boolean;
  primaryFresh: boolean;
  primaryStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  circuitOpen: boolean;
}): boolean {
  return input.circuitOpen || !input.primaryHealthy || !input.primaryFresh || input.primaryStatus !== "LIVE";
}
