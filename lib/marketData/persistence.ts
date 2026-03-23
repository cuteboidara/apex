import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AssetClass, Timeframe } from "@/lib/marketData/types";
import type { ProviderCandlePayload, ProviderQuotePayload } from "@/lib/providers/types";

function toDate(timestamp: number | null | undefined) {
  return timestamp != null && Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function toJsonValue(
  metadata: Record<string, unknown> | null | undefined
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return metadata == null ? Prisma.JsonNull : (metadata as Prisma.InputJsonValue);
}

export type CandlePersistenceRow = Prisma.CandleCreateManyInput;
export type QuoteSnapshotPersistenceRow = Prisma.QuoteSnapshotCreateManyInput;

export function buildHistoricalQuoteRow(
  symbol: string,
  assetClass: AssetClass,
  quote: ProviderQuotePayload,
  input: {
    selectedProvider: string;
    freshnessMs: number | null;
  }
): QuoteSnapshotPersistenceRow | null {
  const sourceTimestamp = toDate(quote.sourceTimestamp ?? quote.timestamp);
  if (!sourceTimestamp || quote.price == null || quote.price <= 0) {
    return null;
  }

  return {
    symbol,
    assetClass,
    provider: input.selectedProvider,
    requestSymbol: quote.requestSymbol ?? symbol,
    sourceTimestamp,
    price: quote.price,
    bid: quote.bid ?? null,
    ask: quote.ask ?? null,
    change24h: quote.change24h ?? null,
    high14d: quote.high14d ?? null,
    low14d: quote.low14d ?? null,
    volume: quote.volume ?? null,
    freshnessMs: input.freshnessMs,
    marketStatus: quote.marketStatus,
    reason: quote.reason,
    metadata: toJsonValue(quote.metadata),
  };
}

export function buildHistoricalCandleRows(
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe,
  candles: ProviderCandlePayload,
  input: {
    selectedProvider: string;
  }
): CandlePersistenceRow[] {
  const rows: CandlePersistenceRow[] = [];

  for (const rawCandle of candles.candles) {
    const candle = rawCandle as typeof rawCandle & { sourceTimestamp?: number | null };
    const sourceTimestamp = toDate(candle.sourceTimestamp ?? candle.timestamp);
    if (
      !sourceTimestamp ||
      candle.open == null ||
      candle.high == null ||
      candle.low == null ||
      candle.close == null
    ) {
      continue;
    }

    rows.push({
      symbol,
      assetClass,
      timeframe,
      provider: input.selectedProvider,
      requestSymbol: candles.requestSymbol ?? symbol,
      sourceTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume ?? null,
      quality: candles.marketStatus,
      metadata: toJsonValue(candles.metadata),
    });
  }

  return rows;
}

export function buildDerivedQuoteRowsFromCandles(
  rows: CandlePersistenceRow[],
  input: {
    marketStatus?: "LIVE" | "DEGRADED" | "UNAVAILABLE";
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  } = {}
): QuoteSnapshotPersistenceRow[] {
  return rows
    .filter(row => typeof row.close === "number" && row.close > 0)
    .map(row => ({
      symbol: row.symbol,
      assetClass: row.assetClass,
      provider: row.provider,
      requestSymbol: row.requestSymbol ?? row.symbol,
      sourceTimestamp: row.sourceTimestamp,
      price: row.close,
      bid: null,
      ask: null,
      change24h: null,
      high14d: row.high,
      low14d: row.low,
      volume: row.volume ?? null,
      freshnessMs: null,
      marketStatus: input.marketStatus ?? "LIVE",
      reason: input.reason ?? null,
      metadata: toJsonValue({
        derivedFrom: "candle_backfill",
        ...(input.metadata ?? {}),
      }),
    }));
}

export async function storeHistoricalCandleRows(rows: CandlePersistenceRow[]) {
  if (rows.length === 0) return 0;
  const result = await prisma.candle.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

export async function storeQuoteSnapshotRows(rows: QuoteSnapshotPersistenceRow[]) {
  if (rows.length === 0) return 0;
  const result = await prisma.quoteSnapshot.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

export async function persistHistoricalQuote(
  symbol: string,
  assetClass: AssetClass,
  quote: ProviderQuotePayload,
  input: {
    selectedProvider: string;
    freshnessMs: number | null;
  }
) {
  const row = buildHistoricalQuoteRow(symbol, assetClass, quote, input);
  if (!row) {
    return;
  }

  try {
    await prisma.quoteSnapshot.upsert({
      where: {
        symbol_provider_sourceTimestamp: {
          symbol: row.symbol,
          provider: input.selectedProvider,
          sourceTimestamp: row.sourceTimestamp,
        },
      },
      create: row,
      update: {
        price: row.price,
        bid: row.bid,
        ask: row.ask,
        change24h: row.change24h,
        high14d: row.high14d,
        low14d: row.low14d,
        volume: row.volume,
        freshnessMs: row.freshnessMs,
        marketStatus: row.marketStatus,
        reason: row.reason,
        metadata: row.metadata,
        recordedAt: new Date(),
      },
    });
  } catch {
    // Historical persistence must not break quote reads.
  }
}

export async function persistHistoricalCandles(
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe,
  candles: ProviderCandlePayload,
  input: {
    selectedProvider: string;
  }
) {
  const rows = buildHistoricalCandleRows(symbol, assetClass, timeframe, candles, input);

  if (rows.length === 0) {
    return;
  }

  try {
    await storeHistoricalCandleRows(rows);
  } catch {
    // Historical persistence must not break candle reads.
  }
}
