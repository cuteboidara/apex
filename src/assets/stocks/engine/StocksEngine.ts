import { generateSignalReasoning } from "@/src/lib/apex-llm";
import type { SignalReasoningContext, SignalReasoningOutput } from "@/src/lib/apex-llm/types";
import { analyzeEarningsContext } from "@/src/assets/stocks/strategies/earningsStrategy";
import { scoreStockAsset } from "@/src/assets/stocks/strategies/stocksStrategy";
import { analyzeStockSMC } from "@/src/assets/stocks/strategies/stockSMC";
import { analyzeTrend } from "@/src/assets/stocks/strategies/trendStrategy";
import {
  ALL_STOCK_SYMBOLS,
  DEFAULT_STOCK_PROFILE,
  STOCK_DISPLAY_NAMES,
  getStockCategory,
  isStockMarketOpen,
  type StockCategory,
  type StockSymbol,
} from "@/src/assets/stocks/config/stocksScope";
import type { StockSignalCard } from "@/src/assets/stocks/types";
import { preferredProviderWarmupSymbol } from "@/src/assets/shared/providerHealth";
import type { EarningsEvent, PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";
import { runTopDownAnalysis } from "@/src/assets/shared/mtfAnalysis";
import { fetchMTFCandles } from "@/src/assets/shared/mtfDataFetcher";
import { fetchYahooBars } from "@/src/lib/yahooFinance";
import {
  buildAssetViewModelBase,
  buildFallbackReasoning,
  buildTopDownReasoning,
  buildKeyLevelsFromCandles,
  buildSmcSummary,
  titleCase,
  type TradeLevels,
} from "@/src/assets/shared/signalView";

const EXECUTABLE_GRADES = new Set(["B", "A", "S"]);
const STOCK_CACHE_TTL_MS = 48 * 60 * 60 * 1000;

type StockDataSource = StockSignalCard["dataSource"];
type StockProviderSummary = {
  status: "healthy" | "degraded" | "broken" | "no_data";
  notice: string | null;
};
type CachedStockCandles = {
  candles: PolygonCandle[];
  source: "yahoo_day";
  fetchedAt: number;
};
type StocksEngineState = {
  lastKnownCandles: Map<StockSymbol, CachedStockCandles>;
  providerSummary: StockProviderSummary;
};

const globalForStocksEngine = globalThis as typeof globalThis & {
  __apexStocksEngineState?: StocksEngineState;
};

const stocksEngineState = globalForStocksEngine.__apexStocksEngineState ??= {
  lastKnownCandles: new Map<StockSymbol, CachedStockCandles>(),
  providerSummary: {
    status: "no_data",
    notice: "Run a stocks cycle to populate provider status.",
  },
};

function formatCategory(category: StockCategory): string {
  return titleCase(category.replaceAll("_", " ").toLowerCase());
}

function dataSourceLabel(source: StockDataSource): string {
  switch (source) {
    case "yahoo_day":
      return "YAHOO 1D";
    case "cached_yahoo_day":
      return "CACHED YAHOO";
    default:
      return "NO DATA";
  }
}

export function getStocksProviderSummary(): StockProviderSummary {
  return stocksEngineState.providerSummary;
}

function updateStocksProviderSummary(summary: StockProviderSummary): void {
  stocksEngineState.providerSummary = summary;
}

export async function runStocksProviderWarmup(): Promise<{
  ok: boolean;
  symbol: StockSymbol;
  livePrice: number | null;
  candleCount: number;
}> {
  const warmupSymbol = (preferredProviderWarmupSymbol("stock") ?? "AAPL") as StockSymbol;
  const yahooBars = await fetchYahooBars(warmupSymbol, "1d").catch(() => null);
  const yahooPrice = yahooBars?.values.at(-1)?.close ?? null;
  const yahooCount = yahooBars?.values.length ?? 0;
  const ok = yahooPrice != null || yahooCount > 0;
  updateStocksProviderSummary(
    ok
      ? {
        status: "healthy",
        notice: "Stocks are running on Yahoo Finance daily candles.",
      }
      : {
        status: "broken",
        notice: `Yahoo Finance stock preflight failed for ${warmupSymbol}; cycle blocked before full symbol fanout.`,
      },
  );

  return {
    ok,
    symbol: warmupSymbol,
    livePrice: yahooPrice,
    candleCount: yahooCount,
  };
}

async function fetchYahooStockCandles(symbol: StockSymbol): Promise<PolygonCandle[]> {
  const bars = await fetchYahooBars(symbol, "1d");
  if (!bars) {
    return [];
  }
  return bars.values.map(bar => ({
    time: Math.floor(new Date(bar.datetime).getTime() / 1000),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  })).filter(candle => Number.isFinite(candle.close) && candle.close > 0);
}

async function fetchStockCandlesWithFallback(
  symbol: StockSymbol,
): Promise<{ candles: PolygonCandle[]; source: StockDataSource }> {
  const yahooCandles = await fetchYahooStockCandles(symbol);
  if (yahooCandles.length >= 20) {
    stocksEngineState.lastKnownCandles.set(symbol, {
      candles: yahooCandles,
      source: "yahoo_day",
      fetchedAt: Date.now(),
    });
    return { candles: yahooCandles, source: "yahoo_day" };
  }

  const cached = stocksEngineState.lastKnownCandles.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < STOCK_CACHE_TTL_MS) {
    return {
      candles: cached.candles,
      source: "cached_yahoo_day",
    };
  }

  return { candles: [], source: "none" };
}

function summarizeStocksProvider(cards: StockSignalCard[]): StockProviderSummary {
  if (cards.length === 0) {
    return {
      status: "no_data",
      notice: "Stocks returned no usable cards in the latest cycle.",
    };
  }

  if (cards.every(card => card.providerStatus === "broken")) {
    return {
      status: "broken",
      notice: "Stock publication is blocked because Yahoo Finance did not return trustworthy price or candle data.",
    };
  }

  if (cards.some(card => card.providerStatus !== "healthy")) {
    return {
      status: "degraded",
      notice: "Stock analysis is using cached Yahoo candles; publication is capped accordingly.",
    };
  }

  return {
    status: "healthy",
    notice: "Stocks are running on Yahoo Finance daily candles.",
  };
}

function deriveDirection(input: {
  pdLocation: string;
  trendDirection: "bullish" | "bearish" | "neutral";
  trendStrength: "strong" | "moderate" | "weak";
  smcVerdict: string;
}): { direction: StockSignalCard["direction"]; confidence: number } {
  let bullishScore = 0;
  let bearishScore = 0;

  if (input.pdLocation === "discount") {
    bullishScore += 30;
  }
  if (input.pdLocation === "premium") {
    bearishScore += 30;
  }

  if (input.trendDirection === "bullish") {
    bullishScore += input.trendStrength === "strong" ? 35 : 20;
  }
  if (input.trendDirection === "bearish") {
    bearishScore += input.trendStrength === "strong" ? 35 : 20;
  }

  if (input.smcVerdict === "strong_confluence") {
    if (bullishScore >= bearishScore) {
      bullishScore += 15;
    } else {
      bearishScore += 15;
    }
  }

  const spread = Math.abs(bullishScore - bearishScore);
  const direction = bullishScore > bearishScore + 20
    ? "buy"
    : bearishScore > bullishScore + 20
      ? "sell"
      : "neutral";

  return {
    direction,
    confidence: Math.min(0.88, 0.45 + (spread / 100) * 0.5),
  };
}

function deriveLevels(
  direction: StockSignalCard["direction"],
  livePrice: number | null,
  analysis: ReturnType<typeof analyzeStockSMC>,
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
  let entry = livePrice;
  if (analysis.ote?.currentPriceInOTE) {
    entry = analysis.ote.fib_705;
  }

  const sl = orderBlock
    ? direction === "buy"
      ? orderBlock.low * 0.999
      : orderBlock.high * 1.001
    : direction === "buy"
      ? entry * 0.97
      : entry * 1.03;
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
  symbol: StockSymbol;
  displayName: string;
  category: StockCategory;
  direction: StockSignalCard["direction"];
  grade: string;
  confidence: number;
  marketOpen: boolean;
  levels: TradeLevels;
  livePrice: number | null;
  noTradeReason: string | null;
  marketStateLabels: string[];
  trend: ReturnType<typeof analyzeTrend>;
  analysis: ReturnType<typeof analyzeStockSMC>;
  earningsNote: string;
  setupType: string;
}): Promise<SignalReasoningOutput> {
  const fallback = buildFallbackReasoning({
    displayName: input.displayName,
    direction: input.direction,
    grade: input.grade,
    score: input.analysis.smcScore.total,
    contextLine: `${formatCategory(input.category)} stock, trend ${input.trend.direction} (${input.trend.strength}). ${input.earningsNote}`.trim(),
    whyThisSetup: input.direction === "neutral"
      ? "SMC structure and trend are not aligned enough for a directional stock entry."
      : `${titleCase(input.direction)} continuation is supported by the current trend and SMC structure.`,
    whyNow: input.marketOpen
      ? `The market is open and ${formatCategory(input.category)} order flow is active. ${input.earningsNote}`
      : `The market is closed, so the setup is carried as monitored context only. ${input.earningsNote}`,
    whyThisLevel: input.levels.entry != null
      ? `The entry is anchored to the active OTE or order-block zone near ${input.levels.entry.toFixed(2)}.`
      : "No executable level is published until structure and confidence align.",
    invalidation: input.levels.sl != null
      ? `Invalidation sits beyond the active order block at ${input.levels.sl.toFixed(2)}.`
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
      session: input.marketOpen ? formatCategory(input.category) : "market closed",
      bias: input.trend.direction,
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
        killzone: input.marketOpen ? "market hours" : "market closed",
        pdLocation: input.analysis.pdArrays.currentLocation,
        inOTE: input.analysis.ote?.currentPriceInOTE ?? false,
        cotBias: `trend ${input.trend.direction} (${input.trend.strength})`,
        smcVerdict: input.analysis.smcScore.verdict,
        recentSweep: input.analysis.recentSweeps[0]?.reversal
          ? `${input.analysis.recentSweeps[0].side} sweep reversal`
          : null,
      },
    };
    return await generateSignalReasoning(context);
  } catch (error) {
    console.error(`[stocks-engine] Reasoning failed for ${input.symbol}:`, error);
    return fallback;
  }
}

function providerStatusFromSource(source: StockDataSource): "healthy" | "fallback" | "stale" | "broken" {
  if (source === "yahoo_day") {
    return "healthy";
  }
  if (source.startsWith("cached_")) {
    return "stale";
  }
  return "broken";
}

function forceWatchlistForSource(source: StockDataSource): boolean {
  return source === "yahoo_day" || source.startsWith("cached_");
}

function buildUnavailableStockCard(input: {
  symbol: StockSymbol;
  category: StockCategory;
  cycleId: string;
  generatedAt: number;
  marketOpen: boolean;
  dataSource: StockDataSource;
  livePrice: number | null;
  candles: PolygonCandle[];
  noTradeReason: string;
}): StockSignalCard {
  const displayName = STOCK_DISPLAY_NAMES[input.symbol];
  const marketStateLabels = [
    formatCategory(input.category),
    input.marketOpen ? "Market Open" : "Market Closed",
    dataSourceLabel(input.dataSource),
  ];
  const reasoning = buildFallbackReasoning({
    displayName,
    direction: "neutral",
    grade: "F",
    score: 0,
    contextLine: input.noTradeReason,
    whyThisSetup: "Stock publication is blocked until price and candle integrity recover.",
    whyNow: input.noTradeReason,
    whyThisLevel: "No executable level is published without trustworthy stock market data.",
    invalidation: "Wait for the next healthy Yahoo stock cycle.",
    noTradeExplanation: input.noTradeReason,
  });
  const base = buildAssetViewModelBase({
    idPrefix: "stock_view",
    symbol: input.symbol,
    cycleId: input.cycleId,
    generatedAt: input.generatedAt,
    displayCategory: "rejected",
    livePrice: input.livePrice,
    tradeLevels: { entry: null, sl: null, tp1: null, tp2: null, tp3: null },
    direction: "neutral",
    grade: "F",
    gradeScore: 0,
    setupType: "stock data unavailable",
    session: input.marketOpen ? formatCategory(input.category) : "Market Closed",
    bias: "neutral",
    structure: "unavailable",
    liquidityState: "no sweep",
    location: "equilibrium",
    zoneType: "neutral",
    marketPhase: "Unavailable",
    confidence: 0,
    reasoning,
    marketStateLabels,
    noTradeReason: input.noTradeReason,
    blockedReasons: [input.noTradeReason],
    status: "blocked",
    keyLevels: input.candles.length > 0
      ? buildKeyLevelsFromCandles(input.candles, analyzeStockSMC(input.symbol, input.candles, input.livePrice, "neutral"))
      : { pdh: null, pdl: null, sessionHigh: null, sessionLow: null },
    riskStatus: "rejected",
    headline: `${input.symbol} data blocked`,
    uiVersion: "stock_signal_view_v1",
    providerStatus: providerStatusFromSource(input.dataSource),
    priceSource: input.dataSource === "none" ? null : "yahoo",
    candleSource: input.dataSource === "none" ? null : "yahoo",
    fallbackDepth: input.dataSource === "cached_yahoo_day" ? 1 : input.dataSource === "none" ? 2 : 0,
    dataFreshnessMs: input.candles[input.candles.length - 1]?.time != null
      ? Math.max(0, input.generatedAt - (input.candles[input.candles.length - 1]!.time * 1000))
      : null,
    missingBarCount: Math.max(0, 100 - input.candles.length),
    lastSuccessfulProvider: input.dataSource === "none" ? null : "yahoo",
    quoteIntegrity: input.livePrice != null,
    dataTrustScore: input.dataSource === "none" ? 8 : input.dataSource.startsWith("cached_") ? 32 : 48,
    publicationStatus: "blocked",
    publicationReasons: input.livePrice == null ? ["BROKEN_MARKET_DATA", "NULL_PRICE"] : ["BROKEN_MARKET_DATA"],
    moduleHealth: "broken",
    uiSections: {
      assetClass: "stock",
      marketSymbol: input.symbol,
      displayName,
      category: input.category,
      categoryLabel: formatCategory(input.category),
      priceFormat: "fixed_2",
      badges: marketStateLabels,
      dataSource: input.dataSource,
    },
  });

  return {
    ...base,
    assetClass: "stock",
    marketSymbol: input.symbol,
    displayName,
    category: input.category,
    dataSource: input.dataSource,
    marketOpen: input.marketOpen,
    trendDirection: "neutral",
    trendStrength: "weak",
    ema20: 0,
    ema50: 0,
    ema200: 0,
    momentum: 0,
    earningsSetup: "none",
    earningsNote: "No earnings context because market data is unavailable.",
    daysUntilEarnings: null,
  };
}

export async function runStocksCycle(cycleId: string): Promise<StockSignalCard[]> {
  console.log(`[stocks-engine] Starting cycle ${cycleId}`);

  const generatedAt = Date.now();
  const earningsEvents: EarningsEvent[] = [];
  const cards: StockSignalCard[] = [];

  for (const symbol of ALL_STOCK_SYMBOLS) {
    try {
      const category = getStockCategory(symbol);
      const marketOpen = isStockMarketOpen(category);
      const candleResult = await fetchStockCandlesWithFallback(symbol);
      const candles = candleResult.candles;
      const livePrice = candles[candles.length - 1]?.close ?? null;

      if (candles.length < 50 || livePrice == null) {
        console.log(
          `[APEX STOCKS] ${symbol}: insufficient inputs (candles=${candles.length}, livePrice=${livePrice ?? "null"}, source=${candleResult.source})`,
        );
        cards.push(buildUnavailableStockCard({
          symbol,
          category,
          cycleId,
          generatedAt,
          marketOpen,
          dataSource: candleResult.source,
          livePrice,
          candles,
          noTradeReason: candles.length < 20 ? "insufficient stock candles" : "null stock price",
        }));
        continue;
      }

      console.log(
        `[APEX STOCKS] ${symbol}: ${candles.length} candles fetched from ${candleResult.source}, scoring...`,
      );
      const trend = analyzeTrend(candles);
      const mtfCandles = await fetchMTFCandles(symbol);
      const mtfResult = livePrice == null ? null : runTopDownAnalysis(symbol, mtfCandles, livePrice);
      const direction = mtfResult?.direction === "LONG"
        ? "buy"
        : mtfResult?.direction === "SHORT"
          ? "sell"
          : "neutral";
      const confidence = (mtfResult?.confidence ?? 0) / 100;
      const smcResult = analyzeStockSMC(symbol, candles, livePrice, direction);
      const earnings = analyzeEarningsContext(symbol, candles, earningsEvents, trend.direction);
      const grade = mtfResult?.grade ?? "F";
      const gradeScore = mtfResult?.confluenceScore ?? mtfResult?.confidence ?? 0;
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
      const providerStatus = providerStatusFromSource(candleResult.source);
      const noTradeReason = !marketOpen
        ? "market closed"
        : candleResult.source.startsWith("cached_")
          ? "stale data"
        : mtfResult == null
          ? "insufficient candles"
        : direction === "neutral"
          ? "awaiting liquidity sweep"
          : !EXECUTABLE_GRADES.has(grade)
            ? "low confluence"
            : null;
      const displayCategory = providerStatus === "broken"
        ? "rejected"
        : noTradeReason == null && providerStatus === "healthy"
          ? "executable"
          : "monitored";
      const status = displayCategory === "executable" ? "active" : displayCategory === "rejected" ? "blocked" : "watchlist";
      const marketStateLabels = [
        formatCategory(category),
        marketOpen ? "Market Open" : "Market Closed",
        dataSourceLabel(candleResult.source),
        titleCase(trend.direction),
        mtfResult?.entryTimeframe ? `${mtfResult.entryTimeframe} confirmation` : "awaiting sweep",
        mtfResult?.premiumDiscount.zone ? titleCase(mtfResult.premiumDiscount.zone) : null,
        earnings.setupType !== "none" ? titleCase(earnings.setupType.replaceAll("_", " ")) : null,
      ].filter(Boolean) as string[];
      const setupType = mtfResult?.setupType.replaceAll("_", " ") ?? "awaiting liquidity sweep";
      const displayName = STOCK_DISPLAY_NAMES[symbol];
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
          contextLine: `${formatCategory(category)} stock, trend ${trend.direction} (${trend.strength}). ${earnings.note}`.trim(),
          whyThisSetup: "No setup is published until HTF bias, MTF zone selection, and LTF sweep confirmation align.",
          whyNow: marketOpen
            ? `The market is open, but the stock is still waiting for a sweep-confirmed 5m/15m entry. ${earnings.note}`.trim()
            : `The market is closed, so the setup remains monitored only. ${earnings.note}`.trim(),
          whyThisLevel: "No executable structure-based level is published until the sweep confirmation closes.",
          invalidation: "Wait for the next healthy cycle.",
          noTradeExplanation: noTradeReason,
        });
      const smcAnalysis = buildSmcSummary(smcResult, marketOpen ? "Market Hours" : "Market Closed");
      const dataFreshnessMs = candles[candles.length - 1]?.time != null
        ? Math.max(0, generatedAt - (candles[candles.length - 1]!.time * 1000))
        : null;
      const base = buildAssetViewModelBase({
        idPrefix: "stock_view",
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
        session: marketOpen ? formatCategory(category) : "Market Closed",
        bias: trend.direction,
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
        headline: `${symbol} ${direction === "neutral" ? "watchlist" : direction.toUpperCase()} read`,
        uiVersion: "stock_signal_view_v1",
        providerStatus,
        priceSource: candleResult.source === "none" ? null : "yahoo",
        candleSource: candleResult.source === "none" ? null : "yahoo",
        fallbackDepth: candleResult.source === "cached_yahoo_day" ? 1 : candleResult.source === "none" ? 2 : 0,
        dataFreshnessMs,
        missingBarCount: Math.max(0, 100 - candles.length),
        lastSuccessfulProvider: candleResult.source === "none" ? null : "yahoo",
        quoteIntegrity: livePrice != null,
        dataTrustScore: candleResult.source === "none" ? 8 : candleResult.source.startsWith("cached_") ? 42 : 58,
        publicationStatus: displayCategory === "executable"
          ? "publishable"
          : displayCategory === "rejected"
            ? "blocked"
            : candleResult.source.startsWith("cached_")
              ? "shadow_only"
              : "watchlist_only",
        publicationReasons: displayCategory === "executable"
          ? []
          : displayCategory === "rejected"
            ? ["BROKEN_MARKET_DATA", "NULL_PRICE"]
            : candleResult.source.startsWith("cached_")
              ? ["FALLBACK_PROVIDER"]
              : ["LOW_CONFIDENCE"],
        moduleHealth: providerStatus === "healthy" ? "working" : providerStatus === "broken" ? "broken" : "degraded",
        uiSections: {
          assetClass: "stock",
          marketSymbol: symbol,
          displayName,
          category,
          categoryLabel: formatCategory(category),
          priceFormat: "fixed_2",
          badges: marketStateLabels,
          dataSource: candleResult.source,
          timeframe: mtfResult?.entryTimeframe ?? "15m",
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
        assetClass: "stock",
        marketSymbol: symbol,
        displayName,
        category,
        dataSource: candleResult.source,
        marketOpen,
        trendDirection: trend.direction,
        trendStrength: trend.strength,
        ema20: trend.ema20,
        ema50: trend.ema50,
        ema200: trend.ema200,
        momentum: trend.momentum,
        earningsSetup: earnings.setupType,
        earningsNote: earnings.note,
        daysUntilEarnings: earnings.daysUntilEarnings,
      });
    } catch (error) {
      console.error(`[stocks-engine] Failed for ${symbol}:`, error);
    }
  }

  updateStocksProviderSummary(summarizeStocksProvider(cards));
  console.log(`[stocks-engine] Cycle complete - ${cards.length} cards`);
  return cards;
}
