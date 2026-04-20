import type { ScalpCandle } from "@/src/scalp/types/scalpTypes";

export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const alpha = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) {
    current = values[i] * alpha + current * (1 - alpha);
  }
  return current;
}

export function calculateRSI(values: number[], period = 14): number {
  if (values.length <= period) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

export function calculateMACD(values: number[]): { line: number; signal: number; histogram: number } {
  if (values.length < 35) {
    return { line: 0, signal: 0, histogram: 0 };
  }

  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const line = ema12 - ema26;

  const macdSeries: number[] = [];
  for (let i = Math.max(26, values.length - 60); i < values.length; i += 1) {
    const slice = values.slice(0, i + 1);
    macdSeries.push(ema(slice, 12) - ema(slice, 26));
  }

  const signal = ema(macdSeries, 9);
  return { line, signal, histogram: line - signal };
}

export function calculateStochRSI(values: number[], rsiPeriod = 14, stochPeriod = 14): number {
  if (values.length < rsiPeriod + stochPeriod + 2) return 50;

  const rsiSeries: number[] = [];
  for (let i = rsiPeriod; i < values.length; i += 1) {
    rsiSeries.push(calculateRSI(values.slice(0, i + 1), rsiPeriod));
  }

  const recent = rsiSeries.slice(-stochPeriod);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const current = recent[recent.length - 1];

  if (max - min === 0) return 50;
  return ((current - min) / (max - min)) * 100;
}

export function calculateATR(candles: ScalpCandle[], period = 14): number {
  if (candles.length < period + 1) return 0;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    trs.push(tr);
  }

  const recent = trs.slice(-period);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}
