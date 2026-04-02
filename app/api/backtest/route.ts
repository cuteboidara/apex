import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/src/infrastructure/auth/auth";
import { prisma } from "@/src/infrastructure/db/prisma";
import { runReplayBacktest } from "@/lib/backtest/replayEngine";
import {
  backfillHistoricalMarketData,
  getReplayPreparationRange,
  loadReplayCandlesFromStore,
} from "@/lib/marketData/backfill";
import { recordOperationalMetric } from "@/lib/observability/metrics";
import type { AssetClass, Timeframe } from "@/lib/marketData/types";
import { buildRouteErrorResponse } from "@/lib/api/routeErrors";

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

type BacktestRequestBody = {
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
};

type BacktestRouteDependencies = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  prisma: typeof prisma;
  runReplayBacktest: typeof runReplayBacktest;
  backfillHistoricalMarketData: typeof backfillHistoricalMarketData;
  getReplayPreparationRange: typeof getReplayPreparationRange;
  loadReplayCandlesFromStore: typeof loadReplayCandlesFromStore;
  recordOperationalMetric: typeof recordOperationalMetric;
};

function jsonBadRequest(error: string, details: string) {
  return NextResponse.json({
    ok: false,
    error: true,
    code: "BAD_REQUEST",
    message: error,
    details,
    likelyMigrationIssue: false,
    hint: null,
  }, { status: 400 });
}

export function createBacktestRouteHandlers(deps: BacktestRouteDependencies) {
  return {
    GET: async () => {
      try {
        const runs = await deps.prisma.backtestRun.findMany({
          orderBy: { startedAt: "desc" },
          take: 25,
        });

        return NextResponse.json({ runs });
      } catch (error) {
        return buildRouteErrorResponse(error, {
          publicMessage: "Unable to load backtest runs.",
        });
      }
    },

    POST: async (req: NextRequest) => {
      let runId: string | null = null;
      let metricContext: { symbol: string | undefined; assetClass: AssetClass | undefined; style: string | undefined } | null = null;

      try {
        const session = await deps.getSession();
        const body = await req.json().catch(() => null) as BacktestRequestBody | null;

        if (!body) {
          return jsonBadRequest("Invalid backtest request body.", "Request JSON could not be parsed.");
        }

        if (!body.symbol || !body.assetClass || !body.style) {
          return jsonBadRequest(
            "symbol, assetClass, and style are required",
            "Backtest requests must include symbol, assetClass, and style."
          );
        }

        metricContext = {
          symbol: body.symbol,
          assetClass: body.assetClass,
          style: body.style,
        };

        const style = body.style;
        const requiredTimeframes = REQUIRED_BY_STYLE[style];
        const startedAt = new Date();
        const run = await deps.prisma.backtestRun.create({
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
        runId = run.id;

        const range = deps.getReplayPreparationRange(style, {
          start: body.start ?? null,
          end: body.end ?? null,
        });

        let replayData = await deps.loadReplayCandlesFromStore({
          symbol: body.symbol,
          assetClass: body.assetClass,
          timeframes: requiredTimeframes,
          start: range.start,
          end: range.end,
          minimumCandles: 30,
        });
        let dataPreparation: Awaited<ReturnType<typeof deps.backfillHistoricalMarketData>> | null = null;

        if (replayData.missingTimeframes.length > 0 && body.prepareData !== false) {
          dataPreparation = await deps.backfillHistoricalMarketData({
            symbol: body.symbol,
            assetClass: body.assetClass,
            timeframes: replayData.missingTimeframes,
            start: range.start,
            end: range.end,
            includeQuoteSnapshots: true,
            resume: true,
          });

          replayData = await deps.loadReplayCandlesFromStore({
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

          await deps.prisma.backtestRun.update({
            where: { id: run.id },
            data: {
              status: "FAILED",
              failureReason: `Insufficient replay coverage: ${JSON.stringify(coverageSummary)}`,
              completedAt: new Date(),
            },
          });

          return NextResponse.json({
            ok: false,
            error: true,
            code: "INSUFFICIENT_REPLAY_COVERAGE",
            message: "Insufficient replay coverage after preparation.",
            details: JSON.stringify(coverageSummary),
            likelyMigrationIssue: false,
            hint: body.prepareData === false
              ? "Enable prepareData or run the historical backfill before replaying."
              : "Backfill the missing timeframes and retry the replay.",
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
        const replay = deps.runReplayBacktest({
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
          await deps.prisma.backtestTrade.createMany({
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

        await deps.prisma.backtestRun.update({
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
        await deps.recordOperationalMetric({
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
        if (runId) {
          await deps.prisma.backtestRun.update({
            where: { id: runId },
            data: {
              status: "FAILED",
              failureReason: String(error).slice(0, 1000),
              completedAt: new Date(),
            },
          }).catch(() => undefined);

          await deps.recordOperationalMetric({
            metric: "backtest_failed",
            category: "backtest",
            severity: "ERROR",
            count: 1,
            symbol: metricContext?.symbol,
            assetClass: metricContext?.assetClass,
            detail: String(error).slice(0, 500),
            tags: {
              backtestRunId: runId,
              style: metricContext?.style ?? null,
            },
          }).catch(() => undefined);
        }

        return buildRouteErrorResponse(error, {
          publicMessage: "Unable to run the replay backtest.",
        });
      }
    },
  };
}

const backtestRouteHandlers = createBacktestRouteHandlers({
  getSession: () => getServerSession(authOptions),
  prisma,
  runReplayBacktest,
  backfillHistoricalMarketData,
  getReplayPreparationRange,
  loadReplayCandlesFromStore,
  recordOperationalMetric,
});

export const GET = backtestRouteHandlers.GET;
export const POST = backtestRouteHandlers.POST;
