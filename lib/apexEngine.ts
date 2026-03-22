import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";
import { ENGINE_VERSION, FAILURE_CODES, FEATURE_VERSION, PROMPT_VERSION, type FailureCode } from "@/lib/runConfig";
import { buildTradePlans } from "@/lib/tradePlanner";
import { generateSignalNarrative } from "@/lib/llm/explanationService";
import type { Timeframe } from "@/lib/marketData/types";
import {
  applyTradePlanQualityGates,
  getStylePerformanceGateState,
  refreshTradePlanDiagnostics,
  resolveSignalProviderContext,
  type StylePerformanceGateState,
} from "@/lib/tradePlanDiagnostics";
import {
  fetchCryptoData,
  fetchForexData,
  fetchCommodityData,
  fetchMacroData,
  fetchNewsBundle,
  fetchTechnicals,
} from "@/lib/marketData";
import { SUPPORTED_ASSETS, type SupportedAsset } from "@/lib/assets";
import {
  deriveDirectionSMC,
  scoreMacroSMC,
  scoreStructureSMC,
  scoreZonesSMC,
  scoreTechnicalSMC,
  scoreTimingSMC,
  classifySmcFamily,
  meetsPublicationThreshold,
  calcRSI,
} from "@/lib/scoring/smcEngine";

// ── Asset universe ────────────────────────────────────────────────────────────

export const ASSETS = SUPPORTED_ASSETS;
export type Asset = SupportedAsset;
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
  closes: number[];
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

// ── Scoring is delegated to lib/scoring/smcEngine.ts ─────────────────────────

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

export async function analyzeAsset(
  asset: Asset,
  runId: string,
  gateState: StylePerformanceGateState,
  macroData: Awaited<ReturnType<typeof fetchMacroData>> | null
) {
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
    asset.assetClass === "CRYPTO"    ? asset.symbol.replace("USDT", "") :
    asset.assetClass === "COMMODITY" ? (asset.alphaSymbol === "XAU" ? "gold" : "silver") :
    asset.symbol;

  const [priceResult, newsResult] = await Promise.allSettled([
    // Price + candles
    // For FOREX: derive from/to from symbol (EURUSD → EUR + USD, USDJPY → USD + JPY)
    asset.assetClass === "CRYPTO"
      ? fetchCryptoData(asset.binanceSymbol!, { consumer: "signal-cycle", priority: "cold", allowBackgroundRefresh: false })
      : asset.assetClass === "FOREX"
        ? fetchForexData(asset.symbol.slice(0, 3), asset.symbol.slice(3, 6), { consumer: "signal-cycle", priority: "cold", allowBackgroundRefresh: false })
        : fetchCommodityData(asset.alphaSymbol!, { consumer: "signal-cycle", priority: "cold", allowBackgroundRefresh: false }),

    // News
    fetchNewsBundle(newsQuery, { consumer: "signal-cycle", priority: "cold", allowBackgroundRefresh: false }),
  ]);

  const priceData = priceResult.status === "fulfilled" ? priceResult.value : null;
  const newsBundle = newsResult.status === "fulfilled"
    ? newsResult.value
    : {
        articles: [],
        status: "UNAVAILABLE" as const,
        reason: "news_unavailable",
        degraded: true,
        sourceType: "fallback" as const,
        fetchedAt: null,
      };
  const newsData = newsBundle.articles;

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
    newsStatus: newsBundle.status,
  });

  // Technicals (needs closes from price data)
  const closes = (priceData as { closes?: number[] })?.closes ?? [];
  const techData = await fetchTechnicals(
    asset.symbol.replace("USDT", ""),
    asset.assetClass,
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
    assetClass: asset.assetClass,
    stale: Boolean((priceData as Record<string, unknown> | null)?.stale) || toNullableNumber((priceData as Record<string, unknown>)?.price) == null,
    closes,
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
    sentiment: asset.assetClass === "CRYPTO"
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

  // ── SMC direction derivation ───────────────────────────────────────────────
  const smcDirection = deriveDirectionSMC(
    dataSummary.closes,
    dataSummary.price.current!,
    asset.symbol,
    asset.assetClass,
    dataSummary.macro,
    dataSummary.sentiment,
  );

  const macroBias =
    asset.assetClass === "COMMODITY"
      ? "risk_off"
      : asset.assetClass === "CRYPTO"
        ? (dataSummary.technicals.trend === "uptrend" ? "risk_on" : "neutral")
        : (dataSummary.macro?.fedTrend === "falling" ? "risk_on" : dataSummary.macro?.fedTrend === "rising" ? "risk_off" : "neutral");

  const rawTradePlans = buildTradePlans(
    {
      asset: asset.symbol,
      assetClass: asset.assetClass,
      direction: smcDirection,
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
      marketStatus: ((priceData as Record<string, unknown> | null)?.marketStatus as "LIVE" | "DEGRADED" | "UNAVAILABLE" | undefined),
      providerFallbackUsed: Boolean((priceData as Record<string, unknown> | null)?.fallbackUsed),
      candleProviders: ((priceData as Record<string, unknown> | null)?.candleProviders as Partial<Record<Timeframe, {
        selectedProvider: string | null;
        fallbackUsed: boolean;
        freshnessMs: number | null;
        marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
        reason: string | null;
      }>> | undefined),
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
  const providerContext = await resolveSignalProviderContext(asset.assetClass, priceData);
  const tradePlans = applyTradePlanQualityGates(rawTradePlans, providerContext, gateState);

  const rankedPlans = [...tradePlans].sort((a, b) => {
    if (a.status === b.status) return b.setupScore - a.setupScore;
    if (a.status === "ACTIVE") return -1;
    if (b.status === "ACTIVE") return 1;
    return b.setupScore - a.setupScore;
  });
  const bestPlan = rankedPlans[0];
  const direction = bestPlan?.bias ?? smcDirection;

  // Only use plan breakdown scores when the plan is active (setupScore > 0).
  // Blocked plans have all-zero breakdowns, and ?? does not guard against 0,
  // so checking setupScore prevents silent zero-scoring on degraded data.
  const hasActivePlan = (bestPlan?.setupScore ?? 0) > 0;

  // ── SMC fallback scoring (Path A: no active plan) ─────────────────────────
  const smcRsi = dataSummary.technicals.rsi ?? calcRSI(dataSummary.closes);
  const structureResult = scoreStructureSMC(dataSummary.closes, dataSummary.price.current!, direction);

  const smcScores = {
    macro:     scoreMacroSMC(asset.symbol, asset.assetClass, dataSummary.macro, dataSummary.sentiment, direction),
    structure: structureResult.score,
    zones:     scoreZonesSMC(dataSummary.closes, dataSummary.price.current!, direction),
    technical: scoreTechnicalSMC(dataSummary.closes, smcRsi, direction),
    timing:    scoreTimingSMC(asset.assetClass, asset.symbol, dataSummary.news, direction),
  };

  const scores = hasActivePlan
    ? {
        macro:     bestPlan!.scoreBreakdown.regimeAlignment,
        structure: bestPlan!.scoreBreakdown.liquidityQuality,
        zones:     bestPlan!.scoreBreakdown.structureConfirmation,
        technical: Math.min(20, bestPlan!.scoreBreakdown.trapEdge + Math.ceil(bestPlan!.scoreBreakdown.entryPrecision / 2)),
        timing:    Math.min(20, bestPlan!.scoreBreakdown.riskReward + bestPlan!.scoreBreakdown.freshness + Math.floor(bestPlan!.scoreBreakdown.entryPrecision / 2)),
      }
    : smcScores;

  const smcTotal = Object.values(smcScores).reduce((a, b) => a + b, 0);
  const total = hasActivePlan ? bestPlan!.setupScore : smcTotal;

  // SMC publication threshold: must meet minimum criteria for non-Silent rank
  const passesThreshold = hasActivePlan || meetsPublicationThreshold(smcScores);
  const rankFromScore = bestPlan?.publicationRank ?? getRank(total);
  const rank = passesThreshold ? rankFromScore : "Silent";
  const levels = {
    entry: bestPlan?.entryMin != null && bestPlan.entryMax != null ? (bestPlan.entryMin + bestPlan.entryMax) / 2 : null,
    stopLoss: bestPlan?.stopLoss ?? null,
    tp1: bestPlan?.takeProfit1 ?? null,
    tp2: bestPlan?.takeProfit2 ?? null,
    tp3: bestPlan?.takeProfit3 ?? null,
  };
  const scoringDurationMs = Date.now() - scoringStartedAt;

  const narrativeStartedAt = Date.now();
  const smcFamily = !hasActivePlan
    ? classifySmcFamily(smcScores, {
        bullishBOS: structureResult.bullishBOS,
        bearishBOS: structureResult.bearishBOS,
        rsiDivBullish: false,
        rsiDivBearish: false,
      })
    : null;

  const deterministicBrief = fallbackBrief(asset, direction, scores, rank, levels, bestPlan ? {
    family: bestPlan.setupFamily,
    regimeTag: bestPlan.regimeTag,
    liquidityThesis: bestPlan.liquidityThesis,
    trapThesis: bestPlan.trapThesis,
  } : smcFamily ? {
    family: smcFamily,
    regimeTag: structureResult.bullishBOS ? "expansion" : structureResult.bearishBOS ? "expansion" : "range",
    liquidityThesis: `SMC scoring: BOS ${structureResult.bullishBOS ? "bullish" : structureResult.bearishBOS ? "bearish" : "none"}`,
    trapThesis: "",
  } : undefined);
  const userPrompt = `Write a concise trading brief in plain text only, max 120 words.

Asset: ${asset.symbol}
Class: ${asset.assetClass}
Direction: ${direction}
Rank: ${rank}
Scores: macro ${scores.macro}, structure ${scores.structure}, zones ${scores.zones}, technical ${scores.technical}, timing ${scores.timing}, total ${total}
SMC setup family: ${bestPlan?.setupFamily ?? smcFamily ?? "n/a"}
Regime: ${bestPlan?.regimeTag ?? "n/a"}
Entry: ${levels.entry ?? "n/a"}
Stop loss: ${levels.stopLoss ?? "n/a"}
TP1: ${levels.tp1 ?? "n/a"}
TP2: ${levels.tp2 ?? "n/a"}
TP3: ${levels.tp3 ?? "n/a"}
Deterministic context: ${deterministicBrief}
Market data: ${JSON.stringify(dataSummary)}

Cover conviction, strongest factors, invalidation, and execution discipline.`;
  const explanation = await generateSignalNarrative({
    template: {
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      direction,
      rank,
      style: bestPlan?.style ?? null,
      setupFamily: bestPlan?.setupFamily ?? null,
      regimeTag: bestPlan?.regimeTag ?? null,
      status: bestPlan?.status ?? "NO_SETUP",
      diagnostics: bestPlan?.diagnostics ?? [],
      provider: providerContext.providerAtSignal,
      providerHealthState: providerContext.providerHealthStateAtSignal,
      marketStatus: providerContext.providerMarketStatusAtSignal,
      fallbackUsed: providerContext.providerFallbackUsedAtSignal,
      freshnessClass: ((priceData as Record<string, unknown> | null)?.freshnessClass as "fresh" | "stale" | "expired" | null | undefined) ?? null,
      entry: levels.entry,
      stopLoss: levels.stopLoss,
      tp1: levels.tp1,
      tp2: levels.tp2,
      tp3: levels.tp3,
      reason: bestPlan?.status === "ACTIVE"
        ? bestPlan.executionNotes
        : bestPlan?.executionNotes ?? deterministicBrief,
    },
    prompt: {
      system: "You are APEX. Provide explanation text only. Do not alter the supplied scores or direction.",
      user: userPrompt,
      maxTokens: 220,
      requestId: asset.symbol,
    },
    mode: "auto",
  });
  const brief = explanation.text || deterministicBrief;

  if (explanation.status === "generated") {
    logEvent({
      runId,
      asset: asset.symbol,
      component: "explanation-engine",
      message: "Explanation generated",
      provider: explanation.provider,
      cached: explanation.cached,
    });
  } else if (explanation.status === "template") {
    logEvent({
      runId,
      asset: asset.symbol,
      component: "explanation-engine",
      severity: "WARN",
      message: "Deterministic explanation template used",
      provider: explanation.provider,
      reason: explanation.degradedReason,
      cached: explanation.cached,
    });
  } else {
    logEvent({
      runId,
      asset: asset.symbol,
      component: "explanation-engine",
      severity: "WARN",
      message: "Explanation unavailable after template/LLM fallback",
      reason: explanation.degradedReason,
      cached: explanation.cached,
    });
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
    setupFamily: bestPlan?.setupFamily ?? smcFamily ?? null,
    smcFamily: smcFamily ?? null,
    smcBullishBOS: structureResult.bullishBOS,
    smcBearishBOS: structureResult.bearishBOS,
    passesThreshold,
    regimeTag: bestPlan?.regimeTag ?? null,
  });

  // ── 4. Save to DB ─────────────────────────────────────────────────────────

  const signalData = {
    runId,
    asset:      asset.symbol,
    assetClass: asset.assetClass,
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
      newsMeta: {
        status: newsBundle.status,
        reason: newsBundle.reason,
        degraded: newsBundle.degraded,
        sourceType: newsBundle.sourceType,
        fetchedAt: newsBundle.fetchedAt,
      },
      strategy: {
        selectedStyle: bestPlan?.style ?? null,
        setupFamily: bestPlan?.setupFamily ?? null,
        regimeTag: bestPlan?.regimeTag ?? null,
        setupScore: bestPlan?.setupScore ?? total,
        status: bestPlan?.status ?? "NO_SETUP",
        breakdown: bestPlan?.scoreBreakdown ?? null,
        diagnostics: bestPlan?.diagnostics ?? [],
        providerContext,
        qualityGate: {
          degradedConfidenceFloor: gateState.degradedConfidenceFloor,
          byStyle: gateState.byStyle,
          qualityGateReason: bestPlan?.qualityGateReason ?? null,
        },
        tradePlans,
      },
      explanation: {
        provider: explanation.provider,
        fallbackUsed: explanation.fallbackUsed,
        status: explanation.status,
        degradedReason: explanation.degradedReason,
        cached: explanation.cached,
        fingerprint: explanation.fingerprint,
        chain: explanation.chain,
      },
    } as object,
  };

  const persistenceStartedAt = Date.now();
  const signal = await prisma.$transaction(async (tx: PersistenceTransaction) => {
    const createdSignal = await tx.signal.create({ data: signalData });
    const detectedAt = createdSignal.createdAt;
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
        providerAtSignal: plan.providerAtSignal,
        providerHealthStateAtSignal: plan.providerHealthStateAtSignal,
        providerMarketStatusAtSignal: plan.providerMarketStatusAtSignal,
        providerFallbackUsedAtSignal: plan.providerFallbackUsedAtSignal,
        qualityGateReason: plan.qualityGateReason,
        detectedAt,
        outcome: plan.status === "ACTIVE" ? "PENDING_ENTRY" : null,
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
  const gateState = await getStylePerformanceGateState();
  const macroResult = await fetchMacroData({ consumer: "signal-cycle", priority: "cold", allowBackgroundRefresh: false })
    .catch(error => {
      logEvent({
        runId,
        component: "signal-engine",
        severity: "WARN",
        message: "Macro fetch failed for cycle; using null macro context",
        reason: String(error),
      });
      return null;
    });
  const results = await Promise.allSettled(ASSETS.map(a => analyzeAsset(a, runId, gateState, macroResult)));

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

  try {
    await refreshTradePlanDiagnostics({ maxPlans: 400 });
  } catch (error) {
    logEvent({
      runId,
      component: "trade-plan-diagnostics",
      severity: "WARN",
      message: "Trade plan diagnostics refresh failed",
      reason: String(error),
    });
  }

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
