/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import { assessMarketRegime } from "@/lib/analysis/marketRegime";
import type { MarketSnapshot, RegimeAssessment } from "@/lib/strategy/types";

export function detectRegime(snapshot: MarketSnapshot): RegimeAssessment {
  return assessMarketRegime(snapshot);
}

