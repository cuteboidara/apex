// src/indices/data/fetchers/forexFetcher.ts
// Fetch OHLCV candles for all configured forex symbols

import type { AssetData, Candle } from '@/src/indices/types';
import { ASSET_CONFIG, ASSET_SYMBOLS, CANDLE_LIMITS, isForex, type AssetSymbol } from './assetConfig';
import { fetchYahooCandles, fetchYahooCurrentPrice } from './yahooFinance';
import { getCache, setCache, CacheKeys, CacheTTL } from '../cache/cacheManager';
import type { MultiTimeframeCandles } from './indicesFetcher';

const FOREX_SYMBOLS: AssetSymbol[] = ASSET_SYMBOLS.filter(symbol => isForex(symbol));

export async function fetchForexCandles(symbol: AssetSymbol): Promise<MultiTimeframeCandles> {
  const config = ASSET_CONFIG[symbol];
  const cacheKey = CacheKeys.candles(symbol, 'multi');
  const cached = await getCache<MultiTimeframeCandles>(cacheKey);
  if (cached) {
    console.log(`[forex-fetcher] Cache hit for ${symbol}`);
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

  if (result.daily.length > 0) {
    await setCache(cacheKey, result, CacheTTL.candles);
  }

  console.log(
    `[forex-fetcher] ${symbol}: daily=${result.daily.length} h4=${result.h4.length} weekly=${result.weekly.length} price=${result.currentPrice ?? 'null'}`,
  );
  return result;
}

export async function fetchAllForexCandles(): Promise<Map<AssetSymbol, MultiTimeframeCandles>> {
  const results = await Promise.all(
    FOREX_SYMBOLS.map(async symbol => ({ symbol, data: await fetchForexCandles(symbol) })),
  );
  return new Map(results.map(r => [r.symbol, r.data]));
}

export function buildForexAssetData(symbol: AssetSymbol, mtf: MultiTimeframeCandles): AssetData {
  return {
    asset: symbol,
    candles: mtf.daily,
    currentPrice: mtf.currentPrice ?? 0,
    lastUpdate: mtf.sourceTimestamp,
  };
}
