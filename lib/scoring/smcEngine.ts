/**
 * SMC/ICT-based scoring engine for APEX.
 *
 * All functions are pure and deterministic: given the same closes[] array and
 * current price they will always produce the same outputs. No API calls are
 * made here — callers supply the data.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type MacroData = {
  fedFundsRate: string | null;
  fedTrend?: string | null;
  cpi: string | null;
  cpiTrend?: string | null;
  treasury10y?: string | null;
  gdp?: string | null;
} | null;

export type NewsItem = {
  title: string;
  source: string;
  publishedAt: string;
  sentiment: string;
};

export type SentimentData = { value: string; label: string } | null;

export type SmcScores = {
  macro: number;
  structure: number;
  zones: number;
  technical: number;
  timing: number;
};

export type SmcContext = {
  bullishBOS: boolean;
  bearishBOS: boolean;
  rsiDivBullish: boolean;
  rsiDivBearish: boolean;
  smcFamily: string;
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function clamp(value: number, min = 0, max = 20): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ── RSI ───────────────────────────────────────────────────────────────────────

/**
 * Returns a full RSI series aligned to the closes array.
 * Positions 0..period-1 are NaN (insufficient history).
 */
export function calcRSISeries(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return closes.map(() => NaN);

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gainSum += d;
    else lossSum += Math.abs(d);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const out: number[] = new Array(period).fill(NaN);
  const firstRS = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRS));

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }

  return out;
}

export function calcRSI(closes: number[], period = 14): number | null {
  const series = calcRSISeries(closes, period);
  const last = series[series.length - 1];
  return Number.isFinite(last) ? last : null;
}

// ── SMA ───────────────────────────────────────────────────────────────────────

export function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ── Swing Highs / Lows ────────────────────────────────────────────────────────

/**
 * closes[0] = oldest, closes[n-1] = newest.
 * Returns prices of the last 3 swing highs (local maxima with 2-bar padding).
 */
export function findSwingHighs(closes: number[]): number[] {
  const result: number[] = [];
  for (let i = 2; i < closes.length - 2; i++) {
    if (
      closes[i] > closes[i - 1] &&
      closes[i] > closes[i - 2] &&
      closes[i] > closes[i + 1] &&
      closes[i] > closes[i + 2]
    ) {
      result.push(closes[i]);
    }
  }
  return result.slice(-3);
}

export function findSwingLows(closes: number[]): number[] {
  const result: number[] = [];
  for (let i = 2; i < closes.length - 2; i++) {
    if (
      closes[i] < closes[i - 1] &&
      closes[i] < closes[i - 2] &&
      closes[i] < closes[i + 1] &&
      closes[i] < closes[i + 2]
    ) {
      result.push(closes[i]);
    }
  }
  return result.slice(-3);
}

// ── Order Block / Zone Detection ──────────────────────────────────────────────

/**
 * Demand zones: local minima where a 3%+ upward move occurred within 5 bars.
 * Returns the last 3 unique zones, prices ascending (oldest first).
 */
export function detectDemandZones(closes: number[]): Array<{ price: number }> {
  const zones: Array<{ price: number }> = [];
  const THRESHOLD = 0.03;

  for (let i = 1; i < closes.length - 5; i++) {
    // Must be a local minimum
    if (closes[i] >= closes[i - 1] && closes[i] >= closes[i + 1]) continue;
    const basePrice = closes[i];
    const futureMax = Math.max(...closes.slice(i + 1, i + 6));
    if ((futureMax - basePrice) / basePrice >= THRESHOLD) {
      zones.push({ price: basePrice });
    }
  }

  // Deduplicate zones within 1% of each other, keep last 3
  const unique: Array<{ price: number }> = [];
  for (const zone of zones.slice(-12)) {
    const isDup = unique.some(u => Math.abs(u.price - zone.price) / zone.price < 0.01);
    if (!isDup) unique.push(zone);
  }
  return unique.slice(-3);
}

/**
 * Supply zones: local maxima where a 3%+ downward move occurred within 5 bars.
 */
export function detectSupplyZones(closes: number[]): Array<{ price: number }> {
  const zones: Array<{ price: number }> = [];
  const THRESHOLD = 0.03;

  for (let i = 1; i < closes.length - 5; i++) {
    if (closes[i] <= closes[i - 1] && closes[i] <= closes[i + 1]) continue;
    const basePrice = closes[i];
    const futureMin = Math.min(...closes.slice(i + 1, i + 6));
    if ((basePrice - futureMin) / basePrice >= THRESHOLD) {
      zones.push({ price: basePrice });
    }
  }

  const unique: Array<{ price: number }> = [];
  for (const zone of zones.slice(-12)) {
    const isDup = unique.some(u => Math.abs(u.price - zone.price) / zone.price < 0.01);
    if (!isDup) unique.push(zone);
  }
  return unique.slice(-3);
}

// ── RSI Divergence ────────────────────────────────────────────────────────────

export function detectRSIDivergence(
  closes: number[],
  rsiSeries: number[]
): { bullish: boolean; bearish: boolean } {
  const n = Math.min(closes.length, rsiSeries.length, 20);
  if (n < 8) return { bullish: false, bearish: false };

  const recentCloses = closes.slice(-n);
  const recentRSI = rsiSeries.slice(-n);

  const lows: Array<{ price: number; rsi: number }> = [];
  const highs: Array<{ price: number; rsi: number }> = [];

  for (let i = 1; i < recentCloses.length - 1; i++) {
    if (!Number.isFinite(recentRSI[i])) continue;
    if (recentCloses[i] < recentCloses[i - 1] && recentCloses[i] < recentCloses[i + 1]) {
      lows.push({ price: recentCloses[i], rsi: recentRSI[i] });
    }
    if (recentCloses[i] > recentCloses[i - 1] && recentCloses[i] > recentCloses[i + 1]) {
      highs.push({ price: recentCloses[i], rsi: recentRSI[i] });
    }
  }

  let bullish = false;
  let bearish = false;

  if (lows.length >= 2) {
    const [prev, curr] = lows.slice(-2);
    // Price lower low, RSI higher low = bullish divergence
    if (curr.price < prev.price && curr.rsi > prev.rsi) bullish = true;
  }
  if (highs.length >= 2) {
    const [prev, curr] = highs.slice(-2);
    // Price higher high, RSI lower high = bearish divergence
    if (curr.price > prev.price && curr.rsi < prev.rsi) bearish = true;
  }

  return { bullish, bearish };
}

// ── Macro direction helpers ───────────────────────────────────────────────────

const USD_BASE_PAIRS = ["USDCAD", "USDCHF"]; // USD strong → pair goes UP
const USD_QUOTE_PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"]; // USD strong → pair goes DOWN
const JPY_PAIRS = ["USDJPY", "EURJPY", "GBPJPY"];

function parseMacroNum(raw: string | null | undefined): number {
  const n = parseFloat(raw ?? "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * Returns the macro-implied directional bias for this asset.
 * "LONG" / "SHORT" / null (neutral / unclear).
 */
export function macroDirectionFor(
  symbol: string,
  assetClass: string,
  macro: MacroData,
  sentiment: SentimentData
): "LONG" | "SHORT" | null {
  const fedFunds = parseMacroNum(macro?.fedFundsRate);
  const fedTrend = macro?.fedTrend ?? "flat";
  const cpiTrend = macro?.cpiTrend ?? "flat";
  const treasury = parseMacroNum(macro?.treasury10y);

  if (assetClass === "FOREX") {
    if (JPY_PAIRS.includes(symbol)) {
      // BOJ structurally loose → JPY weak bias → these pairs tend long
      return "LONG";
    }
    // USD bias from rate level + trend
    let usdBias = 0;
    if (fedFunds > 4.5) usdBias++;
    if (fedFunds < 3.5) usdBias--;
    if (fedTrend === "rising") usdBias++;
    if (fedTrend === "falling") usdBias--;

    if (usdBias > 0) {
      return USD_BASE_PAIRS.includes(symbol) ? "LONG" : "SHORT";
    }
    if (usdBias < 0) {
      return USD_QUOTE_PAIRS.includes(symbol) ? "LONG" : "SHORT";
    }
    return null; // neutral
  }

  if (assetClass === "COMMODITY") {
    // Rising CPI or falling Fed → metals bullish; high treasury → headwind
    let score = 0;
    if (cpiTrend === "rising") score++;
    if (fedTrend === "falling") score++;
    if (treasury > 4.5) score--;
    if (score > 0) return "LONG";
    if (score < 0) return "SHORT";
    return null;
  }

  if (assetClass === "CRYPTO") {
    const fg = parseMacroNum(sentiment?.value) || 50;
    if (fg < 35) return "LONG";  // fear zone → contrarian buy
    if (fg > 65) return "SHORT"; // greed zone → contrarian sell
    return null;
  }

  return null;
}

// ── DIMENSION 1: Macro ────────────────────────────────────────────────────────

export function scoreMacroSMC(
  symbol: string,
  assetClass: string,
  macro: MacroData,
  sentiment: SentimentData,
  direction: "LONG" | "SHORT"
): number {
  const fedFunds = parseMacroNum(macro?.fedFundsRate);
  const fedTrend = macro?.fedTrend ?? "flat";
  const cpiTrend = macro?.cpiTrend ?? "flat";
  const treasury = parseMacroNum(macro?.treasury10y);

  if (assetClass === "FOREX") {
    if (JPY_PAIRS.includes(symbol)) {
      // BOJ ultra-loose → JPY weak → LONG pairs benefit
      return direction === "LONG" ? clamp(8) : clamp(2);
    }

    let usdBias = 0;
    if (fedFunds > 4.5) usdBias++;
    if (fedFunds < 3.5) usdBias--;
    if (fedTrend === "rising") usdBias++;
    if (fedTrend === "falling") usdBias--;

    if (usdBias > 0) {
      const aligned =
        (USD_BASE_PAIRS.includes(symbol) && direction === "LONG") ||
        (USD_QUOTE_PAIRS.includes(symbol) && direction === "SHORT");
      return aligned ? clamp(10) : clamp(2);
    }
    if (usdBias < 0) {
      const aligned =
        (USD_QUOTE_PAIRS.includes(symbol) && direction === "LONG") ||
        (USD_BASE_PAIRS.includes(symbol) && direction === "SHORT");
      return aligned ? clamp(10) : clamp(2);
    }
    return 5; // neutral USD environment
  }

  if (assetClass === "COMMODITY") {
    let score = 5;
    if (direction === "LONG") {
      if (cpiTrend === "rising") score += 5;
      if (fedTrend === "falling") score += 4;
      if (treasury < 4.5) score += 2;
      if (treasury > 4.5) score -= 4;
    } else {
      if (treasury > 4.5) score += 3;
      if (cpiTrend === "falling") score += 3;
      if (fedTrend === "rising") score += 2;
      if (cpiTrend === "rising") score -= 4;
    }
    // If opposed to macro, cap at 3
    const macroBias = macroDirectionFor(symbol, assetClass, macro, sentiment);
    if (macroBias && macroBias !== direction) return Math.min(3, clamp(score));
    return clamp(score);
  }

  if (assetClass === "CRYPTO") {
    const fg = parseMacroNum(sentiment?.value) || 50;
    if (fg < 25 && direction === "LONG") return clamp(11);  // extreme fear contrarian long
    if (fg > 75 && direction === "SHORT") return clamp(9);  // extreme greed contrarian short
    if (fg < 25 && direction === "SHORT") return clamp(2);  // against contrarian
    if (fg > 75 && direction === "LONG") return clamp(2);   // against contrarian
    return clamp(7); // neutral 25-75 range
  }

  return !macro ? 5 : 6;
}

// ── DIMENSION 2: Structure ────────────────────────────────────────────────────

export type StructureResult = {
  score: number;
  bullishBOS: boolean;
  bearishBOS: boolean;
};

export function scoreStructureSMC(
  closes: number[],
  currentPrice: number,
  direction: "LONG" | "SHORT"
): StructureResult {
  if (closes.length < 10) {
    return { score: 3, bullishBOS: false, bearishBOS: false };
  }

  const swingHighs = findSwingHighs(closes);
  const swingLows = findSwingLows(closes);
  const lastSwingHigh = swingHighs[swingHighs.length - 1] ?? null;
  const lastSwingLow = swingLows[swingLows.length - 1] ?? null;
  const prevSwingHigh = swingHighs[swingHighs.length - 2] ?? null;

  const bullishBOS = lastSwingHigh != null && currentPrice > lastSwingHigh;
  const bearishBOS = lastSwingLow != null && currentPrice < lastSwingLow;

  // CHoCH: after bearish leg, price breaks a prior swing high (potential reversal)
  const choch =
    !bullishBOS &&
    bearishBOS &&
    prevSwingHigh != null &&
    currentPrice > prevSwingHigh;

  let score = 0;

  if (bullishBOS) {
    score = direction === "LONG" ? 14 : 4; // BOS bullish favors LONG strongly
  } else if (bearishBOS) {
    score = direction === "SHORT" ? 14 : 4; // BOS bearish favors SHORT strongly
  } else if (choch) {
    score = direction === "LONG" ? 6 : 3;
  } else if (lastSwingHigh != null && lastSwingLow != null) {
    // Price ranging between swing high and low
    score = 3;
  } else {
    score = 1;
  }

  // Trend alignment bonus
  if (bullishBOS && direction === "LONG") score += 6;
  if (bearishBOS && direction === "SHORT") score += 6;

  // Trading against confirmed BOS = penalise
  if (bullishBOS && direction === "SHORT") score = Math.min(score, 4);
  if (bearishBOS && direction === "LONG") score = Math.min(score, 4);

  return { score: clamp(score), bullishBOS, bearishBOS };
}

// ── DIMENSION 3: Zones ────────────────────────────────────────────────────────

export function scoreZonesSMC(
  closes: number[],
  currentPrice: number,
  direction: "LONG" | "SHORT"
): number {
  if (closes.length < 10) return 4;

  const demandZones = detectDemandZones(closes);
  const supplyZones = detectSupplyZones(closes);

  // Distance from current price to nearest relevant zone (as fraction)
  function nearestDist(zones: Array<{ price: number }>): number {
    if (zones.length === 0) return Infinity;
    return Math.min(...zones.map(z => Math.abs(currentPrice - z.price) / currentPrice));
  }

  const demandDist = nearestDist(demandZones);
  const supplyDist = nearestDist(supplyZones);

  let score = 0;

  if (direction === "LONG") {
    if (demandDist <= 0.003) score = 18;        // within 0.3% of demand
    else if (demandDist <= 0.005) score = 14;   // within 0.5%
    else if (demandDist <= 0.01) score = 8;     // within 1%
    else if (demandDist > 0.02) score = 2;      // far from all zones
    else score = 4;

    // At supply side → penalty
    if (supplyDist <= 0.005) score = Math.min(score, 4);
  } else {
    if (supplyDist <= 0.003) score = 18;
    else if (supplyDist <= 0.005) score = 14;
    else if (supplyDist <= 0.01) score = 8;
    else if (supplyDist > 0.02) score = 2;
    else score = 4;

    if (demandDist <= 0.005) score = Math.min(score, 4);
  }

  // Midpoint between nearest supply and demand = unfavourable
  if (demandZones.length > 0 && supplyZones.length > 0) {
    const nearestDemand = demandZones[demandZones.length - 1].price;
    const nearestSupply = supplyZones[supplyZones.length - 1].price;
    if (nearestSupply > nearestDemand) {
      const mid = (nearestDemand + nearestSupply) / 2;
      const distFromMid = Math.abs(currentPrice - mid) / currentPrice;
      if (distFromMid <= 0.005) score = Math.min(score, 3); // at midpoint = unfavourable
    }
  }

  return clamp(score);
}

// ── DIMENSION 4: Technical ────────────────────────────────────────────────────

export function scoreTechnicalSMC(
  closes: number[],
  rsi: number | null,
  direction: "LONG" | "SHORT"
): number {
  if (closes.length < 5) return 0;

  let score = 0;

  // RSI scoring
  if (rsi != null) {
    if (direction === "LONG") {
      if (rsi < 28) score += 7;
      else if (rsi < 35) score += 5;
      else if (rsi >= 45 && rsi <= 55) score += 1;
    } else {
      if (rsi > 72) score += 7;
      else if (rsi > 65) score += 5;
      else if (rsi >= 45 && rsi <= 55) score += 1;
    }

    // RSI divergence bonus (+5)
    const rsiSeries = calcRSISeries(closes);
    const div = detectRSIDivergence(closes, rsiSeries);
    if (direction === "LONG" && div.bullish) score += 5;
    if (direction === "SHORT" && div.bearish) score += 5;
  }

  // SMA trend confirmation (+5)
  const sma20 = calcSMA(closes, 20);
  const sma20prev = calcSMA(closes.slice(0, -3), 20); // SMA 3 bars ago
  const currentPrice = closes[closes.length - 1];
  if (sma20 != null && sma20prev != null) {
    const smaSloping = sma20 > sma20prev;
    if (direction === "LONG" && currentPrice > sma20 && smaSloping) score += 5;
    if (direction === "SHORT" && currentPrice < sma20 && !smaSloping) score += 5;
  }

  // Momentum: last 3 candles all in same direction (+3)
  if (closes.length >= 4) {
    const last3 = closes.slice(-4);
    const allBullish = last3[1] > last3[0] && last3[2] > last3[1] && last3[3] > last3[2];
    const allBearish = last3[1] < last3[0] && last3[2] < last3[1] && last3[3] < last3[2];
    if (direction === "LONG" && allBullish) score += 3;
    if (direction === "SHORT" && allBearish) score += 3;
  }

  return clamp(score);
}

// ── DIMENSION 5: Timing ───────────────────────────────────────────────────────

export function scoreTimingSMC(
  assetClass: string,
  symbol: string,
  news: NewsItem[],
  direction: "LONG" | "SHORT"
): number {
  const utcHour = new Date().getUTCHours();
  let score = 0;

  if (assetClass === "CRYPTO") {
    // Crypto is 24/7; NY hours get extra
    score = utcHour >= 13 && utcHour < 21 ? 8 : 5;
  } else {
    const isJPY = JPY_PAIRS.includes(symbol);
    const isMetal = assetClass === "COMMODITY";

    if (utcHour >= 13 && utcHour < 16) {
      // London/NY overlap — peak liquidity for everything
      score = 10;
    } else if (utcHour >= 13 && utcHour < 15) {
      // NY open
      score = 8;
    } else if (utcHour >= 7 && utcHour < 9) {
      // London open
      score = 8;
    } else if (utcHour >= 0 && utcHour < 7) {
      // Asian session
      score = isJPY ? 5 : 2;
    } else if (utcHour >= 20 && utcHour < 23) {
      // Dead zone
      score = 1;
    } else {
      score = 3; // other hours
    }

    if (isMetal && (utcHour >= 13 && utcHour < 21)) score = Math.max(score, 8);
  }

  // News proximity (<2 hours) bonus/penalty
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const recentNews = news.filter(n => {
    const ts = Date.parse(n.publishedAt);
    return Number.isFinite(ts) && ts >= twoHoursAgo;
  });

  if (recentNews.length > 0) {
    const bullishCount = recentNews.filter(n => n.sentiment === "bullish").length;
    const bearishCount = recentNews.filter(n => n.sentiment === "bearish").length;

    if (direction === "LONG" && bullishCount > bearishCount) score += 4;
    else if (direction === "SHORT" && bearishCount > bullishCount) score += 4;
    else if (direction === "LONG" && bearishCount > bullishCount) score -= 2;
    else if (direction === "SHORT" && bullishCount > bearishCount) score -= 2;
  }

  return clamp(score);
}

// ── Direction derivation ──────────────────────────────────────────────────────

/**
 * Derive direction from structure (BOS) + macro confluence.
 * Structure wins on conflict. RSI and symbol parity are final fallbacks.
 */
export function deriveDirectionSMC(
  closes: number[],
  currentPrice: number,
  symbol: string,
  assetClass: string,
  macro: MacroData,
  sentiment: SentimentData
): "LONG" | "SHORT" {
  // 1. Structure signal
  const swingHighs = findSwingHighs(closes);
  const swingLows = findSwingLows(closes);
  const lastSwingHigh = swingHighs[swingHighs.length - 1] ?? null;
  const lastSwingLow = swingLows[swingLows.length - 1] ?? null;

  let structureSignal: "LONG" | "SHORT" | null = null;
  if (lastSwingHigh != null && currentPrice > lastSwingHigh) {
    structureSignal = "LONG"; // bullish BOS
  } else if (lastSwingLow != null && currentPrice < lastSwingLow) {
    structureSignal = "SHORT"; // bearish BOS
  }

  // 2. Macro signal
  const macroSignal = macroDirectionFor(symbol, assetClass, macro, sentiment);

  // 3. Confluence: both agree → clear, conflict → structure wins
  if (structureSignal && macroSignal) {
    return structureSignal === macroSignal ? structureSignal : structureSignal;
  }
  if (structureSignal) return structureSignal;
  if (macroSignal) return macroSignal;

  // 4. RSI fallback
  const rsi = calcRSI(closes);
  if (rsi != null) {
    if (rsi < 45) return "LONG";
    if (rsi > 55) return "SHORT";
  }

  // 5. Deterministic tiebreaker (no bias towards either side)
  const symbolParity = Array.from(symbol).reduce((s, c) => s + c.charCodeAt(0), 0);
  return symbolParity % 2 === 0 ? "LONG" : "SHORT";
}

// ── Setup family classification ───────────────────────────────────────────────

export function classifySmcFamily(
  scores: SmcScores,
  ctx: Pick<SmcContext, "rsiDivBullish" | "rsiDivBearish" | "bullishBOS" | "bearishBOS">
): string {
  if (scores.zones >= 14 && scores.structure >= 12) return "Order Block Entry";
  if (scores.technical >= 14 && scores.structure >= 8) return "RSI Extreme Reversal";
  if (scores.macro >= 16 && scores.structure >= 12) return "Macro Trend Continuation";
  if (ctx.rsiDivBullish || ctx.rsiDivBearish) return "Divergence Play";
  const dims = Object.values(scores);
  const moderate = dims.filter(v => v >= 8 && v <= 12).length;
  if (moderate >= 3) return "Confluence Zone";
  return "Structure Break";
}

// ── Publication threshold ─────────────────────────────────────────────────────

/**
 * Returns true when the score profile is strong enough to publish a non-Silent signal.
 * - total >= 38 (conservative floor)
 * - at least 3 of 5 dimensions > 0
 * - macro AND structure both > 0
 */
export function meetsPublicationThreshold(scores: SmcScores): boolean {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total < 38) return false;
  const dims = Object.values(scores);
  if (dims.filter(v => v > 0).length < 3) return false;
  if (scores.macro === 0 || scores.structure === 0) return false;
  return true;
}
