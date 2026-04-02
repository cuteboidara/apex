import { normalizePodConfidence } from "@/src/domain/pods/confidenceNormalization";
import type { PodEvidence, PodType, PodVote } from "@/src/domain/pods/types";
import type {
  DirectionalPodOutput,
  FeatureSnapshot,
  GateStatus,
  GatingPodOutput,
  IAlphaPod,
  NoTradeReasonCode,
  PodCategory,
  PodStatus,
  PriceZone,
  SignalDirection,
  SignalRegime,
  SignalType,
} from "@/src/interfaces/contracts";
import { actionFromDirection, clamp01, decodeVolatilityRegime } from "@/src/interfaces/contracts";

type BaseOutputInput = {
  snapshot: FeatureSnapshot;
  signalType: SignalType;
  confidence: number;
  stateAssessment?: string;
  constraints?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  rationale?: string[];
};

type DirectionalOutputInput = BaseOutputInput & {
  direction: DirectionalPodOutput["direction"];
  score: number;
  entryStyle: DirectionalPodOutput["entry_style"];
  regime: SignalRegime;
  regimeAlignment?: number;
  tradeabilityAlignment?: number;
  entryZone?: PriceZone | null;
  invalidationZone?: PriceZone | null;
};

type GatingOutputInput = BaseOutputInput & {
  gateStatus: GateStatus;
  entryStyle?: GatingPodOutput["entry_style"];
  vetoReasons?: NoTradeReasonCode[];
  preferredExecutionStyle?: GatingPodOutput["preferred_execution_style"];
  advisoryDirection?: GatingPodOutput["advisory_direction"];
};

export abstract class BaseAlphaPod implements IAlphaPod {
  private status: PodStatus = "active";
  private lastDiagnostics: Record<string, unknown> = {};

  protected constructor(
    public readonly pod_id: string,
    public readonly model_version: string,
    public readonly pod_category: PodCategory,
  ) {}

  protected getFeature(snapshot: FeatureSnapshot, key: string): number {
    return snapshot.features[key] ?? 0;
  }

  protected getVolatilityRegime(snapshot: FeatureSnapshot) {
    return decodeVolatilityRegime(snapshot.features.volatility_regime);
  }

  private resolvePodType(): PodType {
    if (this.pod_category === "directional") {
      return "alpha";
    }
    if (this.pod_id === "volatility-regime") {
      return "regime";
    }
    if (this.pod_id === "execution-advisory") {
      return "execution_feasibility";
    }
    return "constraint";
  }

  private toVoteSignal(direction: SignalDirection): PodVote["signal"] {
    if (direction === "buy") {
      return "buy";
    }
    if (direction === "sell") {
      return "sell";
    }
    return "neutral";
  }

  private toVoteDirection(direction: SignalDirection): PodVote["direction"] {
    if (direction === "buy") {
      return "long";
    }
    if (direction === "sell") {
      return "short";
    }
    return "none";
  }

  private toLegacyScore(score: number): number {
    return score <= 1 ? Math.round(clamp01(score) * 100) : Math.round(score);
  }

  private buildEvidence(rationale: string[], metadata?: Record<string, unknown>): PodEvidence[] {
    return rationale.map((description, index) => ({
      code: `rationale.${index + 1}`,
      description,
      ...(metadata ? { metadata } : {}),
    }));
  }

  private buildNativeVoteBase(input: {
    snapshot: FeatureSnapshot;
    direction: SignalDirection;
    confidence: number;
    score: number;
    rationale: string[];
    meta: Record<string, unknown>;
    vetoes?: string[];
    warnings?: string[];
  }): Omit<PodVote, "confidence" | "score" | "weight" | "normalizedConfidence" | "normalized_confidence" | "direction"> {
    const signal = this.toVoteSignal(input.direction);
    const version = this.model_version;
    const podType = this.resolvePodType();
    const vote: Omit<PodVote, "confidence" | "score" | "weight" | "normalizedConfidence" | "normalized_confidence" | "direction"> = {
      podName: this.pod_id,
      version,
      podType,
      symbol: input.snapshot.symbol_canonical,
      signal,
      reasoning: input.rationale[0] ?? `${this.pod_id} evaluated ${signal}.`,
      rawConfidence: clamp01(input.confidence),
      subScores: Object.fromEntries(
        Object.entries(input.meta).filter(([, value]) => typeof value === "number") as Array<[string, number]>,
      ),
      vetoes: [...(input.vetoes ?? [])],
      warnings: [...(input.warnings ?? [])],
      evidence: this.buildEvidence(input.rationale, {
        pod_id: this.pod_id,
        pod_category: this.pod_category,
      }),
      meta: input.meta,
      pod_name: this.pod_id,
      pod_version: version,
      pod_type: podType,
      raw_confidence: clamp01(input.confidence),
      veto: (input.vetoes?.length ?? 0) > 0,
      metadata: input.meta,
    };

    return vote;
  }

  protected buildDirectionalOutput(input: DirectionalOutputInput): DirectionalPodOutput {
    const diagnostics = {
      ...input.diagnostics,
      volatility_regime: this.getVolatilityRegime(input.snapshot),
    };
    const output: DirectionalPodOutput & Omit<PodVote, "direction"> = {
      pod_id: this.pod_id,
      ts: Date.now(),
      symbol_canonical: input.snapshot.symbol_canonical,
      decision_horizon: input.snapshot.horizon,
      signal_type: input.signalType,
      confidence: clamp01(input.confidence),
      score: this.toLegacyScore(input.score),
      weight: clamp01(input.confidence),
      recommended_action: this.status === "active" ? actionFromDirection(input.direction) : "hold",
      state_assessment: input.stateAssessment,
      constraints: {
        pod_status: this.status,
        ...(input.constraints ?? {}),
      },
      diagnostics,
      model_version: this.model_version,
      pod_category: "directional",
      entry_style: input.entryStyle,
      rationale: input.rationale ?? [],
      direction: this.status === "active" ? input.direction : "none",
      regime: input.regime,
      regime_alignment: clamp01(input.regimeAlignment ?? input.confidence),
      tradeability_alignment: clamp01(input.tradeabilityAlignment ?? input.confidence),
      entry_zone: input.entryZone ?? null,
      invalidation_zone: input.invalidationZone ?? null,
      ...this.buildNativeVoteBase({
        snapshot: input.snapshot,
        direction: this.status === "active" ? input.direction : "none",
        confidence: input.confidence,
        score: input.score,
        rationale: input.rationale ?? [],
        meta: {
          legacy_pod_category: "directional",
          signal_type: input.signalType,
          entry_style: input.entryStyle,
          recommended_action: this.status === "active" ? actionFromDirection(input.direction) : "hold",
          state_assessment: input.stateAssessment ?? null,
          diagnostics,
          constraints: {
            pod_status: this.status,
            ...(input.constraints ?? {}),
          },
          legacy_score: input.score,
          regime: input.regime,
          regime_alignment: clamp01(input.regimeAlignment ?? input.confidence),
          tradeability_alignment: clamp01(input.tradeabilityAlignment ?? input.confidence),
        },
      }),
    };

    output.normalizedConfidence = normalizePodConfidence({ ...output, direction: undefined } as PodVote);
    output.normalized_confidence = output.normalizedConfidence;

    this.lastDiagnostics = output.diagnostics;
    return output;
  }

  protected buildGatingOutput(input: GatingOutputInput): GatingPodOutput {
    const diagnostics = {
      ...input.diagnostics,
      volatility_regime: this.getVolatilityRegime(input.snapshot),
    };
    const liveGateStatus = this.status === "active" ? input.gateStatus : "warn";
    const liveVetoReasons = this.status === "active" ? [...(input.vetoReasons ?? [])] : [];
    const output: GatingPodOutput & PodVote = {
      pod_id: this.pod_id,
      ts: Date.now(),
      symbol_canonical: input.snapshot.symbol_canonical,
      decision_horizon: input.snapshot.horizon,
      signal_type: input.signalType,
      confidence: clamp01(input.confidence),
      score: this.toLegacyScore(input.confidence),
      weight: clamp01(input.confidence),
      recommended_action: "hold",
      state_assessment: input.stateAssessment,
      constraints: {
        pod_status: this.status,
        ...(input.constraints ?? {}),
      },
      diagnostics,
      model_version: this.model_version,
      pod_category: "gating",
      entry_style: input.entryStyle ?? "support",
      rationale: input.rationale ?? [],
      gate_status: liveGateStatus,
      veto_reasons: liveVetoReasons,
      preferred_execution_style: input.preferredExecutionStyle,
      advisory_direction: input.advisoryDirection,
      ...this.buildNativeVoteBase({
        snapshot: input.snapshot,
        direction: input.advisoryDirection ?? "none",
        confidence: input.confidence,
        score: input.confidence,
        rationale: input.rationale ?? [],
        vetoes: liveGateStatus === "block" ? liveVetoReasons : [],
        warnings: liveGateStatus === "warn" ? liveVetoReasons : [],
        meta: {
          legacy_pod_category: "gating",
          signal_type: input.signalType,
          entry_style: input.entryStyle ?? "support",
          recommended_action: "hold",
          state_assessment: input.stateAssessment ?? null,
          diagnostics,
          constraints: {
            pod_status: this.status,
            ...(input.constraints ?? {}),
          },
          gate_status: liveGateStatus,
          veto_reason_codes: liveVetoReasons,
          preferred_execution_style: input.preferredExecutionStyle ?? null,
          advisory_direction: input.advisoryDirection ?? "none",
        },
      }),
    };

    output.normalizedConfidence = normalizePodConfidence(output as PodVote);
    output.normalized_confidence = output.normalizedConfidence;

    this.lastDiagnostics = output.diagnostics;
    return output;
  }

  pause(): void {
    this.status = "paused";
  }

  resume(): void {
    this.status = "active";
  }

  quarantine(reason = "manual"): void {
    this.status = "quarantined";
    this.lastDiagnostics = {
      ...this.lastDiagnostics,
      quarantine_reason: reason,
    };
  }

  getStatus(): PodStatus {
    return this.status;
  }

  getDiagnostics(): Record<string, unknown> {
    return {
      ...this.lastDiagnostics,
      status: this.status,
      pod_category: this.pod_category,
    };
  }

  abstract evaluate(snapshot: FeatureSnapshot): Promise<DirectionalPodOutput | GatingPodOutput>;
}
