import { TRADE_PLAN_STYLES } from "@/lib/assets";
import { prisma } from "@/lib/prisma";
import { buildTradePlans } from "@/lib/tradePlanner";
import type { InstrumentedTradePlan, SignalProviderContext } from "@/lib/tradePlanDiagnostics";

type PersistedSignalLike = {
  id: string;
  runId: string;
  asset: string;
  assetClass: string;
  direction: string;
  total: number;
  brief: string;
  createdAt: Date;
  rawData: unknown;
  tradePlans: Array<{ id: string; style: string }>;
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
  strategy?: {
    providerContext?: Partial<SignalProviderContext>;
    tradePlans?: Array<Partial<InstrumentedTradePlan>>;
  };
};

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeProviderContext(rawData: RawDataShape): SignalProviderContext {
  const strategy = rawData.strategy;
  const providerContext = strategy?.providerContext ?? {};
  return {
    providerAtSignal: typeof providerContext.providerAtSignal === "string" ? providerContext.providerAtSignal : null,
    providerHealthStateAtSignal:
      providerContext.providerHealthStateAtSignal === "UNHEALTHY" ||
      providerContext.providerHealthStateAtSignal === "DEGRADED"
        ? providerContext.providerHealthStateAtSignal
        : "HEALTHY",
    providerMarketStatusAtSignal:
      providerContext.providerMarketStatusAtSignal === "UNAVAILABLE" ||
      providerContext.providerMarketStatusAtSignal === "DEGRADED"
        ? providerContext.providerMarketStatusAtSignal
        : "LIVE",
    providerFallbackUsedAtSignal: providerContext.providerFallbackUsedAtSignal === true,
  };
}

function buildTradePlansForPersistedSignal(signal: PersistedSignalLike): InstrumentedTradePlan[] {
  const rawData = (signal.rawData ?? {}) as RawDataShape;
  const direction = signal.direction === "SHORT" ? "SHORT" : "LONG";
  const providerContext = normalizeProviderContext(rawData);
  const storedPlans = rawData.strategy?.tradePlans ?? [];

  if (Array.isArray(storedPlans) && storedPlans.length > 0) {
    return storedPlans
      .filter((plan): plan is Partial<InstrumentedTradePlan> & { style: InstrumentedTradePlan["style"] } => typeof plan?.style === "string")
      .map(plan => ({
        symbol: signal.asset,
        assetClass: signal.assetClass,
        style: plan.style,
        setupFamily: typeof plan.setupFamily === "string" ? plan.setupFamily : null,
        bias: plan.bias === "SHORT" ? "SHORT" : "LONG",
        confidence: toNullableNumber(plan.confidence) ?? 0,
        timeframe: typeof plan.timeframe === "string" ? plan.timeframe : "Unavailable",
        entryType: plan.entryType === "LIMIT" || plan.entryType === "STOP" ? plan.entryType : "NONE",
        entryMin: toNullableNumber(plan.entryMin),
        entryMax: toNullableNumber(plan.entryMax),
        stopLoss: toNullableNumber(plan.stopLoss),
        takeProfit1: toNullableNumber(plan.takeProfit1),
        takeProfit2: toNullableNumber(plan.takeProfit2),
        takeProfit3: toNullableNumber(plan.takeProfit3),
        riskRewardRatio: toNullableNumber(plan.riskRewardRatio),
        invalidationLevel: toNullableNumber(plan.invalidationLevel),
        regimeTag: typeof plan.regimeTag === "string" ? plan.regimeTag : "unclear",
        liquidityThesis: typeof plan.liquidityThesis === "string" ? plan.liquidityThesis : "",
        trapThesis: typeof plan.trapThesis === "string" ? plan.trapThesis : "",
        setupScore: toNullableNumber(plan.setupScore) ?? 0,
        publicationRank:
          plan.publicationRank === "S" ||
          plan.publicationRank === "A" ||
          plan.publicationRank === "B"
            ? plan.publicationRank
            : "Silent",
        scoreBreakdown: {
          regimeAlignment: toNullableNumber(plan.scoreBreakdown?.regimeAlignment) ?? 0,
          liquidityQuality: toNullableNumber(plan.scoreBreakdown?.liquidityQuality) ?? 0,
          structureConfirmation: toNullableNumber(plan.scoreBreakdown?.structureConfirmation) ?? 0,
          trapEdge: toNullableNumber(plan.scoreBreakdown?.trapEdge) ?? 0,
          entryPrecision: toNullableNumber(plan.scoreBreakdown?.entryPrecision) ?? 0,
          riskReward: toNullableNumber(plan.scoreBreakdown?.riskReward) ?? 0,
          freshness: toNullableNumber(plan.scoreBreakdown?.freshness) ?? 0,
        },
        thesis: typeof plan.thesis === "string" ? plan.thesis : signal.brief,
        executionNotes: typeof plan.executionNotes === "string" ? plan.executionNotes : signal.brief,
        status: plan.status === "STALE" ? "STALE" : plan.status === "ACTIVE" ? "ACTIVE" : "NO_SETUP",
        providerAtSignal: typeof plan.providerAtSignal === "string" ? plan.providerAtSignal : providerContext.providerAtSignal,
        providerHealthStateAtSignal:
          plan.providerHealthStateAtSignal === "UNHEALTHY" ||
          plan.providerHealthStateAtSignal === "DEGRADED"
            ? plan.providerHealthStateAtSignal
            : providerContext.providerHealthStateAtSignal,
        providerMarketStatusAtSignal:
          plan.providerMarketStatusAtSignal === "UNAVAILABLE" ||
          plan.providerMarketStatusAtSignal === "DEGRADED"
            ? plan.providerMarketStatusAtSignal
            : providerContext.providerMarketStatusAtSignal,
        providerFallbackUsedAtSignal:
          typeof plan.providerFallbackUsedAtSignal === "boolean"
            ? plan.providerFallbackUsedAtSignal
            : providerContext.providerFallbackUsedAtSignal,
        qualityGateReason: typeof plan.qualityGateReason === "string" ? plan.qualityGateReason : null,
      }));
  }

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
  ).map(plan => ({
    ...plan,
    ...providerContext,
    qualityGateReason: null,
  }));
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
          createdAt: true,
          rawData: true,
          tradePlans: {
            select: {
              id: true,
              style: true,
            },
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

  const planRows = run.signals.flatMap(signal => {
    const existingStyles = new Set(signal.tradePlans.map(plan => plan.style));
    if (existingStyles.size >= TRADE_PLAN_STYLES.length) {
      return [];
    }

    return buildTradePlansForPersistedSignal(signal)
      .filter(plan => !existingStyles.has(plan.style))
      .map(plan => ({
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
        providerAtSignal: plan.providerAtSignal,
        providerHealthStateAtSignal: plan.providerHealthStateAtSignal,
        providerMarketStatusAtSignal: plan.providerMarketStatusAtSignal,
        providerFallbackUsedAtSignal: plan.providerFallbackUsedAtSignal,
        qualityGateReason: plan.qualityGateReason,
        detectedAt: signal.createdAt,
        outcome: plan.status === "ACTIVE" ? "PENDING_ENTRY" : null,
      }));
  });

  if (planRows.length === 0) {
    return 0;
  }

  const created = await prisma.tradePlan.createMany({
    data: planRows,
    skipDuplicates: true,
  });

  return created.count;
}

export async function ensureTradePlansForRuns(runIds: string[]) {
  let created = 0;

  for (const runId of Array.from(new Set(runIds))) {
    created += await ensureTradePlansForRun(runId);
  }

  return created;
}
