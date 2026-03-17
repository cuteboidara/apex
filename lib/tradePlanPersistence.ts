import { prisma } from "@/lib/prisma";
import { buildTradePlans } from "@/lib/tradePlanner";

type PersistedSignalLike = {
  id: string;
  runId: string;
  asset: string;
  assetClass: string;
  direction: string;
  total: number;
  brief: string;
  rawData: unknown;
  tradePlans: Array<{ id: string }>;
};

type RawDataShape = {
  price?: {
    current?: number | null;
    change24h?: number | null;
    high14d?: number | null;
    low14d?: number | null;
  };
  technicals?: {
    trend?: string | null;
    rsi?: number | null;
  };
  newsSentimentScore?: number;
  stale?: boolean;
};

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildTradePlansForPersistedSignal(signal: PersistedSignalLike) {
  const rawData = (signal.rawData ?? {}) as RawDataShape;
  const direction = signal.direction === "SHORT" ? "SHORT" : "LONG";

  return buildTradePlans(
    {
      asset: signal.asset,
      assetClass: signal.assetClass,
      direction,
      total: signal.total,
    },
    {
      currentPrice: toNullableNumber(rawData.price?.current),
      change24h: toNullableNumber(rawData.price?.change24h),
      high14d: toNullableNumber(rawData.price?.high14d),
      low14d: toNullableNumber(rawData.price?.low14d),
      trend: rawData.technicals?.trend ?? null,
      rsi: toNullableNumber(rawData.technicals?.rsi),
      stale: Boolean(rawData.stale),
      newsSentimentScore: toNullableNumber(rawData.newsSentimentScore) ?? 0,
      macroBias: signal.assetClass === "COMMODITY" ? "risk_off" : signal.assetClass === "CRYPTO" ? "risk_on" : "neutral",
      brief: signal.brief,
    }
  );
}

export async function ensureTradePlansForRun(runId: string) {
  const run = await prisma.signalRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      signals: {
        select: {
          id: true,
          runId: true,
          asset: true,
          assetClass: true,
          direction: true,
          total: true,
          brief: true,
          rawData: true,
          tradePlans: {
            select: { id: true },
          },
        },
      },
    },
  });

  if (!run || run.status !== "COMPLETED") {
    return 0;
  }

  if (run.signals.length === 0) {
    return 0;
  }

  const planRows = run.signals.flatMap(signal =>
    buildTradePlansForPersistedSignal(signal).map(plan => ({
      runId: signal.runId,
      signalId: signal.id,
      symbol: plan.symbol,
      assetClass: plan.assetClass,
      style: plan.style,
      setupFamily: plan.setupFamily,
      bias: plan.bias,
      confidence: plan.confidence,
      timeframe: plan.timeframe,
      entryType: plan.entryType,
      entryMin: plan.entryMin,
      entryMax: plan.entryMax,
      stopLoss: plan.stopLoss,
      takeProfit1: plan.takeProfit1,
      takeProfit2: plan.takeProfit2,
      takeProfit3: plan.takeProfit3,
      riskRewardRatio: plan.riskRewardRatio,
      invalidationLevel: plan.invalidationLevel,
      regimeTag: plan.regimeTag,
      liquidityThesis: plan.liquidityThesis,
      trapThesis: plan.trapThesis,
      setupScore: plan.setupScore,
      publicationRank: plan.publicationRank,
      thesis: plan.thesis,
      executionNotes: plan.executionNotes,
      status: plan.status,
    }))
  );

  if (planRows.length === 0) {
    return 0;
  }

  let affected = 0;

  await prisma.$transaction(async tx => {
    for (const row of planRows) {
      await tx.tradePlan.upsert({
        where: {
          signalId_style: {
            signalId: row.signalId,
            style: row.style,
          },
        },
        create: row,
        update: {
          assetClass: row.assetClass,
          bias: row.bias,
          confidence: row.confidence,
          timeframe: row.timeframe,
          setupFamily: row.setupFamily,
          entryType: row.entryType,
          entryMin: row.entryMin,
          entryMax: row.entryMax,
          stopLoss: row.stopLoss,
          takeProfit1: row.takeProfit1,
          takeProfit2: row.takeProfit2,
          takeProfit3: row.takeProfit3,
          riskRewardRatio: row.riskRewardRatio,
          invalidationLevel: row.invalidationLevel,
          regimeTag: row.regimeTag,
          liquidityThesis: row.liquidityThesis,
          trapThesis: row.trapThesis,
          setupScore: row.setupScore,
          publicationRank: row.publicationRank,
          thesis: row.thesis,
          executionNotes: row.executionNotes,
          status: row.status,
        },
      });
      affected += 1;
    }
  });

  return affected;
}

export async function ensureTradePlansForRuns(runIds: string[]) {
  let created = 0;

  for (const runId of Array.from(new Set(runIds))) {
    created += await ensureTradePlansForRun(runId);
  }

  return created;
}
