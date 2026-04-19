// src/indices/data/fetchers/commodityFetcher.ts
// Fetch OHLCV candles for all configured commodity symbols

import { ASSET_CONFIG, ASSET_SYMBOLS, CANDLE_LIMITS, isCommodity, type AssetSymbol } from './assetConfig';
import { fetchYahooCandles, fetchYahooCurrentPrice } from './yahooFinance';
import { getCache, setCache, CacheKeys, CacheTTL } from '../cache/cacheManager';
import type { MultiTimeframeCandles } from './indicesFetcher';

const COMMODITY_SYMBOLS: AssetSymbol[] = ASSET_SYMBOLS.filter(isCommodity);

export async function fetchCommodityCandles(symbol: AssetSymbol): Promise<MultiTimeframeCandles> {
  const config = ASSET_CONFIG[symbol];
  const cacheKey = CacheKeys.candles(symbol, 'multi');
  const cached = await getCache<MultiTimeframeCandles>(cacheKey);
  if (cached) {
    console.log(`[commodity-fetcher] Cache hit for ${symbol}`);
    return cached;
  }

  const [dailyResult, h4Result, weeklyResult, livePrice] = await Promise.all([
    fetchYahooCandles(config.yahooSymbol, '1d', CANDLE_LIMITS['1D']),
    fetchYahooCandles(config.yahooSymbol, '4h', CANDLE_LIMITS['4H']),
    fetchYahooCandles(config.yahooSymbol, '1wk', CANDLE_LIMITS['1W']),
    fetchYahooCurrentPrice(config.yahooSymbol),
  ]);

  const result: MultiTimeframeCandles = {
    daily: dailyResult.candles,
    h4: h4Result.candles,
    weekly: weeklyResult.candles,
    currentPrice: livePrice ?? dailyResult.currentPrice ?? h4Result.currentPrice,
    sourceTimestamp: new Date(),
  };

  if (result.daily.length > 0 || result.h4.length > 0) {
    await setCache(cacheKey, result, CacheTTL.candles);
  }

  console.log(
    `[commodity-fetcher] ${symbol}: daily=${result.daily.length} h4=${result.h4.length} weekly=${result.weekly.length} price=${result.currentPrice ?? 'null'}`,
  );
  return result;
}

export async function fetchAllCommodityCandles(): Promise<Map<AssetSymbol, MultiTimeframeCandles>> {
  const results = await Promise.all(
    COMMODITY_SYMBOLS.map(async symbol => ({ symbol, data: await fetchCommodityCandles(symbol) })),
  );
  return new Map(results.map(r => [r.symbol, r.data]));
}
