import { triggerCommoditiesCycle } from "@/src/assets/commodities/engine/commoditiesRuntime";
import { triggerIndicesCycle } from "@/src/assets/indices/engine/indicesRuntime";
import { triggerMemeCycle } from "@/src/assets/memecoins/engine/memeRuntime";
import { triggerStocksCycle } from "@/src/assets/stocks/engine/stocksRuntime";
import { getApexRuntime } from "@/src/application/cycle/buildRuntime";
import { queueFocusedRuntimeCycle, type FocusedRuntimeCycleHost } from "@/src/application/cycle/runCycle";
import { triggerCryptoCycle } from "@/src/crypto/engine/cryptoRuntime";

export type ModuleTriggerResult = {
  ok: boolean;
  status: "queued" | "completed" | "failed";
  cycleId: string | null;
  jobId?: string | null;
  cardCount?: number | null;
  universeSize?: number | null;
  error?: string;
};

export type TriggerResultMap = Record<string, ModuleTriggerResult>;

export type TriggerAllAssetCyclesDependencies = {
  source?: string;
  includeMemecoins?: boolean;
  getRuntime?: () => FocusedRuntimeCycleHost;
  queueForexCycle?: typeof queueFocusedRuntimeCycle;
  triggerCrypto?: typeof triggerCryptoCycle;
  triggerStocks?: typeof triggerStocksCycle;
  triggerCommodities?: typeof triggerCommoditiesCycle;
  triggerIndices?: typeof triggerIndicesCycle;
  triggerMeme?: typeof triggerMemeCycle;
};

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

async function runModuleTrigger<T>(
  name: string,
  execute: () => Promise<T>,
  map: (result: T) => Omit<ModuleTriggerResult, "ok">,
): Promise<ModuleTriggerResult> {
  console.log(`[APEX TRIGGER] ${name} cycle starting`);
  try {
    const result = await execute();
    const mapped = {
      ok: true,
      ...map(result),
    };
    console.log(`[APEX TRIGGER] ${name} cycle complete`, mapped);
    return mapped;
  } catch (error) {
    const formatted = formatError(error);
    console.error(`[APEX TRIGGER] ${name} cycle failed:`, error);
    return {
      ok: false,
      status: "failed",
      cycleId: null,
      error: formatted,
    };
  }
}

export async function triggerAllAssetCycles(
  deps?: TriggerAllAssetCyclesDependencies,
): Promise<{
  success: boolean;
  partial: boolean;
  okCount: number;
  failureCount: number;
  queuedCount: number;
  completedCount: number;
  failedModules: string[];
  modules: TriggerResultMap;
}> {
  const runtime = (deps?.getRuntime ?? getApexRuntime)();
  const source = deps?.source ?? "all_assets";
  const includeMemecoins = deps?.includeMemecoins ?? true;

  console.log(`[APEX TRIGGER] Starting all asset cycle fan-out from ${source}`);

  const moduleEntries = await Promise.all([
    runModuleTrigger(
      "forex",
      () => (deps?.queueForexCycle ?? queueFocusedRuntimeCycle)(runtime, source),
      result => ({
        status: result.queued ? "queued" : "completed",
        cycleId: result.result?.cycle_id ?? null,
        jobId: result.jobId ?? null,
        cardCount: result.result?.symbols.length ?? null,
      }),
    ),
    runModuleTrigger(
      "crypto",
      () => (deps?.triggerCrypto ?? triggerCryptoCycle)(),
      result => ({
        status: "completed",
        cycleId: result.cycleId,
        cardCount: result.cardCount,
      }),
    ),
    runModuleTrigger(
      "stocks",
      () => (deps?.triggerStocks ?? triggerStocksCycle)(),
      result => ({
        status: "completed",
        cycleId: result.cycleId,
        cardCount: result.cardCount,
      }),
    ),
    runModuleTrigger(
      "commodities",
      () => (deps?.triggerCommodities ?? triggerCommoditiesCycle)(),
      result => ({
        status: "completed",
        cycleId: result.cycleId,
        cardCount: result.cardCount,
      }),
    ),
    runModuleTrigger(
      "indices",
      () => (deps?.triggerIndices ?? triggerIndicesCycle)(),
      result => ({
        status: "completed",
        cycleId: result.cycleId,
        cardCount: result.cardCount,
      }),
    ),
    includeMemecoins
      ? runModuleTrigger(
        "memecoins",
        () => (deps?.triggerMeme ?? triggerMemeCycle)(),
        result => ({
          status: "completed",
          cycleId: result.cycleId,
          cardCount: result.cardCount,
          universeSize: result.universeSize,
        }),
      )
      : Promise.resolve<ModuleTriggerResult | null>(null),
  ]);

  const modules: TriggerResultMap = {
    forex: moduleEntries[0]!,
    crypto: moduleEntries[1]!,
    stocks: moduleEntries[2]!,
    commodities: moduleEntries[3]!,
    indices: moduleEntries[4]!,
    ...(moduleEntries[5] ? { memecoins: moduleEntries[5] } : {}),
  };

  const results = Object.values(modules);
  const okCount = results.filter(result => result.ok).length;
  const failureCount = results.length - okCount;
  const queuedCount = results.filter(result => result.status === "queued").length;
  const completedCount = results.filter(result => result.status === "completed").length;
  const failedModules = Object.entries(modules)
    .filter(([, result]) => !result.ok)
    .map(([module]) => module);

  console.log("[APEX TRIGGER] All cycles fired:", {
    source,
    okCount,
    failureCount,
    queuedCount,
    completedCount,
    failedModules,
  });

  return {
    success: failureCount === 0,
    partial: okCount > 0 && failureCount > 0,
    okCount,
    failureCount,
    queuedCount,
    completedCount,
    failedModules,
    modules,
  };
}
