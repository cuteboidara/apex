import { clamp01, type DirectionalPodOutput, type FeatureSnapshot } from "@/src/interfaces/contracts";
import { BaseAlphaPod } from "@/src/pods/base";
import { rescoreSMCAnalysis, smcVerdictBonus } from "@/src/smc";

function makeZone(center: number, width: number, label: string) {
  return {
    low: center - width,
    high: center + width,
    label,
  };
}

export class BreakoutPod extends BaseAlphaPod {
  constructor() {
    super("breakout", "2.0.0", "directional");
  }

  async evaluate(snapshot: FeatureSnapshot): Promise<DirectionalPodOutput> {
    const mid = this.getFeature(snapshot, "mid");
    const atr = Math.max(this.getFeature(snapshot, "atr_14"), Math.abs(mid) * 0.0005);
    const sessionFeatures = snapshot.context.session_features;
    const structure = snapshot.context.market_structure;
    const session = snapshot.context.session.session;
    const breakoutState = sessionFeatures?.sessionBreakoutState ?? "none";
    const compressed = sessionFeatures?.sessionCompressionState === "compressed";
    const expansion = sessionFeatures?.newYorkOpeningExpansion ?? 0;
    const direction: DirectionalPodOutput["direction"] = breakoutState === "bullish"
      ? "buy"
      : breakoutState === "bearish"
        ? "sell"
        : "none";
    const breakoutReference = direction === "buy"
      ? (structure?.recentSwingHigh ?? mid + atr * 0.5)
      : direction === "sell"
        ? (structure?.recentSwingLow ?? mid - atr * 0.5)
        : mid;
    const entryZone = makeZone(breakoutReference, Math.max(atr * 0.16, Math.abs(mid) * 0.00012), "Session breakout reference");
    const invalidationZone = makeZone(
      direction === "buy" ? breakoutReference - atr * 0.45 : breakoutReference + atr * 0.45,
      Math.max(atr * 0.14, Math.abs(mid) * 0.0001),
      "Breakout invalidation",
    );
    const baseScore = direction === "none"
      ? 0.18
      : Math.min(1, (compressed ? 0.35 : 0.18) + Math.min(0.45, expansion * 0.25));
    const baseConfidence = direction === "none"
      ? 0.18
      : 0.38 + baseScore * 0.32 + (session === "london" || session === "new_york" ? 0.08 : -0.05);
    let smcBonus = 0;
    let smcScoreTotal = snapshot.smcAnalysis?.smcScore.total ?? 0;
    let smcVerdict = snapshot.smcAnalysis?.smcScore.verdict ?? "no_confluence";

    if (snapshot.smcAnalysis && direction !== "none") {
      const rescored = rescoreSMCAnalysis(snapshot.smcAnalysis, direction, mid || null);
      smcScoreTotal = rescored.total;
      smcVerdict = rescored.verdict;
      smcBonus = smcVerdictBonus(rescored.verdict);
    }

    const score = clamp01(baseScore + smcBonus);
    const confidence = direction === "none"
      ? clamp01(baseConfidence)
      : clamp01(baseConfidence + (smcBonus * 0.65));

    return this.buildDirectionalOutput({
      snapshot,
      signalType: "reactive",
      direction,
      confidence,
      score,
      entryStyle: "session_breakout",
      regime: compressed ? "breakout" : "normal",
      regimeAlignment: compressed ? 0.82 : 0.5,
      tradeabilityAlignment: Math.min(1, 0.45 + expansion * 0.2),
      entryZone,
      invalidationZone,
      stateAssessment: direction === "none" ? "session_breakout_not_ready" : `${session}_session_breakout`,
      diagnostics: {
        session,
        breakout_state: breakoutState,
        compressed,
        expansion,
        smc_score: smcScoreTotal,
        smc_verdict: smcVerdict,
        smc_bonus: smcBonus,
      },
      rationale: [
        compressed ? "Pre-break compression is present." : "Compression is weak, so breakout quality is lower.",
        direction === "buy"
          ? "Price is breaking through the relevant session high."
          : direction === "sell"
            ? "Price is breaking through the relevant session low."
            : "No clean session breakout is in force.",
        snapshot.smcAnalysis
          ? `SMC confluence reads ${smcVerdict.replaceAll("_", " ")} (${smcScoreTotal}/100).`
          : "SMC confluence is not available on this snapshot.",
      ],
    });
  }
}
