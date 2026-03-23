import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runReplayBacktest } from "@/lib/backtest/replayEngine";
import {
  backfillHistoricalMarketData,
  getReplayPreparationRange,
  loadReplayCandlesFromStore,
} from "@/lib/marketData/backfill";
import { recordOperationalMetric } from "@/lib/observability/metrics";
import type { AssetClass, Timeframe } from "@/lib/marketData/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const REQUIRED_BY_STYLE = {
  SCALP: ["1m", "5m"] as Timeframe[],
  INTRADAY: ["5m", "15m", "1h"] as Timeframe[],
  SWING: ["1h", "4h", "1D"] as Timeframe[],
};

const BASE_BY_STYLE = {
  SCALP: "5m",
  INTRADAY: "15m",
  SWING: "1h",
} as const;

export async function GET() {
  const runs = await prisma.backtestRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 25,
  });

  return NextResponse.json({ runs });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const body = await req.json().catch(() => null) as {
    symbol?: string;
    assetClass?: AssetClass;
    style?: "SCALP" | "INTRADAY" | "SWING";
    spreadBps?: number;
    slippageBps?: number;
    confidenceFloor?: number;
    start?: string;
    end?: string;
    name?: string;
    prepareData?: boolean;
  } | null;

  if (!body?.symbol || !body.assetClass || !body.style) {
    return NextResponse.json({ error: "symbol, assetClass, and style are required" }, { status: 400 });
  }

  const style = body.style;
  const requiredTimeframes = REQUIRED_BY_STYLE[style];
  const startedAt = new Date();
  const run = await prisma.backtestRun.create({
    data: {
      name: body.name ?? `${body.symbol} ${body.style} replay`,
      requestedByUserId: session?.user ? ((session.user as { id?: string }).id ?? null) : null,
      symbol: body.symbol,
      assetClass: body.assetClass,
      timeframe: requiredTimeframes.join(","),
      status: "RUNNING",
      config: {
        style,
        spreadBps: body.spreadBps ?? 0,
        slippageBps: body.slippageBps ?? 0,
        confidenceFloor: body.confidenceFloor ?? 65,
        start: body.start ?? null,
        end: body.end ?? null,
        prepareData: body.prepareData ?? true,
      },
      startedAt,
    },
  });

  try {
    const range = getReplayPreparationRange(style, {
      start: body.start ?? null,
      end: body.end ?? null,
    });

    let replayData = await loadReplayCandlesFromStore({
      symbol: body.symbol,
      assetClass: body.assetClass,
      timeframes: requiredTimeframes,
      start: range.start,
      end: range.end,
      minimumCandles: 30,
    });
    let dataPreparation: Awaited<ReturnType<typeof backfillHistoricalMarketData>> | null = null;

    if (replayData.missingTimeframes.length > 0 && body.prepareData !== false) {
      dataPreparation = await backfillHistoricalMarketData({
        symbol: body.symbol,
        assetClass: body.assetClass,
        timeframes: replayData.missingTimeframes,
        start: range.start,
        end: range.end,
        includeQuoteSnapshots: true,
        resume: true,
      });

      replayData = await loadReplayCandlesFromStore({
        symbol: body.symbol,
        assetClass: body.assetClass,
        timeframes: requiredTimeframes,
        start: range.start,
        end: range.end,
        minimumCandles: 30,
      });
    }

    if (replayData.missingTimeframes.length > 0) {
      const coverageSummary = replayData.coverage.map(item => ({
        timeframe: item.timeframe,
        provider: item.provider,
        candleCount: item.candleCount,
        latestTimestamp: item.latestTimestamp != null ? new Date(item.latestTimestamp).toISOString() : null,
        reason: item.reason,
      }));
      await prisma.backtestRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          failureReason: `Insufficient replay coverage: ${JSON.stringify(coverageSummary)}`,
          completedAt: new Date(),
        },
      });
      return NextResponse.json({
        error: "Insufficient replay coverage after preparation.",
        coverage: coverageSummary,
      }, { status: 400 });
    }

    const candlesByTimeframe = replayData.candlesByTimeframe as Record<Timeframe, Array<{
      timestamp: number;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      volume: number | null;
    }>>;
    const replayProvider = replayData.coverage.find(item => item.timeframe === BASE_BY_STYLE[style])?.provider
      ?? replayData.selectedProvider
      ?? "Replay";
    const replay = runReplayBacktest({
      symbol: body.symbol,
      assetClass: body.assetClass,
      style,
      provider: replayProvider,
      confidenceFloor: body.confidenceFloor ?? 65,
      candlesByTimeframe,
      execution: {
        spreadBps: body.spreadBps ?? 0,
        slippageBps: body.slippageBps ?? 0,
      },
    });

    if (replay.trades.length > 0) {
      await prisma.backtestTrade.createMany({
        data: replay.trades.map(trade => ({
          backtestRunId: run.id,
          symbol: trade.symbol,
          assetClass: trade.assetClass,
          style: trade.style,
          signalTimestamp: new Date(trade.entryTimestamp ?? startedAt),
          entryTimestamp: trade.entryTimestamp != null ? new Date(trade.entryTimestamp) : null,
          exitTimestamp: trade.exitTimestamp != null ? new Date(trade.exitTimestamp) : null,
          provider: trade.provider,
          regimeTag: trade.regimeTag,
          setupFamily: trade.setupFamily,
          confidence: trade.confidence,
          outcome: trade.outcome,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          realizedPnl: trade.realizedPnl,
          realizedRR: trade.realizedRR,
          maxFavorableExcursion: trade.maxFavorableExcursion,
          maxAdverseExcursion: trade.maxAdverseExcursion,
        })),
      });
    }

    await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        summary: {
          ...replay.report,
          coverage: replayData.coverage,
          dataPreparation: dataPreparation
            ? {
                timeframes: dataPreparation.timeframes.map(item => ({
                  timeframe: item.timeframe,
                  provider: item.selectedProvider,
                  insertedCandles: item.candleInsertCount,
                  insertedQuotes: item.quoteInsertCount,
                })),
              }
            : null,
        },
        completedAt: new Date(),
      },
    });
    await recordOperationalMetric({
      metric: "backtest_completed",
      category: "backtest",
      severity: "INFO",
      count: 1,
      symbol: body.symbol,
      assetClass: body.assetClass,
      detail: `${body.style} replay completed`,
      tags: {
        backtestRunId: run.id,
        sampleSize: replay.report.sampleSize,
      },
    });

    return NextResponse.json({
      runId: run.id,
      coverage: replayData.coverage,
      dataPreparation,
      ...replay,
    });
  } catch (error) {
    await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        failureReason: String(error).slice(0, 1000),
        completedAt: new Date(),
      },
    }).catch(() => undefined);

    await recordOperationalMetric({
      metric: "backtest_failed",
      category: "backtest",
      severity: "ERROR",
      count: 1,
      symbol: body.symbol,
      assetClass: body.assetClass,
      detail: String(error).slice(0, 500),
      tags: {
        backtestRunId: run.id,
      },
    });

    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
