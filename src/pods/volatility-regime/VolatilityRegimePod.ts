import { BaseAlphaPod } from "@/src/pods/base";
import type { FeatureSnapshot, GatingPodOutput, NoTradeReasonCode, VolatilityRegimeState } from "@/src/interfaces/contracts";
import { decodeVolatilityRegime } from "@/src/interfaces/contracts";

export class VolatilityRegimePod extends BaseAlphaPod {
  constructor() {
    super("volatility-regime", "2.0.0", "gating");
  }

  async evaluate(snapshot: FeatureSnapshot): Promise<GatingPodOutput> {
    const raw = snapshot.features.volatility_regime;
    const state = decodeVolatilityRegime(raw) as VolatilityRegimeState;
    const tradeability = snapshot.context.tradeability;
    const vetoReasons: NoTradeReasonCode[] = [];
    let gateStatus: GatingPodOutput["gate_status"] = "allow";

    if (tradeability?.volatilityState === "too_high" || state === "high_vol_chaotic") {
      gateStatus = "block";
      vetoReasons.push("VOL_TOO_HIGH", "CONFLICTING_REGIME");
    } else if (tradeability?.volatilityState === "too_low") {
      gateStatus = "warn";
      vetoReasons.push("VOL_TOO_LOW");
    }

    return this.buildGatingOutput({
      snapshot,
      signalType: "regime",
      confidence: state === "high_vol_chaotic" ? 0.9 : state === "compressing" ? 0.72 : 0.66,
      gateStatus,
      vetoReasons,
      stateAssessment: state,
      diagnostics: {
        state,
        spread_bps: snapshot.features.spread_bps ?? 0,
        volatility_raw: snapshot.features.volatility_raw ?? 0,
        tradeability_volatility_state: tradeability?.volatilityState ?? "acceptable",
      },
      rationale: [
        state === "high_vol_chaotic"
          ? "Volatility is chaotic enough to block new intraday signals."
          : state === "compressing"
            ? "Compression is present, so trend continuation should be treated carefully."
            : "Volatility regime remains tradable.",
      ],
    });
  }
}
