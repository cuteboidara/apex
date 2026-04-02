import { clamp01, type DirectionalPodOutput, type FeatureSnapshot, type SignalRegime } from "@/src/interfaces/contracts";
import { BaseAlphaPod } from "@/src/pods/base";
import { rescoreSMCAnalysis, smcVerdictBonus } from "@/src/smc";

function makeZone(center: number, width: number, label: string) {
  return {
    low: center - width,
    high: center + width,
    label,
  };
}

export class MeanReversionPod extends BaseAlphaPod {
  constructor() {
    super("mean-reversion", "2.0.0", "directional");
  }

  async evaluate(snapshot: FeatureSnapshot): Promise<DirectionalPodOutput> {
    const pctB = this.getFeature(snapshot, "bollinger_pct_b");
    const rsi = this.getFeature(snapshot, "rsi_14");
    const mid = this.getFeature(snapshot, "mid");
    const atr = Math.max(this.getFeature(snapshot, "atr_14"), Math.abs(mid) * 0.0005);
    const structure = snapshot.context.market_structure;
    const sessionFeatures = snapshot.context.session_features;
    const tradeability = snapshot.context.tradeability;
    const regimeState = this.getVolatilityRegime(snapshot);
    const rangeOnly = regimeState === "compressing"
      || sessionFeatures?.sessionCompressionState === "compressed"
      || structure?.structureBias === "neutral"
      || (!sessionFeatures && !structure);

    let direction: DirectionalPodOutput["direction"] = "none";
    if (rangeOnly) {
      if (pctB < 0.16 && rsi < 36) {
        direction = "buy";
      } else if (pctB > 0.84 && rsi > 64) {
        direction = "sell";
      }
    }

    const regime: SignalRegime = rangeOnly ? "range" : "trend";
    const edge = direction === "none"
      ? 0.15
      : Math.min(0.9, Math.abs(0.5 - pctB) + Math.abs(50 - rsi) / 100);
    const tradeabilityAlignment = tradeability?.rewardToRiskFeasible ? 0.7 : 0.35;
    const baseConfidence = direction === "none"
      ? rangeOnly ? 0.2 : 0.08
      : 0.42 + (edge * 0.2) + ((tradeability?.rewardToRiskPotential ?? 1) * 0.04);
    const entryZone = makeZone(mid, Math.max(atr * 0.15, Math.abs(mid) * 0.00015), "Range fade zone");
    const invalidationReference = direction === "buy"
      ? (structure?.recentSwingLow ?? mid - atr)
      : direction === "sell"
        ? (structure?.recentSwingHigh ?? mid + atr)
        : mid;
    const invalidationZone = makeZone(invalidationReference, Math.max(atr * 0.1, Math.abs(mid) * 0.0001), "Range invalidation");
    let smcBonus = 0;
    let smcScoreTotal = snapshot.smcAnalysis?.smcScore.total ?? 0;
    let smcVerdict = snapshot.smcAnalysis?.smcScore.verdict ?? "no_confluence";

    if (snapshot.smcAnalysis && direction !== "none") {
      const rescored = rescoreSMCAnalysis(snapshot.smcAnalysis, direction, mid || null);
      smcScoreTotal = rescored.total;
      smcVerdict = rescored.verdict;
      smcBonus = smcVerdictBonus(rescored.verdict);
    }

    const score = clamp01(edge + smcBonus);
    const confidence = direction === "none"
      ? clamp01(baseConfidence)
      : clamp01(baseConfidence + (smcBonus * 0.65));

    return this.buildDirectionalOutput({
      snapshot,
      signalType: "reactive",
      direction,
      confidence,
      score,
      entryStyle: "range_reversal",
      regime,
      regimeAlignment: rangeOnly ? 0.8 : 0.1,
      tradeabilityAlignment,
      entryZone,
      invalidationZone,
      stateAssessment: rangeOnly ? "range_regime" : "range_disabled_by_trend",
      diagnostics: {
        bollinger_pct_b: pctB,
        rsi_14: rsi,
        range_only: rangeOnly,
        smc_score: smcScoreTotal,
        smc_verdict: smcVerdict,
        smc_bonus: smcBonus,
      },
      rationale: [
        rangeOnly ? "Mean reversion is enabled because the pair is in range/compression conditions." : "Mean reversion is explicitly disabled outside range/compression regimes.",
        direction === "buy"
          ? "Price is stretched near the lower band with RSI exhaustion."
          : direction === "sell"
            ? "Price is stretched near the upper band with RSI exhaustion."
            : "No high-quality range fade is present.",
        snapshot.smcAnalysis
          ? `SMC confluence reads ${smcVerdict.replaceAll("_", " ")} (${smcScoreTotal}/100).`
          : "SMC confluence is not available on this snapshot.",
      ],
      constraints: {
        range_only: true,
      },
    });
  }
}
