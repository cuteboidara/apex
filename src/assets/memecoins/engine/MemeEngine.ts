import { generateSignalReasoning } from "@/src/lib/apex-llm";
import type { SignalReasoningContext, SignalReasoningOutput } from "@/src/lib/apex-llm/types";
import { analyzeSMC } from "@/src/smc";
import type { Candle } from "@/src/smc/types";
import {
  getMemeUniverse,
  type MemeCoinProfile,
} from "@/src/assets/memecoins/config/memeScope";
import {
  fetchCoinGeckoMarketData,
  fetchCoinGeckoOHLCV,
  fetchCoinGeckoPrice,
} from "@/src/assets/memecoins/data/CoinGeckoOHLCV";
import {
  fetchMemeBinanceCandles,
  fetchMemeBinanceCandlesByInterval,
  fetchMemeBinanceTickerPrice,
  getMemeBinanceLivePrice,
} from "@/src/assets/memecoins/data/BinanceMemeMarketData";
import { gradeMemeSignal } from "@/src/assets/memecoins/strategies/memeGrading";
import { detectVolumeSpike, deriveMemeSignal, type VolumeSpikeAnalysis } from "@/src/assets/memecoins/strategies/volumeSpike";
import type { MemeSignalCard } from "@/src/assets/memecoins/types";
import type { MTFCandles } from "@/src/assets/shared/mtfAnalysis";
import { runTopDownAnalysis } from "@/src/assets/shared/mtfAnalysis";
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

type MarketDataById = Map<string, Awaited<ReturnType<typeof fetchCoinGeckoMarketData>>[number]>;

function buildNoVolumeAnalysis(note = "No volume data"): VolumeSpikeAnalysis {
  return {
    isSpike: false,
    spikeMultiplier: 1,
    avgVolume20: 0,
    currentVolume: 0,
    spikeDirection: "neutral",
    spikeStrength: "none",
    spikeScore: 0,
    note,
  };
}

function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  const grouped = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time * 1000 / bucketMs) * bucketMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, []);
    }
    grouped.get(bucket)?.push(candle);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, group]) => ({
      time: Math.floor(bucket / 1000),
      open: group[0]?.open ?? group[0]?.close ?? 0,
      high: Math.max(...group.map(candle => candle.high)),
      low: Math.min(...group.map(candle => candle.low)),
      close: group.at(-1)?.close ?? group[0]?.close ?? 0,
      volume: group.reduce((sum, candle) => sum + (candle.volume ?? 0), 0),
    }))
    .filter(candle => candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0);
}

async function fetchMemeMtfcandles(profile: MemeCoinProfile): Promise<MTFCandles | null> {
  if (!profile.binanceListed) {
    return null;
  }

  const [dailyRaw, h4Raw, h1Raw, m15Raw, m5Raw] = await Promise.all([
    fetchMemeBinanceCandlesByInterval(profile.symbol, "1d", 180),
    fetchMemeBinanceCandlesByInterval(profile.symbol, "4h", 180),
    fetchMemeBinanceCandlesByInterval(profile.symbol, "1h", 240),
    fetchMemeBinanceCandlesByInterval(profile.symbol, "15m", 240),
    fetchMemeBinanceCandlesByInterval(profile.symbol, "5m", 240),
  ]);
  const normalizeTime = (candles: Candle[]) => candles.map(candle => ({
    ...candle,
    time: candle.time * 1000,
  }));
  const daily = normalizeTime(dailyRaw);
  const h4 = normalizeTime(h4Raw);
  const h1 = normalizeTime(h1Raw);
  const m15 = normalizeTime(m15Raw);
  const m5 = normalizeTime(m5Raw);

  if (daily.length < 20 || h4.length < 20 || h1.length < 20 || m15.length < 24 || m5.length < 24) {
    return null;
  }

  return {
    monthly: aggregateCandles(daily, 30 * 24 * 60 * 60 * 1000),
    weekly: aggregateCandles(daily, 7 * 24 * 60 * 60 * 1000),
    daily,
    h4,
    h1,
    m15,
    m5,
  };
}

function buildUiBadges(input: {
  profile: MemeCoinProfile;
  volumeAnalysis: VolumeSpikeAnalysis;
  dataSource: "binance" | "coingecko";
}): string[] {
  return [
    input.profile.isBase ? "BASE" : "TRENDING",
    input.dataSource.toUpperCase(),
    input.volumeAnalysis.isSpike ? `${input.volumeAnalysis.spikeMultiplier.toFixed(1)}X VOLUME` : "NORMAL VOLUME",
  ];
}

function providerStatusFromDataSource(input: {
  dataSource: MemeSignalCard["dataSource"];
  binanceListed: boolean;
  hasPrice: boolean;
}): "healthy" | "degraded" | "fallback" | "broken" {
  if (!input.hasPrice) {
    return "broken";
  }
  if (input.dataSource === "binance") {
    return "healthy";
  }
  return input.binanceListed ? "fallback" : "degraded";
}

async function fetchMemeCandles(profile: MemeCoinProfile): Promise<{ candles: Candle[]; dataSource: MemeSignalCard["dataSource"] }> {
  if (profile.binanceListed) {
    const binanceCandles = await fetchMemeBinanceCandles(profile.symbol);
    if (binanceCandles.length >= 10) {
      return {
        candles: binanceCandles,
        dataSource: "binance",
      };
    }
    console.warn(`[meme-engine] ${profile.symbol}: Binance candles unavailable, falling back to CoinGecko`);
  }

  return {
    candles: await fetchCoinGeckoOHLCV(profile.coingeckoId, 1),
    dataSource: "coingecko",
  };
}

async function fetchMemeLivePrice(profile: MemeCoinProfile): Promise<{ price: number | null; dataSource: MemeSignalCard["dataSource"] }> {
  if (profile.binanceListed) {
    const wsPrice = getMemeBinanceLivePrice(profile.symbol);
    if (wsPrice != null) {
      return {
        price: wsPrice,
        dataSource: "binance",
      };
    }

    const restPrice = await fetchMemeBinanceTickerPrice(profile.symbol);
    if (restPrice != null) {
      return {
        price: restPrice,
        dataSource: "binance",
      };
    }

    console.warn(`[meme-engine] ${profile.symbol}: Binance live price unavailable, falling back to CoinGecko`);
  }

  return {
    price: await fetchCoinGeckoPrice(profile.coingeckoId),
    dataSource: "coingecko",
  };
}

function deriveMemeLevels(
  direction: MemeSignalCard["direction"],
  livePrice: number | null,
  analysis: ReturnType<typeof analyzeSMC>,
  isHighVolatility: boolean,
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
  const slPct = isHighVolatility ? 0.05 : 0.03;
  const sl = orderBlock
    ? direction === "buy"
      ? orderBlock.low * 0.998
      : orderBlock.high * 1.002
    : direction === "buy"
      ? entry * (1 - slPct)
      : entry * (1 + slPct);
  const distance = Math.abs(entry - sl);

  return {
    entry,
    sl,
    tp1: direction === "buy" ? entry + distance * 1.2 : entry - distance * 1.2,
    tp2: direction === "buy" ? entry + distance * 2 : entry - distance * 2,
    tp3: direction === "buy" ? entry + distance * 3 : entry - distance * 3,
  };
}

async function resolveReasoning(input: {
  profile: MemeCoinProfile;
  direction: MemeSignalCard["direction"];
  grade: string;
  confidence: number;
  livePrice: number | null;
  noTradeReason: string | null;
  levels: TradeLevels;
  marketStateLabels: string[];
  analysis: ReturnType<typeof analyzeSMC>;
  primaryDriver: string;
  volumeAnalysis: VolumeSpikeAnalysis;
}): Promise<SignalReasoningOutput> {
  const fallback = buildFallbackReasoning({
    displayName: input.profile.displayName,
    direction: input.direction,
    grade: input.grade,
    score: input.analysis.smcScore.total,
    contextLine: `${input.primaryDriver.replaceAll("_", " ")}. ${input.volumeAnalysis.note}`.trim(),
    whyThisSetup: input.direction === "neutral"
      ? "Volume and SMC context are not aligned enough for a directional meme-coin entry."
      : `${titleCase(input.direction)} direction is driven by ${input.primaryDriver.replaceAll("_", " ")} with meme-coin volatility adjustments.`,
    whyNow: input.volumeAnalysis.isSpike
      ? `A ${input.volumeAnalysis.spikeMultiplier.toFixed(1)}x volume expansion is active near the current structural level.`
      : "The engine is waiting for a clearer expansion impulse or sharper liquidity reaction.",
    whyThisLevel: input.levels.entry != null
      ? `The entry is anchored to the active OTE or order-block zone near ${input.levels.entry.toPrecision(6)}.`
      : "No executable level is published until price and velocity align.",
    invalidation: input.levels.sl != null
      ? `Invalidation is set beyond the active volatility-adjusted structural boundary at ${input.levels.sl.toPrecision(6)}.`
      : "A fresh structural break invalidates the watchlist idea.",
    noTradeExplanation: input.noTradeReason,
  });

  if (process.env.APEX_DISABLE_LLM === "true" || !process.env.ANTHROPIC_API_KEY) {
    return fallback;
  }

  try {
    const context: SignalReasoningContext = {
      symbol: input.profile.displayName,
      direction: input.direction,
      grade: input.grade,
      setupType: input.primaryDriver,
      session: "24/7 crypto",
      bias: input.direction === "buy" ? "bullish" : input.direction === "sell" ? "bearish" : "neutral",
      structure: input.analysis.orderBlocks[0]?.type ?? "none",
      liquidityState: input.analysis.recentSweeps[0]?.reversal ? "liquidity sweep" : "normal",
      location: input.analysis.pdArrays.currentLocation,
      zoneType: input.direction === "buy" ? "demand" : input.direction === "sell" ? "supply" : "neutral",
      marketPhase: input.volumeAnalysis.isSpike ? "expansion" : input.analysis.smcScore.verdict,
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
    };
    return await generateSignalReasoning(context);
  } catch (error) {
    console.error(`[meme-engine] Reasoning failed for ${input.profile.symbol}:`, error);
    return fallback;
  }
}

function buildUnavailableMemeCard(input: {
  profile: MemeCoinProfile;
  cycleId: string;
  generatedAt: number;
  livePrice: number | null;
  candles: Candle[];
  reason: string;
  dataSource?: MemeSignalCard["dataSource"];
}): MemeSignalCard {
  const dataSource = input.dataSource ?? (input.profile.binanceListed ? "binance" : "coingecko");
  const volumeAnalysis = buildNoVolumeAnalysis("Insufficient data for volume analysis");
  const marketStateLabels = [
    input.profile.isBase ? "established meme" : "trending coin",
    dataSource.toUpperCase(),
    "insufficient data",
  ];
  const reasoning = buildFallbackReasoning({
    displayName: input.profile.displayName,
    direction: "neutral",
    grade: "F",
    score: 0,
    contextLine: input.reason,
    whyThisSetup: "The engine could not build enough market context to score this meme coin.",
    whyNow: input.reason,
    whyThisLevel: "No executable level is published until enough market data is available.",
    invalidation: "A fresh cycle with valid market data is required before the setup can be assessed.",
    noTradeExplanation: input.reason,
  });
  const base = buildAssetViewModelBase({
    idPrefix: "meme_view",
    symbol: input.profile.symbol,
    cycleId: input.cycleId,
    generatedAt: input.generatedAt,
    displayCategory: "monitored",
    livePrice: input.livePrice,
    tradeLevels: {
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null,
    },
    direction: "neutral",
    grade: "F",
    gradeScore: 0,
    setupType: "no_signal",
    session: "24/7 Crypto",
    bias: "neutral",
    structure: "neutral",
    liquidityState: "no sweep",
    location: "equilibrium",
    zoneType: "neutral",
    marketPhase: "Monitoring",
    confidence: 0,
    reasoning,
    marketStateLabels,
    noTradeReason: input.reason,
    blockedReasons: [input.reason],
    status: "watchlist",
    keyLevels: input.candles.length > 0
      ? {
        pdh: Math.max(...input.candles.map(candle => candle.high)),
        pdl: Math.min(...input.candles.map(candle => candle.low)),
        sessionHigh: null,
        sessionLow: null,
      }
      : {
        pdh: null,
        pdl: null,
        sessionHigh: null,
        sessionLow: null,
      },
    riskStatus: "deferred",
    headline: `${input.profile.displayName} monitoring`,
    uiVersion: "meme_signal_view_v1",
    providerStatus: providerStatusFromDataSource({
      dataSource,
      binanceListed: input.profile.binanceListed,
      hasPrice: input.livePrice != null,
    }),
    priceSource: dataSource,
    candleSource: dataSource,
    fallbackDepth: dataSource === "binance" ? 0 : 1,
    dataFreshnessMs: input.candles[input.candles.length - 1]?.time != null
      ? Math.max(0, input.generatedAt - (input.candles[input.candles.length - 1]!.time * 1000))
      : null,
    missingBarCount: Math.max(0, 100 - input.candles.length),
    lastSuccessfulProvider: dataSource,
    quoteIntegrity: input.livePrice != null,
    dataTrustScore: dataSource === "binance" ? 70 : 46,
    publicationStatus: "blocked",
    publicationReasons: ["BROKEN_MARKET_DATA"],
    moduleHealth: "broken",
    uiSections: {
      assetClass: "memecoin",
      marketSymbol: input.profile.symbol,
      displayName: input.profile.displayName,
      categoryLabel: input.profile.isBase ? "Base Meme" : "Trending Meme",
      priceFormat: "meme",
      badges: buildUiBadges({
        profile: input.profile,
        volumeAnalysis,
        dataSource,
      }),
    },
  });

  return {
    ...base,
    assetClass: "memecoin",
    marketSymbol: input.profile.symbol,
    displayName: input.profile.displayName,
    coingeckoId: input.profile.coingeckoId,
    isBase: input.profile.isBase,
    binanceListed: input.profile.binanceListed,
    dataSource,
    marketCapRank: input.profile.marketCapRank,
    priceChange24h: null,
    volume24h: null,
    primaryDriver: "no_signal",
    volumeSpike: false,
    volumeSpikeMultiplier: 1,
    volumeSpikeStrength: "none",
    volumeNote: volumeAnalysis.note,
  };
}

export async function runMemeCycle(cycleId: string): Promise<MemeSignalCard[]> {
  console.log(`[meme-engine] Starting cycle ${cycleId}`);

  const generatedAt = Date.now();
  const universe = getMemeUniverse();
  const marketData = await fetchCoinGeckoMarketData(universe.map(profile => profile.coingeckoId));
  const marketDataById: MarketDataById = new Map(marketData.map(entry => [entry.id, entry]));
  const cards: MemeSignalCard[] = [];

  for (const profile of universe) {
    console.log(`[meme-engine] Processing ${profile.symbol}...`);
    let candles: Candle[] = [];
    let livePrice: number | null = null;
    let dataSource: MemeSignalCard["dataSource"] = profile.binanceListed ? "binance" : "coingecko";

    try {
      const candleResult = await fetchMemeCandles(profile);
      candles = candleResult.candles;
      dataSource = candleResult.dataSource;
      console.log(`[meme-engine] ${profile.symbol}: ${candles.length} candles, binanceListed=${profile.binanceListed}`);

      const priceResult = await fetchMemeLivePrice(profile);
      livePrice = priceResult.price ?? candles[candles.length - 1]?.close ?? null;
      if (priceResult.dataSource === "coingecko") {
        dataSource = "coingecko";
      }
      console.log(`[meme-engine] ${profile.symbol}: livePrice=${livePrice}`);

      if (candles.length < 10) {
        console.warn(`[meme-engine] ${profile.symbol}: SKIPPED SIGNAL LOGIC - only ${candles.length} candles`);
        cards.push(buildUnavailableMemeCard({
          profile,
          cycleId,
          generatedAt,
          livePrice,
          candles,
          reason: `insufficient candles (${candles.length})`,
          dataSource,
        }));
        continue;
      }

      if (livePrice == null) {
        console.warn(`[meme-engine] ${profile.symbol}: SKIPPED SIGNAL LOGIC - no live price`);
        cards.push(buildUnavailableMemeCard({
          profile,
          cycleId,
          generatedAt,
          livePrice,
          candles,
          reason: "live price unavailable",
          dataSource,
        }));
        continue;
      }

      const marketEntry = marketDataById.get(profile.coingeckoId);
      const volumeAnalysis = dataSource === "binance" && candles.some(candle => (candle.volume ?? 0) > 0)
        ? detectVolumeSpike(candles, profile.volumeSpikeThreshold)
        : buildNoVolumeAnalysis();
      const initialSmc = analyzeSMC(profile.symbol, candles, livePrice, "neutral");
      const recentSweep = initialSmc.recentSweeps[0] ?? null;
      const mtfCandles = await fetchMemeMtfcandles(profile);
      const mtfResult = mtfCandles ? runTopDownAnalysis(profile.symbol, mtfCandles, livePrice) : null;
      const { primaryDriver } = deriveMemeSignal(
        volumeAnalysis,
        initialSmc.pdArrays.currentLocation,
        recentSweep?.side ?? null,
        recentSweep?.reversal ?? false,
      );
      const direction = mtfResult?.direction === "LONG"
        ? "buy"
        : mtfResult?.direction === "SHORT"
          ? "sell"
          : "neutral";
      const confidence = (mtfResult?.confidence ?? 0) / 100;
      console.log(`[meme-engine] ${profile.symbol}: direction=${direction}, confidence=${confidence}, driver=${primaryDriver}`);

      const smcResult = analyzeSMC(profile.symbol, candles, livePrice, direction);
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
      const noTradeReason = mtfResult == null
        ? "insufficient mtf data"
        : direction === "neutral"
          ? "awaiting liquidity sweep"
          : !EXECUTABLE_GRADES.has(grade)
            ? "low confluence"
            : null;
      const displayCategory = noTradeReason == null ? "executable" : "monitored";
      const status = displayCategory === "executable" ? "active" : "watchlist";
      const marketStateLabels = [
        volumeAnalysis.isSpike ? `${volumeAnalysis.spikeStrength} volume spike` : "normal volume",
        smcResult.pdArrays.currentLocation,
        profile.isBase ? "established meme" : "trending coin",
        mtfResult?.entryTimeframe ? `${mtfResult.entryTimeframe} confirmation` : "awaiting sweep",
      ];
      console.log(`[meme-engine] ${profile.symbol}: grade=${grade}, gradeScore=${gradeScore}, displayCategory=${displayCategory}`);

      const reasoning = mtfResult
        ? buildTopDownReasoning({
          displayName: profile.displayName,
          result: mtfResult,
          noTradeReason,
        })
        : buildFallbackReasoning({
          displayName: profile.displayName,
          direction,
          grade,
          score: smcResult.smcScore.total,
          contextLine: volumeAnalysis.note,
          whyThisSetup: "No memecoin setup is published until HTF bias, MTF zone selection, and LTF sweep confirmation align.",
          whyNow: volumeAnalysis.note,
          whyThisLevel: "No executable structure-based level is published until the sweep confirmation closes.",
          invalidation: "Wait for the next healthy cycle.",
          noTradeExplanation: noTradeReason,
        });
      const smcAnalysis = buildSmcSummary(smcResult, "24/7 Crypto");
      const dataFreshnessMs = candles[candles.length - 1]?.time != null
        ? Math.max(0, generatedAt - (candles[candles.length - 1]!.time * 1000))
        : null;
      const base = buildAssetViewModelBase({
        idPrefix: "meme_view",
        symbol: profile.symbol,
        cycleId,
        generatedAt,
        displayCategory,
        livePrice,
        tradeLevels: levels,
        direction,
        grade,
        gradeScore,
        setupType: primaryDriver,
        session: "24/7 Crypto",
        bias: direction === "buy" ? "bullish" : direction === "sell" ? "bearish" : "neutral",
        structure: smcResult.orderBlocks[0]?.type ?? "neutral",
        liquidityState: recentSweep?.reversal ? "liquidity sweep" : "no sweep",
        location: smcResult.pdArrays.currentLocation,
        zoneType: direction === "buy" ? "demand" : direction === "sell" ? "supply" : "neutral",
        marketPhase: mtfResult?.setupType === "liquidity_sweep_reversal" ? "Pullback" : volumeAnalysis.isSpike ? "Expansion" : titleCase(smcResult.smcScore.verdict.replaceAll("_", " ")),
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
        riskStatus: displayCategory === "executable" ? "approved" : "deferred",
        headline: `${profile.displayName} ${direction === "neutral" ? "watchlist" : direction.toUpperCase()} read`,
        uiVersion: "meme_signal_view_v1",
        providerStatus: providerStatusFromDataSource({
          dataSource,
          binanceListed: profile.binanceListed,
          hasPrice: livePrice != null,
        }),
        priceSource: dataSource,
        candleSource: dataSource,
        fallbackDepth: dataSource === "binance" ? 0 : 1,
        dataFreshnessMs,
        missingBarCount: Math.max(0, 100 - candles.length),
        lastSuccessfulProvider: dataSource,
        quoteIntegrity: livePrice != null,
        dataTrustScore: dataSource === "binance" ? 76 : profile.binanceListed ? 54 : 48,
        publicationStatus: displayCategory === "executable"
          ? "publishable"
          : dataSource === "binance"
            ? "watchlist_only"
            : "shadow_only",
        publicationReasons: displayCategory === "executable" ? [] : dataSource === "binance" ? ["LOW_CONFIDENCE"] : ["FALLBACK_PROVIDER"],
        moduleHealth: dataSource === "binance" ? "working" : "degraded",
        uiSections: {
          assetClass: "memecoin",
          marketSymbol: profile.symbol,
          displayName: profile.displayName,
          categoryLabel: profile.isBase ? "Base Meme" : "Trending Meme",
          priceFormat: "meme",
          badges: buildUiBadges({
            profile,
            volumeAnalysis,
            dataSource,
          }),
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
        assetClass: "memecoin",
        marketSymbol: profile.symbol,
        displayName: profile.displayName,
        coingeckoId: profile.coingeckoId,
        isBase: profile.isBase,
        binanceListed: profile.binanceListed,
        dataSource,
        marketCapRank: marketEntry?.market_cap_rank ?? profile.marketCapRank,
        priceChange24h: marketEntry?.price_change_percentage_24h ?? null,
        volume24h: marketEntry?.total_volume ?? null,
        primaryDriver,
        volumeSpike: volumeAnalysis.isSpike,
        volumeSpikeMultiplier: volumeAnalysis.spikeMultiplier,
        volumeSpikeStrength: volumeAnalysis.spikeStrength,
        volumeNote: volumeAnalysis.note,
      });
    } catch (error) {
      console.error(`[meme-engine] ${profile.symbol}: EXCEPTION`, error);
      cards.push(buildUnavailableMemeCard({
        profile,
        cycleId,
        generatedAt,
        livePrice,
        candles,
        reason: error instanceof Error ? error.message : "processing failure",
        dataSource,
      }));
    }
  }

  console.log(`[meme-engine] Cycle complete - ${cards.length} cards`);
  return cards;
}
