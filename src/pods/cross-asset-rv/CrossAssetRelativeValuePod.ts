import type { DirectionalPodOutput, FeatureSnapshot } from "@/src/interfaces/contracts";
import { BaseAlphaPod } from "@/src/pods/base";

const CORRELATED_PAIRS: Record<string, string> = {
  EURUSD: "GBPUSD",
  GBPUSD: "EURUSD",
};

export class CrossAssetRelativeValuePod extends BaseAlphaPod {
  constructor(private readonly getLatestSnapshot: (symbol: string) => FeatureSnapshot | null) {
    super("cross-asset-rv", "2.0.0", "directional");
  }

  async evaluate(snapshot: FeatureSnapshot): Promise<DirectionalPodOutput> {
    const pair = CORRELATED_PAIRS[snapshot.symbol_canonical];
    const pairSnapshot = pair ? this.getLatestSnapshot(pair) : null;
    const ownMomentum = this.getFeature(snapshot, "price_momentum_1h");
    const pairMomentum = pairSnapshot ? pairSnapshot.features.price_momentum_1h ?? 0 : 0;
    const divergence = ownMomentum - pairMomentum;
    const direction: DirectionalPodOutput["direction"] = divergence > 0.8
      ? "sell"
      : divergence < -0.8
        ? "buy"
        : "none";
    const mid = this.getFeature(snapshot, "mid");
    const atr = Math.max(this.getFeature(snapshot, "atr_14"), Math.abs(mid) * 0.0005);

    return this.buildDirectionalOutput({
      snapshot,
      signalType: "predictive",
      direction,
      confidence: direction === "none" ? 0.18 : Math.min(0.75, 0.38 + Math.abs(divergence) * 0.1),
      score: Math.min(1, Math.abs(divergence) * 0.4),
      entryStyle: "support",
      regime: "normal",
      regimeAlignment: 0.3,
      tradeabilityAlignment: 0.35,
      entryZone: {
        low: mid - atr * 0.2,
        high: mid + atr * 0.2,
        label: "Legacy RV zone",
      },
      invalidationZone: {
        low: mid - atr * 0.8,
        high: mid + atr * 0.8,
        label: "Legacy RV invalidation",
      },
      diagnostics: {
        paired_symbol: pair ?? null,
        divergence_zscore: divergence,
        pair_snapshot_available: Boolean(pairSnapshot),
      },
      rationale: [
        "Legacy cross-asset relative value pod remains in the codebase but is outside the default Phase 10 scope.",
      ],
      constraints: {
        legacy_scope: true,
        requires_pair: true,
      },
    });
  }
}
