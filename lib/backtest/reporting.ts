import { buildConfidenceCalibrationBuckets } from "@/lib/analysis/confidenceCalibration";
import type { SimulatedTradeResult } from "@/lib/backtest/executionSimulator";

export type BacktestSummaryBucket = {
  key: string;
  sampleSize: number;
  winRate: number | null;
  expectancy: number | null;
  averageRR: number | null;
};

export type BacktestReport = {
  sampleSize: number;
  winRate: number | null;
  expectancy: number | null;
  averageRR: number | null;
  rrDistribution: number[];
  maxDrawdown: number | null;
  bySymbol: BacktestSummaryBucket[];
  byProvider: BacktestSummaryBucket[];
  bySetupFamily: BacktestSummaryBucket[];
  byRegime: BacktestSummaryBucket[];
  calibration: ReturnType<typeof buildConfidenceCalibrationBuckets>;
};

function round(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function summarize(key: string, trades: SimulatedTradeResult[]): BacktestSummaryBucket {
  const rrDistribution = trades
    .map(trade => trade.realizedRR)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageRR = rrDistribution.length > 0
    ? rrDistribution.reduce((sum, value) => sum + value, 0) / rrDistribution.length
    : null;
  const winRate = rrDistribution.length > 0
    ? rrDistribution.filter(value => value > 0).length / rrDistribution.length
    : null;

  return {
    key,
    sampleSize: trades.length,
    winRate: round(winRate),
    expectancy: round(averageRR),
    averageRR: round(averageRR),
  };
}

function groupSummary(trades: SimulatedTradeResult[], keyFor: (trade: SimulatedTradeResult) => string) {
  const map = new Map<string, SimulatedTradeResult[]>();
  for (const trade of trades) {
    const key = keyFor(trade);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(trade);
  }

  return Array.from(map.entries())
    .map(([key, groupedTrades]) => summarize(key, groupedTrades))
    .sort((left, right) => right.sampleSize - left.sampleSize);
}

function calculateMaxDrawdown(rrDistribution: number[]) {
  if (rrDistribution.length === 0) return null;
  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const rr of rrDistribution) {
    equity += rr;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, equity - peak);
  }
  return round(worst);
}

export function buildBacktestReport(trades: SimulatedTradeResult[]): BacktestReport {
  const rrDistribution = trades
    .map(trade => trade.realizedRR)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageRR = rrDistribution.length > 0
    ? rrDistribution.reduce((sum, value) => sum + value, 0) / rrDistribution.length
    : null;
  const winRate = rrDistribution.length > 0
    ? rrDistribution.filter(value => value > 0).length / rrDistribution.length
    : null;

  return {
    sampleSize: trades.length,
    winRate: round(winRate),
    expectancy: round(averageRR),
    averageRR: round(averageRR),
    rrDistribution,
    maxDrawdown: calculateMaxDrawdown(rrDistribution),
    bySymbol: groupSummary(trades, trade => trade.symbol),
    byProvider: groupSummary(trades, trade => trade.provider ?? "unknown"),
    bySetupFamily: groupSummary(trades, trade => trade.setupFamily ?? "Unknown"),
    byRegime: groupSummary(trades, trade => trade.regimeTag ?? "unclear"),
    calibration: buildConfidenceCalibrationBuckets(
      trades.map(trade => ({
        symbol: trade.symbol,
        assetClass: trade.assetClass,
        style: trade.style,
        setupFamily: trade.setupFamily,
        regimeTag: trade.regimeTag,
        provider: trade.provider,
        providerHealthState: null,
        confidence: trade.confidence,
        realizedRR: trade.realizedRR,
      })),
      { scopeType: "BACKTEST" }
    ),
  };
}
