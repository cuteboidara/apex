import type { SignalAssetClass, SignalQualityScores } from "@/src/domain/models/signalHealth";

export type CrossAssetCalibrationWeights = Pick<
  SignalQualityScores,
  "structure" | "market" | "execution" | "data" | "assetFit"
>;

export type CrossAssetCalibrationProfile = {
  assetClass: SignalAssetClass;
  version: string;
  derivedFrom: "fx" | "fx_port";
  experimental: boolean;
  weights: CrossAssetCalibrationWeights;
};

export const CROSS_ASSET_CALIBRATION_VERSION = "cross_asset_weights_v1";

const FX_BASE_WEIGHTS: CrossAssetCalibrationWeights = {
  structure: 0.3,
  market: 0.2,
  execution: 0.2,
  data: 0.15,
  assetFit: 0.15,
};

const ASSET_SPECIFIC_ADJUSTMENTS: Record<SignalAssetClass, Partial<CrossAssetCalibrationWeights>> = {
  fx: {},
  crypto: {
    data: 0.1,
    execution: 0.26,
    market: 0.22,
  },
  stock: {
    market: 0.28,
    structure: 0.24,
  },
  commodity: {
    structure: 0.22,
    market: 0.24,
    data: 0.19,
  },
  index: {
    structure: 0.2,
    market: 0.25,
    data: 0.2,
  },
  memecoin: {
    structure: 0.18,
    execution: 0.24,
    data: 0.2,
    assetFit: 0.18,
  },
};

function normalizeWeights(weights: CrossAssetCalibrationWeights): CrossAssetCalibrationWeights {
  const total = weights.structure + weights.market + weights.execution + weights.data + weights.assetFit;
  if (total <= 0) {
    return FX_BASE_WEIGHTS;
  }

  return {
    structure: weights.structure / total,
    market: weights.market / total,
    execution: weights.execution / total,
    data: weights.data / total,
    assetFit: weights.assetFit / total,
  };
}

export function getCrossAssetCalibrationProfile(
  assetClass: SignalAssetClass,
  sampleSize: number,
): CrossAssetCalibrationProfile {
  const merged = normalizeWeights({
    ...FX_BASE_WEIGHTS,
    ...ASSET_SPECIFIC_ADJUSTMENTS[assetClass],
  });

  return {
    assetClass,
    version: CROSS_ASSET_CALIBRATION_VERSION,
    derivedFrom: assetClass === "fx" ? "fx" : "fx_port",
    experimental: assetClass !== "fx" || sampleSize < 30,
    weights: merged,
  };
}

export function computeCrossAssetWeightedScore(
  assetClass: SignalAssetClass,
  qualityScores: Pick<SignalQualityScores, "structure" | "market" | "execution" | "data" | "assetFit">,
): number {
  const profile = getCrossAssetCalibrationProfile(assetClass, Number.POSITIVE_INFINITY);
  const weighted = (
    (qualityScores.structure * profile.weights.structure)
    + (qualityScores.market * profile.weights.market)
    + (qualityScores.execution * profile.weights.execution)
    + (qualityScores.data * profile.weights.data)
    + (qualityScores.assetFit * profile.weights.assetFit)
  );

  return Math.max(0, Math.min(100, Math.round(weighted)));
}

export function estimateCrossAssetCalibratedConfidence(input: {
  assetClass: SignalAssetClass;
  rawConfidence: number;
  qualityScores: Pick<SignalQualityScores, "structure" | "market" | "execution" | "data" | "assetFit">;
  sampleSize: number;
}): { rawConfidence: number; calibratedConfidence: number; profile: CrossAssetCalibrationProfile } {
  const profile = getCrossAssetCalibrationProfile(input.assetClass, input.sampleSize);
  const weightedScore = computeCrossAssetWeightedScore(input.assetClass, input.qualityScores) / 100;
  const calibratedConfidence = Math.max(
    0,
    Math.min(
      1,
      (input.rawConfidence * (profile.experimental ? 0.72 : 0.48))
      + (weightedScore * (profile.experimental ? 0.28 : 0.52)),
    ),
  );

  return {
    rawConfidence: input.rawConfidence,
    calibratedConfidence,
    profile,
  };
}
