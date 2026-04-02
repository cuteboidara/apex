import { analyzeSMC } from "@/src/smc";
import type { SMCAnalysis } from "@/src/smc/types";
import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";

export function analyzeStockSMC(
  symbol: string,
  candles: PolygonCandle[],
  livePrice: number | null,
  direction: "buy" | "sell" | "neutral",
): SMCAnalysis {
  return analyzeSMC(symbol, candles, livePrice, direction);
}
