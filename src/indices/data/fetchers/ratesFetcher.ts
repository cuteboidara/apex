// src/indices/data/fetchers/ratesFetcher.ts
// Fetch candle data for bond yield rates
// US10Y / US2Y use reliable Yahoo Finance tickers; DE10Y/JP10Y/UK10Y use best-effort symbols

import { ASSET_CONFIG, ASSET_SYMBOLS, CANDLE_LIMITS, isRate, type AssetSymbol } from './assetConfig';
import { fetchYahooCandles, fetchYahooCurrentPrice } from './yahooFinance';
import { getCache, setCache, CacheKeys, CacheTTL } from '../cache/cacheManager';
import type { MultiTimeframeCandles } from './indicesFetcher';

const RATE_SYMBOLS: AssetSymbol[] = ASSET_SYMBOLS.filter(isRate);

// US10Y already tracked via macro context (^TNX); fallback price for it
const MACRO_RATE_FALLBACK: Partial<Record<AssetSymbol, number>> = {
  US10Y: 4.5,
  US2Y: 4.8,
  DE10Y: 2.6,
  JP10Y: 1.4,
  UK10Y: 4.4,
};

export async function fetchRateCandles(symbol: AssetSymbol): Promise<MultiTimeframeCandles> {
  const config = ASSET_CONFIG[symbol];
  const cacheKey = CacheKeys.candles(symbol, 'multi');
  const cached = await getCache<MultiTimeframeCandles>(cacheKey);
  if (cached) {
    console.log(`[rates-fetcher] Cache hit for ${symbol}`);
    return cached;
  }

  try {
    // Rates typically only have daily data on Yahoo Finance; 4H may be empty
    const [dailyResult, h4Result, weeklyResult, livePrice] = await Promise.all([
      fetchYahooCandles(config.yahooSymbol, '1d', CANDLE_LIMITS['1D']),
      fetchYahooCandles(config.yahooSymbol, '4h', CANDLE_LIMITS['4H']),
      fetchYahooCandles(config.yahooSymbol, '1wk', CANDLE_LIMITS['1W']),
      fetchYahooCurrentPrice(config.yahooSymbol),
    ]);

    const currentPrice =
      livePrice ?? dailyResult.currentPrice ?? MACRO_RATE_FALLBACK[symbol] ?? 0;

    const result: MultiTimeframeCandles = {
      daily: dailyResult.candles,
      h4: h4Result.candles,
      weekly: weeklyResult.candles,
      currentPrice,
      sourceTimestamp: new Date(),
    };

    if (result.daily.length > 0) {
      await setCache(cacheKey, result, CacheTTL.candles);
    }

    console.log(
      `[rates-fetcher] ${symbol}: daily=${result.daily.length} h4=${result.h4.length} price=${currentPrice}`,
    );
    return result;
  } catch (err) {
    // Fallback: synthesise a minimal result so the runtime can at least show a price
    const fallbackPrice = MACRO_RATE_FALLBACK[symbol];
    if (fallbackPrice !== undefined) {
      console.warn(`[rates-fetcher] ${symbol} Yahoo fetch failed, using fallback price ${fallbackPrice}`);
      return {
        daily: [],
        h4: [],
        weekly: [],
        currentPrice: fallbackPrice,
        sourceTimestamp: new Date(),
      };
    }
    throw err;
  }
}

export async function fetchAllRateCandles(): Promise<Map<AssetSymbol, MultiTimeframeCandles>> {
  const results = await Promise.allSettled(
    RATE_SYMBOLS.map(async symbol => ({ symbol, data: await fetchRateCandles(symbol) })),
  );

  const map = new Map<AssetSymbol, MultiTimeframeCandles>();
  for (const result of results) {
    if (result.status === 'fulfilled') {
      map.set(result.value.symbol, result.value.data);
    }
  }
  return map;
}
