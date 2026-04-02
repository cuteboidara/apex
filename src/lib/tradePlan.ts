import type { FeatureSnapshot, PriceZone, SignalDirection, TradePlan } from "@/src/interfaces/contracts";

type TradePlanInput = {
  snapshot: FeatureSnapshot;
  direction: SignalDirection;
  entryZone?: PriceZone | null;
  invalidationZone?: PriceZone | null;
  expiresAfterBars?: number;
};

function roundPrice(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (Math.abs(value) >= 1000) {
    return Number(value.toFixed(2));
  }

  if (Math.abs(value) >= 1) {
    return Number(value.toFixed(4));
  }

  return Number(value.toFixed(6));
}

function midpoint(zone: PriceZone | null | undefined, fallback: number): number {
  if (!zone) {
    return fallback;
  }

  return (zone.low + zone.high) / 2;
}

function calculateRiskReward(entry: number, stopLoss: number, target: number): number | null {
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  return Number((Math.abs(target - entry) / risk).toFixed(2));
}

export function deriveTradePlan(input: TradePlanInput): TradePlan | null {
  if (input.direction !== "buy" && input.direction !== "sell") {
    return null;
  }

  const snapshot = input.snapshot;
  const entry = midpoint(
    input.entryZone,
    snapshot.features.mid ?? snapshot.features.ema_9 ?? snapshot.features.ema_21 ?? snapshot.features.sma_20 ?? 0,
  );

  if (!Number.isFinite(entry) || entry <= 0) {
    return null;
  }

  const atr = Math.max(snapshot.features.atr_14 ?? 0, entry * 0.0012);
  const structure = snapshot.context.market_structure;
  const session = snapshot.context.session;
  const expiryBars = input.expiresAfterBars ?? 3;
  const expiryMs = expiryBars * (
    snapshot.horizon === "1m" ? 60_000
      : snapshot.horizon === "5m" ? 300_000
        : snapshot.horizon === "15m" ? 900_000
          : snapshot.horizon === "1h" ? 3_600_000
            : 14_400_000
  );
  const stopBuffer = Math.max(atr * 0.18, entry * 0.0004);
  const tpBuffer = Math.max(atr * 0.12, entry * 0.0003);
  const sessionExtension = session.session === "london" || session.session === "new_york";

  if (input.direction === "buy") {
    const structuralFloor = Math.min(
      structure?.recentSwingLow ?? entry - atr,
      structure?.previousSwingLow ?? entry - atr * 1.1,
      entry - atr * 0.6,
    );
    const invalidationZone = input.invalidationZone ?? {
      low: roundPrice(structuralFloor - stopBuffer),
      high: roundPrice(structuralFloor + stopBuffer * 0.35),
      label: "Bullish structure invalidation",
    };
    const sl = roundPrice(Math.min(invalidationZone.low, structuralFloor - stopBuffer));
    const tp1Reference = structure?.recentSwingHigh ?? entry + atr * 2;
    const tp2Reference = structure?.previousSwingHigh ?? entry + atr * 3.2;
    const tp3Reference = sessionExtension ? entry + atr * 4.4 : null;
    const entryZone = input.entryZone ?? {
      low: roundPrice(entry - atr * 0.18),
      high: roundPrice(entry + atr * 0.18),
      label: "Trend pullback entry",
    };

    return {
      entry: roundPrice(entry),
      sl,
      tp1: roundPrice(Math.max(entry + atr, tp1Reference - tpBuffer)),
      tp2: roundPrice(Math.max(entry + atr * 1.8, tp2Reference - tpBuffer)),
      tp3: tp3Reference == null ? null : roundPrice(tp3Reference),
      risk_reward_ratio: calculateRiskReward(entry, sl, Math.max(entry + atr, tp1Reference - tpBuffer)),
      entry_zone: entryZone,
      invalidation_zone: invalidationZone,
      pre_entry_invalidation: "Cancel if price closes below structure before entry triggers.",
      post_entry_invalidation: "Exit if price closes below the invalidation zone after activation.",
      expires_after_bars: expiryBars,
      expires_at: input.snapshot.ts + expiryMs,
    };
  }

  const structuralCeiling = Math.max(
    structure?.recentSwingHigh ?? entry + atr,
    structure?.previousSwingHigh ?? entry + atr * 1.1,
    entry + atr * 0.6,
  );
  const invalidationZone = input.invalidationZone ?? {
    low: roundPrice(structuralCeiling - stopBuffer * 0.35),
    high: roundPrice(structuralCeiling + stopBuffer),
    label: "Bearish structure invalidation",
  };
  const sl = roundPrice(Math.max(invalidationZone.high, structuralCeiling + stopBuffer));
  const tp1Reference = structure?.recentSwingLow ?? entry - atr * 2;
  const tp2Reference = structure?.previousSwingLow ?? entry - atr * 3.2;
  const tp3Reference = sessionExtension ? entry - atr * 4.4 : null;
  const entryZone = input.entryZone ?? {
    low: roundPrice(entry - atr * 0.18),
    high: roundPrice(entry + atr * 0.18),
    label: "Trend pullback entry",
  };

  return {
    entry: roundPrice(entry),
    sl,
    tp1: roundPrice(Math.min(entry - atr, tp1Reference + tpBuffer)),
    tp2: roundPrice(Math.min(entry - atr * 1.8, tp2Reference + tpBuffer)),
    tp3: tp3Reference == null ? null : roundPrice(tp3Reference),
    risk_reward_ratio: calculateRiskReward(entry, sl, Math.min(entry - atr, tp1Reference + tpBuffer)),
    entry_zone: entryZone,
    invalidation_zone: invalidationZone,
    pre_entry_invalidation: "Cancel if price closes above structure before entry triggers.",
    post_entry_invalidation: "Exit if price closes above the invalidation zone after activation.",
    expires_after_bars: expiryBars,
    expires_at: input.snapshot.ts + expiryMs,
  };
}
