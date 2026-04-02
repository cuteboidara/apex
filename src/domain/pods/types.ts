export type PodType =
  | "alpha"
  | "regime"
  | "constraint"
  | "execution_feasibility";

export type PodDirection = "long" | "short" | "none";
export type PodSignal = "buy" | "sell" | "neutral";

export type PodEvidence = {
  code: string;
  description: string;
  metadata?: Record<string, unknown>;
};

export type PodVote = {
  podName: string;
  version: string;
  podType: PodType;
  symbol: string;
  signal: PodSignal;
  confidence: number;
  score: number;
  reasoning: string;
  weight: number;
  rawConfidence?: number;
  normalizedConfidence?: number;
  subScores?: Record<string, number>;
  vetoes?: string[];
  warnings?: string[];
  evidence: PodEvidence[];
  meta: Record<string, unknown>;
  pod_name?: string;
  pod_version?: string;
  pod_type?: PodType;
  direction?: PodDirection;
  raw_confidence?: number;
  normalized_confidence?: number;
  veto?: boolean;
  metadata?: Record<string, unknown>;
};

export type AggregatedPodDecision = {
  symbol: string;
  direction: PodDirection;
  signal: PodSignal;
  confidence: number;
  score: number;
  agreement: number;
  votes: PodVote[];
  vetoes: string[];
  warnings: string[];
  reasoning: string;
  directional_support: {
    long_score: number;
    short_score: number;
    neutral_score: number;
  };
  veto_details: Array<{
    pod_name: string;
    reason_codes: string[];
  }>;
  contributing_pods: PodVote[];
  attribution: {
    long_contributors: string[];
    short_contributors: string[];
    veto_contributors: string[];
    regime_contributors: string[];
  };
  metadata: Record<string, unknown>;
};
