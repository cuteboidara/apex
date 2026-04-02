import type { FeatureSnapshot, IAlphaPod } from "@/src/interfaces/contracts";
import { BreakoutPod } from "@/src/pods/breakout/BreakoutPod";
import { CrossAssetRelativeValuePod } from "@/src/pods/cross-asset-rv/CrossAssetRelativeValuePod";
import { ExecutionAdvisoryPod } from "@/src/pods/execution-advisory/ExecutionAdvisoryPod";
import { MeanReversionPod } from "@/src/pods/mean-reversion/MeanReversionPod";
import { TrendPod } from "@/src/pods/trend/TrendPod";
import { VolatilityRegimePod } from "@/src/pods/volatility-regime/VolatilityRegimePod";

export function createDefaultPods(getLatestSnapshot: (symbol: string) => FeatureSnapshot | null): IAlphaPod[] {
  return [
    new TrendPod(),
    new MeanReversionPod(),
    new BreakoutPod(),
    new CrossAssetRelativeValuePod(getLatestSnapshot),
    new VolatilityRegimePod(),
    new ExecutionAdvisoryPod(),
  ];
}
