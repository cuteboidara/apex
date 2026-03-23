import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_ASSETS } from "@/lib/assets";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { recordAuditEvent } from "@/lib/audit";
import { backfillAssetSet } from "@/lib/marketData/backfill";
import type { AssetClass, ProviderName, Timeframe } from "@/lib/marketData/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALL_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D"];

function isTimeframe(value: string): value is Timeframe {
  return ALL_TIMEFRAMES.includes(value as Timeframe);
}

function isProviderName(value: string): value is ProviderName {
  return ["Binance", "Yahoo Finance"].includes(value);
}

function isAssetClass(value: string): value is AssetClass {
  return value === "CRYPTO" || value === "FOREX" || value === "COMMODITY";
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const [recentMetrics, latestCandles, latestQuotes] = await Promise.all([
    prisma.operationalMetric.findMany({
      where: { category: "backfill" },
      orderBy: { recordedAt: "desc" },
      take: 20,
    }),
    prisma.candle.groupBy({
      by: ["symbol", "timeframe", "provider"],
      _max: { sourceTimestamp: true },
      orderBy: { _max: { sourceTimestamp: "desc" } },
      take: 25,
    }),
    prisma.quoteSnapshot.groupBy({
      by: ["symbol", "provider"],
      _max: { sourceTimestamp: true },
      orderBy: { _max: { sourceTimestamp: "desc" } },
      take: 25,
    }),
  ]);

  return NextResponse.json({
    supportedSymbols: SUPPORTED_ASSETS,
    recentMetrics,
    latestCandles: latestCandles.map(row => ({
      symbol: row.symbol,
      timeframe: row.timeframe,
      provider: row.provider,
      latestSourceTimestamp: row._max.sourceTimestamp,
    })),
    latestQuotes: latestQuotes.map(row => ({
      symbol: row.symbol,
      provider: row.provider,
      latestSourceTimestamp: row._max.sourceTimestamp,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null) as {
    symbols?: string[];
    assetClass?: string;
    timeframes?: string[];
    start?: string;
    end?: string;
    preferredProvider?: string;
    includeQuoteSnapshots?: boolean;
    resume?: boolean;
    dryRun?: boolean;
    maxBatchesPerTimeframe?: number;
  } | null;

  const start = body?.start ? new Date(body.start) : null;
  const end = body?.end ? new Date(body.end) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return NextResponse.json({ error: "Valid start and end are required." }, { status: 400 });
  }

  const timeframes = (body?.timeframes ?? ["1h", "4h", "1D"]).filter(isTimeframe);
  if (timeframes.length === 0) {
    return NextResponse.json({ error: "At least one valid timeframe is required." }, { status: 400 });
  }

  const assetClass = body?.assetClass && isAssetClass(body.assetClass) ? body.assetClass : undefined;
  const symbols = Array.isArray(body?.symbols)
    ? body.symbols.filter(symbol => SUPPORTED_ASSETS.some(asset => asset.symbol === symbol))
    : undefined;
  if (!symbols?.length && !assetClass) {
    return NextResponse.json({ error: "Provide symbols or assetClass for backfill." }, { status: 400 });
  }

  const preferredProvider = body?.preferredProvider && isProviderName(body.preferredProvider)
    ? body.preferredProvider
    : undefined;

  const results = await backfillAssetSet({
    symbols,
    assetClass,
    timeframes,
    start,
    end,
    preferredProvider,
    includeQuoteSnapshots: body?.includeQuoteSnapshots ?? true,
    resume: body?.resume ?? true,
    dryRun: body?.dryRun ?? false,
    maxBatchesPerTimeframe: body?.maxBatchesPerTimeframe,
  });

  await recordAuditEvent({
    actor: "ADMIN",
    action: "market_data_backfill_triggered",
    entityType: "MarketDataBackfill",
    entityId: `${assetClass ?? "mixed"}:${start.toISOString()}:${end.toISOString()}`,
    after: {
      symbols: symbols ?? null,
      assetClass: assetClass ?? null,
      timeframes,
      preferredProvider: preferredProvider ?? null,
      dryRun: body?.dryRun ?? false,
      resume: body?.resume ?? true,
    },
  });

  return NextResponse.json({
    results,
    summary: {
      assets: results.length,
      insertedCandles: results.reduce((sum, result) => (
        sum + result.timeframes.reduce((inner, timeframe) => inner + timeframe.candleInsertCount, 0)
      ), 0),
      insertedQuotes: results.reduce((sum, result) => (
        sum + result.timeframes.reduce((inner, timeframe) => inner + timeframe.quoteInsertCount, 0)
      ), 0),
    },
  });
}
