import type { Candle } from "@/src/assets/shared/types";
import {
  atr,
  bollingerBands,
  buildTradeLevels,
  calculateGrade,
  calculateGradeScore,
  calculateLevels,
  ema,
  formatPrice,
  macd,
  rsi,
  sma,
  volumeSpike,
  type StrategySignal,
} from "@/src/assets/shared/strategyUtils";

export type StockStrategySignal = StrategySignal & {
  gradeScore: number;
  tradeLevels: ReturnType<typeof buildTradeLevels>;
};

export function scoreStockAsset(
  symbol: string,
  sector: string,
  candles: Candle[],
  livePrice: number,
  marketOpen: boolean,
): StockStrategySignal | null {
  if (candles.length < 50) {
    return null;
  }

  const closes = candles.map(candle => candle.close);
  const volumes = candles.map(candle => candle.volume ?? 0);
  const atrValue = atr(candles);
  const sma50 = sma(closes, 50);
  const sma20 = sma(closes, 20);
  const ema9 = ema(closes, 9);
  const aboveAllMAs = livePrice > ema9 && ema9 > sma20 && sma20 > sma50;
  const belowAllMAs = livePrice < ema9 && ema9 < sma20 && sma20 < sma50;
  const rsiValue = rsi(closes);
  const { macd: macdLine, signal: signalLine, histogram } = macd(closes);
  const macdCrossUp = macdLine > signalLine && histogram > 0;
  const macdCrossDown = macdLine < signalLine && histogram < 0;
  const volSpike = volumeSpike(volumes);
  const strongVolume = volSpike > 1.5;
  const bands = bollingerBands(closes);
  const nearLower = livePrice < bands.lower * 1.01;
  const nearUpper = livePrice > bands.upper * 0.99;
  const marketBonus = marketOpen ? 5 : 0;

  let direction: StockStrategySignal["direction"] = "neutral";
  let confidence = 50;

  if (aboveAllMAs && macdCrossUp && !nearUpper) {
    direction = "buy";
    confidence = 57 + marketBonus;
    if (strongVolume) confidence += 10;
    if (rsiValue > 50 && rsiValue < 70) confidence += 8;
    if (nearLower) confidence += 5;
  } else if (belowAllMAs && macdCrossDown && !nearLower) {
    direction = "sell";
    confidence = 57 + marketBonus;
    if (strongVolume) confidence += 10;
    if (rsiValue < 50 && rsiValue > 30) confidence += 8;
  } else if (nearLower && rsiValue < 35 && macdCrossUp) {
    direction = "buy";
    confidence = 53 + marketBonus;
  } else if (nearUpper && rsiValue > 65 && macdCrossDown) {
    direction = "sell";
    confidence = 53 + marketBonus;
  }

  confidence = Math.min(93, Math.max(38, confidence));

  const rawLevels = calculateLevels(direction, livePrice, atrValue, 2.0);
  const grade = calculateGrade(confidence, rawLevels.rr);
  const signal: StockStrategySignal = {
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
    setupType: direction === "neutral" ? "range_reversal" : "trend_pullback",
    reasoning: direction === "buy"
      ? `${symbol} (${sector}): price above all MAs, MACD bullish cross, RSI ${rsiValue.toFixed(0)}${strongVolume ? ", strong volume" : ""}.`
      : direction === "sell"
        ? `${symbol} (${sector}): price below all MAs, MACD bearish cross, RSI ${rsiValue.toFixed(0)}${strongVolume ? ", elevated volume" : ""}.`
        : `${symbol} (${sector}): mixed signals. RSI ${rsiValue.toFixed(0)}, no clear MA alignment.`,
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
