// src/indices/data/fetchers/indicesFetcher.ts
// Fetch OHLCV candles for NAS100, SPX500, DAX

import type { AssetData, Candle } from '@/src/indices/types';
import { ASSET_CONFIG, CANDLE_LIMITS, type AssetSymbol } from './assetConfig';
import { fetchYahooCandles, fetchYahooCurrentPrice } from './yahooFinance';
import { getCache, setCache, CacheKeys, CacheTTL } from '../cache/cacheManager';

export type MultiTimeframeCandles = {
  daily: Candle[];
  h4: Candle[];
  weekly: Candle[];
  currentPrice: number | null;
  sourceTimestamp: Date;
};

export async function fetchIndexCandles(symbol: AssetSymbol): Promise<MultiTimeframeCandles> {
  const config = ASSET_CONFIG[symbol];
  const cacheKey = CacheKeys.candles(symbol, 'multi');
  const cached = await getCache<MultiTimeframeCandles>(cacheKey);
  if (cached) {
    console.log(`[indices-fetcher] Cache hit for ${symbol}`);
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
    `[indices-fetcher] ${symbol}: daily=${result.daily.length} h4=${result.h4.length} weekly=${result.weekly.length} price=${result.currentPrice ?? 'null'}`,
  );
  return result;
}

export async function fetchAllIndicesCandles(): Promise<Map<AssetSymbol, MultiTimeframeCandles>> {
  const indexSymbols: AssetSymbol[] = ['NAS100', 'SPX500', 'DAX'];
  const results = await Promise.all(
    indexSymbols.map(async symbol => ({ symbol, data: await fetchIndexCandles(symbol) })),
  );
  return new Map(results.map(r => [r.symbol, r.data]));
}

export function buildAssetData(symbol: AssetSymbol, mtf: MultiTimeframeCandles): AssetData {
  return {
    asset: symbol,
    candles: mtf.daily,
    currentPrice: mtf.currentPrice ?? 0,
    lastUpdate: mtf.sourceTimestamp,
  };
}
