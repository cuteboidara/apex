import { createId } from "@/src/lib/ids";
import { persistKillSwitchToDb } from "@/src/lib/operatorControls";
import { RepositoryUnavailableError } from "@/src/lib/repository";
import { getApexRuntime } from "@/src/lib/runtime";

type SystemRuntimeLike = ReturnType<typeof getApexRuntime>;
const SYSTEM_STATUS_TIMEOUT_MS = 3_000;
const SYSTEM_STATUS_ROUTE_TIMEOUT_MS = 10_000;

async function withTimeout<T>(
  operation: (() => Promise<T> | T) | Promise<T>,
  fallback: T,
  timeoutMs = SYSTEM_STATUS_TIMEOUT_MS,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const promise = typeof operation === "function"
    ? Promise.resolve().then(operation)
    : operation;

  try {
    return await Promise.race([
      promise,
      new Promise<T>(resolve => {
        timeoutHandle = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function createOfflineSystemStatusPayload() {
  return {
    status: "offline" as const,
    pairs: [] as string[],
    lastCycle: null as number | null,
    mode: "normal" as const,
    kill_switch_active: false,
    last_cycle_ts: null as number | null,
    active_symbols: [] as string[],
    modules: [],
    feed_health: [],
    readiness: {
      market_data_status: "degraded" as const,
      provider_latency_ms: 0,
      stale_symbols: [] as string[],
      news_lock_active: false,
      session_lock_active: false,
    },
    execution_health: [],
    provider: "synthetic",
    cycle_interval_minutes: 15,
    active_pods: [],
    active_entry_style: "trend_pullback" as const,
  };
}

export function createDegradedSystemStatusPayload(error?: string) {
  return {
    ...createOfflineSystemStatusPayload(),
    status: "degraded" as const,
    error: error ?? "System status partially unavailable",
    timestamp: Date.now(),
  };
}

function createRuntimeFallbackStatus(runtime: SystemRuntimeLike) {
  return {
    mode: "normal" as const,
    kill_switch_active: false,
    last_cycle_ts: null as number | null,
    active_symbols: runtime.config.activeSymbols,
    modules: [],
    feed_health: [],
    readiness: {
      market_data_status: "degraded" as const,
      provider_latency_ms: 0,
      stale_symbols: runtime.config.activeSymbols,
      news_lock_active: false,
      session_lock_active: false,
    },
  };
}

function createRuntimeDegradedSystemStatusPayload(runtime: SystemRuntimeLike, error?: string) {
  return {
    ...createRuntimeFallbackStatus(runtime),
    status: "degraded" as const,
    error: error ?? "System status partially unavailable",
    timestamp: Date.now(),
    execution_health: [],
    provider: runtime.config.defaultVenue,
    cycle_interval_minutes: runtime.config.cycleIntervalMinutes,
    active_pods: runtime.config.activePods,
    active_entry_style: runtime.config.primaryEntryStyle,
  };
}

export async function getSystemStatusPayloadForRuntime(runtime: SystemRuntimeLike) {
  const fallbackStatus = createRuntimeFallbackStatus(runtime);
  const status = await withTimeout(
    () => {
      try {
        return runtime.ops.getSystemStatus(runtime.config.activeSymbols);
      } catch (error) {
        console.error("[system] Failed to read runtime ops status:", error);
        return fallbackStatus;
      }
    },
    fallbackStatus,
  );
  const pairStates = typeof runtime.repository.getLatestTraderPairRuntimeStates === "function"
    ? await withTimeout(
      async () => {
        try {
          return await runtime.repository.getLatestTraderPairRuntimeStates(runtime.config.activeSymbols);
        } catch (error) {
          console.error("[system] Failed to read persisted pair states:", error);
          return [];
        }
      },
      [],
    )
    : [];
  const latestPersistedTs = pairStates.reduce<number | null>((latest, state) =>
    latest == null || state.generatedAt > latest ? state.generatedAt : latest
  , null);
  const fallbackFeedHealth = pairStates.map(state => ({
    symbol_canonical: state.symbol,
    latency_ms: state.diagnostics.marketData.latencyMs,
    last_received_ts: state.diagnostics.marketData.lastCandleTimestamp,
    gap_count: 0,
    quarantined: state.diagnostics.unavailableReason === "SYMBOL_QUARANTINED",
    last_reason: state.diagnostics.unavailableReason ?? state.diagnostics.noTradeReason ?? undefined,
    provider: state.diagnostics.marketData.provider ?? undefined,
    quality_flag: state.diagnostics.marketData.qualityFlag ?? undefined,
    missing_bars: Math.max(0, state.diagnostics.marketData.candlesFetched > 0 ? 0 : 1),
    duplicate_bars: 0,
    out_of_order_bars: 0,
    stale_last_candle: false,
    abnormal_gap_detected: false,
  }));
  const staleSymbols = fallbackFeedHealth
    .filter(row => row.last_received_ts == null)
    .map(row => row.symbol_canonical);
  const inMemorySymbols = new Set(status.feed_health.map(row => row.symbol_canonical));
  const persistedSnapshotIsNewer = latestPersistedTs != null && latestPersistedTs > (status.last_cycle_ts ?? 0);
  const inMemoryCoverageIsIncomplete = runtime.config.activeSymbols.some(symbol => !inMemorySymbols.has(symbol));
  const usePersistedFeedHealth = pairStates.length > 0
    && (status.feed_health.length === 0 || inMemoryCoverageIsIncomplete || persistedSnapshotIsNewer);
  const executionHealth = typeof runtime.repository.getExecutionHealth === "function"
    ? await withTimeout(
      () => {
        try {
          return runtime.repository.getExecutionHealth();
        } catch (error) {
          console.error("[system] Failed to read execution health:", error);
          return [];
        }
      },
      [],
    )
    : [];

  return {
    ...status,
    last_cycle_ts: latestPersistedTs != null
      ? Math.max(status.last_cycle_ts ?? 0, latestPersistedTs)
      : status.last_cycle_ts,
    feed_health: usePersistedFeedHealth ? fallbackFeedHealth : status.feed_health,
    readiness: usePersistedFeedHealth
      ? {
        market_data_status: staleSymbols.length > 0 ? "degraded" : "healthy",
        provider_latency_ms: fallbackFeedHealth.length === 0
          ? 0
          : fallbackFeedHealth.reduce((sum, row) => sum + row.latency_ms, 0) / fallbackFeedHealth.length,
        stale_symbols: staleSymbols,
        news_lock_active: false,
        session_lock_active: pairStates.length > 0 && pairStates.every(state => state.liveMarket.session === "Off hours"),
      }
      : status.readiness,
    execution_health: executionHealth,
    provider: runtime.config.defaultVenue,
    cycle_interval_minutes: runtime.config.cycleIntervalMinutes,
    active_pods: runtime.config.activePods,
    active_entry_style: runtime.config.primaryEntryStyle,
  };
}

export async function getSystemStatusPayload() {
  try {
    const runtime = await withTimeout<SystemRuntimeLike | null>(
      () => {
        try {
          return getApexRuntime();
        } catch (error) {
          console.error("[system] Failed to initialize runtime for status payload:", error);
          return null;
        }
      },
      null,
    );

    if (!runtime) {
      return createDegradedSystemStatusPayload("Runtime unavailable");
    }

    return await withTimeout(
      () => getSystemStatusPayloadForRuntime(runtime),
      createRuntimeDegradedSystemStatusPayload(runtime, "System status partially unavailable"),
      SYSTEM_STATUS_ROUTE_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof RepositoryUnavailableError) {
      return createOfflineSystemStatusPayload();
    }
    console.error("[system] Failed to build system status payload:", error);
    return createDegradedSystemStatusPayload();
  }
}

export async function toggleKillSwitchPayload(active: boolean) {
  const runtime = getApexRuntime();
  runtime.repository.setKillSwitch(active);
  await persistKillSwitchToDb(active);
  await runtime.repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: Date.now(),
    module: "risk",
    type: active ? "kill_switch_activated" : "kill_switch_deactivated",
    reason: "operator action",
    payload: {},
  });
  return {
    kill_switch_active: runtime.repository.isKillSwitchActive(),
  };
}
