import { createId } from "@/src/lib/ids";
import type { ApexRepository } from "@/src/lib/repository";
import type { DataPlant } from "@/src/data-plant/DataPlant";
import type { FeatureEngine } from "@/src/feature-engine/FeatureEngine";
import type { IAlphaPod, ModuleHealth, RecoveryMode, SystemStatusSnapshot } from "@/src/interfaces/contracts";

export class OpsManager {
  constructor(
    private readonly repository: ApexRepository,
    private readonly dependencies: {
      dataPlant: DataPlant;
      featureEngine: FeatureEngine;
      getPods: () => IAlphaPod[];
      healthModules: () => ModuleHealth[];
      replayPods: () => IAlphaPod[];
      createFeatureEngine: () => FeatureEngine;
    },
  ) {}

  getSystemStatus(activeSymbols: string[]): SystemStatusSnapshot {
    const feedHealth = this.dependencies.dataPlant.getHealthMetrics();
    const latestSnapshots = activeSymbols
      .map(symbol => this.repository.getLatestFeatureSnapshot(symbol))
      .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot != null);
    const providerLatencyMs = feedHealth.length === 0
      ? 0
      : feedHealth.reduce((sum, row) => sum + row.latency_ms, 0) / feedHealth.length;
    const staleThresholdMs = 2 * 15 * 60_000;
    const staleSymbols = feedHealth
      .filter(row => row.last_received_ts == null || (Date.now() - row.last_received_ts) > staleThresholdMs || row.quarantined)
      .map(row => row.symbol_canonical);

    return {
      mode: this.repository.getRecoveryMode(),
      kill_switch_active: this.repository.isKillSwitchActive(),
      last_cycle_ts: this.repository.getLastCycleTs(),
      active_symbols: activeSymbols,
      modules: this.dependencies.healthModules(),
      feed_health: feedHealth,
      readiness: {
        market_data_status: staleSymbols.length > 0 ? "degraded" : "healthy",
        provider_latency_ms: providerLatencyMs,
        stale_symbols: staleSymbols,
        news_lock_active: latestSnapshots.some(snapshot => snapshot.context.economic_event.majorNewsFlag),
        session_lock_active: latestSnapshots.every(snapshot => snapshot.context.session.session === "off_hours"),
      },
    };
  }

  async setRecoveryMode(mode: RecoveryMode): Promise<void> {
    this.repository.setRecoveryMode(mode);
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "ops",
      type: "recovery_mode_changed",
      reason: "runtime config mutation",
      payload: { mode },
    });
  }

  async quarantineModule(module: string, reason: string): Promise<void> {
    this.repository.quarantineModule(module, reason);
    const pod = this.dependencies.getPods().find(item => item.pod_id === module);
    pod?.pause();
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "ops",
      type: "module_quarantined",
      reason,
      payload: { module },
    });
  }

  async replayEvents(symbol: string, from_ts: number, to_ts: number) {
    const events = this.repository.getMarketEvents(symbol, from_ts, to_ts);
    const featureEngine = this.dependencies.createFeatureEngine();
    const pods = this.dependencies.replayPods();
    const snapshots = [];
    const outputs = [];

    for (const event of events) {
      featureEngine.consume(event);
      const snapshot = featureEngine.buildSnapshot(symbol, "15m");
      if (!snapshot) {
        continue;
      }
      snapshots.push(snapshot);
      outputs.push(await Promise.all(pods.map(pod => pod.evaluate(snapshot))));
    }

    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "ops",
      type: "event_replay_completed",
      reason: "historical replay",
      payload: { symbol, from_ts, to_ts, event_count: events.length },
    });

    return {
      symbol,
      from_ts,
      to_ts,
      event_count: events.length,
      snapshot_count: snapshots.length,
      outputs,
    };
  }
}
