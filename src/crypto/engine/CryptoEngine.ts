import type { SignalViewModel, SignalViewModelSMC } from "@/src/domain/models/signalPipeline";
import { createId } from "@/src/lib/ids";
import { generateSignalReasoning } from "@/src/lib/apex-llm";
import type { SignalReasoningContext, SignalReasoningOutput } from "@/src/lib/apex-llm/types";
import { TelegramNotifier } from "@/src/lib/telegram";
import { analyzeSMC } from "@/src/smc";
import type { Candle, SMCAnalysis } from "@/src/smc/types";
import {
  CRYPTO_ACTIVE_SYMBOLS,
  CRYPTO_DISPLAY_NAMES,
  CRYPTO_PAIR_PROFILES,
  getCryptoVolatilityWindow,
  isCryptoWeekend,
  type CryptoPairProfile,
  type CryptoSymbol,
  type CryptoVolatilityWindow,
} from "@/src/crypto/config/cryptoScope";
import { fetchCryptoTickerPrice } from "@/src/crypto/data/CryptoDataPlant";
import { getAllCryptoLivePrices } from "@/src/crypto/data/BinanceWebSocket";
import type { CryptoSignalCard } from "@/src/crypto/types";
import type { MTFAnalysisResult, MTFCandles } from "@/src/assets/shared/mtfAnalysis";
import { runTopDownAnalysis } from "@/src/assets/shared/mtfAnalysis";
import { fetchMTFCandles } from "@/src/assets/shared/mtfDataFetcher";
import { prepareSignalViewModelForPersistence } from "@/src/assets/shared/persistedSignalViewModel";
import { buildTopDownReasoning } from "@/src/assets/shared/signalView";

type SignalDecision = {
  direction: SignalViewModel["direction"];
  confidence: number;
  score: number;
};

type TradeLevels = Pick<SignalViewModel, "entry" | "sl" | "tp1" | "tp2" | "tp3">;

const EXECUTABLE_GRADES = new Set(["B", "A", "S"]);

function titleCase(value: string): string {
  return value
    .split(" ")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatVolatilityWindow(window: CryptoVolatilityWindow): string {
  return titleCase(window.replaceAll("_", " "));
}

function nextVolatilityWindow(window: CryptoVolatilityWindow): CryptoVolatilityWindow {
  if (window === "asian_open") return "london_cross";
  if (window === "london_cross") return "ny_open";
  if (window === "ny_open") return "late_us";
  if (window === "late_us") return "low_volume";
  return "asian_open";
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "high conviction";
  if (confidence >= 0.65) return "actionable";
  if (confidence >= 0.5) return "developing";
  return "early";
}

function buildMarketStateLabels(
  window: CryptoVolatilityWindow,
  analysis: SMCAnalysis | null,
  timestamp: Date,
): string[] {
  const labels = [
    "24/7",
    formatVolatilityWindow(window),
  ];

  if (isCryptoWeekend(timestamp)) {
    labels.push("Weekend");
  }

  if (analysis) {
    labels.push(titleCase(analysis.smcScore.verdict.replaceAll("_", " ")));
    if (analysis.ote?.currentPriceInOTE) {
      labels.push("OTE");
    }
  }

  return Array.from(new Set(labels));
}

function buildCryptoSmcSummary(analysis: SMCAnalysis, window: CryptoVolatilityWindow): SignalViewModelSMC {
  return {
    nearestOrderBlock: analysis.orderBlocks[0]
      ? {
        type: analysis.orderBlocks[0].type,
        high: analysis.orderBlocks[0].high,
        low: analysis.orderBlocks[0].low,
        strength: analysis.orderBlocks[0].strength,
      }
      : null,
    nearestFVG: analysis.fairValueGaps[0]
      ? {
        type: analysis.fairValueGaps[0].type,
        upper: analysis.fairValueGaps[0].upper,
        lower: analysis.fairValueGaps[0].lower,
        fillPercent: analysis.fairValueGaps[0].fillPercent,
      }
      : null,
    nearestBreaker: analysis.breakerBlocks[0]
      ? {
        type: analysis.breakerBlocks[0].type,
        high: analysis.breakerBlocks[0].high,
        low: analysis.breakerBlocks[0].low,
      }
      : null,
    recentLiquiditySweep: analysis.recentSweeps[0]
      ? {
        side: analysis.recentSweeps[0].side,
        reversal: analysis.recentSweeps[0].reversal,
        reversalStrength: analysis.recentSweeps[0].reversalStrength,
      }
      : null,
    killzone: formatVolatilityWindow(window),
    minutesToNextKillzone: analysis.killzone.minutesUntilNextKillzone,
    nextKillzone: formatVolatilityWindow(nextVolatilityWindow(window)),
    asianRangeHigh: analysis.killzone.asianRangeHigh,
    asianRangeLow: analysis.killzone.asianRangeLow,
    inOTE: analysis.ote?.currentPriceInOTE ?? false,
    oteLevels: analysis.ote
      ? {
        fib62: analysis.ote.fib_62,
        fib705: analysis.ote.fib_705,
        fib79: analysis.ote.fib_79,
      }
      : null,
    pdLocation: analysis.pdArrays.currentLocation,
    pdPercent: analysis.pdArrays.currentPricePercent,
    cotBias: analysis.cot?.smartMoneyBias ?? "unavailable",
    cotStrength: analysis.cot?.smartMoneyBiasStrength ?? "unavailable",
    cotDivergence: analysis.cot?.divergence ?? false,
    smcScore: analysis.smcScore.total,
    smcVerdict: analysis.smcScore.verdict,
  };
}

function deriveCryptoSignal(analysis: SMCAnalysis, livePrice: number | null): SignalDecision {
  if (livePrice == null) {
    return {
      direction: "neutral",
      confidence: 0,
      score: 0,
    };
  }

  let bullishScore = 0;
  let bearishScore = 0;

  if (analysis.pdArrays.currentLocation === "discount") {
    bullishScore += 25;
  }
  if (analysis.pdArrays.currentLocation === "premium") {
    bearishScore += 25;
  }

  const recentBuysideSweep = analysis.recentSweeps.find(sweep => sweep.side === "buyside" && sweep.reversal);
  const recentSellsideSweep = analysis.recentSweeps.find(sweep => sweep.side === "sellside" && sweep.reversal);
  if (recentBuysideSweep) {
    bearishScore += recentBuysideSweep.reversalStrength === "strong" ? 30 : 20;
  }
  if (recentSellsideSweep) {
    bullishScore += recentSellsideSweep.reversalStrength === "strong" ? 30 : 20;
  }

  const bullishOrderBlock = analysis.orderBlocks.find(orderBlock =>
    orderBlock.type === "bullish"
    && livePrice >= orderBlock.low
    && livePrice <= orderBlock.high,
  );
  const bearishOrderBlock = analysis.orderBlocks.find(orderBlock =>
    orderBlock.type === "bearish"
    && livePrice >= orderBlock.low
    && livePrice <= orderBlock.high,
  );
  if (bullishOrderBlock) {
    bullishScore += bullishOrderBlock.strength === "strong" ? 25 : 15;
  }
  if (bearishOrderBlock) {
    bearishScore += bearishOrderBlock.strength === "strong" ? 25 : 15;
  }

  if (analysis.ote?.currentPriceInOTE) {
    if (analysis.ote.direction === "bullish") {
      bullishScore += 20;
    }
    if (analysis.ote.direction === "bearish") {
      bearishScore += 20;
    }
  }

  const dominantScore = Math.max(bullishScore, bearishScore);
  const direction = bullishScore > bearishScore + 15
    ? "buy"
    : bearishScore > bullishScore + 15
      ? "sell"
      : "neutral";

  return {
    direction,
    confidence: Math.min(0.9, dominantScore / 100),
    score: dominantScore,
  };
}

function deriveGrade(score: number, confidence: number): { grade: string; gradeScore: number } {
  const gradeScore = Math.round((score * 0.6) + (confidence * 100 * 0.4));
  if (gradeScore >= 92) return { grade: "S+", gradeScore };
  if (gradeScore >= 84) return { grade: "S", gradeScore };
  if (gradeScore >= 75) return { grade: "A", gradeScore };
  if (gradeScore >= 66) return { grade: "B", gradeScore };
  if (gradeScore >= 56) return { grade: "C", gradeScore };
  if (gradeScore >= 46) return { grade: "D", gradeScore };
  return { grade: "F", gradeScore };
}

function deriveTradeLevels(
  direction: SignalViewModel["direction"],
  livePrice: number | null,
  analysis: SMCAnalysis,
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

  const orderBlock = analysis.orderBlocks.find(order =>
    direction === "buy" ? order.type === "bullish" : order.type === "bearish",
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
      ? entry * 0.985
      : entry * 1.015;

  const stopDistance = Math.abs(entry - sl);
  return {
    entry,
    sl,
    tp1: direction === "buy" ? entry + (stopDistance * 1.5) : entry - (stopDistance * 1.5),
    tp2: direction === "buy" ? entry + (stopDistance * 2.5) : entry - (stopDistance * 2.5),
    tp3: direction === "buy" ? entry + (stopDistance * 4) : entry - (stopDistance * 4),
  };
}

function describeNoTradeReason(noTradeReason: string | null): string | null {
  if (noTradeReason === "data unavailable") {
    return "Live Binance price or Yahoo MTF candle data is not available yet, so the crypto setup stays blocked until inputs recover.";
  }
  if (noTradeReason === "no structure") {
    return "The higher and lower timeframe map does not offer a clean aligned directional imbalance yet, so the pair remains on watch.";
  }
  if (noTradeReason === "low confidence") {
    return "SMC confluence is present but still below the configured confidence floor for an executable crypto alert.";
  }
  return noTradeReason;
}

function buildSignalReasoningContext(input: {
  symbol: CryptoSymbol;
  displayName: string;
  direction: SignalViewModel["direction"];
  grade: string;
  confidence: number;
  levels: TradeLevels;
  livePrice: number | null;
  noTradeReason: string | null;
  marketStateLabels: string[];
  analysis: SMCAnalysis;
  window: CryptoVolatilityWindow;
}): SignalReasoningContext {
  const summary = buildCryptoSmcSummary(input.analysis, input.window);
  return {
    symbol: input.displayName,
    direction: input.direction,
    grade: input.grade,
    setupType: "smc crypto",
    session: formatVolatilityWindow(input.window),
    bias: input.direction === "buy" ? "bullish" : input.direction === "sell" ? "bearish" : "neutral",
    structure: summary.nearestOrderBlock ? `${summary.nearestOrderBlock.type} order block` : "no clear order block",
    liquidityState: summary.recentLiquiditySweep?.reversal ? "liquidity sweep" : "neutral",
    location: summary.pdLocation,
    zoneType: input.direction === "buy" ? "demand" : input.direction === "sell" ? "supply" : "neutral",
    marketPhase: titleCase(summary.smcVerdict.replaceAll("_", " ")),
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
      sessionHigh: summary.asianRangeHigh,
      sessionLow: summary.asianRangeLow,
    },
    smcContext: {
      orderBlock: summary.nearestOrderBlock
        ? `${summary.nearestOrderBlock.type} OB ${summary.nearestOrderBlock.low.toFixed(2)}-${summary.nearestOrderBlock.high.toFixed(2)}`
        : null,
      fvg: summary.nearestFVG
        ? `${summary.nearestFVG.type} FVG ${summary.nearestFVG.lower.toFixed(2)}-${summary.nearestFVG.upper.toFixed(2)}`
        : null,
      killzone: summary.killzone,
      pdLocation: summary.pdLocation,
      inOTE: summary.inOTE,
      cotBias: summary.cotBias,
      smcVerdict: summary.smcVerdict,
      recentSweep: summary.recentLiquiditySweep
        ? `${summary.recentLiquiditySweep.side} ${summary.recentLiquiditySweep.reversal ? "reversal" : "sweep"}`
        : null,
    },
  };
}

async function resolveReasoning(input: {
  symbol: CryptoSymbol;
  direction: SignalViewModel["direction"];
  grade: string;
  confidence: number;
  livePrice: number | null;
  levels: TradeLevels;
  noTradeReason: string | null;
  marketStateLabels: string[];
  analysis: SMCAnalysis;
  window: CryptoVolatilityWindow;
}): Promise<SignalReasoningOutput> {
  const displayName = CRYPTO_DISPLAY_NAMES[input.symbol];
  const fallbackNoTradeExplanation = describeNoTradeReason(input.noTradeReason);
  const fallback: SignalReasoningOutput = {
    shortReasoning: `${displayName} ${input.direction === "neutral" ? "is still shaping structure" : `${input.direction.toUpperCase()} structure is in play`} with SMC confluence at ${input.analysis.smcScore.total}/100.`,
    detailedReasoning: `${displayName} is trading inside the ${formatVolatilityWindow(input.window)} window with ${titleCase(input.analysis.smcScore.verdict.replaceAll("_", " "))} structure.`,
    whyThisSetup: input.direction === "neutral"
      ? "Order flow does not yet show a decisive bullish or bearish imbalance."
      : `The active ${input.direction === "buy" ? "demand" : "supply"} context is supported by the latest SMC confluence cluster.`,
    whyNow: `This pair is currently in the ${formatVolatilityWindow(input.window)} volatility window where crypto participation tends to be strongest.`,
    whyThisLevel: input.levels.entry != null
      ? "The entry is anchored to the current OTE/order-block zone instead of chasing open-air price."
      : "No executable entry is published until structure firms up.",
    invalidation: input.levels.sl != null
      ? "Invalidation sits just beyond the active order block so the idea fails quickly if structure breaks."
      : "A fresh structural break against the setup invalidates the watchlist bias.",
    whyThisGrade: `The grade combines the SMC score and confidence, landing at ${input.grade} for the current cycle.`,
    marketStructureSummary: `${titleCase(input.analysis.smcScore.verdict.replaceAll("_", " "))} structure in ${input.analysis.pdArrays.currentLocation}.`,
    liquiditySummary: input.analysis.recentSweeps[0]?.reversal
      ? "Recent liquidity sweep reversal is supporting the read."
      : "No recent reversal sweep is adding extra confirmation yet.",
    keyLevelsSummary: input.levels.entry != null
      ? `Entry ${input.levels.entry.toFixed(2)}, stop ${input.levels.sl?.toFixed(2) ?? "n/a"}, TP1 ${input.levels.tp1?.toFixed(2) ?? "n/a"}.`
      : "Executable levels are not published until the setup clears the confidence floor.",
    noTradeExplanation: fallbackNoTradeExplanation,
  };

  if (process.env.APEX_DISABLE_LLM === "true" || !process.env.ANTHROPIC_API_KEY) {
    return fallback;
  }

  try {
    return await generateSignalReasoning(buildSignalReasoningContext({
      symbol: input.symbol,
      displayName,
      direction: input.direction,
      grade: input.grade,
      confidence: input.confidence,
      levels: input.levels,
      livePrice: input.livePrice,
      noTradeReason: input.noTradeReason,
      marketStateLabels: input.marketStateLabels,
      analysis: input.analysis,
      window: input.window,
    }));
  } catch (error) {
    console.error(`[crypto-engine] Reasoning generation failed for ${input.symbol}:`, error);
    return fallback;
  }
}

function buildKeyLevels(candles: Candle[], analysis: SMCAnalysis): SignalViewModel["keyLevels"] {
  const recentWindow = candles.slice(-96);
  const highs = recentWindow.map(candle => candle.high);
  const lows = recentWindow.map(candle => candle.low);

  return {
    pdh: highs.length > 0 ? Math.max(...highs) : null,
    pdl: lows.length > 0 ? Math.min(...lows) : null,
    sessionHigh: analysis.killzone.sessionHigh,
    sessionLow: analysis.killzone.sessionLow,
  };
}

function mapMtfDirection(direction: MTFAnalysisResult["direction"]): SignalViewModel["direction"] {
  if (direction === "LONG") return "buy";
  if (direction === "SHORT") return "sell";
  return "neutral";
}

function describeMtfNoTradeReason(reason: string): string {
  if (reason === "no structure") {
    return "Top-down timeframe bias is still mixed, so the crypto setup stays on watch until MTF alignment improves.";
  }
  if (reason === "insufficient candles") {
    return "Yahoo MTF candles are incomplete, so the crypto setup stays blocked until enough higher and lower timeframe data loads.";
  }
  return describeNoTradeReason(reason) ?? reason;
}

function buildMtfReasoning(input: {
  displayName: string;
  direction: SignalViewModel["direction"];
  result: MTFAnalysisResult | null;
  levels: TradeLevels;
  noTradeReason: string | null;
}): SignalReasoningOutput & {
  marketStructureSummary: string;
  liquiditySummary: string;
  keyLevelsSummary: string;
} {
  if (!input.result) {
    return {
      shortReasoning: `${input.displayName} is waiting for complete MTF data before publishing a crypto setup.`,
      detailedReasoning: `${input.displayName} did not produce a trade card because the multi-timeframe candle set is incomplete.`,
      whyThisSetup: "No setup is published without aligned higher and lower timeframe data.",
      whyNow: "The engine is waiting for enough monthly, weekly, daily, H4, H1, M15, and M5 candles.",
      whyThisLevel: "No executable levels are emitted until the MTF model returns a directional read.",
      invalidation: "Wait for the next healthy cycle.",
      whyThisGrade: "Missing MTF context forces an F-grade blocked card.",
      noTradeExplanation: input.noTradeReason ? describeMtfNoTradeReason(input.noTradeReason) : null,
      marketStructureSummary: "No MTF structure summary available.",
      liquiditySummary: "No liquidity context available.",
      keyLevelsSummary: "No executable levels available.",
    };
  }
  return buildTopDownReasoning({
    displayName: input.displayName,
    result: input.result,
    noTradeReason: input.noTradeReason ? describeMtfNoTradeReason(input.noTradeReason) : null,
  });
}

function buildMtfSmcSummary(
  result: MTFAnalysisResult,
  window: CryptoVolatilityWindow,
  mtfCandles: MTFCandles,
): SignalViewModelSMC {
  const orderBlock = result.orderBlocks.at(-1);
  const fvg = result.fvgs.at(-1);
  const breaker = result.breakerBlocks.at(-1);
  const liquidity = result.liquiditySweeps.at(-1);
  const sessionCandles = mtfCandles.m15.slice(-32);
  const sessionHigh = sessionCandles.length > 0 ? Math.max(...sessionCandles.map(candle => candle.high)) : null;
  const sessionLow = sessionCandles.length > 0 ? Math.min(...sessionCandles.map(candle => candle.low)) : null;

  return {
    nearestOrderBlock: orderBlock
      ? {
        type: orderBlock.type,
        high: orderBlock.high,
        low: orderBlock.low,
        strength: orderBlock.strength >= 80 ? "strong" : orderBlock.strength >= 60 ? "moderate" : "developing",
      }
      : null,
    nearestFVG: fvg
      ? {
        type: fvg.type,
        upper: fvg.high,
        lower: fvg.low,
        fillPercent: 0,
      }
      : null,
    nearestBreaker: breaker
      ? {
        type: breaker.type,
        high: breaker.high,
        low: breaker.low,
      }
      : null,
    recentLiquiditySweep: liquidity
      ? {
        side: liquidity.type === "buy_side" ? "buyside" : "sellside",
        reversal: liquidity.reversed,
        reversalStrength: liquidity.reversed ? "strong" : "moderate",
      }
      : null,
    killzone: formatVolatilityWindow(window),
    minutesToNextKillzone: 0,
    nextKillzone: formatVolatilityWindow(nextVolatilityWindow(window)),
    asianRangeHigh: sessionHigh,
    asianRangeLow: sessionLow,
    inOTE: result.premiumDiscount.zone === "discount" || result.premiumDiscount.zone === "premium",
    oteLevels: null,
    pdLocation: result.premiumDiscount.zone,
    pdPercent: result.premiumDiscount.pct,
    cotBias: "unavailable",
    cotStrength: "unavailable",
    cotDivergence: false,
    smcScore: result.confidence,
    smcVerdict: result.overallBias === "ranging" ? "mtf_ranging" : `mtf_${result.overallBias}`,
  };
}

function buildMtfKeyLevels(mtfCandles: MTFCandles): SignalViewModel["keyLevels"] {
  const h1Window = mtfCandles.h1.slice(-24);
  const sessionWindow = mtfCandles.m15.slice(-32);
  const highs = h1Window.map(candle => candle.high);
  const lows = h1Window.map(candle => candle.low);

  return {
    pdh: highs.length > 0 ? Math.max(...highs) : null,
    pdl: lows.length > 0 ? Math.min(...lows) : null,
    sessionHigh: sessionWindow.length > 0 ? Math.max(...sessionWindow.map(candle => candle.high)) : null,
    sessionLow: sessionWindow.length > 0 ? Math.min(...sessionWindow.map(candle => candle.low)) : null,
  };
}

async function buildCryptoCard(input: {
  symbol: CryptoSymbol;
  profile: CryptoPairProfile;
  cycleId: string;
  timestamp: number;
  window: CryptoVolatilityWindow;
  mtfCandles: MTFCandles;
  livePrice: number | null;
}): Promise<CryptoSignalCard> {
  const displayName = CRYPTO_DISPLAY_NAMES[input.symbol];
  const primaryCandles = input.mtfCandles.h1.length > 0 ? input.mtfCandles.h1 : input.mtfCandles.daily;
  const mtfResult = input.livePrice == null
    ? null
    : runTopDownAnalysis(input.symbol, input.mtfCandles, input.livePrice);
  const direction = mtfResult ? mapMtfDirection(mtfResult.direction) : "neutral";
  const confidence = (mtfResult?.confidence ?? 0) / 100;
  const analysis = analyzeSMC(input.symbol, primaryCandles, input.livePrice, direction);
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
  const grade = mtfResult?.grade ?? "F";
  const gradeScore = mtfResult?.confluenceScore ?? mtfResult?.confidence ?? 0;

  const noTradeReason = input.livePrice == null
    ? "data unavailable"
    : mtfResult == null
      ? "insufficient candles"
      : direction === "neutral"
      ? "awaiting liquidity sweep"
      : !EXECUTABLE_GRADES.has(grade)
        ? "low confidence"
        : null;

  const displayCategory = input.livePrice == null
    ? "rejected"
    : noTradeReason == null
      ? "executable"
      : "monitored";
  const status = displayCategory === "executable"
    ? "active"
    : displayCategory === "rejected"
      ? "blocked"
      : "watchlist";
  const marketStateLabels = Array.from(new Set([
    ...buildMarketStateLabels(input.window, analysis, new Date(input.timestamp)),
    mtfResult ? `${titleCase(mtfResult.overallBias)} ${mtfResult.biasStrength}% TF` : "MTF unavailable",
    mtfResult?.entryTimeframe ? `${mtfResult.entryTimeframe} confirmation` : null,
    mtfResult?.entryTrigger !== "none" ? "sweep confirmed" : null,
    mtfResult ? titleCase(mtfResult.premiumDiscount.zone) : null,
  ].filter((label): label is string => Boolean(label))));
  const reasoning = buildMtfReasoning({
    displayName,
    direction,
    result: mtfResult,
    levels,
    noTradeReason,
  });
  const smcAnalysis = mtfResult
    ? buildMtfSmcSummary(mtfResult, input.window, input.mtfCandles)
    : buildCryptoSmcSummary(analysis, input.window);
  const viewId = createId("crypto_view");

  if (mtfResult) {
    console.log(
      `[APEX CRYPTO MTF] ${input.symbol}: ${mtfResult.grade} ${mtfResult.direction} | Bias: ${mtfResult.overallBias} (${mtfResult.biasStrength}% confluence)`,
    );
  }

  return prepareSignalViewModelForPersistence({
    id: `crypto-${input.symbol}-${input.cycleId}`,
    view_id: viewId,
    entity_ref: `${input.symbol}:${input.cycleId}`,
    signal_id: null,
    symbol: displayName,
    cycleId: input.cycleId,
    generatedAt: input.timestamp,
    displayCategory,
    display_type: displayCategory,
    livePrice: input.livePrice,
    entry: levels.entry,
    sl: levels.sl,
    tp1: levels.tp1,
    tp2: levels.tp2,
    tp3: levels.tp3,
    direction,
    grade,
    gradeScore,
    setupType: mtfResult?.setupType.replaceAll("_", " ") ?? "mtf analysis",
    session: formatVolatilityWindow(input.window),
    bias: direction === "buy" ? "bullish" : direction === "sell" ? "bearish" : "neutral",
    structure: mtfResult?.structureBreaks.at(-1)
      ? `${mtfResult.structureBreaks.at(-1)?.type} ${mtfResult.structureBreaks.at(-1)?.direction}`
      : analysis.orderBlocks[0]
        ? `${analysis.orderBlocks[0].type} order block`
        : "neutral",
    liquidityState: mtfResult?.liquiditySweeps.at(-1)?.reversed ? "liquidity sweep" : "no sweep",
    location: mtfResult?.premiumDiscount.zone ?? analysis.pdArrays.currentLocation,
    zoneType: direction === "buy" ? "demand" : direction === "sell" ? "supply" : "neutral",
    marketPhase: mtfResult ? titleCase(`${mtfResult.overallBias} confluence`) : titleCase(analysis.smcScore.verdict.replaceAll("_", " ")),
    confidence,
    entryTimeframe: mtfResult?.entryTimeframe ?? null,
    tp1RiskReward: mtfResult?.riskReward ?? null,
    tp2RiskReward: mtfResult?.riskReward2 ?? null,
    htfBiasSummary: mtfResult?.htfBiasSummary ?? null,
    liquiditySweepDescription: mtfResult?.liquiditySweepDescription ?? null,
    confluenceScore: mtfResult?.confluenceScore ?? null,
    shortReasoning: reasoning.shortReasoning,
    detailedReasoning: reasoning.detailedReasoning,
    whyThisSetup: reasoning.whyThisSetup,
    whyNow: reasoning.whyNow,
    whyThisLevel: reasoning.whyThisLevel,
    invalidation: reasoning.invalidation,
    whyThisGrade: reasoning.whyThisGrade,
    noTradeExplanation: reasoning.noTradeExplanation,
    smcAnalysis,
    marketStateLabels,
    noTradeReason,
    blockedReasons: displayCategory === "rejected" && noTradeReason ? [noTradeReason] : [],
    riskStatus: displayCategory === "executable" ? "approved" : displayCategory === "rejected" ? "rejected" : "deferred",
    riskRuleCodes: [],
    riskExplainability: [],
    podVotes: [],
    lifecycleState: null,
    status,
    keyLevels: buildMtfKeyLevels(input.mtfCandles),
    marketStructureSummary: reasoning.marketStructureSummary,
    liquiditySummary: reasoning.liquiditySummary,
    keyLevelsSummary: reasoning.keyLevelsSummary,
    headline: `${displayName} ${direction === "neutral" ? "watchlist" : direction.toUpperCase()} MTF read`,
    summary: reasoning.detailedReasoning,
    reason_labels: marketStateLabels,
    confidence_label: confidenceLabel(confidence),
    ui_sections: {
      assetClass: "crypto",
      marketSymbol: input.symbol,
      volatilityWindow: input.window,
      timeframe: mtfResult?.entryTimeframe ?? mtfResult?.timeframe ?? "15m",
      mtf: mtfResult,
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
    commentary: null,
    ui_version: "crypto_signal_view_v1",
    generated_at: input.timestamp,
    assetClass: "crypto",
    providerStatus: "healthy",
    priceSource: "binance",
    candleSource: "yahoo",
    fallbackDepth: 1,
    dataFreshnessMs: 0,
    missingBarCount: 0,
    lastSuccessfulProvider: "Yahoo",
    quoteIntegrity: true,
    universeMembershipConfidence: 1,
    dataTrustScore: 90,
    qualityScores: {
      structure: gradeScore || analysis.smcScore.total,
      market: Math.round(confidence * 100),
      execution: levels.entry != null && levels.sl != null ? 78 : 42,
      data: 90,
      assetFit: 86,
      composite: gradeScore || Math.round((Math.round(confidence * 100) * 0.34) + (78 * 0.2) + (90 * 0.2) + (86 * 0.12)),
    },
    publicationStatus: displayCategory === "executable" ? "publishable" : displayCategory === "rejected" ? "blocked" : "watchlist_only",
    publicationReasons: displayCategory === "executable" ? [] : displayCategory === "rejected" ? ["BROKEN_MARKET_DATA"] : ["LOW_CONFIDENCE"],
    moduleHealth: displayCategory === "rejected" ? "broken" : "working",
    healthFlags: displayCategory === "executable" ? [] : displayCategory === "rejected" ? ["BROKEN DATA"] : ["WATCHLIST ONLY"],
    marketSymbol: input.symbol,
    displayName,
    volatilityWindow: input.window,
  });
}

async function buildUnavailableCard(input: {
  symbol: CryptoSymbol;
  cycleId: string;
  timestamp: number;
  window: CryptoVolatilityWindow;
  livePrice: number | null;
}): Promise<CryptoSignalCard> {
  const displayName = CRYPTO_DISPLAY_NAMES[input.symbol];
  const viewId = createId("crypto_view");
  const reason = "data unavailable";

  return prepareSignalViewModelForPersistence({
    id: `crypto-${input.symbol}-${input.cycleId}`,
    view_id: viewId,
    entity_ref: `${input.symbol}:${input.cycleId}`,
    signal_id: null,
    symbol: displayName,
    cycleId: input.cycleId,
    generatedAt: input.timestamp,
    displayCategory: "rejected",
    display_type: "rejected",
    livePrice: input.livePrice,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    tp3: null,
    direction: "neutral",
    grade: "F",
    gradeScore: 0,
    setupType: "smc crypto",
    session: formatVolatilityWindow(input.window),
    bias: "neutral",
    structure: "unavailable",
    liquidityState: "unavailable",
    location: "equilibrium",
    zoneType: "neutral",
    marketPhase: "Unavailable",
    confidence: 0,
    shortReasoning: `${displayName} is blocked because Binance price or Yahoo MTF candle data is unavailable.`,
    detailedReasoning: `${displayName} could not be analyzed for this cycle because the crypto engine did not receive enough live price or multi-timeframe candle inputs.`,
    whyThisSetup: "No setup is published when live price or MTF candles are missing.",
    whyNow: "The cycle is waiting for Binance live price and Yahoo MTF candles.",
    whyThisLevel: "No trade levels are emitted without valid live and higher timeframe market data.",
    invalidation: "Wait for the next healthy cycle.",
    whyThisGrade: "Unavailable data forces an F-grade blocked card.",
    noTradeExplanation: describeNoTradeReason(reason),
    smcAnalysis: undefined,
    marketStateLabels: ["24/7", formatVolatilityWindow(input.window), "Data Unavailable"],
    noTradeReason: reason,
    blockedReasons: [reason],
    riskStatus: "rejected",
    riskRuleCodes: [],
    riskExplainability: [],
    podVotes: [],
    lifecycleState: null,
    status: "blocked",
    keyLevels: {
      pdh: null,
      pdl: null,
      sessionHigh: null,
      sessionLow: null,
    },
    marketStructureSummary: "No structure summary available.",
    liquiditySummary: "No liquidity context available.",
    keyLevelsSummary: "No executable levels available.",
    headline: `${displayName} waiting on data`,
    summary: `${displayName} is waiting on fresh Binance data before the next crypto cycle can score structure.`,
    reason_labels: ["Data Unavailable"],
    confidence_label: "offline",
    ui_sections: {
      assetClass: "crypto",
      marketSymbol: input.symbol,
      volatilityWindow: input.window,
    },
    commentary: null,
    ui_version: "crypto_signal_view_v1",
    generated_at: input.timestamp,
    assetClass: "crypto",
    providerStatus: "broken",
    priceSource: null,
    candleSource: "yahoo",
    fallbackDepth: 2,
    dataFreshnessMs: null,
    missingBarCount: 20,
    lastSuccessfulProvider: "Yahoo",
    quoteIntegrity: false,
    universeMembershipConfidence: 1,
    dataTrustScore: 8,
    qualityScores: {
      structure: 0,
      market: 0,
      execution: 0,
      data: 8,
      assetFit: 86,
      composite: 10,
    },
    publicationStatus: "blocked",
    publicationReasons: ["BROKEN_MARKET_DATA", "NULL_PRICE"],
    moduleHealth: "broken",
    healthFlags: ["BROKEN DATA", "BLOCKED"],
    marketSymbol: input.symbol,
    displayName,
    volatilityWindow: input.window,
  });
}

export async function runCryptoCycle(cycleId: string): Promise<CryptoSignalCard[]> {
  console.log(`[crypto-engine] Starting cycle ${cycleId}`);

  const timestamp = Date.now();
  const now = new Date(timestamp);
  const window = getCryptoVolatilityWindow(now.getUTCHours());
  const wsPrices = getAllCryptoLivePrices();
  const cards: CryptoSignalCard[] = [];

  for (const symbol of CRYPTO_ACTIVE_SYMBOLS) {
    try {
      const mtfCandles = await fetchMTFCandles(symbol);
      let livePrice = wsPrices[symbol];
      let livePriceSource: "binance_ws" | "binance_rest" | "unavailable" = livePrice != null
        ? "binance_ws"
        : "unavailable";
      if (livePrice == null) {
        livePrice = await fetchCryptoTickerPrice(symbol);
        if (livePrice != null) {
          livePriceSource = "binance_rest";
        }
      }

      if (livePrice == null || mtfCandles.daily.length < 10 || mtfCandles.h4.length < 10 || mtfCandles.h1.length < 10) {
        console.log(
          `[APEX CRYPTO] ${symbol}: insufficient MTF inputs (daily=${mtfCandles.daily.length}, h4=${mtfCandles.h4.length}, h1=${mtfCandles.h1.length}, m15=${mtfCandles.m15.length}, m5=${mtfCandles.m5.length}, livePrice=${livePrice ?? "null"}, livePriceSource=${livePriceSource}), skipping signal`,
        );
        cards.push(await buildUnavailableCard({
          symbol,
          cycleId,
          timestamp,
          window,
          livePrice,
        }));
        continue;
      }

      console.log(
        `[APEX CRYPTO] ${symbol}: daily=${mtfCandles.daily.length} h4=${mtfCandles.h4.length} h1=${mtfCandles.h1.length} m15=${mtfCandles.m15.length} m5=${mtfCandles.m5.length} livePrice=${livePrice} source=${livePriceSource}, running MTF scoring...`,
      );
      cards.push(await buildCryptoCard({
        symbol,
        profile: CRYPTO_PAIR_PROFILES[symbol],
        cycleId,
        timestamp,
        window,
        mtfCandles,
        livePrice,
      }));
    } catch (error) {
      console.error(`[crypto-engine] Failed for ${symbol}:`, error);
      cards.push(await buildUnavailableCard({
        symbol,
        cycleId,
        timestamp,
        window,
        livePrice: wsPrices[symbol] ?? null,
      }));
    }
  }

  const notifier = new TelegramNotifier();
  for (const card of cards) {
    await notifier.sendCryptoSignalAlert(card);
  }

  console.log(`[crypto-engine] Cycle ${cycleId} complete — ${cards.length} cards built`);
  return cards;
}
