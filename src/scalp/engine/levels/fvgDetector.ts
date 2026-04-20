import type { ScalpCandle } from "@/src/scalp/types/scalpTypes";

export type SimpleFvg = {
  type: "bullish" | "bearish";
  price: number;
};

export function detectSimpleFvgs(candles15m: ScalpCandle[]): SimpleFvg[] {
  if (candles15m.length < 6) return [];

  const fvgs: SimpleFvg[] = [];
  const recent = candles15m.slice(-30);

  for (let i = 2; i < recent.length; i += 1) {
    const a = recent[i - 2];
    const b = recent[i - 1];
    const c = recent[i];

    if (a.high < c.low) {
      fvgs.push({ type: "bullish", price: (a.high + c.low) / 2 });
    }
    if (a.low > c.high) {
      fvgs.push({ type: "bearish", price: (a.low + c.high) / 2 });
    }

    void b;
  }

  return fvgs.slice(-8);
}
