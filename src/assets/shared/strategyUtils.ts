import type { Candle } from "@/src/assets/shared/types";

export type StrategyDirection = "buy" | "sell" | "neutral";

export type StrategySignal = {
  symbol: string;
  direction: StrategyDirection;
  grade: string;
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  timeframe: string;
  setupType: string;
  reasoning: string;
  generatedAt: Date;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) {
    return [];
  }

  const smoothing = 2 / (period + 1);
  const series: number[] = [values[0] ?? 0];

  for (let index = 1; index < values.length; index += 1) {
    const previous = series[index - 1] ?? values[index - 1] ?? 0;
    const nextValue = (values[index] * smoothing) + (previous * (1 - smoothing));
    series.push(nextValue);
  }

  return series;
}

export function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  return average(slice);
}

export function ema(values: number[], period: number): number {
  const series = emaSeries(values, period);
  return series.at(-1) ?? 0;
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) {
    return 50;
  }

  let gains = 0;
  let losses = 0;
  const start = closes.length - period;

  for (let index = start; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    const diff = current - previous;
    if (diff > 0) {
      gains += diff;
    } else {
      losses += Math.abs(diff);
    }
  }

  const relativeStrength = gains / (losses || 1);
  return 100 - (100 / (1 + relativeStrength));
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length === 0) {
    return 0;
  }

  const window = candles.slice(-(period + 1));
  const ranges: number[] = [];

  for (let index = 0; index < window.length; index += 1) {
    const current = window[index];
    const previous = index > 0 ? window[index - 1] : null;
    const trueRange = previous
      ? Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      )
      : current.high - current.low;
    ranges.push(trueRange);
  }

  return average(ranges.filter(value => Number.isFinite(value) && value >= 0));
}

export function macd(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length === 0) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const ema12Series = emaSeries(closes, 12);
  const ema26Series = emaSeries(closes, 26);
  const macdSeries = closes.map((_, index) => (ema12Series[index] ?? 0) - (ema26Series[index] ?? 0));
  const signalSeries = emaSeries(macdSeries, 9);
  const macdLine = macdSeries.at(-1) ?? 0;
  const signalLine = signalSeries.at(-1) ?? 0;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine,
  };
}

export function bollingerBands(closes: number[], period = 20, stdDev = 2): {
  upper: number;
  middle: number;
  lower: number;
} {
  const slice = closes.slice(-period);
  const middle = average(slice);
  const variance = average(slice.map(value => (value - middle) ** 2));
  const deviation = Math.sqrt(variance);

  return {
    upper: middle + (stdDev * deviation),
    middle,
    lower: middle - (stdDev * deviation),
  };
}

export function volumeSpike(volumes: number[], lookback = 20): number {
  if (volumes.length === 0) {
    return 1;
  }

  const recent = volumes.slice(-lookback - 1, -1).filter(value => Number.isFinite(value) && value >= 0);
  const baseline = average(recent);
  const latest = volumes.at(-1) ?? 0;
  return baseline > 0 ? latest / baseline : 1;
}

export function calculateGrade(confidence: number, rr: number): string {
  if (confidence >= 78 && rr >= 2.2) return "S";
  if (confidence >= 68 && rr >= 1.8) return "A";
  if (confidence >= 58 && rr >= 1.4) return "B";
  if (confidence >= 48 && rr >= 1.1) return "C";
  if (confidence >= 40) return "D";
  return "F";
}

export function calculateGradeScore(confidence: number, rr: number): number {
  const rrComponent = Math.min(Math.max(rr, 0), 3) / 3;
  return Math.max(0, Math.min(100, Math.round((confidence * 0.72) + (rrComponent * 28))));
}

export function calculateLevels(
  direction: StrategyDirection,
  price: number,
  atrValue: number,
  rrTarget = 2.0,
): { entry: number; stopLoss: number; takeProfit: number; rr: number } {
  const safeAtr = Number.isFinite(atrValue) && atrValue > 0
    ? atrValue
    : Math.max(Math.abs(price) * 0.01, 0.01);
  const stopMultiplier = 1.5;
  const targetMultiplier = stopMultiplier * rrTarget;

  if (direction === "buy") {
    return {
      entry: price,
      stopLoss: price - (safeAtr * stopMultiplier),
      takeProfit: price + (safeAtr * targetMultiplier),
      rr: rrTarget,
    };
  }

  if (direction === "sell") {
    return {
      entry: price,
      stopLoss: price + (safeAtr * stopMultiplier),
      takeProfit: price - (safeAtr * targetMultiplier),
      rr: rrTarget,
    };
  }

  return {
    entry: price,
    stopLoss: price,
    takeProfit: price,
    rr: 0,
  };
}

export function buildTradeLevels(signal: Pick<StrategySignal, "direction" | "entry" | "stopLoss" | "takeProfit" | "riskReward">): {
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
} {
  if (signal.direction === "neutral") {
    return {
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null,
    };
  }

  const risk = Math.abs(signal.entry - signal.stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return {
      entry: signal.entry,
      sl: signal.stopLoss,
      tp1: signal.takeProfit,
      tp2: signal.takeProfit,
      tp3: signal.takeProfit,
    };
  }

  const tp2Rr = Math.max(signal.riskReward + 0.8, signal.riskReward * 1.35);
  const tp3Rr = Math.max(signal.riskReward + 1.6, signal.riskReward * 1.7);

  return {
    entry: signal.entry,
    sl: signal.stopLoss,
    tp1: signal.takeProfit,
    tp2: signal.direction === "buy"
      ? signal.entry + (risk * tp2Rr)
      : signal.entry - (risk * tp2Rr),
    tp3: signal.direction === "buy"
      ? signal.entry + (risk * tp3Rr)
      : signal.entry - (risk * tp3Rr),
  };
}

export function formatPrice(price: number, symbol: string): number {
  if (["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"].includes(symbol)) {
    return Number(price.toFixed(5));
  }
  if (["USDJPY", "EURJPY"].includes(symbol)) {
    return Number(price.toFixed(3));
  }
  if (price > 1000) {
    return Number(price.toFixed(2));
  }
  if (price > 10) {
    return Number(price.toFixed(3));
  }
  return Number(price.toFixed(5));
}
