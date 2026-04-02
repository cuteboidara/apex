import type { Candle } from "@/src/assets/shared/types";
import {
  atr,
  buildTradeLevels,
  calculateGrade,
  calculateGradeScore,
  calculateLevels,
  formatPrice,
  macd,
  rsi,
  sma,
  type StrategySignal,
} from "@/src/assets/shared/strategyUtils";

export type IndexStrategySignal = StrategySignal & {
  gradeScore: number;
  tradeLevels: ReturnType<typeof buildTradeLevels>;
};

export function scoreIndexAsset(
  symbol: string,
  region: string,
  candles: Candle[],
  livePrice: number,
  vixLevel?: number,
  dxyDirection?: "up" | "down" | "flat",
): IndexStrategySignal | null {
  if (candles.length < 30) {
    return null;
  }

  const closes = candles.map(candle => candle.close);
  const atrValue = atr(candles);
  const sma20 = sma(closes, 20);
  const sma50 = closes.length >= 50 ? sma(closes, 50) : sma20;
  const trendUp = livePrice > sma20 && sma20 > sma50;
  const trendDown = livePrice < sma20 && sma20 < sma50;
  const rsiValue = rsi(closes);
  const { histogram } = macd(closes);
  const riskOff = typeof vixLevel === "number" && vixLevel > 25;
  const riskOn = typeof vixLevel === "number" && vixLevel < 15;
  const dxyBearishForIndex = dxyDirection === "up" && ["asia", "europe"].includes(region);

  let direction: IndexStrategySignal["direction"] = "neutral";
  let confidence = 50;

  if (trendUp && histogram > 0 && !riskOff) {
    direction = "buy";
    confidence = 57;
    if (riskOn) confidence += 10;
    if (rsiValue > 50 && rsiValue < 68) confidence += 8;
    if (!dxyBearishForIndex) confidence += 5;
  } else if (trendDown && histogram < 0 && !riskOn) {
    direction = "sell";
    confidence = 57;
    if (riskOff) confidence += 10;
    if (rsiValue < 50 && rsiValue > 32) confidence += 8;
    if (dxyBearishForIndex) confidence += 5;
  } else if (riskOff && trendDown) {
    direction = "sell";
    confidence = 55;
  } else if (riskOn && trendUp) {
    direction = "buy";
    confidence = 55;
  }

  confidence = Math.min(91, Math.max(38, confidence));

  const rawLevels = calculateLevels(direction, livePrice, atrValue, 1.8);
  const grade = calculateGrade(confidence, rawLevels.rr);
  const vixNote = typeof vixLevel === "number"
    ? ` VIX at ${vixLevel.toFixed(1)} (${riskOff ? "risk-off" : riskOn ? "risk-on" : "neutral"}).`
    : "";
  const dxyNote = dxyDirection ? ` DXY ${dxyDirection}.` : "";
  const signal: IndexStrategySignal = {
    symbol,
    direction,
    grade,
    gradeScore: calculateGradeScore(confidence, rawLevels.rr),
    confidence: Math.round(confidence),
    entry: formatPrice(rawLevels.entry, symbol),
    stopLoss: formatPrice(rawLevels.stopLoss, symbol),
    takeProfit: formatPrice(rawLevels.takeProfit, symbol),
    riskReward: rawLevels.rr,
    timeframe: "1d",
    setupType: "trend_pullback",
    reasoning: direction === "buy"
      ? `${symbol} bullish: uptrend, RSI ${rsiValue.toFixed(0)}, positive momentum.${vixNote}${dxyNote}`
      : direction === "sell"
        ? `${symbol} bearish: downtrend, RSI ${rsiValue.toFixed(0)}, negative momentum.${vixNote}${dxyNote}`
        : `${symbol} neutral: mixed signals, RSI ${rsiValue.toFixed(0)}.${vixNote}${dxyNote}`,
    generatedAt: new Date(),
    tradeLevels: buildTradeLevels({
      direction,
      entry: formatPrice(rawLevels.entry, symbol),
      stopLoss: formatPrice(rawLevels.stopLoss, symbol),
      takeProfit: formatPrice(rawLevels.takeProfit, symbol),
      riskReward: rawLevels.rr,
    }),
  };

  return signal;
}
