import type { Candle, LiquidityLevel, LiquiditySweep } from "@/src/smc/types";

const SWING_LOOKBACK = 5;

function priceTolerance(candles: Candle[]): number {
  const last = candles.at(-1)?.close ?? 1;
  return last >= 20 ? 0.03 : 0.0003;
}

function buildSweepMetadata(level: Omit<LiquidityLevel, "swept" | "sweepTime" | "sweepCandle">, futureCandles: Candle[]): LiquidityLevel {
  const sweepCandle = futureCandles.find(candle =>
    level.side === "buyside" ? candle.high > level.price : candle.low < level.price,
  );

  return {
    ...level,
    swept: Boolean(sweepCandle),
    sweepTime: sweepCandle?.time,
    sweepCandle,
  };
}

function detectEqualHighLowLevels(candles: Candle[]): LiquidityLevel[] {
  if (candles.length < 8) {
    return [];
  }

  const recent = candles.slice(-80);
  const tolerance = priceTolerance(recent);
  const levels: LiquidityLevel[] = [];

  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    if (!previous || !current) {
      continue;
    }

    if (Math.abs(previous.high - current.high) <= tolerance) {
      levels.push(buildSweepMetadata({
        side: "buyside",
        price: Number(((previous.high + current.high) / 2).toFixed(6)),
        time: current.time,
        type: "equal_highs",
      }, recent.slice(index + 1)));
    }

    if (Math.abs(previous.low - current.low) <= tolerance) {
      levels.push(buildSweepMetadata({
        side: "sellside",
        price: Number(((previous.low + current.low) / 2).toFixed(6)),
        time: current.time,
        type: "equal_lows",
      }, recent.slice(index + 1)));
    }
  }

  return levels;
}

function detectPreviousDayLevels(candles: Candle[]): LiquidityLevel[] {
  if (candles.length === 0) {
    return [];
  }

  const lastTime = candles.at(-1)?.time ?? 0;
  const currentDay = new Date(lastTime);
  currentDay.setUTCHours(0, 0, 0, 0);
  const previousDayStart = currentDay.getTime() - 24 * 60 * 60_000;
  const previousDayEnd = currentDay.getTime();

  const previousDayCandles = candles.filter(candle => candle.time >= previousDayStart && candle.time < previousDayEnd);
  if (previousDayCandles.length === 0) {
    return [];
  }

  const high = Math.max(...previousDayCandles.map(candle => candle.high));
  const low = Math.min(...previousDayCandles.map(candle => candle.low));
  const futureCandles = candles.filter(candle => candle.time >= previousDayEnd);

  return [
    buildSweepMetadata({
      side: "buyside",
      price: high,
      time: previousDayCandles.at(-1)?.time ?? previousDayEnd,
      type: "previous_day_high",
    }, futureCandles),
    buildSweepMetadata({
      side: "sellside",
      price: low,
      time: previousDayCandles.at(-1)?.time ?? previousDayEnd,
      type: "previous_day_low",
    }, futureCandles),
  ];
}

export function detectLiquidityLevels(candles: Candle[]): LiquidityLevel[] {
  const recent = candles.slice(-120);
  if (recent.length < (SWING_LOOKBACK * 2) + 1) {
    return [];
  }

  const levels: LiquidityLevel[] = [];

  for (let index = SWING_LOOKBACK; index < recent.length - SWING_LOOKBACK; index += 1) {
    const candle = recent[index];
    if (!candle) {
      continue;
    }

    const left = recent.slice(index - SWING_LOOKBACK, index);
    const right = recent.slice(index + 1, index + SWING_LOOKBACK + 1);
    const isSwingHigh = left.every(bar => bar.high < candle.high) && right.every(bar => bar.high < candle.high);
    const isSwingLow = left.every(bar => bar.low > candle.low) && right.every(bar => bar.low > candle.low);

    if (isSwingHigh) {
      levels.push(buildSweepMetadata({
        side: "buyside",
        price: candle.high,
        time: candle.time,
        type: "swing_high",
      }, recent.slice(index + 1)));
    }

    if (isSwingLow) {
      levels.push(buildSweepMetadata({
        side: "sellside",
        price: candle.low,
        time: candle.time,
        type: "swing_low",
      }, recent.slice(index + 1)));
    }
  }

  return [...levels, ...detectEqualHighLowLevels(recent), ...detectPreviousDayLevels(recent)]
    .sort((left, right) => right.time - left.time)
    .slice(0, 10);
}

export function detectRecentSweeps(candles: Candle[], levels: LiquidityLevel[]): LiquiditySweep[] {
  const recent = candles.slice(-20);
  const sweeps: LiquiditySweep[] = [];

  for (const level of levels.filter(item => item.swept && item.sweepTime != null && item.sweepCandle != null)) {
    const index = recent.findIndex(candle => candle.time === level.sweepTime);
    if (index < 0) {
      continue;
    }

    const sweepCandle = recent[index];
    if (!sweepCandle) {
      continue;
    }
    const postSweep = recent.slice(index + 1, index + 4);

    let reversal = false;
    let reversalStrength: LiquiditySweep["reversalStrength"] = "none";

    if (level.side === "buyside" && postSweep.length > 0) {
      reversal = (postSweep.at(-1)?.close ?? sweepCandle.close) < sweepCandle.open;
      if (reversal) {
        const closesLower = postSweep.every((candle, candleIndex) => candleIndex === 0 || candle.close < (postSweep[candleIndex - 1]?.close ?? candle.close));
        reversalStrength = closesLower ? "strong" : "moderate";
      }
    }

    if (level.side === "sellside" && postSweep.length > 0) {
      reversal = (postSweep.at(-1)?.close ?? sweepCandle.close) > sweepCandle.open;
      if (reversal) {
        const closesHigher = postSweep.every((candle, candleIndex) => candleIndex === 0 || candle.close > (postSweep[candleIndex - 1]?.close ?? candle.close));
        reversalStrength = closesHigher ? "strong" : "moderate";
      }
    }

    sweeps.push({
      side: level.side,
      level,
      sweepCandle,
      reversal,
      reversalStrength,
    });
  }

  return sweeps.sort((left, right) => right.sweepCandle.time - left.sweepCandle.time).slice(0, 5);
}

export function scoreLiquidity(
  levels: LiquidityLevel[],
  sweeps: LiquiditySweep[],
  direction: "buy" | "sell" | "neutral",
  livePrice: number | null,
): number {
  if (!livePrice || direction === "neutral") {
    return 0;
  }

  const reversingSweep = sweeps.find(sweep =>
    sweep.reversal
    && (
      (direction === "buy" && sweep.side === "sellside")
      || (direction === "sell" && sweep.side === "buyside")
    ),
  );
  if (reversingSweep) {
    return reversingSweep.reversalStrength === "strong" ? 10 : 8;
  }

  const targetLiquidity = levels.find(level =>
    !level.swept
    && (
      (direction === "sell" && level.side === "buyside" && level.price > livePrice)
      || (direction === "buy" && level.side === "sellside" && level.price < livePrice)
    ),
  );
  if (targetLiquidity) {
    return 5;
  }

  return 2;
}
