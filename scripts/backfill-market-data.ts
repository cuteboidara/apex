import "./load-env.mjs";

import { SUPPORTED_ASSETS } from "@/lib/assets";
import { backfillAssetSet } from "@/lib/marketData/backfill";
import type { AssetClass, ProviderName, Timeframe } from "@/lib/marketData/types";
import { printValidationReport, validateRuntimeEnv } from "./validate-env.mjs";

const validationReport = validateRuntimeEnv({
  service: "backfill",
  strict: process.env.NODE_ENV === "production" || process.env.APEX_STRICT_STARTUP === "true",
});
printValidationReport(validationReport);
if (validationReport.errors.length > 0) {
  process.exit(1);
}

const ALL_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D"];

function getArg(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find(arg => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function parseDate(value: string | null, fallback: Date | null = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTimeframes(value: string | null) {
  if (!value) return ["1h", "4h", "1D"] as Timeframe[];
  const parsed = value
    .split(",")
    .map(part => part.trim())
    .filter((part): part is Timeframe => ALL_TIMEFRAMES.includes(part as Timeframe));
  return parsed.length > 0 ? parsed : null;
}

function parseSymbols(value: string | null) {
  if (!value) return null;
  const supported = new Set<string>(SUPPORTED_ASSETS.map(asset => asset.symbol));
  const parsed = value
    .split(",")
    .map(part => part.trim().toUpperCase())
    .filter(symbol => supported.has(symbol));
  return parsed.length > 0 ? parsed : null;
}

function parseAssetClass(value: string | null): AssetClass | null {
  if (value === "CRYPTO" || value === "FOREX" || value === "COMMODITY") {
    return value;
  }
  return null;
}

function parseProvider(value: string | null): ProviderName | null {
  if (
    value === "Binance" ||
    value === "Yahoo Finance"
  ) {
    return value;
  }
  return null;
}

function printUsage() {
  console.log([
    "Usage:",
    "  node --import tsx scripts/backfill-market-data.ts --symbols=EURUSD,GBPUSD --timeframes=1m,5m --start=2026-01-01 --end=2026-01-14",
    "Options:",
    "  --symbols=EURUSD,GBPUSD",
    "  --assetClass=FOREX",
    "  --timeframes=1m,5m,15m,1h,4h,1D",
    "  --start=2026-01-01T00:00:00Z",
    "  --end=2026-03-01T00:00:00Z",
    "  --provider=Yahoo Finance",
    "  --resume",
    "  --dry-run",
    "  --no-quotes",
    "  --max-batches=10",
  ].join("\n"));
}

async function main() {
  if (hasFlag("help")) {
    printUsage();
    return;
  }

  const start = parseDate(getArg("start"));
  const end = parseDate(getArg("end"), new Date());
  const symbols = parseSymbols(getArg("symbols"));
  const assetClass = parseAssetClass(getArg("assetClass"));
  const timeframes = parseTimeframes(getArg("timeframes"));
  const preferredProvider = parseProvider(getArg("provider"));
  const maxBatches = getArg("max-batches");

  if (!start || !end || start >= end || !timeframes || (!symbols?.length && !assetClass)) {
    printUsage();
    throw new Error("Invalid backfill arguments.");
  }

  const startedAt = Date.now();
  const results = await backfillAssetSet({
    symbols: symbols ?? undefined,
    assetClass: assetClass ?? undefined,
    timeframes,
    start,
    end,
    preferredProvider: preferredProvider ?? undefined,
    includeQuoteSnapshots: !hasFlag("no-quotes"),
    resume: hasFlag("resume"),
    dryRun: hasFlag("dry-run"),
    maxBatchesPerTimeframe: maxBatches ? Number(maxBatches) : undefined,
    onProgress: event => {
      if (event.stage === "timeframe_started") {
        console.log(`[backfill] ${event.symbol} ${event.timeframe} starting via ${event.providerCandidates.join(" -> ")} from ${event.resumeFrom ?? "range_start"}`);
        return;
      }

      if (event.stage === "chunk_completed") {
        console.log(
          `[backfill] ${event.symbol} ${event.timeframe} ${event.chunk.provider} ${event.chunk.chunkStart}..${event.chunk.chunkEnd} returned=${event.chunk.candlesReturned} inserted=${event.chunk.candlesInserted} quotes=${event.chunk.quotesInserted} reason=${event.chunk.reason ?? "ok"}`
        );
        return;
      }

      console.log(
        `[backfill] ${event.symbol} ${event.timeframe} completed provider=${event.summary.selectedProvider ?? "none"} inserted=${event.summary.candleInsertCount} quotes=${event.summary.quoteInsertCount} reason=${event.summary.reason ?? "ok"}`
      );
    },
  });

  const insertedCandles = results.reduce((sum, result) => (
    sum + result.timeframes.reduce((inner, timeframe) => inner + timeframe.candleInsertCount, 0)
  ), 0);
  const insertedQuotes = results.reduce((sum, result) => (
    sum + result.timeframes.reduce((inner, timeframe) => inner + timeframe.quoteInsertCount, 0)
  ), 0);

  console.log(JSON.stringify({
    assets: results.length,
    insertedCandles,
    insertedQuotes,
    durationMs: Date.now() - startedAt,
  }, null, 2));
}

void main().catch(error => {
  console.error("[backfill] Failed:", error);
  process.exit(1);
});
