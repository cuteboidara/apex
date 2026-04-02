import { analyzeSMC } from "@/src/smc";
import { generateSignalReasoning } from "@/src/lib/apex-llm";
import type { SignalReasoningContext, SignalReasoningOutput } from "@/src/lib/apex-llm/types";
import { prisma } from "@/src/infrastructure/db/prisma";
import {
  INDEX_DISPLAY_NAMES,
  INDEX_PROFILES,
  INDICES_SYMBOLS,
  getIndexCategory,
  isIndexMarketOpen,
  type IndexCategory,
  type IndexSymbol,
} from "@/src/assets/indices/config/indicesScope";
import { fetchStooqIndexCandles, fetchStooqIndexPrice } from "@/src/assets/indices/data/StooqIndicesPlant";
import { fetchYahooChartCandles } from "@/src/assets/shared/YahooChartPlant";
import { analyzeIndexRegime } from "@/src/assets/indices/strategies/macroRegime";
import { scoreIndexAsset } from "@/src/assets/indices/strategies/indicesStrategy";
import type { IndexSignalCard } from "@/src/assets/indices/types";
import { runTopDownAnalysis } from "@/src/assets/shared/mtfAnalysis";
import { fetchMTFCandles } from "@/src/assets/shared/mtfDataFetcher";
import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";
import { rankProviderKeysForAsset } from "@/src/application/analytics/providerDiagnostics";
import { readPersistedMarketSymbol, readPersistedSignalModel } from "@/src/assets/shared/persistedSignalViewModel";
import {
  buildAssetViewModelBase,
  buildFallbackReasoning,
  buildTopDownReasoning,
  buildKeyLevelsFromCandles,
  buildSmcSummary,
  titleCase,
  type TradeLevels,
} from "@/src/assets/shared/signalView";

// Retained for future Polygon plan upgrades.
// import { INDEX_POLYGON_TICKERS } from "@/src/assets/indices/config/indicesScope";
// import { fetchPolygonCandles, fetchPolygonPrices } from "@/src/assets/shared/PolygonDataPlant";

const EXECUTABLE_GRADES = new Set(["B", "A", "S"]);
const CANDLE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type CachedIndexCandles = {
  candles: PolygonCandle[];
  source: "stooq" | "yahoo";
  fetchedAt: number;
};

const globalForIndicesEngine = globalThis as typeof globalThis & {
  __apexIndexCandles?: Map<IndexSymbol, CachedIndexCandles>;
};

const lastKnownCandles = globalForIndicesEngine.__apexIndexCandles ??= new Map<IndexSymbol, CachedIndexCandles>();

function formatIndexCategory(category: IndexCategory): string {
  return titleCase(category.toLowerCase());
}

function dataSourceLabel(source: IndexSignalCard["dataSource"]): string {
  switch (source) {
    case "stooq":
      return "STOOQ";
    case "yahoo":
      return "YAHOO";
    case "cached_stooq":
      return "CACHED STOOQ";
    case "cached_yahoo":
      return "CACHED YAHOO";
    default:
      return "DATA";
  }
}

function providerStatusFromSource(source: IndexSignalCard["dataSource"] | null): "healthy" | "fallback" | "stale" | "broken" {
  if (source === "stooq") {
    return "healthy";
  }
  if (source === "yahoo") {
    return "fallback";
  }
  if (source?.startsWith("cached_")) {
    return "stale";
  }
  return "broken";
}

export async function warmIndexProviders(): Promise<{
  symbol: IndexSymbol;
  dataSource: IndexSignalCard["dataSource"] | null;
  livePrice: number | null;
  candleCount: number;
}> {
  const symbol: IndexSymbol = "SPX";
  const candleResult = await fetchIndexCandlesWithFallback(symbol);
  const livePrice = await fetchIndexPriceWithFallback(symbol, candleResult);

  return {
    symbol,
    dataSource: candleResult.source,
    livePrice,
    candleCount: candleResult.candles.length,
  };
}

async function fetchIndexCandlesWithFallback(
  symbol: IndexSymbol,
): Promise<{ candles: PolygonCandle[]; source: IndexSignalCard["dataSource"] | null }> {
  const providerOrder = await rankProviderKeysForAsset("index", ["Stooq", "Yahoo"]);

  for (const provider of providerOrder) {
    if (provider === "Stooq") {
      try {
        const candles = await fetchStooqIndexCandles(symbol, 100);
        if (candles.length >= 20) {
          lastKnownCandles.set(symbol, {
            candles,
            source: "stooq",
            fetchedAt: Date.now(),
          });
          return { candles, source: "stooq" };
        }
      } catch (error) {
        console.warn(`[indices-engine] Stooq failed for ${symbol}:`, error);
      }
    }

    if (provider === "Yahoo") {
      try {
        const yahoo = await fetchYahooChartCandles(symbol, "1D", 100);
        if (yahoo.candles.length >= 20) {
          lastKnownCandles.set(symbol, {
            candles: yahoo.candles,
            source: "yahoo",
            fetchedAt: Date.now(),
          });
          return { candles: yahoo.candles, source: "yahoo" };
        }
      } catch (error) {
        console.warn(`[indices-engine] Yahoo fallback failed for ${symbol}:`, error);
      }
    }
  }

  const cached = lastKnownCandles.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_STALE_THRESHOLD_MS) {
    return {
      candles: cached.candles,
      source: cached.source === "stooq" ? "cached_stooq" : "cached_yahoo",
    };
  }

  return {
    candles: [],
    source: null,
  };
}

async function fetchIndexPriceWithFallback(
  symbol: IndexSymbol,
  candleResult: { candles: PolygonCandle[]; source: IndexSignalCard["dataSource"] | null },
): Promise<number | null> {
  const providerOrder = await rankProviderKeysForAsset("index", ["Stooq", "Yahoo"]);

  for (const provider of providerOrder) {
    if (provider === "Stooq") {
      try {
        const price = await fetchStooqIndexPrice(symbol);
        if (price != null) {
          return price;
        }
      } catch {
        // Continue.
      }
    }
  }

  return candleResult.candles[candleResult.candles.length - 1]?.close ?? null;
}

function deriveLevels(
  direction: IndexSignalCard["direction"],
  livePrice: number | null,
  analysis: ReturnType<typeof analyzeSMC>,
  volatile: boolean,
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
  const stopMultiplier = volatile ? 0.025 : 0.015;
  const sl = orderBlock
    ? direction === "buy"
      ? orderBlock.low * 0.999
      : orderBlock.high * 1.001
    : direction === "buy"
      ? entry * (1 - stopMultiplier)
      : entry * (1 + stopMultiplier);
  const distance = Math.abs(entry - sl);

  return {
    entry,
    sl,
    tp1: direction === "buy" ? entry + distance * 1.5 : entry - distance * 1.5,
    tp2: direction === "buy" ? entry + distance * 2.5 : entry - distance * 2.5,
    tp3: direction === "buy" ? entry + distance * 3.5 : entry - distance * 3.5,
  };
}

async function resolveReasoning(input: {
  symbol: IndexSymbol;
  displayName: string;
  direction: IndexSignalCard["direction"];
  grade: string;
  confidence: number;
  marketOpen: boolean;
  levels: TradeLevels;
  livePrice: number | null;
  noTradeReason: string | null;
  marketStateLabels: string[];
  analysis: ReturnType<typeof analyzeSMC>;
  regimeNote: string;
  setupType: string;
}): Promise<SignalReasoningOutput> {
  const fallback = buildFallbackReasoning({
    displayName: input.displayName,
    direction: input.direction,
    grade: input.grade,
    score: input.analysis.smcScore.total,
    contextLine: input.regimeNote,
    whyThisSetup: input.direction === "neutral"
      ? "The index regime and SMC structure are not aligned enough for a directional setup."
      : `${titleCase(input.direction)} structure is aligned with the current index regime.`,
    whyNow: input.marketOpen ? input.regimeNote : `The index market is closed. ${input.regimeNote}`,
    whyThisLevel: input.levels.entry != null
      ? `The level is anchored to the active OTE or order-block zone near ${input.levels.entry.toFixed(2)}.`
      : "No executable level is published until the regime and structure line up.",
    invalidation: input.levels.sl != null
      ? `Invalidation sits beyond the active structure at ${input.levels.sl.toFixed(2)}.`
      : "A fresh regime shift invalidates the watchlist idea.",
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
      session: input.marketOpen ? "market hours" : "market closed",
      bias: input.direction === "buy" ? "bullish" : input.direction === "sell" ? "bearish" : "neutral",
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
        cotBias: input.regimeNote,
        smcVerdict: input.analysis.smcScore.verdict,
        recentSweep: input.analysis.recentSweeps[0]?.reversal
          ? `${input.analysis.recentSweeps[0].side} sweep reversal`
          : null,
      },
    };
    return await generateSignalReasoning(context);
  } catch (error) {
    console.error(`[indices-engine] Reasoning failed for ${input.symbol}:`, error);
    return fallback;
  }
}

function readPersistedNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function inferDxyDirection(direction: unknown, bias: unknown): "up" | "down" | "flat" {
  if (direction === "buy") {
    return "up";
  }
  if (direction === "sell") {
    return "down";
  }
  if (typeof bias === "string") {
    const normalized = bias.toLowerCase();
    if (normalized.includes("bull")) {
      return "up";
    }
    if (normalized.includes("bear")) {
      return "down";
    }
  }
  return "flat";
}

async function loadIndexMacroContext(): Promise<{
  vixLevel: number | undefined;
  dxyDirection: "up" | "down" | "flat" | undefined;
}> {
  try {
    const rows = await prisma.signalViewModel.findMany({
      orderBy: {
        generated_at: "desc",
      },
      take: 300,
    });

    let vixLevel: number | undefined;
    let dxyDirection: "up" | "down" | "flat" | undefined;

    for (const row of rows) {
      const marketSymbol = readPersistedMarketSymbol(row.ui_sections);
      const model = readPersistedSignalModel(row.ui_sections);

      if (vixLevel == null && marketSymbol === "^VIX") {
        vixLevel = readPersistedNumber(model.livePrice) ?? readPersistedNumber(model.entry);
      }

      if (dxyDirection == null && marketSymbol === "DX-Y.NYB") {
        dxyDirection = inferDxyDirection(model.direction, model.bias);
      }

      if (vixLevel != null && dxyDirection != null) {
        break;
      }
    }

    return {
      vixLevel,
      dxyDirection,
    };
  } catch (error) {
    console.warn("[indices-engine] Failed to load VIX/DXY context:", error);
    return {
      vixLevel: undefined,
      dxyDirection: undefined,
    };
  }
}

export async function runIndicesCycle(cycleId: string): Promise<IndexSignalCard[]> {
  console.log(`[indices-engine] Starting cycle ${cycleId}`);

  const generatedAt = Date.now();
  const macroContext = await loadIndexMacroContext();
  const cards: IndexSignalCard[] = [];

  for (const symbol of INDICES_SYMBOLS) {
    try {
      const candleResult = await fetchIndexCandlesWithFallback(symbol);
      const candles = candleResult.candles;
      if (candles.length < 30) {
        console.log(`[APEX INDICES] ${symbol}: insufficient candles (${candles.length}) from ${candleResult.source ?? "none"}`);
        continue;
      }

      console.log(
        `[APEX INDICES] ${symbol}: ${candles.length} candles fetched from ${candleResult.source ?? "none"}, scoring...`,
      );
      const livePrice = await fetchIndexPriceWithFallback(symbol, candleResult);
      if (livePrice == null) {
        console.log(`[APEX INDICES] ${symbol}: null live price after candle fetch`);
        continue;
      }
      const marketOpen = isIndexMarketOpen(symbol);
      const category = getIndexCategory(symbol);
      const regime = analyzeIndexRegime(candles);
      const mtfCandles = await fetchMTFCandles(symbol);
      const mtfResult = runTopDownAnalysis(symbol, mtfCandles, livePrice);
      const direction = mtfResult?.direction === "LONG"
        ? "buy"
        : mtfResult?.direction === "SHORT"
          ? "sell"
          : "neutral";
      const confidence = (mtfResult?.confidence ?? 0) / 100;
      const smcResult = analyzeSMC(symbol, candles, livePrice, direction);
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
        formatIndexCategory(category),
        dataSourceLabel(candleResult.source ?? "stooq"),
        marketOpen ? "Market Open" : "Market Closed",
        titleCase(regime.regime.replaceAll("_", " ")),
        mtfResult?.entryTimeframe ? `${mtfResult.entryTimeframe} confirmation` : "awaiting sweep",
        mtfResult?.premiumDiscount.zone ? titleCase(mtfResult.premiumDiscount.zone) : null,
        macroContext.vixLevel != null ? `VIX ${macroContext.vixLevel.toFixed(1)}` : null,
        macroContext.dxyDirection ? `DXY ${macroContext.dxyDirection}` : null,
      ].filter(Boolean) as string[];
      const displayName = INDEX_DISPLAY_NAMES[symbol];
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
          contextLine: regime.regimeNote,
          whyThisSetup: "No index setup is published until HTF bias, MTF zone selection, and LTF sweep confirmation align.",
          whyNow: regime.regimeNote,
          whyThisLevel: "No executable structure-based level is published until the sweep confirmation closes.",
          invalidation: "Wait for the next healthy cycle.",
          noTradeExplanation: noTradeReason,
        });
      const smcAnalysis = buildSmcSummary(smcResult, marketOpen ? "Market Hours" : "Market Closed");
      const dataFreshnessMs = candles[candles.length - 1]?.time != null
        ? Math.max(0, generatedAt - (candles[candles.length - 1]!.time * 1000))
        : null;
      const base = buildAssetViewModelBase({
        idPrefix: "index_view",
        symbol: displayName,
        cycleId,
        generatedAt,
        displayCategory,
        livePrice,
        tradeLevels: levels,
        direction,
        grade,
        gradeScore,
        setupType,
        session: marketOpen ? "Market Hours" : "Market Closed",
        bias: direction === "buy" ? "bullish" : direction === "sell" ? "bearish" : "neutral",
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
        uiVersion: "index_signal_view_v1",
        providerStatus,
        priceSource: candleResult.source,
        candleSource: candleResult.source,
        fallbackDepth: providerStatus === "healthy" ? 0 : providerStatus === "broken" ? 2 : 1,
        dataFreshnessMs,
        missingBarCount: Math.max(0, 100 - candles.length),
        lastSuccessfulProvider: candleResult.source,
        quoteIntegrity: livePrice != null,
        dataTrustScore: providerStatus === "healthy" ? 88 : providerStatus === "fallback" ? 52 : providerStatus === "stale" ? 30 : 8,
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
          assetClass: "index",
          marketSymbol: symbol,
          displayName,
          category,
          categoryLabel: formatIndexCategory(category),
          priceFormat: "fixed_2",
          badges: marketStateLabels,
          regime: regime.regime,
          regimeNote: regime.regimeNote,
          dataSource: candleResult.source ?? "stooq",
          vixLevel: macroContext.vixLevel ?? null,
          dxyDirection: macroContext.dxyDirection ?? null,
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
        assetClass: "index",
        marketSymbol: symbol,
        displayName,
        category,
        marketOpen,
        regime: regime.regime,
        regimeNote: regime.regimeNote,
        dataSource: candleResult.source ?? "stooq",
      });
    } catch (error) {
      console.error(`[indices-engine] Failed for ${symbol}:`, error);
    }
  }

  console.log(`[indices-engine] Cycle complete - ${cards.length} cards`);
  return cards;
}
