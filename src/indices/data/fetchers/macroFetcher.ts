// src/indices/data/fetchers/macroFetcher.ts
// Fetch DXY, VIX, 10Y yield, Fear & Greed sentiment, economic calendar

import axios from 'axios';
import type { MacroContext, EconomicEvent } from '@/src/indices/types';
import { MACRO_CONFIG } from './assetConfig';
import { fetchYahooCandles } from './yahooFinance';
import { getCache, setCache, CacheKeys, CacheTTL } from '../cache/cacheManager';

// ─── DXY ─────────────────────────────────────────────────────────────────────

export interface DXYData {
  price: number;
  change24h: number;
  trend: 'up' | 'down' | 'neutral';
  sma20: number;
  strength: 'strong' | 'weak' | 'neutral';
}

export async function fetchDXY(): Promise<DXYData | null> {
  const cached = await getCache<DXYData>(CacheKeys.dxy());
  if (cached) return cached;

  const { candles } = await fetchYahooCandles(MACRO_CONFIG.DXY.yahooSymbol, '1d', 30);
  if (candles.length < 2) return null;

  const latest = candles.at(-1)!;
  const prev = candles.at(-2)!;
  const closes = candles.map(c => c.close);
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, closes.length);
  const change24h = ((latest.close - prev.close) / prev.close) * 100;

  const strength: DXYData['strength'] =
    latest.close > sma20 * 1.005 ? 'strong' :
    latest.close < sma20 * 0.995 ? 'weak' : 'neutral';

  const trend: DXYData['trend'] =
    change24h > 0.1 ? 'up' :
    change24h < -0.1 ? 'down' : 'neutral';

  const data: DXYData = { price: latest.close, change24h, trend, sma20, strength };
  await setCache(CacheKeys.dxy(), data, CacheTTL.dxy);
  return data;
}

// ─── VIX ─────────────────────────────────────────────────────────────────────

export interface VIXData {
  price: number;
  change24h: number;
  regime: 'low' | 'normal' | 'high';
}

export async function fetchVIX(): Promise<VIXData | null> {
  const cached = await getCache<VIXData>(CacheKeys.vix());
  if (cached) return cached;

  const { candles } = await fetchYahooCandles(MACRO_CONFIG.VIX.yahooSymbol, '1d', 5);
  if (candles.length < 2) return null;

  const latest = candles.at(-1)!;
  const prev = candles.at(-2)!;
  const change24h = ((latest.close - prev.close) / prev.close) * 100;

  const regime: VIXData['regime'] =
    latest.close < 15 ? 'low' :
    latest.close > 25 ? 'high' : 'normal';

  const data: VIXData = { price: latest.close, change24h, regime };
  await setCache(CacheKeys.vix(), data, CacheTTL.vix);
  return data;
}

// ─── 10Y Yield ────────────────────────────────────────────────────────────────

export interface YieldData {
  price: number;
  change5d: number;      // basis points
  trend: 'up' | 'down' | 'stable';
}

export async function fetchYield10Y(): Promise<YieldData | null> {
  const cached = await getCache<YieldData>(CacheKeys.yields());
  if (cached) return cached;

  const { candles } = await fetchYahooCandles(MACRO_CONFIG.TNX.yahooSymbol, '1d', 10);
  if (candles.length < 6) return null;

  const latest = candles.at(-1)!;
  const fiveDaysAgo = candles.at(-6)!;
  const change5d = (latest.close - fiveDaysAgo.close) * 100; // in bps (TNX is in %)

  const trend: YieldData['trend'] =
    change5d > 5 ? 'up' :
    change5d < -5 ? 'down' : 'stable';

  const data: YieldData = { price: latest.close, change5d, trend };
  await setCache(CacheKeys.yields(), data, CacheTTL.yields);
  return data;
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────

export interface SentimentData {
  fearGreed: number;
  classification: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
}

export async function fetchFearGreed(): Promise<SentimentData | null> {
  const cached = await getCache<SentimentData>(CacheKeys.sentiment());
  if (cached) return cached;

  try {
    const response = await axios.get<{
      data: Array<{ value: string; value_classification: string }>;
    }>('https://api.alternative.me/fng/?limit=1', { timeout: 8_000 });

    const item = response.data.data?.[0];
    if (!item) return null;

    const value = Number(item.value);
    const classification: SentimentData['classification'] =
      value <= 25 ? 'extreme_fear' :
      value <= 45 ? 'fear' :
      value <= 55 ? 'neutral' :
      value <= 75 ? 'greed' : 'extreme_greed';

    const data: SentimentData = { fearGreed: value, classification };
    await setCache(CacheKeys.sentiment(), data, CacheTTL.sentiment);
    return data;
  } catch (error) {
    console.error('[macro-fetcher] Fear & Greed fetch failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ─── Economic Calendar ────────────────────────────────────────────────────────

export async function fetchEconomicCalendar(): Promise<EconomicEvent[]> {
  const cached = await getCache<EconomicEvent[]>(CacheKeys.calendar());
  if (cached) return cached;

  try {
    // Use Finnhub if available (existing dependency)
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return [];

    const now = new Date();
    const from = now.toISOString().split('T')[0];
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await axios.get<{
      economicCalendar?: Array<{
        event: string;
        country: string;
        time: string;
        impact: string;
        estimate?: number;
        prev?: number;
        actual?: number;
      }>;
    }>(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${apiKey}`, {
      timeout: 8_000,
    });

    const rawEvents = Array.isArray(response.data)
      ? response.data
      : (response.data?.economicCalendar ?? []);

    const events: EconomicEvent[] = rawEvents
      .filter((e: { impact: string }) => e.impact === 'high' || e.impact === 'medium')
      .map((e: { event?: string; eventName?: string; country: string; time: string; impact: string; estimate?: number; prev?: number; actual?: number }) => ({
        time: new Date(e.time),
        country: e.country,
        event: e.event ?? e.eventName ?? '',
        impact: (e.impact === 'high' ? 'high' : e.impact === 'medium' ? 'medium' : 'low') as EconomicEvent['impact'],
        forecast: e.estimate,
        previous: e.prev,
        actual: e.actual,
      }));

    await setCache(CacheKeys.calendar(), events, CacheTTL.calendar);
    return events;
  } catch (error) {
    console.error('[macro-fetcher] Calendar fetch failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ─── Aggregated Macro Context ─────────────────────────────────────────────────

export async function fetchMacroContext(): Promise<MacroContext> {
  const [dxy, vix, yields, sentiment, events] = await Promise.all([
    fetchDXY(),
    fetchVIX(),
    fetchYield10Y(),
    fetchFearGreed(),
    fetchEconomicCalendar(),
  ]);

  return {
    timestamp: new Date(),
    dxy: dxy
      ? { price: dxy.price, change24h: dxy.change24h, trend: dxy.trend, sma20: dxy.sma20, strength: dxy.strength }
      : { price: 0, change24h: 0, trend: 'neutral', sma20: 0, strength: 'neutral' },
    vix: vix
      ? { price: vix.price, change24h: vix.change24h, regime: vix.regime }
      : { price: 20, change24h: 0, regime: 'normal' },
    yield10y: yields
      ? { price: yields.price, change5d: yields.change5d, trend: yields.trend }
      : { price: 4.5, change5d: 0, trend: 'stable' },
    sentiment: sentiment
      ? { fearGreed: sentiment.fearGreed, classification: sentiment.classification }
      : { fearGreed: 50, classification: 'neutral' },
    economicEvents: events,
  };
}
