import type { Candle } from "@/src/assets/shared/types";
import {
  atr,
  buildTradeLevels,
  calculateGrade,
  calculateGradeScore,
  calculateLevels,
  ema,
  formatPrice,
  macd,
  rsi,
  volumeSpike,
  type StrategySignal,
} from "@/src/assets/shared/strategyUtils";

export type CryptoStrategySignal = StrategySignal & {
  gradeScore: number;
  tradeLevels: ReturnType<typeof buildTradeLevels>;
};

export function scoreCryptoAsset(
  symbol: string,
  candles: Candle[],
  livePrice: number,
  btcDominance?: number | null,
): CryptoStrategySignal | null {
  if (candles.length < 50) {
    return null;
  }

  const closes = candles.map(candle => candle.close);
  const volumes = candles.map(candle => candle.volume ?? 0);
  const atrValue = atr(candles);
  const ema21 = ema(closes, 21);
  const ema55 = ema(closes, 55);
  const trendBullish = livePrice > ema21 && ema21 > ema55;
  const trendBearish = livePrice < ema21 && ema21 < ema55;
  const rsiValue = rsi(closes);
  const { histogram } = macd(closes);
  const rsiOverbought = rsiValue > 70;
  const rsiOversold = rsiValue < 30;
  const macdBullish = histogram > 0;
  const macdBearish = histogram < 0;
  const volSpike = volumeSpike(volumes);
  const hasVolumeConfirmation = volSpike > 1.3;
  const isBTC = symbol === "BTCUSDT";
  const altsBleeding = !isBTC && typeof btcDominance === "number" && btcDominance > 55;

  let direction: CryptoStrategySignal["direction"] = "neutral";
  let confidence = 50;

  if (trendBullish && macdBullish && !rsiOverbought && !altsBleeding) {
    direction = "buy";
    confidence = 55;
    if (hasVolumeConfirmation) confidence += 10;
    if (rsiValue > 50 && rsiValue < 65) confidence += 8;
    if (ema21 > ema55 * 1.005) confidence += 7;
  } else if (trendBearish && macdBearish && !rsiOversold) {
    direction = "sell";
    confidence = 55;
    if (hasVolumeConfirmation) confidence += 10;
    if (rsiValue < 50 && rsiValue > 35) confidence += 8;
    if (ema21 < ema55 * 0.995) confidence += 7;
  } else if (rsiOversold && macdBullish && !altsBleeding) {
    direction = "buy";
    confidence = 50;
  } else if (rsiOverbought && macdBearish) {
    direction = "sell";
    confidence = 50;
  }

  confidence = Math.min(94, Math.max(38, confidence));

  const rawLevels = calculateLevels(direction, livePrice, atrValue, 2.2);
  const grade = calculateGrade(confidence, rawLevels.rr);
  const signal: CryptoStrategySignal = {
    symbol,
    direction,
    grade,
    gradeScore: calculateGradeScore(confidence, rawLevels.rr),
    confidence: Math.round(confidence),
    entry: formatPrice(rawLevels.entry, symbol),
    stopLoss: formatPrice(rawLevels.stopLoss, symbol),
    takeProfit: formatPrice(rawLevels.takeProfit, symbol),
    riskReward: rawLevels.rr,
    timeframe: "1h",
    setupType: direction === "neutral" ? "range_reversal" : "trend_pullback",
    reasoning: direction === "buy"
      ? `${symbol} bullish: EMA21 above EMA55, RSI ${rsiValue.toFixed(0)}, MACD positive${hasVolumeConfirmation ? ", volume spike confirms" : ""}.`
      : direction === "sell"
        ? `${symbol} bearish: EMA21 below EMA55, RSI ${rsiValue.toFixed(0)}, MACD negative${hasVolumeConfirmation ? ", volume spike confirms" : ""}.`
        : `${symbol} ranging: no clear momentum bias. RSI ${rsiValue.toFixed(0)}, mixed MACD signals${altsBleeding ? ", BTC dominance is pressuring alts" : ""}.`,
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
