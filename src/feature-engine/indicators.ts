export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdev(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function sma(values: number[], period: number): number {
  return mean(values.slice(-period));
}

export function ema(values: number[], period: number): number {
  const series = values.slice(-Math.max(period * 3, period));
  if (series.length === 0) {
    return 0;
  }

  const multiplier = 2 / (period + 1);
  let current = series[0];
  for (const value of series.slice(1)) {
    current = ((value - current) * multiplier) + current;
  }
  return current;
}

export function rsi(values: number[], period: number): number {
  const series = values.slice(-(period + 1));
  if (series.length < period + 1) {
    return 50;
  }

  let gain = 0;
  let loss = 0;
  for (let index = 1; index < series.length; index += 1) {
    const delta = series[index] - series[index - 1];
    if (delta >= 0) {
      gain += delta;
    } else {
      loss += Math.abs(delta);
    }
  }

  if (loss === 0) {
    return 100;
  }

  const rs = (gain / period) / (loss / period);
  return 100 - (100 / (1 + rs));
}

export function atr(highs: number[], lows: number[], closes: number[], period: number): number {
  const size = Math.min(highs.length, lows.length, closes.length);
  if (size < 2) {
    return 0;
  }

  const trueRanges: number[] = [];
  for (let index = 1; index < size; index += 1) {
    const high = highs[highs.length - size + index];
    const low = lows[lows.length - size + index];
    const previousClose = closes[closes.length - size + index - 1];
    trueRanges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return mean(trueRanges.slice(-period));
}

export function bollinger(values: number[], period: number, deviation = 2) {
  const window = values.slice(-period);
  const mid = mean(window);
  const sigma = stdev(window);
  const upper = mid + (sigma * deviation);
  const lower = mid - (sigma * deviation);
  const latest = values[values.length - 1] ?? mid;
  const pctB = upper === lower ? 0.5 : (latest - lower) / (upper - lower);
  return { upper, lower, pctB };
}

export function zscore(values: number[], sample: number): number {
  const window = values.slice(-sample);
  if (window.length < 2) {
    return 0;
  }
  const avg = mean(window);
  const sigma = stdev(window);
  if (sigma === 0) {
    return 0;
  }
  const latest = window[window.length - 1] ?? avg;
  return (latest - avg) / sigma;
}
