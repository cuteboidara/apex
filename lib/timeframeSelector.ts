import type { TradePlanStyle } from "@/lib/assets";

export function getPreferredTimeframe(style: TradePlanStyle): string {
  switch (style) {
    case "SCALP":
      return "5m-15m";
    case "INTRADAY":
      return "15m-1h";
    case "SWING":
      return "4h-1D";
  }
}
