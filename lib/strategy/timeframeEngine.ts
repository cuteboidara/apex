import type { TradePlanStyle } from "@/lib/assets";
import type { TimeframeProfile } from "@/lib/strategy/types";

export function getTimeframeProfile(style: TradePlanStyle): TimeframeProfile {
  switch (style) {
    case "SCALP":
      return { style, execution: "1m", confirmation: "5m", holdingPeriod: "minutes" };
    case "INTRADAY":
      return { style, execution: "5m-15m", confirmation: "1h", holdingPeriod: "same session" };
    case "SWING":
      return { style, execution: "1h-4h", confirmation: "1D", holdingPeriod: "days" };
  }
}
