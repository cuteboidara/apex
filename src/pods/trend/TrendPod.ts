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

export class TrendPod extends BaseAlphaPod {
  constructor() {
    super("trend", "2.0.0", "directional");
  }

  async evaluate(snapshot: FeatureSnapshot): Promise<DirectionalPodOutput> {
    const fast = this.getFeature(snapshot, "ema_9");
    const slow = this.getFeature(snapshot, "ema_21");
    const mid = this.getFeature(snapshot, "mid") || fast || slow;
    const atr = Math.max(this.getFeature(snapshot, "atr_14"), Math.abs(mid) * 0.0005);
    const momentum1h = this.getFeature(snapshot, "price_momentum_1h");
    const momentum4h = this.getFeature(snapshot, "price_momentum_4h");
    const structure = snapshot.context.market_structure;
    const tradeability = snapshot.context.tradeability;
    const session = snapshot.context.session;
    const economicEvent = snapshot.context.economic_event;

    const bullishBias = fast > slow && momentum1h > 0 && momentum4h >= 0 && structure?.structureBias !== "bearish";
    const bearishBias = fast < slow && momentum1h < 0 && momentum4h <= 0 && structure?.structureBias !== "bullish";
    const pullbackDistance = Math.abs(mid - slow) / Math.max(atr, 0.0001);
    const retraceReady = !structure || pullbackDistance <= 0.8 || (structure?.distanceToRecentStructure ?? 9e9) <= atr * 1.4;
    const momentumRecoveryLong = mid >= fast && momentum1h > 0;
    const momentumRecoveryShort = mid <= fast && momentum1h < 0;
    const tradeable = tradeability
      ? tradeability.volatilityState === "acceptable" && (tradeability.rewardToRiskFeasible ?? false)
      : true;
    const avoidNews = !economicEvent.majorNewsFlag;

    let direction: DirectionalPodOutput["direction"] = "none";
    if (bullishBias && retraceReady && momentumRecoveryLong && tradeable && avoidNews) {
      direction = "buy";
    } else if (bearishBias && retraceReady && momentumRecoveryShort && tradeable && avoidNews) {
      direction = "sell";
    }

    const regime: SignalRegime = bullishBias || bearishBias ? "trend" : "normal";
    const biasStrength = Math.min(1, (Math.abs(momentum1h) + Math.abs(momentum4h) * 0.5) / Math.max(atr, 0.0001) * 0.04);
    const retraceScore = Math.max(0, 1 - Math.min(1, pullbackDistance / 1.1));
    const structureSupport = structure?.distanceToRecentStructure != null
      ? Math.max(0, 1 - Math.min(1, structure.distanceToRecentStructure / Math.max(atr * 2, 0.0001)))
      : 0.4;
    const tradeabilityAlignment = tradeability?.rewardToRiskPotential != null
      ? Math.min(1, tradeability.rewardToRiskPotential / 3)
      : 0.45;
    const regimeAlignment = Math.min(1, (biasStrength * 0.55) + (retraceScore * 0.25) + (structureSupport * 0.2));
    const baseConfidence = direction === "none"
      ? 0.22
      : 0.45 + (regimeAlignment * 0.22) + (tradeabilityAlignment * 0.18) + (session.session === "off_hours" ? -0.1 : 0);
    const baseScore = (regimeAlignment * 0.6) + (tradeabilityAlignment * 0.4);

    let smcBonus = 0;
    let smcScoreTotal = snapshot.smcAnalysis?.smcScore.total ?? 0;
    let smcVerdict = snapshot.smcAnalysis?.smcScore.verdict ?? "no_confluence";

    if (snapshot.smcAnalysis && direction !== "none") {
      const rescored = rescoreSMCAnalysis(snapshot.smcAnalysis, direction, mid || null);
      smcScoreTotal = rescored.total;
      smcVerdict = rescored.verdict;
      smcBonus = smcVerdictBonus(rescored.verdict);
    }

    const confidence = direction === "none"
      ? baseConfidence
      : clamp01(baseConfidence + (smcBonus * 0.65));
    const score = clamp01(baseScore + smcBonus);
    const entryReference = slow || mid;
    const zoneWidth = Math.max(atr * 0.2, Math.abs(mid) * 0.0002);
    const entryZone = makeZone(entryReference, zoneWidth, "EMA pullback zone");
    const invalidationReference = direction === "buy"
      ? (structure?.recentSwingLow ?? slow - atr * 1.2)
      : direction === "sell"
        ? (structure?.recentSwingHigh ?? slow + atr * 1.2)
        : mid;
    const invalidationZone = makeZone(invalidationReference, zoneWidth * 0.75, "Structure invalidation");

    const rationale = [
      bullishBias ? "Higher-timeframe bias remains bullish." : bearishBias ? "Higher-timeframe bias remains bearish." : "Higher-timeframe bias is not aligned.",
      retraceReady ? "Price is retracing into the pullback zone instead of chasing extension." : "Pullback depth is not yet favorable.",
      direction === "buy"
        ? "Momentum recovery confirms continuation for a long setup."
        : direction === "sell"
          ? "Momentum recovery confirms continuation for a short setup."
          : "Momentum recovery is not clean enough to issue a trend-pullback signal.",
      tradeable ? "Tradeability checks still support intraday continuation." : "Tradeability is not sufficient for a fresh signal.",
      avoidNews ? "No major news lock is active." : "Major news proximity suppresses the setup.",
      snapshot.smcAnalysis
        ? `SMC confluence reads ${smcVerdict.replaceAll("_", " ")} (${smcScoreTotal}/100).`
        : "SMC confluence is not available on this snapshot.",
    ];

    return this.buildDirectionalOutput({
      snapshot,
      signalType: "predictive",
      direction,
      confidence,
      score,
      entryStyle: "trend_pullback",
      regime,
      regimeAlignment,
      tradeabilityAlignment,
      entryZone,
      invalidationZone,
      stateAssessment: direction === "none" ? "pullback_not_ready" : `${direction}_pullback_ready`,
      diagnostics: {
        fast_ema: fast,
        slow_ema: slow,
        mid,
        atr,
        momentum_1h: momentum1h,
        momentum_4h: momentum4h,
        pullback_distance_atr: pullbackDistance,
        smc_score: smcScoreTotal,
        smc_verdict: smcVerdict,
        smc_bonus: smcBonus,
      },
      rationale,
      constraints: {
        primary_entry_style: true,
        session: session.session,
      },
    });
  }
}
