import { BaseAlphaPod } from "@/src/pods/base";
import type { ExecutionStyle, FeatureSnapshot, GatingPodOutput, NoTradeReasonCode } from "@/src/interfaces/contracts";

function pickExecutionStyle(spreadBps: number, volatility: number, session: string): ExecutionStyle {
  if (spreadBps < 4 && volatility < 2) {
    return "passive";
  }

  if (session === "london" || session === "new_york") {
    return "vwap";
  }

  if (spreadBps > 18 || volatility > 8) {
    return "sweep";
  }

  return "participation";
}

export class ExecutionAdvisoryPod extends BaseAlphaPod {
  constructor() {
    super("execution-advisory", "2.0.0", "gating");
  }

  async evaluate(snapshot: FeatureSnapshot): Promise<GatingPodOutput> {
    const spreadBps = this.getFeature(snapshot, "spread_bps");
    const volatility = this.getFeature(snapshot, "volatility_raw");
    const session = snapshot.context.session.session;
    const majorNews = snapshot.context.economic_event.majorNewsFlag;
    const style = pickExecutionStyle(spreadBps, volatility, session);
    const vetoReasons: NoTradeReasonCode[] = [];
    let gateStatus: GatingPodOutput["gate_status"] = "allow";

    if (session === "off_hours") {
      gateStatus = "block";
      vetoReasons.push("OFF_SESSION", "SESSION_LOCK");
    } else if (spreadBps > 18) {
      gateStatus = "block";
      vetoReasons.push("SPREAD_ABNORMAL");
    } else if (majorNews) {
      gateStatus = "warn";
      vetoReasons.push("NEWS_LOCK");
    }

    return this.buildGatingOutput({
      snapshot,
      signalType: "execution_advisory",
      confidence: 0.68,
      gateStatus,
      vetoReasons,
      preferredExecutionStyle: style,
      stateAssessment: gateStatus,
      diagnostics: {
        preferred_execution_style: style,
        spread_bps: spreadBps,
        volatility_raw: volatility,
        session,
        major_news: majorNews,
      },
      rationale: [
        session === "off_hours" ? "The pair is outside preferred FX intraday sessions." : `Execution conditions are evaluated for the ${session} session.`,
        spreadBps > 18 ? "Spread is too wide for clean intraday paper evaluation." : "Spread remains within a workable range.",
        majorNews ? "A nearby major event reduces execution confidence." : "No major news execution lock is active.",
      ],
      constraints: {
        preferred_execution_style: style,
      },
    });
  }
}
