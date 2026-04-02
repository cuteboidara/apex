export { analyzeSMC, rescoreSMCAnalysis, smcVerdictBonus } from "@/src/smc/smcAnalyzer";
export { detectOrderBlocks, scoreOrderBlockAlignment } from "@/src/smc/orderBlocks";
export { detectFairValueGaps, scoreFVG } from "@/src/smc/fairValueGaps";
export { detectBreakerBlocks, scoreBreakerBlock } from "@/src/smc/breakerBlocks";
export { detectLiquidityLevels, detectRecentSweeps, scoreLiquidity } from "@/src/smc/liquiditySweeps";
export { buildKillzoneState, getCurrentKillzone, getMinutesUntilNextKillzone, scoreKillzone } from "@/src/smc/killzones";
export { calculateOTE, scoreOTE } from "@/src/smc/ote";
export { calculatePDArrays, scorePDArray } from "@/src/smc/pdArrays";
export { fetchCOTData, getCOTForSymbol, peekCOTForSymbol, primeCOTData, scoreCOT } from "@/src/smc/cotData";
export type {
  BreakerBlock,
  Candle,
  COTReport,
  FairValueGap,
  KillzoneName,
  KillzoneState,
  LiquidityLevel,
  LiquiditySide,
  LiquiditySweep,
  OrderBlock,
  OTELevels,
  PDArrays,
  PDLocation,
  SMCAnalysis,
  SMCScore,
} from "@/src/smc/types";
