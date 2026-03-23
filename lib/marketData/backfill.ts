import { prisma } from "@/lib/prisma";
import { SUPPORTED_ASSETS } from "@/lib/assets";
import { recordOperationalMetric } from "@/lib/observability/metrics";
import { marketProviderCatalog } from "@/lib/marketData/providerRegistry";
import {
  buildDerivedQuoteRowsFromCandles,
  buildHistoricalCandleRows,
  storeQuoteSnapshotRows,
  storeHistoricalCandleRows,
} from "@/lib/marketData/persistence";
import type { AssetClass, CandleBar, ProviderName, Timeframe } from "@/lib/marketData/types";
import type { ProviderCandlePayload, ProviderCandleBar } from "@/lib/providers/types";
import { fetchYahooHistoricalCandles } from "@/lib/providers/yahooFinance";

const BINANCE_BASE = "https://api.binance.com/api/v3";
const BINANCE_INTERVAL_MAP: Record<Timeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1D": "1d",
};

const PROVIDER_RATE_LIMIT_MS: Partial<Record<ProviderName, number>> = {
  "Binance": 150,
  "Yahoo Finance": 300,
};

const BACKFILL_CHUNK_SPAN_MS: Record<ProviderName, Partial<Record<Timeframe, number>>> = {
  "Binance": {
    "1m": 1000 * 60_000,
    "5m": 1000 * 5 * 60_000,
    "15m": 1000 * 15 * 60_000,
    "1h": 1000 * 60 * 60_000,
    "4h": 1000 * 4 * 60 * 60_000,
    "1D": 1000 * 24 * 60 * 60_000,
  },
  "Yahoo Finance": {
    "1m": 7 * 24 * 60 * 60_000,
    "5m": 60 * 24 * 60 * 60_000,
    "15m": 60 * 24 * 60 * 60_000,
    "1h": 365 * 24 * 60 * 60_000,
    "4h": 365 * 24 * 60 * 60_000,
    "1D": 5 * 365 * 24 * 60 * 60_000,
  },
};

const DEFAULT_REPLAY_LOOKBACK_DAYS = {
  SCALP: 14,
  INTRADAY: 45,
  SWING: 365,
} as const;

export type ReplayStyle = keyof typeof DEFAULT_REPLAY_LOOKBACK_DAYS;

export type BackfillChunkSummary = {
  timeframe: Timeframe;
  provider: ProviderName;
  chunkStart: string;
  chunkEnd: string;
  candlesReturned: number;
  candlesInserted: number;
  quotesInserted: number;
  skippedDuplicates: number;
  fallbackUsed: boolean;
  reason: string | null;
};

export type BackfillTimeframeSummary = {
  timeframe: Timeframe;
  selectedProvider: ProviderName | null;
  candleCount: number;
  candleInsertCount: number;
  quoteInsertCount: number;
  skippedDuplicates: number;
  resumeFrom: string | null;
  completed: boolean;
  chunks: BackfillChunkSummary[];
  reason: string | null;
};

export type BackfillResult = {
  symbol: string;
  assetClass: AssetClass;
  start: string;
  end: string;
  includeQuoteSnapshots: boolean;
  dryRun: boolean;
  timeframes: BackfillTimeframeSummary[];
};

export type BackfillProgressEvent =
  | {
      stage: "timeframe_started";
      symbol: string;
      timeframe: Timeframe;
      providerCandidates: ProviderName[];
      resumeFrom: string | null;
    }
  | {
      stage: "chunk_completed";
      symbol: string;
      timeframe: Timeframe;
      chunk: BackfillChunkSummary;
    }
  | {
      stage: "timeframe_completed";
      symbol: string;
      timeframe: Timeframe;
      summary: BackfillTimeframeSummary;
    };

export type BackfillRequest = {
  symbol: string;
  assetClass: AssetClass;
  timeframes: Timeframe[];
  start: Date;
  end: Date;
  preferredProvider?: ProviderName | null;
  includeQuoteSnapshots?: boolean;
  resume?: boolean;
  dryRun?: boolean;
  maxBatchesPerTimeframe?: number;
  onProgress?: (event: BackfillProgressEvent) => Promise<void> | void;
};

export type ReplayCoverage = {
  timeframe: Timeframe;
  provider: ProviderName | null;
  candleCount: number;
  earliestTimestamp: number | null;
  latestTimestamp: number | null;
  sufficient: boolean;
  reason: string | null;
};

type PersistedCoverageRow = {
  timeframe: string;
  provider: string;
  _count: { _all: number };
  _min: { sourceTimestamp: Date | null };
  _max: { sourceTimestamp: Date | null };
};

function timeframeToMs(timeframe: Timeframe) {
  switch (timeframe) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1D":
      return 24 * 60 * 60_000;
  }
}

function addTimeframe(timestamp: number, timeframe: Timeframe) {
  return timestamp + timeframeToMs(timeframe);
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSupportedProviderName(value: string): value is ProviderName {
  return marketProviderCatalog.some(provider => provider.provider === value);
}

function toPositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getChunkSpanMs(provider: ProviderName, timeframe: Timeframe) {
  return BACKFILL_CHUNK_SPAN_MS[provider]?.[timeframe] ?? (timeframeToMs(timeframe) * 500);
}

function buildChunks(start: Date, end: Date, provider: ProviderName, timeframe: Timeframe) {
  const chunks: Array<{ start: Date; end: Date }> = [];
  const step = getChunkSpanMs(provider, timeframe);
  let cursor = start.getTime();
  const endMs = end.getTime();

  while (cursor <= endMs) {
    const chunkEnd = Math.min(endMs, cursor + step - 1);
    chunks.push({
      start: new Date(cursor),
      end: new Date(chunkEnd),
    });
    cursor = chunkEnd + 1;
  }

  return chunks;
}

function getHistoricalProviderCandidates(
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe,
  preferredProvider?: ProviderName | null
) {
  const ordered = marketProviderCatalog
    .filter(provider => provider.capability.supportsHistoricalBackfill)
    .filter(provider => provider.capability.assetClasses.includes(assetClass))
    .filter(provider => provider.capability.timeframes.includes(timeframe))
    .filter(provider => provider.supportsSymbol(symbol, assetClass))
    .sort((left, right) => right.capability.primaryPriority - left.capability.primaryPriority);

  if (!preferredProvider) {
    return ordered;
  }

  return ordered.sort((left, right) => {
    if (left.provider === preferredProvider) return -1;
    if (right.provider === preferredProvider) return 1;
    return right.capability.primaryPriority - left.capability.primaryPriority;
  });
}

async function fetchBinanceHistoricalCandles(
  symbol: string,
  timeframe: Timeframe,
  input: { start: Date; end: Date }
): Promise<ProviderCandlePayload> {
  try {
    const url = new URL(`${BINANCE_BASE}/klines`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", BINANCE_INTERVAL_MAP[timeframe]);
    url.searchParams.set("startTime", String(input.start.getTime()));
    url.searchParams.set("endTime", String(input.end.getTime()));
    url.searchParams.set("limit", "1000");

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        symbol,
        assetClass: "CRYPTO",
        provider: "Binance",
        timeframe,
        candles: [],
        timestamp: null,
        stale: true,
        marketStatus: "UNAVAILABLE",
        reason: `HTTP ${response.status}`,
        requestSymbol: symbol,
        metadata: null,
      };
    }

    const rows = await response.json() as Array<[number, string, string, string, string, string]>;
    const candles: ProviderCandlePayload["candles"] = rows
      .map(row => {
        const open = toPositiveNumber(row[1]);
        const high = toPositiveNumber(row[2]);
        const low = toPositiveNumber(row[3]);
        const close = toPositiveNumber(row[4]);
        if (open == null || high == null || low == null || close == null) {
          return null;
        }

        return {
          timestamp: row[0],
          sourceTimestamp: row[0],
          open,
          high,
          low,
          close,
          volume: Number(row[5]) || null,
        } satisfies ProviderCandleBar;
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    return {
      symbol,
      assetClass: "CRYPTO",
      provider: "Binance",
      timeframe,
      candles,
      timestamp: candles.at(-1)?.timestamp ?? null,
      stale: false,
      marketStatus: candles.length > 0 ? "LIVE" : "DEGRADED",
      reason: candles.length > 0 ? null : "No Binance candles returned.",
      requestSymbol: symbol,
      metadata: {
        backfillRange: {
          start: input.start.toISOString(),
          end: input.end.toISOString(),
        },
      },
    };
  } catch (error) {
    return {
      symbol,
      assetClass: "CRYPTO",
      provider: "Binance",
      timeframe,
      candles: [],
      timestamp: null,
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: String(error).slice(0, 200),
      requestSymbol: symbol,
      metadata: null,
    };
  }
}

async function fetchHistoricalCandlesForProvider(
  provider: ProviderName,
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe,
  input: { start: Date; end: Date }
): Promise<ProviderCandlePayload> {
  if (provider === "Binance") {
    return fetchBinanceHistoricalCandles(symbol, timeframe, input);
  }

  if (provider === "Yahoo Finance") {
    const candles = await fetchYahooHistoricalCandles(symbol, timeframe, input);
    return {
      symbol,
      assetClass,
      provider: "Yahoo Finance" as const,
      timeframe,
      candles: candles.candles,
      timestamp: candles.candles.at(-1)?.timestamp ?? null,
      stale: candles.stale,
      marketStatus: candles.marketStatus,
      reason: candles.reason,
      requestSymbol: symbol,
      metadata: null,
    };
  }

  return {
    symbol,
    assetClass,
    provider,
    timeframe,
    candles: [],
    timestamp: null,
    stale: true,
    marketStatus: "UNAVAILABLE",
    reason: `${provider} historical backfill is unavailable for ${timeframe}.`,
    requestSymbol: symbol,
    metadata: null,
  };
}

async function getResumeStart(
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe,
  provider: ProviderName,
  start: Date
) {
  const latest = await prisma.candle.findFirst({
    where: {
      symbol,
      assetClass,
      timeframe,
      provider,
      sourceTimestamp: { gte: start },
    },
    orderBy: { sourceTimestamp: "desc" },
    select: { sourceTimestamp: true },
  });

  if (!latest) {
    return start;
  }

  const resumedAt = addTimeframe(latest.sourceTimestamp.getTime(), timeframe);
  return resumedAt > start.getTime() ? new Date(resumedAt) : start;
}

export function chooseReplayCoverage(
  timeframe: Timeframe,
  providers: ProviderName[],
  rows: Array<{
    provider: string;
    candleCount: number;
    earliestTimestamp: number | null;
    latestTimestamp: number | null;
  }>,
  input: {
    minimumCandles: number;
    end: Date;
  }
): ReplayCoverage {
  const priorityIndex = new Map(providers.map((provider, index) => [provider, index]));
  const staleThresholdMs = timeframeToMs(timeframe) * 6;
  const sorted = rows
    .filter(row => isSupportedProviderName(row.provider))
    .map(row => {
      const latestAgeMs = row.latestTimestamp == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, input.end.getTime() - row.latestTimestamp);
      const sufficient = row.candleCount >= input.minimumCandles && latestAgeMs <= staleThresholdMs;
      return {
        ...row,
        latestAgeMs,
        sufficient,
      };
    })
    .sort((left, right) => {
      if (left.sufficient !== right.sufficient) {
        return left.sufficient ? -1 : 1;
      }
      const priorityDelta = (priorityIndex.get(left.provider as ProviderName) ?? 99) - (priorityIndex.get(right.provider as ProviderName) ?? 99);
      if (priorityDelta !== 0) return priorityDelta;
      if (right.candleCount !== left.candleCount) return right.candleCount - left.candleCount;
      return (right.latestTimestamp ?? 0) - (left.latestTimestamp ?? 0);
    });

  const selected = sorted[0];
  if (!selected || !isSupportedProviderName(selected.provider)) {
    return {
      timeframe,
      provider: null,
      candleCount: 0,
      earliestTimestamp: null,
      latestTimestamp: null,
      sufficient: false,
      reason: "No persisted candles found.",
    };
  }

  const latestAgeMs = selected.latestAgeMs;
  const sufficient = selected.sufficient;
  const reason = selected.candleCount < input.minimumCandles
    ? `Only ${selected.candleCount} candles available.`
    : latestAgeMs > staleThresholdMs
      ? `Latest ${timeframe} candle is stale by ${Math.round(latestAgeMs / 60_000)} minutes.`
      : null;

  return {
    timeframe,
    provider: selected.provider,
    candleCount: selected.candleCount,
    earliestTimestamp: selected.earliestTimestamp,
    latestTimestamp: selected.latestTimestamp,
    sufficient,
    reason,
  };
}

export async function loadReplayCandlesFromStore(input: {
  symbol: string;
  assetClass: AssetClass;
  timeframes: Timeframe[];
  start: Date;
  end: Date;
  minimumCandles?: number;
  maxCandlesPerTimeframe?: number;
}) {
  const coverageRows = await prisma.candle.groupBy({
    by: ["timeframe", "provider"],
    where: {
      symbol: input.symbol,
      assetClass: input.assetClass,
      timeframe: { in: input.timeframes },
      sourceTimestamp: {
        gte: input.start,
        lte: input.end,
      },
    },
    _count: { _all: true },
    _min: { sourceTimestamp: true },
    _max: { sourceTimestamp: true },
  });

  const groupedCoverage = coverageRows as PersistedCoverageRow[];
  const candlesByTimeframe = {} as Partial<Record<Timeframe, CandleBar[]>>;
  const coverage: ReplayCoverage[] = [];

  for (const timeframe of input.timeframes) {
    const providers = getHistoricalProviderCandidates(input.symbol, input.assetClass, timeframe).map(provider => provider.provider);
    const selection = chooseReplayCoverage(
      timeframe,
      providers,
      groupedCoverage
        .filter(row => row.timeframe === timeframe)
        .map(row => ({
          provider: row.provider,
          candleCount: row._count._all,
          earliestTimestamp: row._min.sourceTimestamp?.getTime() ?? null,
          latestTimestamp: row._max.sourceTimestamp?.getTime() ?? null,
        })),
      {
        minimumCandles: input.minimumCandles ?? 30,
        end: input.end,
      }
    );
    coverage.push(selection);

    if (!selection.provider) {
      candlesByTimeframe[timeframe] = [];
      continue;
    }

    const candles = await prisma.candle.findMany({
      where: {
        symbol: input.symbol,
        assetClass: input.assetClass,
        timeframe,
        provider: selection.provider,
        sourceTimestamp: {
          gte: input.start,
          lte: input.end,
        },
      },
      orderBy: { sourceTimestamp: "asc" },
      take: input.maxCandlesPerTimeframe ?? 25_000,
    });

    candlesByTimeframe[timeframe] = candles.map(candle => ({
      timestamp: candle.sourceTimestamp.getTime(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume ?? null,
    }));
  }

  return {
    candlesByTimeframe,
    coverage,
    missingTimeframes: coverage.filter(item => !item.sufficient).map(item => item.timeframe),
    selectedProvider: coverage.find(item => item.provider)?.provider ?? null,
  };
}

export function getReplayPreparationRange(style: ReplayStyle, input?: { start?: string | null; end?: string | null }) {
  const end = input?.end ? new Date(input.end) : new Date();
  const start = input?.start
    ? new Date(input.start)
    : new Date(end.getTime() - DEFAULT_REPLAY_LOOKBACK_DAYS[style] * 24 * 60 * 60_000);
  return { start, end };
}

async function emitProgress(
  callback: BackfillRequest["onProgress"],
  event: BackfillProgressEvent
) {
  if (!callback) {
    return;
  }
  await callback(event);
}

export async function backfillHistoricalMarketData(input: BackfillRequest): Promise<BackfillResult> {
  const includeQuoteSnapshots = input.includeQuoteSnapshots ?? true;
  const dryRun = input.dryRun ?? false;
  const summaries: BackfillTimeframeSummary[] = [];

  for (const timeframe of input.timeframes) {
    const providers = getHistoricalProviderCandidates(input.symbol, input.assetClass, timeframe, input.preferredProvider);
    const providerNames = providers.map(provider => provider.provider);
    let selectedProvider: ProviderName | null = null;
    let timeframeReason: string | null = null;
    let candleInsertCount = 0;
    let quoteInsertCount = 0;
    let skippedDuplicates = 0;
    const chunks: BackfillChunkSummary[] = [];

    if (providers.length === 0) {
      const summary: BackfillTimeframeSummary = {
        timeframe,
        selectedProvider: null,
        candleCount: 0,
        candleInsertCount: 0,
        quoteInsertCount: 0,
        skippedDuplicates: 0,
        resumeFrom: null,
        completed: false,
        chunks: [],
        reason: "No historical providers available.",
      };
      summaries.push(summary);
      await emitProgress(input.onProgress, {
        stage: "timeframe_completed",
        symbol: input.symbol,
        timeframe,
        summary,
      });
      continue;
    }

    const resumeFrom = input.resume
      ? await getResumeStart(input.symbol, input.assetClass, timeframe, providers[0].provider, input.start)
      : input.start;

    await emitProgress(input.onProgress, {
      stage: "timeframe_started",
      symbol: input.symbol,
      timeframe,
      providerCandidates: providerNames,
      resumeFrom: resumeFrom.toISOString(),
    });

    if (resumeFrom.getTime() > input.end.getTime()) {
      const summary: BackfillTimeframeSummary = {
        timeframe,
        selectedProvider: providers[0].provider,
        candleCount: 0,
        candleInsertCount: 0,
        quoteInsertCount: 0,
        skippedDuplicates: 0,
        resumeFrom: resumeFrom.toISOString(),
        completed: true,
        chunks: [],
        reason: "Already fully backfilled in requested range.",
      };
      summaries.push(summary);
      await emitProgress(input.onProgress, {
        stage: "timeframe_completed",
        symbol: input.symbol,
        timeframe,
        summary,
      });
      continue;
    }

    const plannedChunks = buildChunks(resumeFrom, input.end, providers[0].provider, timeframe)
      .slice(0, input.maxBatchesPerTimeframe ?? Number.POSITIVE_INFINITY);
    let candleCount = 0;

    for (const [chunkIndex, chunk] of plannedChunks.entries()) {
      let completedChunk: BackfillChunkSummary | null = null;

      for (const [providerIndex, provider] of providers.entries()) {
        if (chunkIndex > 0 || providerIndex > 0) {
          await sleep(PROVIDER_RATE_LIMIT_MS[provider.provider] ?? 0);
        }

        const payload = await fetchHistoricalCandlesForProvider(
          provider.provider,
          input.symbol,
          input.assetClass,
          timeframe,
          chunk
        );

        if (payload.candles.length === 0 || payload.marketStatus === "UNAVAILABLE") {
          timeframeReason = payload.reason ?? `${provider.provider} returned no candles.`;
          if (providerIndex === providers.length - 1) {
            completedChunk = {
              timeframe,
              provider: provider.provider,
              chunkStart: chunk.start.toISOString(),
              chunkEnd: chunk.end.toISOString(),
              candlesReturned: 0,
              candlesInserted: 0,
              quotesInserted: 0,
              skippedDuplicates: 0,
              fallbackUsed: providerIndex > 0,
              reason: timeframeReason,
            };
          }
          continue;
        }

        selectedProvider = provider.provider;
        const candleRows = buildHistoricalCandleRows(input.symbol, input.assetClass, timeframe, payload, {
          selectedProvider: provider.provider,
        });
        const quoteRows = includeQuoteSnapshots
          ? buildDerivedQuoteRowsFromCandles(candleRows, {
              marketStatus: "LIVE",
              reason: null,
              metadata: {
                timeframe,
                provider: provider.provider,
              },
            })
          : [];

        const candlesInserted = dryRun ? candleRows.length : await storeHistoricalCandleRows(candleRows);
        const quotesInserted = dryRun ? quoteRows.length : await storeQuoteSnapshotRows(quoteRows);
        const duplicates = Math.max(0, candleRows.length - candlesInserted);

        candleInsertCount += candlesInserted;
        quoteInsertCount += quotesInserted;
        skippedDuplicates += duplicates;
        candleCount += candleRows.length;
        timeframeReason = null;

        completedChunk = {
          timeframe,
          provider: provider.provider,
          chunkStart: chunk.start.toISOString(),
          chunkEnd: chunk.end.toISOString(),
          candlesReturned: candleRows.length,
          candlesInserted,
          quotesInserted,
          skippedDuplicates: duplicates,
          fallbackUsed: providerIndex > 0,
          reason: null,
        };
        break;
      }

      if (!completedChunk) {
        completedChunk = {
          timeframe,
          provider: providers.at(-1)?.provider ?? "Yahoo Finance",
          chunkStart: chunk.start.toISOString(),
          chunkEnd: chunk.end.toISOString(),
          candlesReturned: 0,
          candlesInserted: 0,
          quotesInserted: 0,
          skippedDuplicates: 0,
          fallbackUsed: providers.length > 1,
          reason: timeframeReason ?? "Historical backfill failed.",
        };
      }

      chunks.push(completedChunk);
      await emitProgress(input.onProgress, {
        stage: "chunk_completed",
        symbol: input.symbol,
        timeframe,
        chunk: completedChunk,
      });
    }

    const summary: BackfillTimeframeSummary = {
      timeframe,
      selectedProvider,
      candleCount,
      candleInsertCount,
      quoteInsertCount,
      skippedDuplicates,
      resumeFrom: resumeFrom.toISOString(),
      completed: chunks.every(chunk => chunk.reason == null),
      chunks,
      reason: timeframeReason,
    };
    summaries.push(summary);

    await emitProgress(input.onProgress, {
      stage: "timeframe_completed",
      symbol: input.symbol,
      timeframe,
      summary,
    });
  }

  const result: BackfillResult = {
    symbol: input.symbol,
    assetClass: input.assetClass,
    start: input.start.toISOString(),
    end: input.end.toISOString(),
    includeQuoteSnapshots,
    dryRun,
    timeframes: summaries,
  };

  await recordOperationalMetric({
    metric: "market_data_backfill",
    category: "backfill",
    severity: summaries.every(summary => summary.completed) ? "INFO" : "WARN",
    count: summaries.length,
    symbol: input.symbol,
    assetClass: input.assetClass,
    detail: `Backfill completed for ${input.symbol}`,
    tags: {
      timeframes: input.timeframes,
      dryRun,
      includeQuoteSnapshots,
      insertedCandles: summaries.reduce((sum, summary) => sum + summary.candleInsertCount, 0),
      insertedQuotes: summaries.reduce((sum, summary) => sum + summary.quoteInsertCount, 0),
    },
  });

  return result;
}

export async function backfillAssetSet(input: {
  symbols?: string[];
  assetClass?: AssetClass;
  timeframes: Timeframe[];
  start: Date;
  end: Date;
  preferredProvider?: ProviderName | null;
  includeQuoteSnapshots?: boolean;
  resume?: boolean;
  dryRun?: boolean;
  maxBatchesPerTimeframe?: number;
  onProgress?: BackfillRequest["onProgress"];
}) {
  const assetList = (input.symbols?.length
    ? SUPPORTED_ASSETS.filter(asset => input.symbols?.includes(asset.symbol))
    : SUPPORTED_ASSETS.filter(asset => !input.assetClass || asset.assetClass === input.assetClass)
  ).map(asset => ({
    symbol: asset.symbol,
    assetClass: asset.assetClass as AssetClass,
  }));

  const results: BackfillResult[] = [];
  for (const asset of assetList) {
    results.push(await backfillHistoricalMarketData({
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      timeframes: input.timeframes,
      start: input.start,
      end: input.end,
      preferredProvider: input.preferredProvider,
      includeQuoteSnapshots: input.includeQuoteSnapshots,
      resume: input.resume,
      dryRun: input.dryRun,
      maxBatchesPerTimeframe: input.maxBatchesPerTimeframe,
      onProgress: input.onProgress,
    }));
  }
  return results;
}
