/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import type { Timeframe } from "@/lib/marketData/types";

export const TRADINGVIEW_RESOLUTIONS = ["1", "5", "15", "60", "240", "D"] as const;

export type TradingViewResolution = (typeof TRADINGVIEW_RESOLUTIONS)[number];

const RESOLUTION_TO_TIMEFRAME: Record<TradingViewResolution, Timeframe> = {
  "1": "1m",
  "5": "5m",
  "15": "15m",
  "60": "1h",
  "240": "4h",
  D: "1D",
};

const TIMEFRAME_TO_RESOLUTION: Record<Timeframe, TradingViewResolution> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1D": "D",
};

export function mapResolutionToTimeframe(resolution: string): Timeframe | null {
  return RESOLUTION_TO_TIMEFRAME[resolution as TradingViewResolution] ?? null;
}

export function mapTimeframeToResolution(timeframe: Timeframe): TradingViewResolution {
  return TIMEFRAME_TO_RESOLUTION[timeframe];
}

