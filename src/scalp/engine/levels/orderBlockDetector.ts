import type { ScalpCandle } from "@/src/scalp/types/scalpTypes";

export type SimpleOrderBlock = {
  type: "bullish" | "bearish";
  price: number;
};

export function detectSimpleOrderBlocks(candles1h: ScalpCandle[]): SimpleOrderBlock[] {
  if (candles1h.length < 12) return [];

  const blocks: SimpleOrderBlock[] = [];
  const recent = candles1h.slice(-24);

  for (let i = 1; i < recent.length - 1; i += 1) {
    const prev = recent[i - 1];
    const cur = recent[i];
    const next = recent[i + 1];

    const bullishImpulse = next.close > cur.high && cur.close < cur.open;
    const bearishImpulse = next.close < cur.low && cur.close > cur.open;

    if (bullishImpulse) {
      blocks.push({ type: "bullish", price: cur.low });
    }
    if (bearishImpulse) {
      blocks.push({ type: "bearish", price: cur.high });
    }

    // Keep only recent likely blocks.
    if (blocks.length >= 8) break;
    void prev;
  }

  return blocks;
}
