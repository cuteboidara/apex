import { anthropic } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logging";
import { recordProviderHealth } from "@/lib/providerHealth";
import { recordAuditEvent } from "@/lib/audit";
import { ENGINE_VERSION, FAILURE_CODES, FEATURE_VERSION, PROMPT_VERSION, type FailureCode } from "@/lib/runConfig";
import { buildTradePlans } from "@/lib/tradePlanner";
import type { Timeframe } from "@/lib/marketData/types";
import {
  fetchCryptoData,
  fetchForexData,
  fetchCommodityData,
  fetchMacroData,
  fetchNews,
  fetchTechnicals,
} from "@/lib/marketData";

// ── Asset universe ────────────────────────────────────────────────────────────

export const ASSETS = [
  { symbol: "EURUSD",  class: "FOREX"     as const, binanceSymbol: null,       alphaSymbol: "EUR" },
  { symbol: "GBPUSD",  class: "FOREX"     as const, binanceSymbol: null,       alphaSymbol: "GBP" },
  { symbol: "USDJPY",  class: "FOREX"     as const, binanceSymbol: null,       alphaSymbol: "JPY" },
  { symbol: "XAUUSD",  class: "COMMODITY" as const, binanceSymbol: null,       alphaSymbol: "XAU" },
  { symbol: "XAGUSD",  class: "COMMODITY" as const, binanceSymbol: null,       alphaSymbol: "XAG" },
  { symbol: "BTCUSDT", class: "CRYPTO"    as const, binanceSymbol: "BTCUSDT",  alphaSymbol: null  },
  { symbol: "ETHUSDT", class: "CRYPTO"    as const, binanceSymbol: "ETHUSDT",  alphaSymbol: null  },
] as const;

export type Asset = typeof ASSETS[number];
type PersistenceTransaction = {
  signal: typeof prisma.signal;
  tradePlan: typeof prisma.tradePlan;
};

// ── Rank ─────────────────────────────────────────────────────────────────────

function getRank(total: number): "S" | "A" | "B" | "Silent" {
  if (total >= 85) return "S";
  if (total >= 70) return "A";
  if (total >= 55) return "B";
  return "Silent";
}

type DataSummary = {
  asset: string;
  assetClass: string;
  stale: boolean;
  price: {
    current: number | null;
    change24h: number | null;
    volume: number | null;
    high14d: number | null;
    low14d: number | null;
  };
  technicals: {
    rsi: number | null;
    macdSignal: string | null;
    macdHist: number | null;
    trend: string | null;
  };
  macro: {
    fedFundsRate: string | null;
    fedTrend?: string | null;
    cpi: string | null;
    cpiTrend?: string | null;
    treasury10y?: string | null;
    gdp?: string | null;
  } | null;
  news: Array<{ title: string; source: string; publishedAt: string; sentiment: string }>;
  sentiment: { value: string; label: string } | null;
  newsSentimentScore: number;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(20, Math.round(value)));
}

function deriveDirection(data: DataSummary): "LONG" | "SHORT" {
  const trend = data.technicals.trend;
  const change = data.price.change24h ?? 0;
  const newsBias = data.newsSentimentScore;
  const sentimentValue = Number(data.sentiment?.value ?? 50);

  let score = 0;
  if (trend === "uptrend") score += 2;
  if (trend === "downtrend") score -= 2;
  if (change > 0) score += 1;
  if (change < 0) score -= 1;
  if (newsBias > 0) score += 1;
  if (newsBias < 0) score -= 1;
  if (sentimentValue >= 60) score += 1;
  if (sentimentValue <= 40) score -= 1;

  return score >= 0 ? "LONG" : "SHORT";
}

function scoreMacro(data: DataSummary, direction: "LONG" | "SHORT"): number {
  const macro = data.macro;
  if (!macro) return 10;

  let score = 10;
  const fedTrend = macro.fedTrend ?? "flat";
  const cpiTrend = macro.cpiTrend ?? "flat";
  const treasury = Number(macro.treasury10y ?? 0);

  if (direction === "LONG") {
    if (fedTrend === "falling") score += 4;
    if (cpiTrend === "falling") score += 4;
    if (treasury > 0 && treasury < 4.5) score += 2;
    if (fedTrend === "rising") score -= 3;
    if (cpiTrend === "rising") score -= 3;
  } else {
    if (fedTrend === "rising") score += 4;
    if (cpiTrend === "rising") score += 4;
    if (treasury >= 4.5) score += 2;
    if (fedTrend === "falling") score -= 3;
    if (cpiTrend === "falling") score -= 3;
  }

  return clampScore(score);
}

function scoreStructure(data: DataSummary, direction: "LONG" | "SHORT"): number {
  const trend = data.technicals.trend;
  const move = Math.abs(data.price.change24h ?? 0);
  let score = trend === "consolidation" ? 10 : 12;

  if (direction === "LONG" && trend === "uptrend") score += 6;
  if (direction === "SHORT" && trend === "downtrend") score += 6;
  if (direction === "LONG" && trend === "downtrend") score -= 6;
  if (direction === "SHORT" && trend === "uptrend") score -= 6;
  if (move > 1.2) score += 2;
  if (move < 0.2) score -= 2;

  return clampScore(score);
}

function scoreZones(data: DataSummary, direction: "LONG" | "SHORT"): number {
  const price = data.price.current;
  const high = data.price.high14d;
  const low = data.price.low14d;
  if (price == null || high == null || low == null || high <= low) return 8;

  const range = high - low;
  const normalized = (price - low) / range;
  let score = 10;

  if (direction === "LONG") {
    if (normalized <= 0.25) score += 7;
    else if (normalized <= 0.45) score += 3;
    else if (normalized >= 0.8) score -= 4;
  } else {
    if (normalized >= 0.75) score += 7;
    else if (normalized >= 0.55) score += 3;
    else if (normalized <= 0.2) score -= 4;
  }

  return clampScore(score);
}

function fallbackBrief(
  asset: Asset,
  direction: "LONG" | "SHORT",
  scores: { macro: number; structure: number; zones: number; technical: number; timing: number },
  rank: string,
  levels: { entry: number | null; stopLoss: number | null; tp1: number | null; tp2: number | null; tp3: number | null },
  strategySummary?: { family: string | null; regimeTag: string; liquidityThesis: string; trapThesis: string }
): string {
  const strongest = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "structure";
  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "timing";
  const setupLead = strategySummary?.family
    ? `${strategySummary.family} inside a ${strategySummary.regimeTag} regime.`
    : "No high-quality executable setup is currently active.";
  return `${asset.symbol} is a ${rank} ${direction} setup. ${setupLead} Strength is concentrated in ${strongest}, while ${weakest} is the weakest link. ${strategySummary?.liquidityThesis ?? ""} ${strategySummary?.trapThesis ?? ""} Execute only near ${levels.entry?.toFixed(4) ?? "market"} with discipline around the stop at ${levels.stopLoss?.toFixed(4) ?? "n/a"} and scale targets through TP1 ${levels.tp1?.toFixed(4) ?? "n/a"} and TP2 ${levels.tp2?.toFixed(4) ?? "n/a"}.`.trim();
}

function classifyFailure(reason: unknown): FailureCode {
  const text = String(reason).toLowerCase();
  if (text.includes("timeout")) return FAILURE_CODES.PROVIDER_TIMEOUT;
  if (text.includes("429") || text.includes("rate limit")) return FAILURE_CODES.PROVIDER_RATE_LIMIT;
  if (text.includes("schema") || text.includes("parse")) return FAILURE_CODES.PROVIDER_SCHEMA_ERROR;
  if (text.includes("feature")) return FAILURE_CODES.FEATURE_PIPELINE_ERROR;
  if (text.includes("score")) return FAILURE_CODES.SCORING_ERROR;
  if (text.includes("persist") || text.includes("prisma") || text.includes("database")) return FAILURE_CODES.PERSISTENCE_ERROR;
  if (text.includes("alert") || text.includes("telegram")) return FAILURE_CODES.ALERT_DELIVERY_ERROR;
  return FAILURE_CODES.UNKNOWN_ERROR;
}

// ── Core analysis ─────────────────────────────────────────────────────────────

export async function analyzeAsset(asset: Asset, runId: string) {
  const assetStartedAt = Date.now();
  const fetchStartedAt = assetStartedAt;
  logEvent({
    runId,
    asset: asset.symbol,
    component: "signal-engine",
    message: "Analyzing asset",
  });

  // ── 1. Fetch all data sources in parallel ──────────────────────────────────

  const newsQuery =
    asset.class === "CRYPTO"    ? asset.symbol.replace("USDT", "") :
    asset.class === "COMMODITY" ? (asset.alphaSymbol === "XAU" ? "gold" : "silver") :
    asset.symbol;

  const [priceResult, macroResult, newsResult] = await Promise.allSettled([
    // Price + candles
    // For FOREX: derive from/to from symbol (EURUSD → EUR + USD, USDJPY → USD + JPY)
    asset.class === "CRYPTO"
      ? fetchCryptoData(asset.binanceSymbol!)
      : asset.class === "FOREX"
        ? fetchForexData(asset.symbol.slice(0, 3), asset.symbol.slice(3, 6))
        : fetchCommodityData(asset.alphaSymbol!),

    // Macro
    fetchMacroData(),

    // News
    fetchNews(newsQuery),
  ]);

  const priceData = priceResult.status === "fulfilled" ? priceResult.value : null;
  const macroData = macroResult.status === "fulfilled" ? macroResult.value : null;
  const newsData  = newsResult.status  === "fulfilled" ? newsResult.value  : [];

  if (priceResult.status === "rejected") {
    logEvent({
      runId,
      asset: asset.symbol,
      component: "signal-engine",
      severity: "ERROR",
      message: "Price fetch failed",
      reason: String(priceResult.reason),
    });
  }
  if (macroResult.status === "rejected") {
    logEvent({
      runId,
      asset: asset.symbol,
      component: "signal-engine",
      severity: "ERROR",
      message: "Macro fetch failed",
      reason: String(macroResult.reason),
    });
  }
  if (newsResult.status === "rejected") {
    logEvent({
      runId,
      asset: asset.symbol,
      component: "signal-engine",
      severity: "ERROR",
      message: "News fetch failed",
      reason: String(newsResult.reason),
    });
  }

  const priceVal = (priceData as Record<string, unknown>)?.price ?? null;
  logEvent({
    runId,
    asset: asset.symbol,
    component: "signal-engine",
    message: "Input data collected",
    price: priceVal,
    macroAvailable: Boolean(macroData),
    newsCount: newsData.length,
  });

  // Technicals (needs closes from price data)
  const closes = (priceData as { closes?: number[] })?.closes ?? [];
  const techData = await fetchTechnicals(
    asset.symbol.replace("USDT", ""),
    asset.class,
    closes,
  ).catch(() => ({ rsi: null, macdSignal: null, macdHist: null, trend: null }));
  const dataFetchDurationMs = Date.now() - fetchStartedAt;

  // ── 2. Build data summary ─────────────────────────────────────────────────

  const toNullableNumber = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const dataSummary: DataSummary = {
    asset:      asset.symbol,
    assetClass: asset.class,
    stale: Boolean((priceData as Record<string, unknown> | null)?.stale) || toNullableNumber((priceData as Record<string, unknown>)?.price) == null,
    price: {
      current:  toNullableNumber((priceData as Record<string, unknown>)?.price),
      change24h: toNullableNumber((priceData as Record<string, unknown>)?.change24h),
      volume:   toNullableNumber((priceData as Record<string, unknown>)?.volume),
      high14d:  toNullableNumber((priceData as Record<string, unknown>)?.high14d),
      low14d:   toNullableNumber((priceData as Record<string, unknown>)?.low14d),
    },
    technicals: {
      rsi:        toNullableNumber(techData.rsi),
      macdSignal: techData.macdSignal,
      macdHist:   toNullableNumber(techData.macdHist),
      trend:      techData.trend,
    },
    macro: macroData,
    news:  newsData.slice(0, 5),
    sentiment: asset.class === "CRYPTO"
      ? (() => {
          const raw = (priceData as Record<string, unknown>)?.fearGreed as Record<string, unknown> | null | undefined;
          if (!raw) return null;
          const value = raw.value;
          const label = raw.label;
          return typeof value === "string" && typeof label === "string"
            ? { value, label }
            : null;
        })()
      : null,
    newsSentimentScore: newsData.length > 0
      ? (newsData.filter(n => n.sentiment === "bullish").length -
         newsData.filter(n => n.sentiment === "bearish").length)
      : 0,
  };

  if (dataSummary.price.current == null) {
    console.error(`[apexEngine] No price data for ${asset.symbol} - skipping score`);
    throw new Error(`No price data for ${asset.symbol}`);
  }

  // ── 3. Deterministic hybrid strategy scoring ──────────────────────────────

  const scoringStartedAt = Date.now();
  const macroBias =
    asset.class === "COMMODITY"
      ? "risk_off"
      : asset.class === "CRYPTO"
        ? (dataSummary.technicals.trend === "uptrend" ? "risk_on" : "neutral")
        : (dataSummary.macro?.fedTrend === "falling" ? "risk_on" : dataSummary.macro?.fedTrend === "rising" ? "risk_off" : "neutral");

  const tradePlans = buildTradePlans(
    {
      asset: asset.symbol,
      assetClass: asset.class,
      direction: deriveDirection(dataSummary),
      total: 0,
    },
    {
      currentPrice: dataSummary.price.current,
      change24h: dataSummary.price.change24h,
      high14d: dataSummary.price.high14d,
      low14d: dataSummary.price.low14d,
      trend: dataSummary.technicals.trend,
      rsi: dataSummary.technicals.rsi,
      stale: dataSummary.stale,
      styleReadiness: ((priceData as Record<string, unknown> | null)?.readiness as {
        SCALP: { ready: boolean; missing: Timeframe[]; stale: Timeframe[] };
        INTRADAY: { ready: boolean; missing: Timeframe[]; stale: Timeframe[] };
        SWING: { ready: boolean; missing: Timeframe[]; stale: Timeframe[] };
      } | undefined),
      newsSentimentScore: dataSummary.newsSentimentScore,
      macroBias,
      brief: "",
    }
  );

  const rankedPlans = [...tradePlans].sort((a, b) => {
    if (a.status === b.status) return b.setupScore - a.setupScore;
    if (a.status === "ACTIVE") return -1;
    if (b.status === "ACTIVE") return 1;
    return b.setupScore - a.setupScore;
  });
  const bestPlan = rankedPlans[0];
  const direction = bestPlan?.bias ?? deriveDirection(dataSummary);
  const scores = {
    macro: bestPlan?.scoreBreakdown.regimeAlignment ?? scoreMacro(dataSummary, direction),
    structure: bestPlan?.scoreBreakdown.liquidityQuality ?? scoreStructure(dataSummary, direction),
    zones: bestPlan?.scoreBreakdown.structureConfirmation ?? scoreZones(dataSummary, direction),
    technical: Math.min(20, (bestPlan?.scoreBreakdown.trapEdge ?? 0) + Math.ceil((bestPlan?.scoreBreakdown.entryPrecision ?? 0) / 2)),
    timing: Math.min(20, (bestPlan?.scoreBreakdown.riskReward ?? 0) + (bestPlan?.scoreBreakdown.freshness ?? 0) + Math.floor((bestPlan?.scoreBreakdown.entryPrecision ?? 0) / 2)),
  };
  const total = bestPlan?.setupScore ?? Object.values(scores).reduce((a, b) => a + b, 0);
  const rank = bestPlan?.publicationRank ?? getRank(total);
  const levels = {
    entry: bestPlan?.entryMin != null && bestPlan.entryMax != null ? (bestPlan.entryMin + bestPlan.entryMax) / 2 : null,
    stopLoss: bestPlan?.stopLoss ?? null,
    tp1: bestPlan?.takeProfit1 ?? null,
    tp2: bestPlan?.takeProfit2 ?? null,
    tp3: bestPlan?.takeProfit3 ?? null,
  };
  const scoringDurationMs = Date.now() - scoringStartedAt;

  const narrativeStartedAt = Date.now();
  let brief = fallbackBrief(asset, direction, scores, rank, levels, bestPlan ? {
    family: bestPlan.setupFamily,
    regimeTag: bestPlan.regimeTag,
    liquidityThesis: bestPlan.liquidityThesis,
    trapThesis: bestPlan.trapThesis,
  } : undefined);
  const userPrompt = `Write a concise trading brief in plain text only, max 120 words.

Asset: ${asset.symbol}
Class: ${asset.class}
Direction: ${direction}
Rank: ${rank}
Scores: macro ${scores.macro}, structure ${scores.structure}, zones ${scores.zones}, technical ${scores.technical}, timing ${scores.timing}, total ${total}
Setup family: ${bestPlan?.setupFamily ?? "n/a"}
Regime: ${bestPlan?.regimeTag ?? "n/a"}
Entry: ${levels.entry ?? "n/a"}
Stop loss: ${levels.stopLoss ?? "n/a"}
TP1: ${levels.tp1 ?? "n/a"}
TP2: ${levels.tp2 ?? "n/a"}
TP3: ${levels.tp3 ?? "n/a"}
Market data: ${JSON.stringify(dataSummary)}

Cover conviction, strongest factors, invalidation, and execution discipline.`;

  if (process.env.ANTHROPIC_API_KEY) {
    const startedAt = Date.now();
    try {
      logEvent({
        runId,
        asset: asset.symbol,
        component: "explanation-engine",
        message: "Calling Claude for narrative explanation",
      });
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 220,
        system: "You are APEX. Provide explanation text only. Do not alter the supplied scores or direction.",
        messages: [{ role: "user", content: userPrompt }],
      });
      const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
      if (text) brief = text;
      await recordProviderHealth({
        provider: "Anthropic",
        latencyMs: Date.now() - startedAt,
        status: "OK",
        errorRate: 0,
      });
    } catch (err) {
      await recordProviderHealth({
        provider: "Anthropic",
        latencyMs: Date.now() - startedAt,
        status: "ERROR",
        errorRate: 1,
      });
      logEvent({
        runId,
        asset: asset.symbol,
        component: "explanation-engine",
        severity: "WARN",
        message: "Claude explanation failed; using fallback brief",
        reason: String(err),
      });
    }
  }
  const narrativeDurationMs = Date.now() - narrativeStartedAt;

  logEvent({
    runId,
    asset: asset.symbol,
    component: "signal-engine",
    message: "Scores calculated",
    ...scores,
    total,
    rank,
    thresholds: { S: 85, A: 70, B: 55 },
    setupFamily: bestPlan?.setupFamily ?? null,
    regimeTag: bestPlan?.regimeTag ?? null,
  });

  // ── 4. Save to DB ─────────────────────────────────────────────────────────

  const signalData = {
    runId,
    asset:      asset.symbol,
    assetClass: asset.class,
    direction,
    rank,
    total,
    ...scores,
    entry:    levels.entry,
    stopLoss: levels.stopLoss,
    tp1:      levels.tp1,
    tp2:      levels.tp2,
    tp3:      levels.tp3,
    brief,
    rawData:  {
      ...dataSummary,
      strategy: {
        selectedStyle: bestPlan?.style ?? null,
        setupFamily: bestPlan?.setupFamily ?? null,
        regimeTag: bestPlan?.regimeTag ?? null,
        setupScore: bestPlan?.setupScore ?? total,
        status: bestPlan?.status ?? "NO_SETUP",
        breakdown: bestPlan?.scoreBreakdown ?? null,
      },
    } as object,
  };

  const persistenceStartedAt = Date.now();
  const signal = await prisma.$transaction(async (tx: PersistenceTransaction) => {
    const createdSignal = await tx.signal.create({ data: signalData });
    await tx.tradePlan.createMany({
      data: tradePlans.map((plan: (typeof tradePlans)[number]) => ({
        runId,
        signalId: createdSignal.id,
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
      })),
    });

    return createdSignal;
  });
  const persistenceDurationMs = Date.now() - persistenceStartedAt;
  const persistedAtMs = Date.now();
  logEvent({
    runId,
    asset: asset.symbol,
    component: "signal-persistence",
    message: "Signal persisted",
    signalId: signal.id,
    tradePlanCount: 3,
  });
  return {
    signal,
    metrics: {
      startedAtMs: assetStartedAt,
      fetchCompletedAtMs: fetchStartedAt + dataFetchDurationMs,
      scoringCompletedAtMs: scoringStartedAt + scoringDurationMs + narrativeDurationMs,
      persistedAtMs,
      persistenceDurationMs,
    },
  };
}

// ── Batch analysis ────────────────────────────────────────────────────────────

export async function runFullCycle(runId: string) {
  await prisma.signalRun.update({
    where: { id: runId },
    data: {
      startedAt: new Date(),
      engineVersion: ENGINE_VERSION,
      featureVersion: FEATURE_VERSION,
      promptVersion: PROMPT_VERSION,
      status: "RUNNING",
      failureCode: null,
      failureReason: null,
      failureDetails: undefined,
    },
  });

  logEvent({
    runId,
    component: "signal-engine",
    message: "Signal cycle started",
    assetCount: ASSETS.length,
    rankThresholds: { S: 85, A: 70, B: 55 },
  });
  await recordAuditEvent({
    actor: "SYSTEM",
    action: "run_started",
    entityType: "SignalRun",
    entityId: runId,
    after: { status: "RUNNING" },
    correlationId: runId,
  });

  const cycleStartedAt = Date.now();
  const results = await Promise.allSettled(ASSETS.map(a => analyzeAsset(a, runId)));

  const fulfilled = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof analyzeAsset>>> =>
      r.status === "fulfilled"
    )
    .map(r => r.value);
  const signals = fulfilled.map(r => r.signal);
  const fetchPhaseCompletedAt = fulfilled.length > 0
    ? Math.max(...fulfilled.map(result => result.metrics.fetchCompletedAtMs))
    : cycleStartedAt;
  const scoringPhaseCompletedAt = fulfilled.length > 0
    ? Math.max(...fulfilled.map(result => result.metrics.scoringCompletedAtMs))
    : fetchPhaseCompletedAt;
  const persistencePhaseCompletedAt = fulfilled.length > 0
    ? Math.max(...fulfilled.map(result => result.metrics.persistedAtMs))
    : scoringPhaseCompletedAt;

  // Use wall-clock phase boundaries so run timings reflect operator-visible duration.
  const metrics = {
    dataFetchDurationMs: Math.max(0, fetchPhaseCompletedAt - cycleStartedAt),
    scoringDurationMs: Math.max(0, scoringPhaseCompletedAt - fetchPhaseCompletedAt),
    persistenceDurationMs: Math.max(0, persistencePhaseCompletedAt - scoringPhaseCompletedAt),
  };

  logEvent({
    runId,
    component: "signal-engine",
    message: "Run phase metrics calculated",
    cycleStartedAt,
    fetchPhaseCompletedAt,
    scoringPhaseCompletedAt,
    persistencePhaseCompletedAt,
    ...metrics,
  });

  // Map with original index so asset names are correct
  const errors = results
    .map((r, i) => ({ r, asset: ASSETS[i]?.symbol }))
    .filter(({ r }) => r.status === "rejected")
    .map(({ r, asset }) => ({ asset, reason: (r as PromiseRejectedResult).reason }));

  if (errors.length > 0) {
    await prisma.signalRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        totalDurationMs: Date.now() - cycleStartedAt,
        dataFetchDurationMs: metrics.dataFetchDurationMs,
        scoringDurationMs: metrics.scoringDurationMs,
        persistenceDurationMs: metrics.persistenceDurationMs,
        failureCode: classifyFailure(errors[0]?.reason),
        failureReason: errors.map(e => `${e.asset}: ${String(e.reason)}`).join(" | ").slice(0, 1000),
        failureDetails: errors.map(e => ({
          asset: e.asset,
          failureCode: classifyFailure(e.reason),
          reason: String(e.reason),
        })),
      },
    });

    for (const e of errors) {
      logEvent({
        runId,
        asset: e.asset,
        component: "signal-engine",
        severity: "ERROR",
        message: "Asset analysis failed",
        reason: String(e.reason),
      });
    }
    await recordAuditEvent({
      actor: "SYSTEM",
      action: "run_failed",
      entityType: "SignalRun",
      entityId: runId,
      after: {
        status: "FAILED",
        failureCode: classifyFailure(errors[0]?.reason),
        failureCount: errors.length,
      },
      correlationId: runId,
    });

    throw new Error(`Signal cycle failed for ${errors.length} asset(s)`);
  }

  await prisma.signalRun.update({
    where: { id: runId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      totalDurationMs: persistencePhaseCompletedAt - cycleStartedAt,
      dataFetchDurationMs: metrics.dataFetchDurationMs,
      scoringDurationMs: metrics.scoringDurationMs,
      persistenceDurationMs: metrics.persistenceDurationMs,
    },
  });

  logEvent({
    runId,
    component: "signal-engine",
    message: "Signal cycle completed",
    signalCount: signals.length,
  });
  console.log(`[apexEngine] Cycle complete. Scored ${signals.length} assets.`);
  await recordAuditEvent({
    actor: "SYSTEM",
    action: "run_completed",
    entityType: "SignalRun",
    entityId: runId,
    after: {
      status: "COMPLETED",
      signalCount: signals.length,
      totalDurationMs: Date.now() - cycleStartedAt,
    },
    correlationId: runId,
  });

  return { runId, signals, metrics };
}
