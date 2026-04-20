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

// ─── Economic Calendar (Public Feed Only) ────────────────────────────────────

type PublicCalendarEvent = {
  date?: string;
  country?: string;
  title?: string;
  event?: string;
  impact?: string;
  forecast?: string | number;
  previous?: string | number;
  actual?: string | number;
};

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
}

function normalizeEconomicEvent(value: unknown): EconomicEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<EconomicEvent>;
  const time = coerceDate(raw.time);
  if (!time) return null;

  const impact = raw.impact;
  if (impact !== 'low' && impact !== 'medium' && impact !== 'high') {
    return null;
  }

  const eventName = typeof raw.event === 'string' ? raw.event.trim() : '';
  const country = typeof raw.country === 'string' ? raw.country.trim() : '';

  return {
    time,
    country: country || 'N/A',
    event: eventName || 'Unnamed event',
    impact,
    forecast: typeof raw.forecast === 'number' && Number.isFinite(raw.forecast) ? raw.forecast : undefined,
    previous: typeof raw.previous === 'number' && Number.isFinite(raw.previous) ? raw.previous : undefined,
    actual: typeof raw.actual === 'number' && Number.isFinite(raw.actual) ? raw.actual : undefined,
  };
}

function parseImpact(value: string | undefined): EconomicEvent['impact'] | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();

  if (normalized.includes('high')) return 'high';
  if (normalized.includes('medium')) return 'medium';
  if (normalized.includes('low')) return 'low';
  return null;
}

function parseOptionalNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/[^0-9+-.]/g, '');
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function fetchEconomicCalendar(): Promise<EconomicEvent[]> {
  const cached = await getCache<unknown>(CacheKeys.calendar());
  if (Array.isArray(cached)) {
    const normalizedCached = cached
      .map(normalizeEconomicEvent)
      .filter((event): event is EconomicEvent => event !== null);
    if (normalizedCached.length > 0) {
      return normalizedCached;
    }
  }

  try {
    // Public-source feed (no API key): Forex Factory mirror via Fair Economy.
    const response = await axios.get<PublicCalendarEvent[]>(
      'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      {
      timeout: 8_000,
      },
    );

    const rawEvents = Array.isArray(response.data) ? response.data : [];
    const events: EconomicEvent[] = rawEvents
      .map((event): EconomicEvent | null => {
        const impact = parseImpact(event.impact);
        if (!impact || impact === 'low') return null;

        const timestamp = new Date(event.date ?? '');
        if (Number.isNaN(timestamp.getTime())) return null;

        return {
          time: timestamp,
          country: event.country ?? 'N/A',
          event: (event.title ?? event.event ?? '').trim() || 'Unnamed event',
          impact,
          forecast: parseOptionalNumber(event.forecast),
          previous: parseOptionalNumber(event.previous),
          actual: parseOptionalNumber(event.actual),
        };
      })
      .filter((event): event is EconomicEvent => event !== null);

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
    economicEvents: events
      .map(normalizeEconomicEvent)
      .filter((event): event is EconomicEvent => event !== null),
  };
}
