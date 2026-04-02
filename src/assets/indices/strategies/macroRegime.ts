import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";

export type MarketRegime = "trending_up" | "trending_down" | "ranging" | "volatile";

export interface RegimeAnalysis {
  regime: MarketRegime;
  allowedSetups: Array<"trend_pullback" | "range_reversal">;
  regimeScore: number;
  regimeNote: string;
}

export function analyzeIndexRegime(candles: PolygonCandle[]): RegimeAnalysis {
  if (candles.length < 20) {
    return {
      regime: "ranging",
      allowedSetups: ["range_reversal"],
      regimeScore: 50,
      regimeNote: "Insufficient data for regime analysis",
    };
  }

  const recent = candles.slice(-20);
  const rangeHigh = Math.max(...recent.map(candle => candle.high));
  const rangeLow = Math.min(...recent.map(candle => candle.low));
  const totalRange = rangeHigh - rangeLow;
  const avgCandleRange = recent.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / recent.length;
  const firstClose = recent[0].close;
  const lastClose = recent[recent.length - 1].close;
  const pctChange = firstClose === 0 ? 0 : ((lastClose - firstClose) / firstClose) * 100;
  const atr = lastClose === 0 ? 0 : (avgCandleRange / lastClose) * 100;

  let regime: MarketRegime;
  if (Math.abs(pctChange) > 2 && atr < 0.5) {
    regime = pctChange > 0 ? "trending_up" : "trending_down";
  } else if (atr > 1.5 || totalRange > avgCandleRange * 6) {
    regime = "volatile";
  } else {
    regime = "ranging";
  }

  const allowedSetups: Array<"trend_pullback" | "range_reversal"> = regime === "trending_up" || regime === "trending_down"
    ? ["trend_pullback"]
    : ["range_reversal"];
  const regimeScore = regime === "trending_up"
    ? 70
    : regime === "trending_down"
      ? 30
      : 50;
  const regimeNote = regime === "trending_up"
    ? `Index trending up ${pctChange.toFixed(1)}% - favour pullback buys at order blocks`
    : regime === "trending_down"
      ? `Index trending down ${Math.abs(pctChange).toFixed(1)}% - favour pullback sells at order blocks`
      : regime === "volatile"
        ? "High volatility - reduced confidence, widen levels"
        : "Index ranging - favour reversals at extremes";

  return {
    regime,
    allowedSetups,
    regimeScore,
    regimeNote,
  };
}
