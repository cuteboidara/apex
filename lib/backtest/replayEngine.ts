import { calcRSI } from "@/lib/scoring/smcEngine";
import { simulateTradeExecution, type ExecutionSimulatorConfig, type SimulatedTradePlan } from "@/lib/backtest/executionSimulator";
import { buildBacktestReport } from "@/lib/backtest/reporting";
import { publishStrategyPlan } from "@/lib/strategy/signalPublisher";
import type { MarketSnapshot } from "@/lib/strategy/types";
import type { AssetClass, CandleBar, Timeframe } from "@/lib/marketData/types";

type CandleSeries = Partial<Record<Timeframe, CandleBar[]>>;

type ReplayInput = {
  symbol: string;
  assetClass: AssetClass;
  style: "SCALP" | "INTRADAY" | "SWING";
  candlesByTimeframe: CandleSeries;
  provider?: string | null;
  confidenceFloor?: number;
  execution?: ExecutionSimulatorConfig;
};

const REQUIRED_BY_STYLE: Record<ReplayInput["style"], Timeframe[]> = {
  SCALP: ["1m", "5m"],
  INTRADAY: ["5m", "15m", "1h"],
  SWING: ["1h", "4h", "1D"],
};

const BASE_BY_STYLE: Record<ReplayInput["style"], Timeframe> = {
  SCALP: "5m",
  INTRADAY: "15m",
  SWING: "1h",
};

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trendForCloses(closes: number[]) {
  if (closes.length < 21) return "consolidation";
  const fast = average(closes.slice(-8));
  const slow = average(closes.slice(-21));
  const current = closes.at(-1) ?? null;
  if (fast == null || slow == null || current == null) return "consolidation";
  if (current > fast && fast > slow) return "uptrend";
  if (current < fast && fast < slow) return "downtrend";
  return "consolidation";
}

function buildSnapshotAt(input: ReplayInput, timestamp: number): MarketSnapshot | null {
  const required = REQUIRED_BY_STYLE[input.style];
  const timeframeWindows = Object.fromEntries(
    required.map(timeframe => [
      timeframe,
      (input.candlesByTimeframe[timeframe] ?? []).filter(candle => candle.timestamp <= timestamp),
    ])
  ) as Record<Timeframe, CandleBar[]>;

  if (required.some(timeframe => timeframeWindows[timeframe].length < 20)) {
    return null;
  }

  const baseTimeframe = BASE_BY_STYLE[input.style];
  const baseCandles = timeframeWindows[baseTimeframe];
  const closes = baseCandles.map(candle => candle.close).filter((value): value is number => value != null);
  const currentPrice = closes.at(-1) ?? null;
  const previous = closes.at(-2) ?? null;
  const high14d = closes.length > 0 ? Math.max(...closes.slice(-56)) : null;
  const low14d = closes.length > 0 ? Math.min(...closes.slice(-56)) : null;
  const change24h = currentPrice != null && previous != null && previous > 0
    ? ((currentPrice - previous) / previous) * 100
    : null;

  if (currentPrice == null || high14d == null || low14d == null) {
    return null;
  }

  const readiness = {
    SCALP: { ready: REQUIRED_BY_STYLE.SCALP.every(timeframe => (input.candlesByTimeframe[timeframe] ?? []).some(candle => candle.timestamp <= timestamp)), missing: [] as Timeframe[], stale: [] as Timeframe[] },
    INTRADAY: { ready: REQUIRED_BY_STYLE.INTRADAY.every(timeframe => (input.candlesByTimeframe[timeframe] ?? []).some(candle => candle.timestamp <= timestamp)), missing: [] as Timeframe[], stale: [] as Timeframe[] },
    SWING: { ready: REQUIRED_BY_STYLE.SWING.every(timeframe => (input.candlesByTimeframe[timeframe] ?? []).some(candle => candle.timestamp <= timestamp)), missing: [] as Timeframe[], stale: [] as Timeframe[] },
  };

  return {
    symbol: input.symbol,
    assetClass: input.assetClass,
    preferredBias: trendForCloses(closes) === "downtrend" ? "SHORT" : "LONG",
    currentPrice,
    change24h,
    high14d,
    low14d,
    trend: trendForCloses(closes),
    rsi: calcRSI(closes),
    stale: false,
    styleReadiness: readiness,
    marketStatus: "LIVE",
    providerFallbackUsed: false,
    candleProviders: Object.fromEntries(
      required.map(timeframe => [
        timeframe,
        {
          selectedProvider: input.provider ?? "Replay",
          fallbackUsed: false,
          freshnessMs: 0,
          marketStatus: "LIVE" as const,
          reason: null,
          freshnessClass: "fresh" as const,
        },
      ])
    ),
    newsSentimentScore: 0,
    macroBias: input.assetClass === "COMMODITY" ? "risk_off" : "neutral",
    brief: "Deterministic replay snapshot.",
  };
}

export function runReplayBacktest(input: ReplayInput) {
  const baseTimeframe = BASE_BY_STYLE[input.style];
  const baseCandles = input.candlesByTimeframe[baseTimeframe] ?? [];
  const trades = [];

  for (let index = 21; index < baseCandles.length - 1; index += 1) {
    const snapshot = buildSnapshotAt(input, baseCandles[index].timestamp);
    if (!snapshot) continue;

    const plan = publishStrategyPlan(input.style, snapshot);
    if (plan.status !== "ACTIVE" || plan.entryMin == null || plan.entryMax == null || plan.stopLoss == null || plan.takeProfit1 == null) {
      continue;
    }
    if ((input.confidenceFloor ?? 65) > plan.confidence) {
      continue;
    }

    const simulated = simulateTradeExecution(
      {
        symbol: input.symbol,
        assetClass: input.assetClass,
        style: input.style,
        setupFamily: plan.setupFamily,
        regimeTag: plan.regimeTag,
        provider: input.provider ?? "Replay",
        confidence: plan.confidence,
        bias: plan.bias,
        timeframe: baseTimeframe,
        entryMin: plan.entryMin,
        entryMax: plan.entryMax,
        stopLoss: plan.stopLoss,
        takeProfit1: plan.takeProfit1,
        takeProfit2: plan.takeProfit2,
        takeProfit3: plan.takeProfit3,
        invalidationLevel: plan.invalidationLevel,
      } satisfies SimulatedTradePlan,
      baseCandles.slice(index + 1),
      input.execution
    );

    trades.push(simulated);

    if (simulated.exitTimestamp != null) {
      const exitIndex = baseCandles.findIndex(candle => candle.timestamp === simulated.exitTimestamp);
      if (exitIndex > index) {
        index = exitIndex;
      }
    }
  }

  return {
    trades,
    report: buildBacktestReport(trades),
  };
}
