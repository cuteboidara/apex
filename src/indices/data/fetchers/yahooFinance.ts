// src/indices/data/fetchers/yahooFinance.ts
// Low-level Yahoo Finance v8 API client with retry + timeout

import axios from 'axios';
import type { Candle } from '@/src/indices/types';

const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

type YFInterval = '1d' | '4h' | '1h' | '1wk';

interface YFResponse {
  chart: {
    result: Array<{
      meta: { regularMarketPrice: number; currency: string };
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }>;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchYahooCandles(
  yahooSymbol: string,
  interval: YFInterval,
  count: number,
): Promise<{ candles: Candle[]; currentPrice: number | null }> {
  const range = intervalToRange(interval, count);
  const url = `${YF_BASE}/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}&includePrePost=false`;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<YFResponse>(url, {
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
        },
      });

      const result = response.data.chart.result?.[0];
      if (!result) {
        throw new Error(`No data returned for ${yahooSymbol}`);
      }

      const { timestamp, indicators, meta } = result;
      const quote = indicators.quote[0];
      if (!quote || !timestamp?.length) {
        throw new Error(`Empty quote data for ${yahooSymbol}`);
      }

      const timeframe = yfIntervalToTimeframe(interval);
      const candles: Candle[] = [];

      for (let i = 0; i < timestamp.length; i++) {
        const open = quote.open[i];
        const high = quote.high[i];
        const low = quote.low[i];
        const close = quote.close[i];
        const volume = quote.volume[i] ?? 0;

        if (open == null || high == null || low == null || close == null) continue;
        if (!Number.isFinite(open) || !Number.isFinite(close)) continue;

        candles.push({
          timestamp: new Date(timestamp[i]! * 1000),
          open,
          high,
          low,
          close,
          volume,
          timeframe,
        });
      }

      return {
        candles: candles.slice(-count),
        currentPrice: meta.regularMarketPrice ?? candles.at(-1)?.close ?? null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  console.error(`[yahoo-finance] Failed after ${MAX_RETRIES} attempts for ${yahooSymbol}:`, lastError?.message);
  return { candles: [], currentPrice: null };
}

function intervalToRange(interval: YFInterval, count: number): string {
  switch (interval) {
    case '1wk': return count <= 52 ? '1y' : '5y';
    case '1d': return count <= 200 ? '1y' : '5y';
    case '4h': return '60d';   // Yahoo only provides 4h for ~60 days
    case '1h': return '30d';
    default: return '1y';
  }
}

function yfIntervalToTimeframe(interval: YFInterval): '1D' | '4H' | '1H' {
  switch (interval) {
    case '1d': return '1D';
    case '4h': return '4H';
    case '1h': return '1H';
    default: return '1D';
  }
}

export async function fetchYahooCurrentPrice(yahooSymbol: string): Promise<number | null> {
  const url = `${YF_BASE}/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;
  try {
    const response = await axios.get<YFResponse>(url, {
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    const meta = response.data.chart.result?.[0]?.meta;
    return meta?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}
