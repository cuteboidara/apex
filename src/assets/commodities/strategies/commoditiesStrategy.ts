import type { Candle } from "@/src/assets/shared/types";
import {
  atr,
  calculateGrade,
  formatPrice,
} from "@/src/assets/shared/strategyUtils";
import {
  detectBias,
  detectFVGs,
  detectLiquiditySweeps,
  detectOrderBlocks,
  detectSDZones,
  detectStructureBreaks,
  getPremiumDiscount,
} from "@/src/assets/shared/mtfAnalysis";

export type CommodityCategory = "metals" | "energy" | "agriculture";

interface CommodityConfig {
  category: CommodityCategory;
  dxyCorrelation: "inverse" | "positive" | "weak";
  seasonalBias: Record<number, "bullish" | "bearish" | "neutral">;
  cotSensitive: boolean;
  swingATRMultiplier: number;
  tpATRMultiplier: number;
}

const BASE_COMMODITY_CONFIG: Record<string, CommodityConfig> = {
  XAUUSD: {
    category: "metals",
    dxyCorrelation: "inverse",
    seasonalBias: {
      1: "bullish", 2: "bullish", 3: "neutral",
      4: "neutral", 5: "neutral", 6: "bearish",
      7: "bearish", 8: "bullish", 9: "bullish",
      10: "neutral", 11: "bullish", 12: "neutral",
    },
    cotSensitive: true,
    swingATRMultiplier: 1.8,
    tpATRMultiplier: 4.0,
  },
  XAGUSD: {
    category: "metals",
    dxyCorrelation: "inverse",
    seasonalBias: {
      1: "bullish", 2: "bullish", 3: "neutral",
      4: "bullish", 5: "neutral", 6: "bearish",
      7: "bearish", 8: "neutral", 9: "bullish",
      10: "neutral", 11: "bullish", 12: "neutral",
    },
    cotSensitive: true,
    swingATRMultiplier: 2.0,
    tpATRMultiplier: 4.5,
  },
  "HG=F": {
    category: "metals",
    dxyCorrelation: "inverse",
    seasonalBias: {
      1: "neutral", 2: "bullish", 3: "bullish",
      4: "neutral", 5: "neutral", 6: "neutral",
      7: "bearish", 8: "neutral", 9: "neutral",
      10: "bullish", 11: "neutral", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 1.8,
    tpATRMultiplier: 3.5,
  },
  "PL=F": {
    category: "metals",
    dxyCorrelation: "inverse",
    seasonalBias: {
      1: "bullish", 2: "bullish", 3: "neutral",
      4: "neutral", 5: "neutral", 6: "neutral",
      7: "neutral", 8: "neutral", 9: "bullish",
      10: "bullish", 11: "neutral", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.0,
    tpATRMultiplier: 4.0,
  },
  "CL=F": {
    category: "energy",
    dxyCorrelation: "inverse",
    seasonalBias: {
      1: "bearish", 2: "neutral", 3: "bullish",
      4: "bullish", 5: "bullish", 6: "bullish",
      7: "neutral", 8: "neutral", 9: "bearish",
      10: "bearish", 11: "bearish", 12: "bearish",
    },
    cotSensitive: true,
    swingATRMultiplier: 2.0,
    tpATRMultiplier: 4.5,
  },
  "BZ=F": {
    category: "energy",
    dxyCorrelation: "inverse",
    seasonalBias: {
      1: "bearish", 2: "neutral", 3: "bullish",
      4: "bullish", 5: "bullish", 6: "bullish",
      7: "neutral", 8: "neutral", 9: "bearish",
      10: "bearish", 11: "bearish", 12: "bearish",
    },
    cotSensitive: true,
    swingATRMultiplier: 2.0,
    tpATRMultiplier: 4.5,
  },
  "NG=F": {
    category: "energy",
    dxyCorrelation: "weak",
    seasonalBias: {
      1: "bullish", 2: "bullish", 3: "bearish",
      4: "bearish", 5: "bearish", 6: "neutral",
      7: "bullish", 8: "bullish", 9: "neutral",
      10: "bullish", 11: "bullish", 12: "bullish",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.5,
    tpATRMultiplier: 5.0,
  },
  "RB=F": {
    category: "energy",
    dxyCorrelation: "inverse",
    seasonalBias: {
      1: "neutral", 2: "bullish", 3: "bullish",
      4: "bullish", 5: "bullish", 6: "neutral",
      7: "bearish", 8: "bearish", 9: "bearish",
      10: "neutral", 11: "neutral", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.0,
    tpATRMultiplier: 4.0,
  },
  "ZW=F": {
    category: "agriculture",
    dxyCorrelation: "weak",
    seasonalBias: {
      1: "neutral", 2: "neutral", 3: "bullish",
      4: "bullish", 5: "bullish", 6: "bearish",
      7: "bearish", 8: "bearish", 9: "neutral",
      10: "bullish", 11: "neutral", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.2,
    tpATRMultiplier: 4.5,
  },
  "ZC=F": {
    category: "agriculture",
    dxyCorrelation: "weak",
    seasonalBias: {
      1: "neutral", 2: "neutral", 3: "neutral",
      4: "bullish", 5: "bullish", 6: "bullish",
      7: "neutral", 8: "bearish", 9: "bearish",
      10: "bearish", 11: "bearish", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.0,
    tpATRMultiplier: 4.0,
  },
  "ZS=F": {
    category: "agriculture",
    dxyCorrelation: "weak",
    seasonalBias: {
      1: "neutral", 2: "neutral", 3: "bullish",
      4: "bullish", 5: "bullish", 6: "neutral",
      7: "bearish", 8: "bearish", 9: "bearish",
      10: "neutral", 11: "neutral", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.0,
    tpATRMultiplier: 4.0,
  },
  "KC=F": {
    category: "agriculture",
    dxyCorrelation: "weak",
    seasonalBias: {
      1: "bullish", 2: "bullish", 3: "neutral",
      4: "neutral", 5: "bearish", 6: "bearish",
      7: "neutral", 8: "neutral", 9: "bullish",
      10: "bullish", 11: "neutral", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.5,
    tpATRMultiplier: 5.0,
  },
  "CC=F": {
    category: "agriculture",
    dxyCorrelation: "weak",
    seasonalBias: {
      1: "bullish", 2: "neutral", 3: "neutral",
      4: "neutral", 5: "bullish", 6: "bullish",
      7: "neutral", 8: "neutral", 9: "bullish",
      10: "neutral", 11: "neutral", 12: "neutral",
    },
    cotSensitive: false,
    swingATRMultiplier: 2.2,
    tpATRMultiplier: 4.5,
  },
};

const COMMODITY_ALIASES: Record<string, string> = {
  WTICOUSD: "CL=F",
  BCOUSD: "BZ=F",
  NATGASUSD: "NG=F",
};

function resolveCommodityConfig(symbol: string): CommodityConfig | null {
  const canonical = COMMODITY_ALIASES[symbol] ?? symbol;
  return BASE_COMMODITY_CONFIG[canonical] ?? BASE_COMMODITY_CONFIG[symbol] ?? null;
}

interface DXYContext {
  direction: "rising" | "falling" | "flat";
  strength: number;
}

function getDXYContext(dxyCandles?: Candle[]): DXYContext {
  if (!dxyCandles || dxyCandles.length < 10) {
    return { direction: "flat", strength: 0 };
  }

  const closes = dxyCandles.map(candle => candle.close);
  const current = closes.at(-1) ?? 0;
  const tenBarsAgo = closes.at(-10) ?? current;
  const change = tenBarsAgo !== 0 ? ((current - tenBarsAgo) / tenBarsAgo) * 100 : 0;

  if (change > 0.3) {
    return { direction: "rising", strength: Math.min(100, change * 20) };
  }
  if (change < -0.3) {
    return { direction: "falling", strength: Math.min(100, Math.abs(change) * 20) };
  }
  return { direction: "flat", strength: 0 };
}

function getMonthName(month: number): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]!;
}

function getMacroScore(
  config: CommodityConfig,
  dxy: DXYContext,
  month: number,
): { score: number; notes: string[] } {
  let score = 0;
  const notes: string[] = [];
  const seasonal = config.seasonalBias[month] ?? "neutral";

  if (seasonal === "bullish") {
    score += 15;
    notes.push(`seasonal tailwind (${getMonthName(month)})`);
  }
  if (seasonal === "bearish") {
    score -= 15;
    notes.push(`seasonal headwind (${getMonthName(month)})`);
  }

  if (config.dxyCorrelation === "inverse") {
    if (dxy.direction === "falling") {
      score += 12;
      notes.push("DXY falling - bullish for USD-priced commodity");
    }
    if (dxy.direction === "rising") {
      score -= 12;
      notes.push("DXY rising - bearish for USD-priced commodity");
    }
  } else if (config.dxyCorrelation === "positive") {
    if (dxy.direction === "rising") {
      score += 10;
      notes.push("DXY rising - positive correlation");
    }
    if (dxy.direction === "falling") {
      score -= 10;
      notes.push("DXY falling - negative correlation");
    }
  }

  return { score, notes };
}

export interface CommodityMTFData {
  weekly: Candle[];
  daily: Candle[];
  h4: Candle[];
  h1: Candle[];
  dxy?: Candle[];
}

export interface CommoditySignal {
  symbol: string;
  category: CommodityCategory;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  grade: string;
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  timeframe: string;
  setupType: string;
  reasoning: string;
  weeklyBias: string;
  dailyBias: string;
  h4Bias: string;
  seasonal: string;
  dxyContext: string;
  entryTrigger: string;
  generatedAt: Date;
}

export function scoreCommodityMTF(
  symbol: string,
  mtf: CommodityMTFData,
  livePrice: number,
): CommoditySignal | null {
  const config = resolveCommodityConfig(symbol);
  if (!config) {
    return null;
  }
  if (!mtf.daily?.length || !mtf.h4?.length || !mtf.h1?.length) {
    return null;
  }
  if (mtf.daily.length < 15 || mtf.h4.length < 15) {
    return null;
  }

  const month = new Date().getMonth() + 1;
  const weeklyBias = mtf.weekly.length >= 8 ? detectBias(mtf.weekly, 15) : "ranging";
  const dailyBias = detectBias(mtf.daily, 20);
  const h4Bias = detectBias(mtf.h4, 20);
  const h1Bias = mtf.h1.length >= 10 ? detectBias(mtf.h1, 15) : "ranging";

  const biases = [weeklyBias, dailyBias, h4Bias, h1Bias];
  const bullCount = biases.filter(bias => bias === "bullish").length;
  const bearCount = biases.filter(bias => bias === "bearish").length;

  let overallBias: "bullish" | "bearish" | "ranging" = "ranging";
  if (bullCount >= 3) {
    overallBias = "bullish";
  } else if (bearCount >= 3) {
    overallBias = "bearish";
  } else if (bullCount === 2 && weeklyBias === "bullish" && dailyBias === "bullish") {
    overallBias = "bullish";
  } else if (bearCount === 2 && weeklyBias === "bearish" && dailyBias === "bearish") {
    overallBias = "bearish";
  }

  const dxy = getDXYContext(mtf.dxy);
  const macro = getMacroScore(config, dxy, month);

  const h4OrderBlocks = detectOrderBlocks(mtf.h4);
  void detectFVGs(mtf.h4);
  const h4SdZones = detectSDZones(mtf.h4);
  void detectLiquiditySweeps(mtf.h4);
  const premiumDiscount = getPremiumDiscount(mtf.daily, 60);
  const structure = detectStructureBreaks(mtf.h4);

  const h1OrderBlocks = detectOrderBlocks(mtf.h1);
  const h1Fvgs = detectFVGs(mtf.h1);
  const h1Sweeps = detectLiquiditySweeps(mtf.h1);

  let entryConfluence = 0;
  let entryTrigger = "none";

  const nearH1OrderBlock = h1OrderBlocks.find(orderBlock =>
    livePrice >= orderBlock.low * 0.999 && livePrice <= orderBlock.high * 1.001,
  );
  if (nearH1OrderBlock) {
    entryConfluence += 25;
    entryTrigger = "ob_retest";
  }

  const inH1Fvg = h1Fvgs.find(fvg =>
    livePrice >= fvg.low * 0.999 && livePrice <= fvg.high * 1.001,
  );
  if (inH1Fvg) {
    entryConfluence += 20;
    entryTrigger = "fvg_fill";
  }

  const nearH4SdZone = h4SdZones.find(zone =>
    livePrice >= zone.low * 0.998 && livePrice <= zone.high * 1.002,
  );
  if (nearH4SdZone) {
    entryConfluence += 25;
    if (entryTrigger === "none") {
      entryTrigger = "sd_zone";
    }
  }

  const recentSweep = h1Sweeps.find(sweep => sweep.reversed && sweep.index >= mtf.h1.length - 6);
  if (recentSweep) {
    entryConfluence += 20;
    if (entryTrigger === "none") {
      entryTrigger = "liquidity_sweep";
    }
  }

  let direction: CommoditySignal["direction"] = "NEUTRAL";
  let confidence = 40;

  if (overallBias !== "ranging") {
    const confluenceCount = overallBias === "bullish" ? bullCount : bearCount;
    confidence = 45 + (confluenceCount * 8);

    const macroAdjustment = overallBias === "bullish" ? macro.score : -macro.score;
    confidence += macroAdjustment * 0.4;

    if (overallBias === "bullish" && premiumDiscount.zone === "discount") confidence += 10;
    if (overallBias === "bearish" && premiumDiscount.zone === "premium") confidence += 10;
    if (overallBias === "bullish" && premiumDiscount.zone === "premium") confidence -= 8;
    if (overallBias === "bearish" && premiumDiscount.zone === "discount") confidence -= 8;

    confidence += entryConfluence * 0.2;

    const lastBreak = structure.at(-1);
    if (lastBreak) {
      if (overallBias === "bullish" && lastBreak.direction === "bullish") confidence += 7;
      if (overallBias === "bearish" && lastBreak.direction === "bearish") confidence += 7;
      if (lastBreak.type === "CHoCH") confidence += 5;
    }

    direction = overallBias === "bullish" ? "LONG" : "SHORT";
  }

  confidence = Math.min(93, Math.max(35, confidence));

  const atrValue = Math.max(atr(mtf.h1, 14), livePrice * 0.005);
  let entry = livePrice;
  let stopLoss = livePrice;
  let takeProfit = livePrice;

  if (direction === "LONG") {
    const nearestDemand = h4SdZones
      .filter(zone => zone.type === "demand" && zone.low < livePrice)
      .sort((left, right) => right.low - left.low)[0];
    const nearestBullishOrderBlock = h4OrderBlocks
      .filter(orderBlock => orderBlock.type === "bullish" && orderBlock.low < livePrice)
      .slice(-1)[0];

    stopLoss = nearestDemand
      ? nearestDemand.low - (atrValue * 0.3)
      : nearestBullishOrderBlock
        ? nearestBullishOrderBlock.low - (atrValue * 0.3)
        : livePrice - (atrValue * config.swingATRMultiplier);

    const nearestSupply = h4SdZones
      .filter(zone => zone.type === "supply" && zone.low > livePrice)
      .sort((left, right) => left.low - right.low)[0];

    takeProfit = nearestSupply
      ? nearestSupply.low
      : livePrice + (atrValue * config.tpATRMultiplier);
  } else if (direction === "SHORT") {
    const nearestSupply = h4SdZones
      .filter(zone => zone.type === "supply" && zone.high > livePrice)
      .sort((left, right) => left.high - right.high)[0];
    const nearestBearishOrderBlock = h4OrderBlocks
      .filter(orderBlock => orderBlock.type === "bearish" && orderBlock.high > livePrice)
      .slice(-1)[0];

    stopLoss = nearestSupply
      ? nearestSupply.high + (atrValue * 0.3)
      : nearestBearishOrderBlock
        ? nearestBearishOrderBlock.high + (atrValue * 0.3)
        : livePrice + (atrValue * config.swingATRMultiplier);

    const nearestDemand = h4SdZones
      .filter(zone => zone.type === "demand" && zone.high < livePrice)
      .sort((left, right) => right.high - left.high)[0];

    takeProfit = nearestDemand
      ? nearestDemand.high
      : livePrice - (atrValue * config.tpATRMultiplier);
  }

  const riskReward = stopLoss !== livePrice
    ? Number((Math.abs(takeProfit - entry) / Math.abs(stopLoss - entry)).toFixed(2))
    : 0;

  if (direction !== "NEUTRAL" && riskReward < 1.5) {
    if (direction === "LONG") {
      takeProfit = entry + (Math.abs(entry - stopLoss) * 1.8);
    }
    if (direction === "SHORT") {
      takeProfit = entry - (Math.abs(entry - stopLoss) * 1.8);
    }
  }

  const finalRiskReward = stopLoss !== livePrice
    ? Number((Math.abs(takeProfit - entry) / Math.abs(stopLoss - entry)).toFixed(2))
    : 0;
  const grade = direction === "NEUTRAL" ? "F" : calculateGrade(confidence, finalRiskReward);
  const timeframeSummary = `${Math.max(bullCount, bearCount)}/4 TFs ${overallBias}`;
  const macroNotes = macro.notes.slice(0, 2).join(", ");
  const entryNote = entryTrigger !== "none" ? `Entry: ${entryTrigger.replaceAll("_", " ")}.` : "";
  const pdNote = `Price in ${premiumDiscount.zone} (${premiumDiscount.pct.toFixed(0)}% of range).`;
  const reasoning = direction === "NEUTRAL"
    ? `${symbol}: Mixed signals across timeframes. Waiting for clearer bias.`
    : `${symbol} ${direction} (${config.category}): ${timeframeSummary}. ${macroNotes ? `${macroNotes}. ` : ""}${pdNote} ${entryNote}`.trim();

  return {
    symbol,
    category: config.category,
    direction,
    grade,
    confidence: Math.round(confidence),
    entry: formatPrice(entry, symbol),
    stopLoss: formatPrice(stopLoss, symbol),
    takeProfit: formatPrice(takeProfit, symbol),
    riskReward: finalRiskReward,
    timeframe: "1h",
    setupType: entryTrigger !== "none" ? entryTrigger : "trend_pullback",
    reasoning,
    weeklyBias,
    dailyBias,
    h4Bias,
    seasonal: config.seasonalBias[month] ?? "neutral",
    dxyContext: dxy.direction,
    entryTrigger,
    generatedAt: new Date(),
  };
}
