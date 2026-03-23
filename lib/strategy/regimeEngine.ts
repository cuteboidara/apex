import { assessMarketRegime } from "@/lib/analysis/marketRegime";
import type { MarketSnapshot, RegimeAssessment } from "@/lib/strategy/types";

export function detectRegime(snapshot: MarketSnapshot): RegimeAssessment {
  return assessMarketRegime(snapshot);
}
