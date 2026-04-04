import { analyzeSMC } from "@/src/smc";
import { generateSignalReasoning } from "@/src/lib/apex-llm";
import type { SignalReasoningContext, SignalReasoningOutput } from "@/src/lib/apex-llm/types";
import {
  ALL_COMMODITY_SYMBOLS,
  COMMODITY_DISPLAY_NAMES,
  COMMODITY_PROFILES,
  getCommodityCategory,
  type CommodityCategory,
  type CommoditySymbol,
} from "@/src/assets/commodities/config/commoditiesScope";
import {
  scoreCommodityMTF,
  type CommodityCategory as StrategyCommodityCategory,
  type CommodityMTFData,
} from "@/src/assets/commodities/strategies/commoditiesStrategy";
import type { CommoditySignalCard } from "@/src/assets/commodities/types";
import { runTopDownAnalysis } from "@/src/assets/shared/mtfAnalysis";
import { fetchMTFCandles } from "@/src/assets/shared/mtfDataFetcher";
import { fetchYahooChartCandles } from "@/src/assets/shared/YahooChartPlant";
import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";
import type { Candle } from "@/src/assets/shared/types";
import {
  buildAssetViewModelBase,
  buildFallbackReasoning,
  buildTopDownReasoning,
  buildKeyLevelsFromCandles,
  buildSmcSummary,
  titleCase,
  type TradeLevels,
} from "@/src/assets/shared/signalView";

const CANDLE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type CommodityDataSource = CommoditySignalCard["dataSource"];
type CachedCommodityCandles = {
  candles: PolygonCandle[];
  source: "yahoo";
  fetchedAt: number;
};
type CommodityProviderSummary = {
  status: "healthy" | "degraded_cached" | "no_data";
  notice: string | null;
};
type CommodityEngineState = {
  lastKnownCandles: Map<CommoditySymbol, CachedCommodityCandles>;
  lastProviderSummary: CommodityProviderSummary;
};

const globalForCommodityEngine = globalThis as typeof globalThis & {
  __apexCommodityEngineState?: CommodityEngineState;
};

const engineState = globalForCommodityEngine.__apexCommodityEngineState ??= {
  lastKnownCandles: new Map<CommoditySymbol, CachedCommodityCandles>(),
  lastProviderSummary: {
    status: "no_data",
    notice: "Run a commodities cycle to populate provider status.",
  },
};

function formatCommodityCategory(category: CommodityCategory): string {
  return category === "PRECIOUS_METALS" ? "Precious Metals" : "Energy";
}

function dataSourceLabel(source: CommodityDataSource): string {
  switch (source) {
    case "yahoo":
      return "Yahoo";
    case "cached_yahoo":
      return "Cached Yahoo";
    default:
      return "No Source";
  }
}

function formatStrategyCategory(category: StrategyCommodityCategory): string {
  return titleCase(category);
}

function mapStrategyDirection(direction: "LONG" | "SHORT" | "NEUTRAL"): CommoditySignalCard["direction"] {
  if (direction === "LONG") {
    return "buy";
  }
  if (direction === "SHORT") {
    return "sell";
  }
  return "neutral";
}

function mapMacroDirectionBias(direction: "LONG" | "SHORT" | "NEUTRAL"): CommoditySignalCard["macroDirectionBias"] {
  if (direction === "LONG") {
    return "bullish";
  }
  if (direction === "SHORT") {
    return "bearish";
  }
  return "neutral";
}

function providerStatusFromSource(source: CommodityDataSource): "healthy" | "fallback" | "stale" | "broken" {
  if (source === "yahoo") {
    return "healthy";
  }
  if (source.startsWith("cached_")) {
    return "stale";
  }
  return "broken";
}

function updateProviderSummary(summary: CommodityProviderSummary): void {
  engineState.lastProviderSummary = summary;
}

export function getCommodityProviderSummary(): CommodityProviderSummary {
  return engineState.lastProviderSummary;
}

export async function warmCommodityProviders(): Promise<{
  symbol: CommoditySymbol;
  candleSource: CommodityDataSource;
  priceSource: CommodityDataSource;
  livePrice: number | null;
  candleCount: number;
}> {
  const symbol: CommoditySymbol = "XAUUSD";
  const candleResult = await fetchCommodityCandlesWithFallback(symbol);
  const priceResult = await fetchCommodityPriceWithFallback(symbol, candleResult);

  return {
    symbol,
    candleSource: candleResult.source,
    priceSource: priceResult.source,
    livePrice: priceResult.price,
    candleCount: candleResult.candles.length,
  };
}

async function fetchCommodityCandlesWithFallback(
  symbol: CommoditySymbol,
): Promise<{ candles: PolygonCandle[]; source: CommodityDataSource }> {
  try {
    const yahoo = await fetchYahooChartCandles(symbol, "1D", 100);
    if (yahoo.candles.length >= 20) {
      engineState.lastKnownCandles.set(symbol, {
        candles: yahoo.candles,
        source: "yahoo",
        fetchedAt: Date.now(),
      });
      return { candles: yahoo.candles, source: "yahoo" };
    }
  } catch (error) {
    console.warn(`[commodities] Yahoo failed for ${symbol}:`, error);
  }

  const lastKnown = engineState.lastKnownCandles.get(symbol);
  if (lastKnown && Date.now() - lastKnown.fetchedAt < CANDLE_STALE_THRESHOLD_MS) {
    return {
      candles: lastKnown.candles,
      source: "cached_yahoo",
    };
  }

  console.error(`[commodities] Yahoo failed for ${symbol} - no candles available`);
  return {
    candles: [],
    source: "none",
  };
}

async function fetchCommodityPriceWithFallback(
  symbol: CommoditySymbol,
  candleResult: { candles: PolygonCandle[]; source: CommodityDataSource },
): Promise<{ price: number | null; source: CommodityDataSource }> {
  if (candleResult.source !== "none") {
    return {
      price: candleResult.candles[candleResult.candles.length - 1]?.close ?? null,
      source: candleResult.source,
    };
  }

  return {
    price: null,
    source: "none",
  };
}

async function fetchDXYCandles(): Promise<Candle[]> {
  try {
    const response = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=60d",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
        },
        cache: "no-store",
      },
    );
    if (!response.ok) {
      return [];
    }

    const payload = await response.json() as {
      chart?: {
        result?: Array<{
          timestamp?: Array<number | null>;
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }> | null;
      };
    };

    const result = payload.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    if (!quote || timestamps.length === 0) {
      return [];
    }

    return timestamps.map((timestamp, index) => ({
      time: (timestamp ?? 0) * 1000,
      open: quote.open?.[index] ?? 0,
      high: quote.high?.[index] ?? 0,
      low: quote.low?.[index] ?? 0,
      close: quote.close?.[index] ?? 0,
      volume: quote.volume?.[index] ?? 0,
    })).filter(candle => Number.isFinite(candle.close) && candle.close > 0);
  } catch {
    return [];
  }
}

function deriveLevels(
  direction: CommoditySignalCard["direction"],
  livePrice: number | null,
  analysis: ReturnType<typeof analyzeSMC>,
): TradeLevels {
  if (direction === "neutral" || livePrice == null) {
    return {
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null,
    };
  }

  const orderBlock = analysis.orderBlocks.find(block =>
    direction === "buy" ? block.type === "bullish" : block.type === "bearish",
  );
  const entry = analysis.ote?.currentPriceInOTE ? analysis.ote.fib_705 : livePrice;
  const sl = orderBlock
    ? direction === "buy"
      ? orderBlock.low * 0.999
      : orderBlock.high * 1.001
    : direction === "buy"
      ? entry * 0.985
      : entry * 1.015;
  const distance = Math.abs(entry - sl);

  return {
    entry,
    sl,
    tp1: direction === "buy" ? entry + distance * 1.5 : entry - distance * 1.5,
    tp2: direction === "buy" ? entry + distance * 2.5 : entry - distance * 2.5,
    tp3: direction === "buy" ? entry + distance * 4 : entry - distance * 4,
  };
}

async function resolveReasoning(input: {
  symbol: CommoditySymbol;
  displayName: string;
  direction: CommoditySignalCard["direction"];
  grade: string;
  confidence: number;
  levels: TradeLevels;
  livePrice: number | null;
  noTradeReason: string | null;
  marketStateLabels: string[];
  analysis: ReturnType<typeof analyzeSMC>;
  macroNote: string;
  macroDirectionBias: "bullish" | "bearish" | "neutral";
  setupType: string;
}): Promise<SignalReasoningOutput> {
  const fallback = buildFallbackReasoning({
    displayName: input.displayName,
    direction: input.direction,
    grade: input.grade,
    score: input.analysis.smcScore.total,
    contextLine: input.macroNote,
    whyThisSetup: input.direction === "neutral"
      ? "SMC structure and macro bias are not aligned enough for a commodity entry."
      : `${titleCase(input.direction)} commodity flow is supported by both SMC and the current macro overlay.`,
    whyNow: input.macroNote,
    whyThisLevel: input.levels.entry != null
      ? `The level is anchored to the active OTE or order-block zone near ${input.levels.entry.toFixed(2)}.`
      : "No executable level is published until commodity structure firms up.",
    invalidation: input.levels.sl != null
      ? `Invalidation sits beyond the active commodity structure at ${input.levels.sl.toFixed(2)}.`
      : "A fresh structural break invalidates the watchlist idea.",
    noTradeExplanation: input.noTradeReason,
  });

  if (process.env.APEX_DISABLE_LLM === "true" || !process.env.ANTHROPIC_API_KEY) {
    return fallback;
  }

  try {
    const context: SignalReasoningContext = {
      symbol: input.displayName,
      direction: input.direction,
      grade: input.grade,
      setupType: input.setupType,
      session: "market hours",
      bias: input.macroDirectionBias,
      structure: input.analysis.orderBlocks[0]?.type ?? "none",
      liquidityState: input.analysis.recentSweeps[0]?.reversal ? "liquidity sweep" : "neutral",
      location: input.analysis.pdArrays.currentLocation,
      zoneType: input.direction === "buy" ? "demand" : input.direction === "sell" ? "supply" : "neutral",
      marketPhase: input.analysis.smcScore.verdict,
      confidence: input.confidence,
      entry: input.levels.entry,
      sl: input.levels.sl,
      tp1: input.levels.tp1,
      tp2: input.levels.tp2,
      livePrice: input.livePrice,
      noTradeReason: input.noTradeReason,
      blockedReasons: [],
      vetoes: [],
      podVoteSummary: null,
      marketStateLabels: input.marketStateLabels,
      keyLevels: {
        pdh: null,
        pdl: null,
        sessionHigh: null,
        sessionLow: null,
      },
      smcContext: {
        orderBlock: input.analysis.orderBlocks[0]
          ? `${input.analysis.orderBlocks[0].type} OB ${input.analysis.orderBlocks[0].low.toFixed(2)}-${input.analysis.orderBlocks[0].high.toFixed(2)}`
          : null,
        fvg: input.analysis.fairValueGaps[0]
          ? `${input.analysis.fairValueGaps[0].type} FVG ${input.analysis.fairValueGaps[0].lower.toFixed(2)}-${input.analysis.fairValueGaps[0].upper.toFixed(2)}`
          : null,
        killzone: "market hours",
        pdLocation: input.analysis.pdArrays.currentLocation,
        inOTE: input.analysis.ote?.currentPriceInOTE ?? false,
        cotBias: input.macroDirectionBias,
        smcVerdict: input.analysis.smcScore.verdict,
        recentSweep: input.analysis.recentSweeps[0]?.reversal
          ? `${input.analysis.recentSweeps[0].side} sweep reversal`
          : null,
      },
    };
    return await generateSignalReasoning(context);
  } catch (error) {
    console.error(`[commodities-engine] Reasoning failed for ${input.symbol}:`, error);
    return fallback;
  }
}

function summarizeProviderSources(cards: CommoditySignalCard[]): CommodityProviderSummary {
  if (cards.length === 0) {
    return {
      status: "no_data",
      notice: "Yahoo Finance returned no usable commodity data in the latest cycle.",
    };
  }

  if (cards.some(card => card.dataSource.startsWith("cached"))) {
    return {
      status: "degraded_cached",
      notice: "Commodity analysis is using cached Yahoo candles because live data was unavailable.",
    };
  }

  return {
    status: "healthy",
    notice: "Commodities are running on Yahoo Finance.",
  };
}

export async function runCommoditiesCycle(cycleId: string): Promise<CommoditySignalCard[]> {
  console.log(`[commodities-engine] Starting cycle ${cycleId}`);

  const generatedAt = Date.now();
  const cards: CommoditySignalCard[] = [];
  const dxyCandles = await fetchDXYCandles();
  console.log(`[APEX COMMODITIES] DXY candles fetched: ${dxyCandles.length}`);

  for (const symbol of ALL_COMMODITY_SYMBOLS) {
    try {
      const candleResult = await fetchCommodityCandlesWithFallback(symbol);
      const priceResult = await fetchCommodityPriceWithFallback(symbol, candleResult);
      const candles = candleResult.candles;
      const livePrice = priceResult.price ?? candles[candles.length - 1]?.close ?? null;

      if (candles.length < 30 || livePrice == null) {
        console.log(
          `[APEX COMMODITIES] ${symbol}: insufficient inputs (candles=${candles.length}, livePrice=${livePrice ?? "null"}, source=${candleResult.source})`,
        );
        continue;
      }

      console.log(
        `[APEX COMMODITIES] ${symbol}: ${candles.length} candles fetched from ${candleResult.source}, scoring...`,
      );
      const dataSource = candleResult.source !== "none" ? candleResult.source : priceResult.source;
      const category = getCommodityCategory(symbol);
      const mtfRaw = await fetchMTFCandles(symbol);
      const mtf: CommodityMTFData = {
        weekly: mtfRaw.weekly,
        daily: mtfRaw.daily,
        h4: mtfRaw.h4,
        h1: mtfRaw.h1,
        dxy: dxyCandles,
      };
      console.log(
        `[APEX COMMODITIES] ${symbol}: weekly=${mtf.weekly.length} daily=${mtf.daily.length} h4=${mtf.h4.length} h1=${mtf.h1.length} dxy=${dxyCandles.length}, running institutional scoring...`,
      );

      const mtfResult = livePrice == null ? null : runTopDownAnalysis(symbol, mtfRaw, livePrice);
      const direction = mtfResult?.direction === "LONG"
        ? "buy"
        : mtfResult?.direction === "SHORT"
          ? "sell"
          : "neutral";
      const confidence = (mtfResult?.confidence ?? 0) / 100;
      const smcResult = analyzeSMC(symbol, candles, livePrice, direction);
      const profile = COMMODITY_PROFILES[symbol];
      const grade = mtfResult?.grade ?? "F";
      const gradeScore = mtfResult?.confluenceScore ?? mtfResult?.confidence ?? 0;
      const meetsProfileGate = mtfResult != null
        && direction !== "neutral"
        && mtfResult.promotionStatus === "active"
        && (mtfResult.confidence / 100) >= profile.minConfidence
        && (mtfResult.riskReward ?? 0) >= profile.minRR;
      const levels = mtfResult && direction !== "neutral"
        ? {
          entry: mtfResult.entry,
          sl: mtfResult.stopLoss,
          tp1: mtfResult.takeProfit,
          tp2: mtfResult.takeProfit2 ?? null,
          tp3: null,
        }
        : {
          entry: null,
          sl: null,
          tp1: null,
          tp2: null,
          tp3: null,
        };
      const providerStatus = providerStatusFromSource(dataSource);
      const noTradeReason = mtfResult == null
        ? "insufficient candles"
        : mtfResult.promotionStatus === "waiting_for_rr"
          ? "RR below threshold"
        : mtfResult.promotionStatus === "ranging_bias"
            ? "mixed higher-timeframe bias"
        : direction === "neutral"
            ? "awaiting liquidity sweep"
            : !meetsProfileGate
              ? "low confluence"
              : null;
      const displayCategory = providerStatus === "broken"
        ? "rejected"
        : noTradeReason == null && providerStatus === "healthy"
          ? "executable"
          : "monitored";
      const status = displayCategory === "executable" ? "active" : displayCategory === "rejected" ? "blocked" : "watchlist";
      const macroDirectionBias = direction === "buy" ? "bullish" : direction === "sell" ? "bearish" : "neutral";
      const macroNote = mtfResult?.htfBiasSummary ?? "Commodity bias is waiting on aligned higher-timeframe structure.";
      const marketStateLabels = Array.from(new Set([
        formatCommodityCategory(category),
        dataSourceLabel(dataSource),
        mtfResult?.entryTimeframe ? `${mtfResult.entryTimeframe} confirmation` : "awaiting sweep",
        mtfResult?.premiumDiscount.zone ? titleCase(mtfResult.premiumDiscount.zone) : null,
        titleCase(smcResult.pdArrays.currentLocation),
        titleCase(macroDirectionBias),
      ].filter((label): label is string => label != null && label !== "Neutral")));
      const displayName = COMMODITY_DISPLAY_NAMES[symbol];
      const setupType = mtfResult?.setupType.replaceAll("_", " ") ?? "awaiting liquidity sweep";
      const reasoning = mtfResult
        ? buildTopDownReasoning({
          displayName,
          result: mtfResult,
          noTradeReason,
        })
        : buildFallbackReasoning({
          displayName,
          direction,
          grade,
          score: smcResult.smcScore.total,
          contextLine: macroNote,
          whyThisSetup: "No commodity setup is published until HTF bias, MTF zone selection, and LTF sweep confirmation align.",
          whyNow: macroNote,
          whyThisLevel: "No executable structure-based level is published until the sweep confirmation closes.",
          invalidation: "Wait for the next healthy cycle.",
          noTradeExplanation: noTradeReason,
        });
      const smcAnalysis = buildSmcSummary(smcResult, "Market Hours");
      const dataFreshnessMs = candles[candles.length - 1]?.time != null
        ? Math.max(0, generatedAt - (candles[candles.length - 1]!.time * 1000))
        : null;
      const base = buildAssetViewModelBase({
        idPrefix: "commodity_view",
        symbol,
        cycleId,
        generatedAt,
        displayCategory,
        livePrice,
        tradeLevels: levels,
        direction,
        grade,
        gradeScore,
        setupType,
        session: "Market Hours",
        bias: macroDirectionBias,
        structure: smcResult.orderBlocks[0]?.type ?? "neutral",
        liquidityState: smcResult.recentSweeps[0]?.reversal ? "liquidity sweep" : "no sweep",
        location: smcResult.pdArrays.currentLocation,
        zoneType: direction === "buy" ? "demand" : direction === "sell" ? "supply" : "neutral",
        marketPhase: mtfResult?.setupType === "liquidity_sweep_reversal" ? "Pullback" : titleCase(smcResult.smcScore.verdict.replaceAll("_", " ")),
        confidence,
        entryTimeframe: mtfResult?.entryTimeframe ?? null,
        tp1RiskReward: mtfResult?.riskReward ?? null,
        tp2RiskReward: mtfResult?.riskReward2 ?? null,
        htfBiasSummary: mtfResult?.htfBiasSummary ?? null,
        liquiditySweepDescription: mtfResult?.liquiditySweepDescription ?? null,
        confluenceScore: mtfResult?.confluenceScore ?? null,
        reasoning,
        smcAnalysis,
        marketStateLabels,
        noTradeReason,
        blockedReasons: noTradeReason ? [noTradeReason] : [],
        status,
        keyLevels: buildKeyLevelsFromCandles(candles, smcResult),
        riskStatus: displayCategory === "executable" ? "approved" : displayCategory === "rejected" ? "rejected" : "deferred",
        headline: `${displayName} ${direction === "neutral" ? "watchlist" : direction.toUpperCase()} read`,
        uiVersion: "commodity_signal_view_v1",
        providerStatus,
        priceSource: dataSource === "none" ? null : dataSource,
        candleSource: dataSource === "none" ? null : dataSource,
        fallbackDepth: providerStatus === "healthy" ? 0 : providerStatus === "broken" ? 2 : 1,
        dataFreshnessMs,
        missingBarCount: Math.max(0, 100 - candles.length),
        lastSuccessfulProvider: dataSource === "none" ? null : dataSource,
        quoteIntegrity: livePrice != null,
        dataTrustScore: providerStatus === "healthy" ? 90 : providerStatus === "fallback" ? 56 : providerStatus === "stale" ? 34 : 8,
        publicationStatus: displayCategory === "executable"
          ? "publishable"
          : displayCategory === "rejected"
            ? "blocked"
            : providerStatus === "healthy"
              ? "watchlist_only"
              : "shadow_only",
        publicationReasons: displayCategory === "executable"
          ? []
          : providerStatus === "healthy"
            ? ["LOW_CONFIDENCE"]
            : providerStatus === "broken"
              ? ["BROKEN_MARKET_DATA"]
              : ["FALLBACK_PROVIDER"],
        moduleHealth: providerStatus === "healthy" ? "working" : providerStatus === "broken" ? "broken" : "degraded",
        uiSections: {
          assetClass: "commodity",
          marketSymbol: symbol,
          displayName,
          category,
          categoryLabel: formatCommodityCategory(category),
          priceFormat: "fixed_2",
          badges: marketStateLabels,
          macroNote,
          dataSource,
          timeframe: mtfResult?.entryTimeframe ?? "15m",
          commodityMacro: {
            category: category.toLowerCase(),
            weeklyBias: mtfResult?.weeklyBias ?? "ranging",
            dailyBias: mtfResult?.dailyBias ?? "ranging",
            h4Bias: mtfResult?.h4Bias ?? "ranging",
            seasonal: "structure-led",
            dxyContext: dxyCandles.length > 0 ? "contextual" : "unavailable",
            entryTrigger: mtfResult?.entryTrigger ?? "none",
            riskReward: mtfResult?.riskReward ?? null,
          },
          topDown: mtfResult
            ? {
              entryTimeframe: mtfResult.entryTimeframe ?? mtfResult.timeframe,
              tp1RiskReward: mtfResult.riskReward,
              tp2RiskReward: mtfResult.riskReward2 ?? null,
              htfBiasSummary: mtfResult.htfBiasSummary ?? null,
              liquiditySweepDescription: mtfResult.liquiditySweepDescription ?? null,
              confluenceScore: mtfResult.confluenceScore ?? mtfResult.confidence,
              autoAlert: mtfResult.grade === "S" || mtfResult.grade === "A",
            }
            : null,
        },
      });

      cards.push({
        ...base,
        assetClass: "commodity",
        marketSymbol: symbol,
        displayName,
        category,
        macroNote,
        macroDirectionBias,
        dataSource,
      });
    } catch (error) {
      console.error(`[commodities-engine] Failed for ${symbol}:`, error);
    }
  }

  updateProviderSummary(summarizeProviderSources(cards));
  console.log(`[commodities-engine] Cycle complete - ${cards.length} cards`);
  return cards;
}
