type LatestTradePlanLike = {
  runId: string;
  bias: string;
  status: string;
  updatedAt?: Date;
  createdAt?: Date;
};

export type LatestSetupBreakdown = {
  runId: string | null;
  long: number;
  short: number;
  noSetup: number;
  active: number;
  stale: number;
  total: number;
  directionBalance: "balanced" | "long_only" | "short_only" | "no_active_setups";
  generatedAt: string | null;
};

export function buildLatestSetupBreakdown(plans: LatestTradePlanLike[]): LatestSetupBreakdown {
  const long = plans.filter(plan => plan.status === "ACTIVE" && plan.bias === "LONG").length;
  const short = plans.filter(plan => plan.status === "ACTIVE" && plan.bias === "SHORT").length;
  const stale = plans.filter(plan => plan.status === "STALE").length;
  const noSetup = plans.filter(plan => plan.status !== "ACTIVE").length;
  const latestTimestamp = plans
    .map(plan => plan.updatedAt ?? plan.createdAt ?? null)
    .filter((value): value is Date => value instanceof Date)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  return {
    runId: plans[0]?.runId ?? null,
    long,
    short,
    noSetup,
    active: long + short,
    stale,
    total: plans.length,
    directionBalance:
      long > 0 && short > 0
        ? "balanced"
        : long > 0
          ? "long_only"
          : short > 0
            ? "short_only"
            : "no_active_setups",
    generatedAt: latestTimestamp?.toISOString() ?? null,
  };
}
