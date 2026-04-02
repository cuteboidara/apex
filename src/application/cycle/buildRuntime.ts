import { AuditJournal } from "@/src/audit/AuditJournal";
import { PortfolioAllocator } from "@/src/allocator/PortfolioAllocator";
import { DataPlant } from "@/src/data-plant/DataPlant";
import { resetCryptoRuntimeForTests } from "@/src/crypto/engine/cryptoRuntime";
import { ExecutionOrchestrator } from "@/src/execution/ExecutionOrchestrator";
import { FeatureEngine } from "@/src/feature-engine/FeatureEngine";
import { ApexEngine } from "@/src/lib/engine";
import { getApexConfig } from "@/src/lib/config";
import { logger } from "@/src/lib/logger";
import { hydrateOperatorControlsFromDb } from "@/src/lib/operatorControls";
import { isApexQueueAvailable } from "@/src/lib/queue";
import { ApexRepository } from "@/src/lib/repository";
import { TelegramNotifier } from "@/src/lib/telegram";
import { DriftMonitor } from "@/src/learning/DriftMonitor";
import { OpsManager } from "@/src/ops/OpsManager";
import { createDefaultPods } from "@/src/pods";
import { RiskGovernor } from "@/src/risk/RiskGovernor";

export type ApexRuntime = {
  config: ReturnType<typeof getApexConfig>;
  repository: ApexRepository;
  dataPlant: DataPlant;
  featureEngine: FeatureEngine;
  pods: ReturnType<typeof createDefaultPods>;
  allocator: PortfolioAllocator;
  riskGovernor: RiskGovernor;
  execution: ExecutionOrchestrator;
  driftMonitor: DriftMonitor;
  auditJournal: AuditJournal;
  ops: OpsManager;
  engine: ApexEngine;
  notifier: TelegramNotifier;
};

const globalForRuntime = globalThis as typeof globalThis & {
  __apexRuntime?: ApexRuntime;
  __apexRuntimeVersion?: string;
};

const APEX_RUNTIME_VERSION = "2026-04-01-fx-fallback-rr-v1";

function runtimeSupportsTraderSnapshots(runtime: ApexRuntime): boolean {
  return typeof (runtime.repository as {
    getLatestTraderPairRuntimeStates?: unknown;
    upsertTraderPairRuntimeState?: unknown;
  }).getLatestTraderPairRuntimeStates === "function"
    && typeof (runtime.repository as {
      getLatestTraderPairRuntimeStates?: unknown;
      upsertTraderPairRuntimeState?: unknown;
    }).upsertTraderPairRuntimeState === "function"
    && typeof (runtime.dataPlant as {
      getLatestFetchDiagnostics?: unknown;
    }).getLatestFetchDiagnostics === "function";
}

function applyConfiguredPodScope(
  pods: ReturnType<typeof createDefaultPods>,
  activePodIds: readonly string[],
) {
  for (const pod of pods) {
    if (activePodIds.includes(pod.pod_id)) {
      pod.resume();
      continue;
    }

    pod.pause();
  }

  return pods;
}

function resolveRepositoryMode() {
  const runningNodeTestRunner = process.execArgv.includes("--test")
    || process.argv.includes("--test")
    || process.argv.some(arg => /\.test\.[cm]?[jt]sx?$/i.test(arg));
  const runningApexTests = process.env.NODE_ENV === "test"
    || (process.env.npm_lifecycle_event?.startsWith("test") ?? false)
    || runningNodeTestRunner;
  return runningApexTests ? "memory" as const : "database" as const;
}

export function createApexRuntime(): ApexRuntime {
  const config = getApexConfig();
  const repositoryMode = resolveRepositoryMode();
  const repository = new ApexRepository({ mode: repositoryMode });
  void hydrateOperatorControlsFromDb(repository, { defaultRecoveryMode: config.defaultRecoveryMode }).catch(error => {
    logger.warn({
      module: "runtime",
      message: "Failed to hydrate operator controls from database",
      error: String(error),
    });
  });
  const featureEngine = new FeatureEngine(repository);
  const dataPlant = new DataPlant(repository, config);
  const pods = applyConfiguredPodScope(
    createDefaultPods(symbol => repository.getLatestFeatureSnapshot(symbol)),
    config.activePods,
  );
  const allocator = new PortfolioAllocator(repository, config);
  const riskGovernor = new RiskGovernor(repository, config);
  const notifier = new TelegramNotifier(config.telegramBotToken, config.telegramChatId, {
    minimumTelegramGrade: config.minimumTelegramGrade,
    includeBTelegramSignals: config.includeBTelegramSignals,
  });
  const execution = new ExecutionOrchestrator(repository, config, notifier);
  const auditJournal = new AuditJournal(repository);
  const driftMonitor = new DriftMonitor(repository, () => pods);
  for (const pod of pods) {
    void repository.appendModelRegistry({
      pod_id: pod.pod_id,
      version: pod.model_version,
      trained_at: Date.now(),
      status: "validated",
      validation_score: 0.75,
      deployment_status: "production",
    }).catch(error => {
      logger.warn({
        module: "runtime",
        message: "Failed to seed model registry entry during runtime construction",
        pod_id: pod.pod_id,
        error: String(error),
      });
    });
  }
  const ops = new OpsManager(repository, {
    dataPlant,
    featureEngine,
    getPods: () => pods,
    healthModules: () => [
      { module: "data-plant", status: "healthy", detail: "Feed intake active", updated_at: Date.now() },
      { module: "feature-engine", status: "healthy", detail: "Feature computation active", updated_at: Date.now() },
      { module: "pods", status: "healthy", detail: `${pods.filter(pod => pod.getStatus() === "active").length} active`, updated_at: Date.now() },
      { module: "allocator", status: "healthy", detail: "Allocator active", updated_at: Date.now() },
      { module: "risk", status: repository.isKillSwitchActive() ? "halted" : "healthy", detail: "Risk sovereign", updated_at: Date.now() },
      { module: "execution", status: repository.getRecoveryMode() === "full_stop" ? "halted" : "healthy", detail: config.mode, updated_at: Date.now() },
      { module: "redis", status: isApexQueueAvailable() ? "healthy" : "degraded", detail: isApexQueueAvailable() ? "REDIS_URL configured for cache and queue" : "Redis unavailable; memory cache/direct cycle mode", updated_at: Date.now() },
    ],
    replayPods: () => applyConfiguredPodScope(
      createDefaultPods(symbol => repository.getLatestFeatureSnapshot(symbol)),
      config.activePods,
    ),
    createFeatureEngine: () => new FeatureEngine(new ApexRepository({ mode: repositoryMode })),
  });
  const engine = new ApexEngine(
    config,
    repository,
    dataPlant,
    featureEngine,
    pods,
    allocator,
    riskGovernor,
    execution,
    driftMonitor,
    auditJournal,
    ops,
    notifier,
  );

  logger.info({
    module: "runtime",
    message: "APEX market scope configured",
    active_symbols: config.activeSymbols,
    primary_entry_style: config.primaryEntryStyle,
    enabled_entry_styles: config.enabledEntryStyles,
    disabled_entry_styles: config.disabledEntryStyles,
    active_pods: config.activePods,
    skipped_symbols: config.scopeSkips.symbols,
    skipped_pods: config.scopeSkips.pods,
  });

  logger.info({
    module: "runtime",
    message: "Yahoo Finance market data ready for stocks and commodities",
    asset_modules: ["stocks", "commodities"],
  });
  logger.info({
    module: "runtime",
    message: "Benchmark index feeds ready",
    asset_modules: ["indices"],
    providers: ["Stooq", "Yahoo"],
  });

  return {
    config,
    repository,
    dataPlant,
    featureEngine,
    pods,
    allocator,
    riskGovernor,
    execution,
    driftMonitor,
    auditJournal,
    ops,
    engine,
    notifier,
  };
}

function cacheApexRuntime(runtime: ApexRuntime): ApexRuntime {
  globalForRuntime.__apexRuntime = runtime;
  globalForRuntime.__apexRuntimeVersion = APEX_RUNTIME_VERSION;
  return runtime;
}

export function initializeApexRuntime(): ApexRuntime {
  return globalForRuntime.__apexRuntime ?? cacheApexRuntime(createApexRuntime());
}

export function ensureApexRuntime(runtime?: ApexRuntime | null): ApexRuntime {
  return runtime ?? initializeApexRuntime();
}

export function getApexRuntime(): ApexRuntime {
  const runtimeVersionMismatch = globalForRuntime.__apexRuntimeVersion !== APEX_RUNTIME_VERSION;
  if (
    globalForRuntime.__apexRuntime
    && (
      runtimeVersionMismatch
      || !runtimeSupportsTraderSnapshots(globalForRuntime.__apexRuntime)
    )
  ) {
    logger.info({
      module: "runtime",
      message: "Resetting cached APEX runtime",
      reason: runtimeVersionMismatch ? "version_mismatch" : "capability_mismatch",
      previous_version: globalForRuntime.__apexRuntimeVersion ?? "unknown",
      next_version: APEX_RUNTIME_VERSION,
    });
    void globalForRuntime.__apexRuntime.engine.stop().catch(() => undefined);
    delete globalForRuntime.__apexRuntime;
    delete globalForRuntime.__apexRuntimeVersion;
  }
  return initializeApexRuntime();
}

export const buildRuntime = getApexRuntime;

export function resetApexRuntimeForTests(): void {
  resetCryptoRuntimeForTests();
  delete globalForRuntime.__apexRuntime;
  delete globalForRuntime.__apexRuntimeVersion;
}
