import type { Candle, PDArrays, PDLocation } from "@/src/smc/types";

export function calculatePDArrays(candles: Candle[], livePrice: number | null): PDArrays {
  const rangeCandles = candles.slice(-50);
  const fallbackPrice = livePrice ?? candles.at(-1)?.close ?? 0;

  if (rangeCandles.length === 0) {
    return {
      rangeHigh: fallbackPrice,
      rangeLow: fallbackPrice,
      equilibrium: fallbackPrice,
      currentLocation: "equilibrium",
      premiumThreshold: fallbackPrice,
      discountThreshold: fallbackPrice,
      currentPricePercent: 50,
      pdLevels: [
        { level: fallbackPrice, label: "0.5 Equilibrium", type: "equilibrium" },
      ],
    };
  }

  const rangeHigh = Math.max(...rangeCandles.map(candle => candle.high));
  const rangeLow = Math.min(...rangeCandles.map(candle => candle.low));
  const rangeSize = Math.max(rangeHigh - rangeLow, 0);
  const equilibrium = (rangeHigh + rangeLow) / 2;
  const price = livePrice ?? rangeCandles.at(-1)?.close ?? equilibrium;
  const currentPricePercent = rangeSize > 0
    ? Math.max(0, Math.min(100, Math.round(((price - rangeLow) / rangeSize) * 100)))
    : 50;

  const currentLocation: PDLocation = price > equilibrium
    ? "premium"
    : price < equilibrium
      ? "discount"
      : "equilibrium";

  const pdLevels = rangeSize <= 0
    ? [{ level: equilibrium, label: "0.5 Equilibrium", type: "equilibrium" as const }]
    : [
      { level: rangeHigh, label: "1.0 Range High", type: "premium" as const },
      { level: rangeLow + (rangeSize * 0.79), label: "0.79 Premium", type: "premium" as const },
      { level: rangeLow + (rangeSize * 0.705), label: "0.705 OTE", type: "premium" as const },
      { level: rangeLow + (rangeSize * 0.62), label: "0.62 Premium", type: "premium" as const },
      { level: equilibrium, label: "0.5 Equilibrium", type: "equilibrium" as const },
      { level: rangeLow + (rangeSize * 0.38), label: "0.38 Discount", type: "discount" as const },
      { level: rangeLow + (rangeSize * 0.295), label: "0.295 OTE", type: "discount" as const },
      { level: rangeLow + (rangeSize * 0.21), label: "0.21 Discount", type: "discount" as const },
      { level: rangeLow, label: "0.0 Range Low", type: "discount" as const },
    ];

  return {
    rangeHigh,
    rangeLow,
    equilibrium,
    currentLocation,
    premiumThreshold: equilibrium,
    discountThreshold: equilibrium,
    currentPricePercent,
    pdLevels,
  };
}

export function scorePDArray(pdArrays: PDArrays, direction: "buy" | "sell" | "neutral"): number {
  if (direction === "neutral") {
    return 0;
  }

  if (direction === "buy" && pdArrays.currentLocation === "discount") {
    return 10;
  }
  if (direction === "sell" && pdArrays.currentLocation === "premium") {
    return 10;
  }
  if (pdArrays.currentLocation === "equilibrium") {
    return 5;
  }
  return 0;
}
