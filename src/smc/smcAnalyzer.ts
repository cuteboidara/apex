import type { COTReport, Candle, PDArrays, SMCAnalysis, SMCScore } from "@/src/smc/types";
import { detectOrderBlocks, scoreOrderBlockAlignment } from "@/src/smc/orderBlocks";
import { detectFairValueGaps, scoreFVG } from "@/src/smc/fairValueGaps";
import { detectBreakerBlocks, scoreBreakerBlock } from "@/src/smc/breakerBlocks";
import { detectLiquidityLevels, detectRecentSweeps, scoreLiquidity } from "@/src/smc/liquiditySweeps";
import { buildKillzoneState, scoreKillzone } from "@/src/smc/killzones";
import { calculateOTE, scoreOTE } from "@/src/smc/ote";
import { calculatePDArrays, scorePDArray } from "@/src/smc/pdArrays";
import { peekCOTForSymbol, primeCOTData, scoreCOT } from "@/src/smc/cotData";

const SCORE_WEIGHTS = {
  ob: 0.2,
  fvg: 0.15,
  breaker: 0.1,
  liquidity: 0.2,
  killzone: 0.15,
  ote: 0.1,
  pd: 0.05,
  cot: 0.05,
} as const;

function isCounterPd(pdArrays: PDArrays, direction: "buy" | "sell" | "neutral"): boolean {
  return (direction === "buy" && pdArrays.currentLocation === "premium")
    || (direction === "sell" && pdArrays.currentLocation === "discount");
}

function isCounterCot(cot: COTReport | null, direction: "buy" | "sell" | "neutral"): boolean {
  if (!cot || direction === "neutral" || cot.smartMoneyBias === "neutral") {
    return false;
  }

  return (direction === "buy" && cot.smartMoneyBias === "bearish")
    || (direction === "sell" && cot.smartMoneyBias === "bullish");
}

type ScoreInput = Omit<SMCAnalysis, "timestamp" | "smcScore"> & {
  direction: "buy" | "sell" | "neutral";
  livePrice: number | null;
};

function buildSMCScore(input: ScoreInput): SMCScore {
  const orderBlockAlignment = scoreOrderBlockAlignment(input.orderBlocks, input.direction, input.livePrice);
  const fvgPresent = scoreFVG(input.fairValueGaps, input.direction, input.livePrice);
  const breakerConfirmation = scoreBreakerBlock(input.breakerBlocks, input.direction, input.livePrice);
  const liquidityContext = scoreLiquidity(input.liquidityLevels, input.recentSweeps, input.direction, input.livePrice);
  const killzoneAlignment = scoreKillzone(input.killzone, input.symbol);
  const oteAlignment = scoreOTE(input.ote, input.direction);
  const pdAlignment = scorePDArray(input.pdArrays, input.direction);
  const cotAlignment = scoreCOT(input.cot, input.direction);

  const total = Math.max(0, Math.min(100, Math.round(
    (orderBlockAlignment * SCORE_WEIGHTS.ob * 10)
    + (fvgPresent * SCORE_WEIGHTS.fvg * 10)
    + (breakerConfirmation * SCORE_WEIGHTS.breaker * 10)
    + (liquidityContext * SCORE_WEIGHTS.liquidity * 10)
    + (killzoneAlignment * SCORE_WEIGHTS.killzone * 10)
    + (oteAlignment * SCORE_WEIGHTS.ote * 10)
    + (pdAlignment * SCORE_WEIGHTS.pd * 10)
    + (cotAlignment * SCORE_WEIGHTS.cot * 10)
  )));

  let verdict: SMCScore["verdict"] = "no_confluence";
  if (input.direction !== "neutral" && (isCounterPd(input.pdArrays, input.direction) || isCounterCot(input.cot, input.direction))) {
    verdict = "counter_smc";
  } else if (total >= 75) {
    verdict = "strong_confluence";
  } else if (total >= 55) {
    verdict = "moderate_confluence";
  } else if (total >= 35) {
    verdict = "weak_confluence";
  }

  return {
    orderBlockAlignment,
    fvgPresent,
    breakerConfirmation,
    liquidityContext,
    killzoneAlignment,
    oteAlignment,
    pdAlignment,
    cotAlignment,
    total,
    verdict,
  };
}

export function rescoreSMCAnalysis(
  analysis: SMCAnalysis,
  direction: "buy" | "sell" | "neutral",
  livePrice: number | null,
): SMCScore {
  return buildSMCScore({
    ...analysis,
    direction,
    livePrice,
  });
}

export function smcVerdictBonus(verdict: SMCScore["verdict"]): number {
  if (verdict === "strong_confluence") return 0.1;
  if (verdict === "moderate_confluence") return 0.06;
  if (verdict === "weak_confluence") return 0.02;
  if (verdict === "counter_smc") return -0.08;
  return 0;
}

export function analyzeSMC(
  symbol: string,
  candles: Candle[],
  livePrice: number | null,
  direction: "buy" | "sell" | "neutral",
): SMCAnalysis {
  primeCOTData();

  const orderBlocks = detectOrderBlocks(candles);
  const fairValueGaps = detectFairValueGaps(candles);
  const breakerBlocks = detectBreakerBlocks(candles);
  const liquidityLevels = detectLiquidityLevels(candles);
  const recentSweeps = detectRecentSweeps(candles, liquidityLevels);
  const killzone = buildKillzoneState(new Date(), candles);
  const ote = calculateOTE(candles, livePrice);
  const pdArrays = calculatePDArrays(candles, livePrice);
  const cot = peekCOTForSymbol(symbol);

  const analysisBase = {
    symbol,
    orderBlocks,
    fairValueGaps,
    breakerBlocks,
    liquidityLevels,
    recentSweeps,
    killzone,
    ote,
    pdArrays,
    cot,
  } satisfies Omit<SMCAnalysis, "timestamp" | "smcScore">;

  return {
    ...analysisBase,
    timestamp: Date.now(),
    smcScore: buildSMCScore({
      ...analysisBase,
      direction,
      livePrice,
    }),
  };
}
