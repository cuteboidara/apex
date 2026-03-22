import type { TradePlanStyle } from "@/lib/assets";
import { TRADE_PLAN_STYLES } from "@/lib/assets";
import type { PlannedTrade } from "@/lib/tradePlanner";
import { prisma } from "@/lib/prisma";
import { getProviderHealthScore } from "@/lib/marketData/providerHealthEngine";
import type { AssetClass, MarketStatus, ProviderName } from "@/lib/marketData/types";

export type ProviderHealthStateAtSignal = "HEALTHY" | "DEGRADED" | "UNHEALTHY";
export type TradePlanOutcome =
  | "PENDING_ENTRY"
  | "OPEN"
  | "TP1"
  | "TP2"
  | "TP3"
  | "STOP"
  | "STOP_AFTER_TP1"
  | "STOP_AFTER_TP2"
  | "INVALIDATED"
  | "EXPIRED";

export type SignalProviderContext = {
  providerAtSignal: string | null;
  providerHealthStateAtSignal: ProviderHealthStateAtSignal;
  providerMarketStatusAtSignal: MarketStatus;
  providerFallbackUsedAtSignal: boolean;
};

export type InstrumentedTradePlan = PlannedTrade & SignalProviderContext & {
  qualityGateReason: string | null;
};

type StyleGate = {
  style: TradePlanStyle;
  disabled: boolean;
  sampleSize: number;
  winRate: number | null;
  averageRR: number | null;
  reason: string | null;
  lookbackDays: number;
  minimumSampleSize: number;
};

export type StylePerformanceGateState = {
  degradedConfidenceFloor: number;
  byStyle: Record<TradePlanStyle, StyleGate>;
};

export type LifecycleTradePlan = {
  id: string;
  runId: string;
  signalId: string;
  symbol: string;
  assetClass: string;
  style: string;
  setupFamily: string | null;
  bias: string;
  status: string;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  invalidationLevel: number | null;
  detectedAt: Date | null;
  createdAt: Date;
  outcome: string | null;
};

export type LifecycleSnapshot = {
  symbol: string;
  capturedAt: Date;
  timeframe: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

type LifecycleState = {
  detectedAt: Date;
  entryHitAt: Date | null;
  stopHitAt: Date | null;
  tp1HitAt: Date | null;
  tp2HitAt: Date | null;
  tp3HitAt: Date | null;
  invalidatedAt: Date | null;
  expiredAt: Date | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  realizedRR: number | null;
  outcome: TradePlanOutcome;
};

type PerformanceAccumulator = {
  key: string;
  label: string;
  publishedCount: number;
  enteredCount: number;
  resolvedCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  pendingCount: number;
  openCount: number;
  invalidatedCount: number;
  expiredCount: number;
  tp1Hits: number;
  tp2Hits: number;
  tp3Hits: number;
  rrSum: number;
  rrCount: number;
};

export type PerformanceBucket = {
  key: string;
  label: string;
  publishedCount: number;
  enteredCount: number;
  resolvedCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  pendingCount: number;
  openCount: number;
  invalidatedCount: number;
  expiredCount: number;
  winRate: number | null;
  tp1HitRate: number | null;
  tp2HitRate: number | null;
  tp3HitRate: number | null;
  averageRR: number | null;
};

export type PerformanceReport = {
  summary: PerformanceBucket;
  breakdowns: {
    bySymbol: PerformanceBucket[];
    byStyle: PerformanceBucket[];
    bySetupFamily: PerformanceBucket[];
    byDirection: PerformanceBucket[];
    byRegime: PerformanceBucket[];
    byProviderHealthState: PerformanceBucket[];
  };
  worstPerformers: {
    setupFamilies: PerformanceBucket[];
    symbols: PerformanceBucket[];
  };
  qualityGate: {
    degradedConfidenceFloor: number;
    byStyle: Record<TradePlanStyle, StyleGate>;
  };
  timestamp: string;
};

const KNOWN_PROVIDER_NAMES = new Set<ProviderName>([
  "Alpha Vantage",
  "Binance",
  "FCS API",
  "Finnhub",
  "Twelve Data",
]);

const KNOWN_ASSET_CLASSES = new Set<AssetClass>(["FOREX", "COMMODITY", "CRYPTO"]);
const STYLE_EXPIRY_MS: Record<TradePlanStyle, number> = {
  SCALP: 8 * 60 * 60_000,
  INTRADAY: 36 * 60 * 60_000,
  SWING: 10 * 24 * 60 * 60_000,
};
const DEGRADED_CONFIDENCE_FLOOR = clampInt(process.env.APEX_DEGRADED_CONFIDENCE_FLOOR, 85);
const STYLE_GATE_LOOKBACK_DAYS = clampInt(process.env.APEX_STYLE_GATE_LOOKBACK_DAYS, 21);
const STYLE_GATE_MINIMUM_SAMPLE_SIZE = clampInt(process.env.APEX_STYLE_GATE_MIN_SAMPLE_SIZE, 12);
const SCALP_GATE_MIN_WIN_RATE = clampFloat(process.env.APEX_SCALP_GATE_MIN_WIN_RATE, 0.35);
const SCALP_GATE_MIN_AVERAGE_RR = clampFloat(process.env.APEX_SCALP_GATE_MIN_AVERAGE_RR, 0);
const SCALP_GATE_ENABLED = !["0", "false", "off"].includes((process.env.APEX_AUTO_DISABLE_SCALP ?? "true").toLowerCase());

function clampInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampFloat(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMetric(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

function toTradePlanStyle(value: string): TradePlanStyle {
  return TRADE_PLAN_STYLES.includes(value as TradePlanStyle) ? (value as TradePlanStyle) : "INTRADAY";
}

function toAssetClass(value: string): AssetClass | null {
  return KNOWN_ASSET_CLASSES.has(value as AssetClass) ? (value as AssetClass) : null;
}

function toProviderName(value: unknown): ProviderName | null {
  return typeof value === "string" && KNOWN_PROVIDER_NAMES.has(value as ProviderName)
    ? value as ProviderName
    : null;
}

function toMarketStatus(value: unknown): MarketStatus | null {
  if (value === "LIVE" || value === "DEGRADED" || value === "UNAVAILABLE") return value;
  return null;
}

function worseHealthState(
  left: ProviderHealthStateAtSignal,
  right: ProviderHealthStateAtSignal
): ProviderHealthStateAtSignal {
  const rank = { HEALTHY: 0, DEGRADED: 1, UNHEALTHY: 2 } as const;
  return rank[left] >= rank[right] ? left : right;
}

function inferHealthState(input: {
  marketStatus: MarketStatus;
  fallbackUsed: boolean;
  stale: boolean;
  circuitState: string | null;
}): ProviderHealthStateAtSignal {
  if (input.marketStatus === "UNAVAILABLE" || input.circuitState === "OPEN") return "UNHEALTHY";
  if (input.marketStatus === "DEGRADED" || input.fallbackUsed || input.stale) return "DEGRADED";
  return "HEALTHY";
}

export async function resolveSignalProviderContext(
  assetClass: string,
  priceData: unknown
): Promise<SignalProviderContext> {
  const payload = (priceData ?? {}) as Record<string, unknown>;
  const providerAtSignal =
    typeof payload.selectedProvider === "string" ? payload.selectedProvider :
    typeof payload.provider === "string" ? payload.provider :
    null;
  const providerMarketStatusAtSignal = toMarketStatus(payload.marketStatus)
    ?? ((payload.stale === true || payload.fallbackUsed === true) ? "DEGRADED" : "UNAVAILABLE");
  const providerFallbackUsedAtSignal = payload.fallbackUsed === true;
  const stale = payload.stale === true;
  const circuitState = typeof payload.circuitState === "string" ? payload.circuitState : null;

  let providerHealthStateAtSignal = inferHealthState({
    marketStatus: providerMarketStatusAtSignal,
    fallbackUsed: providerFallbackUsedAtSignal,
    stale,
    circuitState,
  });

  const resolvedAssetClass = toAssetClass(assetClass);
  const resolvedProvider = toProviderName(providerAtSignal);
  if (resolvedAssetClass && resolvedProvider) {
    try {
      const health = await getProviderHealthScore(resolvedProvider, resolvedAssetClass);
      providerHealthStateAtSignal = worseHealthState(providerHealthStateAtSignal, health.state);
    } catch {
      // health enrichment should not block signal creation
    }
  }

  return {
    providerAtSignal,
    providerHealthStateAtSignal,
    providerMarketStatusAtSignal,
    providerFallbackUsedAtSignal,
  };
}

function describeQualityGate(reason: string) {
  if (reason === "degraded_low_confidence") return "Low-confidence setup suppressed because the market-data stack was degraded.";
  if (reason === "style_disabled_poor_performance") return "Style suppressed because recent tracked performance is below threshold.";
  return "Setup suppressed by diagnostics quality gate.";
}

export function applyTradePlanQualityGates(
  plans: PlannedTrade[],
  providerContext: SignalProviderContext,
  gateState: StylePerformanceGateState
): InstrumentedTradePlan[] {
  return plans.map(plan => {
    let qualityGateReason: string | null = null;
    const styleGate = gateState.byStyle[plan.style];
    const degradedSignal =
      providerContext.providerHealthStateAtSignal !== "HEALTHY" ||
      providerContext.providerMarketStatusAtSignal !== "LIVE" ||
      providerContext.providerFallbackUsedAtSignal;

    if (plan.status === "ACTIVE" && styleGate.disabled) {
      qualityGateReason = "style_disabled_poor_performance";
    } else if (plan.status === "ACTIVE" && degradedSignal && plan.confidence < gateState.degradedConfidenceFloor) {
      qualityGateReason = "degraded_low_confidence";
    }

    if (!qualityGateReason) {
      return {
        ...plan,
        ...providerContext,
        qualityGateReason: null,
      };
    }

    return {
      ...plan,
      ...providerContext,
      status: "NO_SETUP",
      publicationRank: "Silent",
      executionNotes: `${plan.executionNotes} Quality gate: ${describeQualityGate(qualityGateReason)}`.trim(),
      qualityGateReason,
    };
  });
}

export async function getStylePerformanceGateState(): Promise<StylePerformanceGateState> {
  const byStyle = Object.fromEntries(
    TRADE_PLAN_STYLES.map(style => [
      style,
      {
        style,
        disabled: false,
        sampleSize: 0,
        winRate: null,
        averageRR: null,
        reason: null,
        lookbackDays: STYLE_GATE_LOOKBACK_DAYS,
        minimumSampleSize: STYLE_GATE_MINIMUM_SAMPLE_SIZE,
      } satisfies StyleGate,
    ])
  ) as Record<TradePlanStyle, StyleGate>;

  if (!SCALP_GATE_ENABLED) {
    return {
      degradedConfidenceFloor: DEGRADED_CONFIDENCE_FLOOR,
      byStyle,
    };
  }

  const cutoff = new Date(Date.now() - STYLE_GATE_LOOKBACK_DAYS * 24 * 60 * 60_000);
  const resolvedScalps = await prisma.tradePlan.findMany({
    where: {
      run: { status: "COMPLETED" },
      status: "ACTIVE",
      style: "SCALP",
      entryHitAt: { not: null },
      realizedRR: { not: null },
      OR: [
        { detectedAt: { gte: cutoff } },
        {
          detectedAt: null,
          createdAt: { gte: cutoff },
        },
      ],
    },
    select: {
      realizedRR: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const sampleSize = resolvedScalps.length;
  const rrValues = resolvedScalps
    .map(plan => plan.realizedRR)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const wins = rrValues.filter(value => value > 0).length;
  const averageRR = rrValues.length > 0
    ? rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length
    : null;
  const winRate = rrValues.length > 0 ? wins / rrValues.length : null;
  const poorPerformance =
    sampleSize >= STYLE_GATE_MINIMUM_SAMPLE_SIZE &&
    (
      (winRate != null && winRate < SCALP_GATE_MIN_WIN_RATE) ||
      (averageRR != null && averageRR < SCALP_GATE_MIN_AVERAGE_RR)
    );

  byStyle.SCALP = {
    style: "SCALP",
    disabled: poorPerformance,
    sampleSize,
    winRate: roundMetric(winRate),
    averageRR: roundMetric(averageRR),
    reason: poorPerformance ? "Recent scalp performance is below the configured gate threshold." : null,
    lookbackDays: STYLE_GATE_LOOKBACK_DAYS,
    minimumSampleSize: STYLE_GATE_MINIMUM_SAMPLE_SIZE,
  };

  return {
    degradedConfidenceFloor: DEGRADED_CONFIDENCE_FLOOR,
    byStyle,
  };
}

function planExpiryAt(plan: Pick<LifecycleTradePlan, "style" | "detectedAt" | "createdAt">) {
  const detectedAt = plan.detectedAt ?? plan.createdAt;
  const style = toTradePlanStyle(plan.style);
  return new Date(detectedAt.getTime() + STYLE_EXPIRY_MS[style]);
}

function entryMidpoint(plan: Pick<LifecycleTradePlan, "entryMin" | "entryMax">) {
  if (plan.entryMin == null && plan.entryMax == null) return null;
  if (plan.entryMin == null) return plan.entryMax;
  if (plan.entryMax == null) return plan.entryMin;
  return (plan.entryMin + plan.entryMax) / 2;
}

function overlapsEntry(plan: LifecycleTradePlan, low: number, high: number) {
  if (plan.entryMin == null && plan.entryMax == null) return false;
  const entryLow = Math.min(plan.entryMin ?? plan.entryMax ?? Number.POSITIVE_INFINITY, plan.entryMax ?? plan.entryMin ?? Number.POSITIVE_INFINITY);
  const entryHigh = Math.max(plan.entryMin ?? plan.entryMax ?? Number.NEGATIVE_INFINITY, plan.entryMax ?? plan.entryMin ?? Number.NEGATIVE_INFINITY);
  return low <= entryHigh && high >= entryLow;
}

function stopLevel(plan: Pick<LifecycleTradePlan, "stopLoss" | "invalidationLevel">) {
  return typeof plan.stopLoss === "number" ? plan.stopLoss : plan.invalidationLevel;
}

function hitsStop(plan: LifecycleTradePlan, low: number, high: number) {
  const level = stopLevel(plan);
  if (level == null) return false;
  return plan.bias === "SHORT" ? high >= level : low <= level;
}

function hitsInvalidationBeforeEntry(plan: LifecycleTradePlan, low: number, high: number) {
  if (plan.invalidationLevel == null) return false;
  return plan.bias === "SHORT" ? high >= plan.invalidationLevel : low <= plan.invalidationLevel;
}

function hitsTarget(level: number | null, bias: string, low: number, high: number) {
  if (level == null) return false;
  return bias === "SHORT" ? low <= level : high >= level;
}

function riskDistance(plan: LifecycleTradePlan, entry: number | null) {
  const level = stopLevel(plan);
  if (entry == null || level == null) return null;
  const distance = Math.abs(entry - level);
  return distance > 0 ? distance : null;
}

function rrToLevel(plan: LifecycleTradePlan, level: number | null, entry: number | null, risk: number | null) {
  if (entry == null || level == null || risk == null || risk <= 0) return null;
  const move = plan.bias === "SHORT" ? entry - level : level - entry;
  return roundMetric(move / risk);
}

function snapshotRange(snapshot: LifecycleSnapshot) {
  const values = [snapshot.price, snapshot.open, snapshot.high, snapshot.low, snapshot.close]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return {
    low: Math.min(...values),
    high: Math.max(...values),
  };
}

function updateExcursions(
  plan: LifecycleTradePlan,
  entry: number | null,
  risk: number | null,
  low: number,
  high: number,
  state: Pick<LifecycleState, "maxFavorableExcursion" | "maxAdverseExcursion">
) {
  if (entry == null || risk == null || risk <= 0) return;

  const favorable = plan.bias === "SHORT" ? (entry - low) / risk : (high - entry) / risk;
  const adverse = plan.bias === "SHORT" ? (high - entry) / risk : (entry - low) / risk;

  state.maxFavorableExcursion = roundMetric(
    Math.max(state.maxFavorableExcursion ?? Number.NEGATIVE_INFINITY, favorable, 0)
  );
  state.maxAdverseExcursion = roundMetric(
    Math.max(state.maxAdverseExcursion ?? Number.NEGATIVE_INFINITY, adverse, 0)
  );
}

export function computeTradePlanLifecycle(
  plan: LifecycleTradePlan,
  snapshots: LifecycleSnapshot[],
  now = new Date()
): LifecycleState {
  const detectedAt = plan.detectedAt ?? plan.createdAt;
  const expiryAt = planExpiryAt(plan);
  const entry = entryMidpoint(plan);
  const risk = riskDistance(plan, entry);
  let deepestTarget = 0;

  const state: LifecycleState = {
    detectedAt,
    entryHitAt: null,
    stopHitAt: null,
    tp1HitAt: null,
    tp2HitAt: null,
    tp3HitAt: null,
    invalidatedAt: null,
    expiredAt: null,
    maxFavorableExcursion: null,
    maxAdverseExcursion: null,
    realizedRR: null,
    outcome: "PENDING_ENTRY",
  };

  for (const snapshot of snapshots) {
    if (snapshot.capturedAt < detectedAt) continue;
    const range = snapshotRange(snapshot);
    if (!range) continue;
    const { low, high } = range;

    if (!state.entryHitAt) {
      if (snapshot.capturedAt > expiryAt) {
        state.expiredAt = expiryAt;
        state.outcome = "EXPIRED";
        return state;
      }

      const entryTriggered = overlapsEntry(plan, low, high);
      const invalidated = hitsInvalidationBeforeEntry(plan, low, high);

      if (invalidated && !entryTriggered) {
        state.invalidatedAt = snapshot.capturedAt;
        state.outcome = "INVALIDATED";
        return state;
      }

      if (!entryTriggered) continue;

      state.entryHitAt = snapshot.capturedAt;
      state.outcome = "OPEN";
      updateExcursions(plan, entry, risk, low, high, state);

      if (hitsStop(plan, low, high)) {
        state.stopHitAt = snapshot.capturedAt;
        state.realizedRR = -1;
        state.outcome = "STOP";
        return state;
      }

      continue;
    }

    updateExcursions(plan, entry, risk, low, high, state);

    if (hitsStop(plan, low, high)) {
      state.stopHitAt = snapshot.capturedAt;
      state.realizedRR = deepestTarget > 0
        ? rrToLevel(
            plan,
            deepestTarget >= 2 ? plan.takeProfit2 : plan.takeProfit1,
            entry,
            risk
          )
        : -1;
      state.outcome = deepestTarget >= 2
        ? "STOP_AFTER_TP2"
        : deepestTarget === 1
          ? "STOP_AFTER_TP1"
          : "STOP";
      return state;
    }

    if (!state.tp1HitAt && hitsTarget(plan.takeProfit1, plan.bias, low, high)) {
      state.tp1HitAt = snapshot.capturedAt;
      deepestTarget = Math.max(deepestTarget, 1);
    }
    if (!state.tp2HitAt && hitsTarget(plan.takeProfit2, plan.bias, low, high)) {
      state.tp2HitAt = snapshot.capturedAt;
      deepestTarget = Math.max(deepestTarget, 2);
    }
    if (!state.tp3HitAt && hitsTarget(plan.takeProfit3, plan.bias, low, high)) {
      state.tp3HitAt = snapshot.capturedAt;
      deepestTarget = Math.max(deepestTarget, 3);
      state.realizedRR = rrToLevel(plan, plan.takeProfit3, entry, risk);
      state.outcome = "TP3";
      return state;
    }

    if (snapshot.capturedAt > expiryAt) {
      state.expiredAt = expiryAt;
      if (deepestTarget >= 2) {
        state.realizedRR = rrToLevel(plan, plan.takeProfit2, entry, risk);
        state.outcome = "TP2";
      } else if (deepestTarget === 1) {
        state.realizedRR = rrToLevel(plan, plan.takeProfit1, entry, risk);
        state.outcome = "TP1";
      } else {
        state.outcome = "EXPIRED";
      }
      return state;
    }
  }

  if (!state.entryHitAt) {
    if (now > expiryAt) {
      state.expiredAt = expiryAt;
      state.outcome = "EXPIRED";
    }
    return state;
  }

  if (now > expiryAt) {
    state.expiredAt = expiryAt;
    if (state.tp2HitAt) {
      state.realizedRR = rrToLevel(plan, plan.takeProfit2, entry, risk);
      state.outcome = "TP2";
    } else if (state.tp1HitAt) {
      state.realizedRR = rrToLevel(plan, plan.takeProfit1, entry, risk);
      state.outcome = "TP1";
    } else {
      state.outcome = "EXPIRED";
    }
    return state;
  }

  state.outcome = "OPEN";
  return state;
}

export async function refreshTradePlanDiagnostics(input?: {
  runIds?: string[];
  maxPlans?: number;
}) {
  const runIds = Array.from(new Set(input?.runIds ?? [])).filter(Boolean);
  const plans = await prisma.tradePlan.findMany({
    where: {
      run: { status: "COMPLETED" },
      status: "ACTIVE",
      ...(runIds.length > 0 ? { runId: { in: runIds } } : {}),
      OR: [
        { detectedAt: null },
        { outcome: null },
        { outcome: { in: ["PENDING_ENTRY", "OPEN"] } },
      ],
    },
    select: {
      id: true,
      runId: true,
      signalId: true,
      symbol: true,
      assetClass: true,
      style: true,
      setupFamily: true,
      bias: true,
      status: true,
      entryMin: true,
      entryMax: true,
      stopLoss: true,
      takeProfit1: true,
      takeProfit2: true,
      takeProfit3: true,
      invalidationLevel: true,
      detectedAt: true,
      createdAt: true,
      outcome: true,
    },
    orderBy: { createdAt: "desc" },
    take: input?.maxPlans ?? 300,
  }) as LifecycleTradePlan[];

  if (plans.length === 0) {
    return { updatedCount: 0, evaluatedCount: 0 };
  }

  const symbols = Array.from(new Set(plans.map(plan => plan.symbol)));
  const snapshotsBySymbol = new Map<string, LifecycleSnapshot[]>();

  await Promise.all(
    symbols.map(async symbol => {
      const symbolPlans = plans.filter(plan => plan.symbol === symbol);
      const earliestDetectedAt = symbolPlans.reduce<Date>(
        (earliest, plan) => {
          const candidate = plan.detectedAt ?? plan.createdAt;
          return candidate < earliest ? candidate : earliest;
        },
        symbolPlans[0]?.detectedAt ?? symbolPlans[0]?.createdAt ?? new Date()
      );

      const snapshots = await prisma.marketDataSnapshot.findMany({
        where: {
          symbol,
          capturedAt: { gte: earliestDetectedAt },
        },
        select: {
          symbol: true,
          capturedAt: true,
          timeframe: true,
          price: true,
          open: true,
          high: true,
          low: true,
          close: true,
        },
        orderBy: [
          { capturedAt: "asc" },
          { timeframe: "asc" },
        ],
      }) as LifecycleSnapshot[];

      snapshotsBySymbol.set(symbol, snapshots);
    })
  );

  const updates = plans.map(plan => {
    const lifecycle = computeTradePlanLifecycle(plan, snapshotsBySymbol.get(plan.symbol) ?? []);
    return prisma.tradePlan.update({
      where: { id: plan.id },
      data: {
        detectedAt: lifecycle.detectedAt,
        entryHitAt: lifecycle.entryHitAt,
        stopHitAt: lifecycle.stopHitAt,
        tp1HitAt: lifecycle.tp1HitAt,
        tp2HitAt: lifecycle.tp2HitAt,
        tp3HitAt: lifecycle.tp3HitAt,
        invalidatedAt: lifecycle.invalidatedAt,
        expiredAt: lifecycle.expiredAt,
        maxFavorableExcursion: lifecycle.maxFavorableExcursion,
        maxAdverseExcursion: lifecycle.maxAdverseExcursion,
        realizedRR: lifecycle.realizedRR,
        outcome: lifecycle.outcome,
      },
    });
  });

  await Promise.all(updates);

  return {
    updatedCount: updates.length,
    evaluatedCount: plans.length,
  };
}

function createAccumulator(key: string, label: string): PerformanceAccumulator {
  return {
    key,
    label,
    publishedCount: 0,
    enteredCount: 0,
    resolvedCount: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    pendingCount: 0,
    openCount: 0,
    invalidatedCount: 0,
    expiredCount: 0,
    tp1Hits: 0,
    tp2Hits: 0,
    tp3Hits: 0,
    rrSum: 0,
    rrCount: 0,
  };
}

function recordPerformance(acc: PerformanceAccumulator, plan: {
  entryHitAt: Date | null;
  tp1HitAt: Date | null;
  tp2HitAt: Date | null;
  tp3HitAt: Date | null;
  realizedRR: number | null;
  outcome: string | null;
}) {
  acc.publishedCount += 1;

  if (plan.entryHitAt) {
    acc.enteredCount += 1;
  }
  if (plan.tp1HitAt) acc.tp1Hits += 1;
  if (plan.tp2HitAt) acc.tp2Hits += 1;
  if (plan.tp3HitAt) acc.tp3Hits += 1;

  if (plan.outcome === "PENDING_ENTRY" || (!plan.outcome && !plan.entryHitAt)) {
    acc.pendingCount += 1;
  } else if (plan.outcome === "OPEN" || (!plan.outcome && plan.entryHitAt)) {
    acc.openCount += 1;
  } else if (plan.outcome === "INVALIDATED") {
    acc.invalidatedCount += 1;
  } else if (plan.outcome === "EXPIRED") {
    acc.expiredCount += 1;
  }

  if (typeof plan.realizedRR === "number" && Number.isFinite(plan.realizedRR)) {
    acc.resolvedCount += 1;
    acc.rrCount += 1;
    acc.rrSum += plan.realizedRR;
    if (plan.realizedRR > 0) acc.wins += 1;
    else if (plan.realizedRR < 0) acc.losses += 1;
    else acc.breakeven += 1;
  }
}

function finalizeBucket(acc: PerformanceAccumulator): PerformanceBucket {
  return {
    key: acc.key,
    label: acc.label,
    publishedCount: acc.publishedCount,
    enteredCount: acc.enteredCount,
    resolvedCount: acc.resolvedCount,
    wins: acc.wins,
    losses: acc.losses,
    breakeven: acc.breakeven,
    pendingCount: acc.pendingCount,
    openCount: acc.openCount,
    invalidatedCount: acc.invalidatedCount,
    expiredCount: acc.expiredCount,
    winRate: acc.rrCount > 0 ? roundMetric(acc.wins / acc.rrCount) : null,
    tp1HitRate: acc.enteredCount > 0 ? roundMetric(acc.tp1Hits / acc.enteredCount) : null,
    tp2HitRate: acc.enteredCount > 0 ? roundMetric(acc.tp2Hits / acc.enteredCount) : null,
    tp3HitRate: acc.enteredCount > 0 ? roundMetric(acc.tp3Hits / acc.enteredCount) : null,
    averageRR: acc.rrCount > 0 ? roundMetric(acc.rrSum / acc.rrCount) : null,
  };
}

function finalizeBuckets(map: Map<string, PerformanceAccumulator>) {
  return Array.from(map.values())
    .map(finalizeBucket)
    .sort((left, right) => {
      const rightRR = right.averageRR ?? Number.NEGATIVE_INFINITY;
      const leftRR = left.averageRR ?? Number.NEGATIVE_INFINITY;
      if (rightRR !== leftRR) return rightRR - leftRR;
      return right.publishedCount - left.publishedCount;
    });
}

function registerBucket(
  map: Map<string, PerformanceAccumulator>,
  key: string,
  label: string,
  plan: {
    entryHitAt: Date | null;
    tp1HitAt: Date | null;
    tp2HitAt: Date | null;
    tp3HitAt: Date | null;
    realizedRR: number | null;
    outcome: string | null;
  }
) {
  if (!map.has(key)) {
    map.set(key, createAccumulator(key, label));
  }
  recordPerformance(map.get(key)!, plan);
}

export async function buildPerformanceReport(input?: {
  lookbackDays?: number;
  minimumSamples?: number;
}): Promise<PerformanceReport> {
  const lookbackDays = input?.lookbackDays ?? 30;
  const minimumSamples = input?.minimumSamples ?? 3;
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60_000);
  const plans = await prisma.tradePlan.findMany({
    where: {
      run: { status: "COMPLETED" },
      status: "ACTIVE",
      OR: [
        { detectedAt: { gte: cutoff } },
        {
          detectedAt: null,
          createdAt: { gte: cutoff },
        },
      ],
    },
    select: {
      symbol: true,
      style: true,
      setupFamily: true,
      bias: true,
      regimeTag: true,
      providerHealthStateAtSignal: true,
      entryHitAt: true,
      tp1HitAt: true,
      tp2HitAt: true,
      tp3HitAt: true,
      realizedRR: true,
      outcome: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1500,
  });

  const summary = createAccumulator("all", `Last ${lookbackDays}d`);
  const bySymbol = new Map<string, PerformanceAccumulator>();
  const byStyle = new Map<string, PerformanceAccumulator>();
  const bySetupFamily = new Map<string, PerformanceAccumulator>();
  const byDirection = new Map<string, PerformanceAccumulator>();
  const byRegime = new Map<string, PerformanceAccumulator>();
  const byProviderHealthState = new Map<string, PerformanceAccumulator>();

  plans.forEach(plan => {
    recordPerformance(summary, plan);
    registerBucket(bySymbol, plan.symbol, plan.symbol, plan);
    registerBucket(byStyle, plan.style, plan.style, plan);
    registerBucket(bySetupFamily, plan.setupFamily ?? "Unknown", plan.setupFamily ?? "Unknown", plan);
    registerBucket(byDirection, plan.bias, plan.bias, plan);
    registerBucket(byRegime, plan.regimeTag ?? "unclear", plan.regimeTag ?? "unclear", plan);
    registerBucket(
      byProviderHealthState,
      plan.providerHealthStateAtSignal ?? "UNKNOWN",
      plan.providerHealthStateAtSignal ?? "UNKNOWN",
      plan
    );
  });

  const styleGateState = await getStylePerformanceGateState();
  const setupFamilies = finalizeBuckets(bySetupFamily);
  const symbols = finalizeBuckets(bySymbol);

  const rankWorst = (items: PerformanceBucket[]) =>
    [...items]
      .filter(item => item.resolvedCount >= minimumSamples)
      .sort((left, right) => {
        const leftRR = left.averageRR ?? Number.POSITIVE_INFINITY;
        const rightRR = right.averageRR ?? Number.POSITIVE_INFINITY;
        if (leftRR !== rightRR) return leftRR - rightRR;
        return (left.winRate ?? 1) - (right.winRate ?? 1);
      })
      .slice(0, 5);

  return {
    summary: finalizeBucket(summary),
    breakdowns: {
      bySymbol: finalizeBuckets(bySymbol),
      byStyle: finalizeBuckets(byStyle),
      bySetupFamily: setupFamilies,
      byDirection: finalizeBuckets(byDirection),
      byRegime: finalizeBuckets(byRegime),
      byProviderHealthState: finalizeBuckets(byProviderHealthState),
    },
    worstPerformers: {
      setupFamilies: rankWorst(setupFamilies),
      symbols: rankWorst(symbols),
    },
    qualityGate: {
      degradedConfidenceFloor: styleGateState.degradedConfidenceFloor,
      byStyle: styleGateState.byStyle,
    },
    timestamp: new Date().toISOString(),
  };
}
