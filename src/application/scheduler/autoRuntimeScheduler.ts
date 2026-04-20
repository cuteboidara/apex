import { randomUUID } from "node:crypto";

import { triggerAllAssetCycles } from "@/src/application/cycle/triggerAllAssetCycles";
import { runDailySignals } from "@/src/application/signals/runDailySignals";
import { getDueDailySignalSessions, getDailySignalsConfig } from "@/src/infrastructure/config/dailySignals";
import { getApexConfig } from "@/src/lib/config";
import { logger } from "@/src/lib/logger";
import { getRedisClient } from "@/src/lib/redis";
import { writeSchedulerHeartbeat } from "@/src/lib/schedulerHeartbeat";

type AutoSchedulerConfig = {
  enabled: boolean;
  runOnStart: boolean;
  allAssetsEnabled: boolean;
  allAssetsIntervalMs: number;
  dailySignalsEnabled: boolean;
  dailySignalsCheckIntervalMs: number;
};

type AutoSchedulerState = {
  started: boolean;
  startedAt: number | null;
  instanceId: string;
  allAssetsTimer: ReturnType<typeof setInterval> | null;
  dailySignalsTimer: ReturnType<typeof setInterval> | null;
  allAssetsTickRunning: boolean;
  dailySignalsTickRunning: boolean;
  nextAllAssetsRunAt: number | null;
};

type LockLease = {
  acquired: boolean;
  release: () => Promise<void>;
};

const DEFAULT_ALL_ASSETS_INTERVAL_MINUTES = 15;
const DEFAULT_DAILY_SIGNALS_CHECK_INTERVAL_SECONDS = 60;
const AUTO_ALL_ASSETS_LOCK_KEY = "apex:auto:scheduler:all_assets:lock";
const AUTO_DAILY_SIGNALS_LOCK_KEY = "apex:auto:scheduler:daily_signals:lock";
const globalForAutoScheduler = globalThis as typeof globalThis & {
  __apexAutoSchedulerState?: AutoSchedulerState;
};

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAutoSchedulerState(): AutoSchedulerState {
  globalForAutoScheduler.__apexAutoSchedulerState ??= {
    started: false,
    startedAt: null,
    instanceId: randomUUID(),
    allAssetsTimer: null,
    dailySignalsTimer: null,
    allAssetsTickRunning: false,
    dailySignalsTickRunning: false,
    nextAllAssetsRunAt: null,
  };
  return globalForAutoScheduler.__apexAutoSchedulerState;
}

function readAutoSchedulerConfig(): AutoSchedulerConfig {
  const apexConfig = getApexConfig();
  const allAssetsIntervalMinutes = normalizeInteger(
    process.env.APEX_AUTO_ALL_ASSETS_INTERVAL_MINUTES,
    apexConfig.cycleIntervalMinutes || DEFAULT_ALL_ASSETS_INTERVAL_MINUTES,
  );
  const dailySignalsCheckIntervalSeconds = normalizeInteger(
    process.env.APEX_AUTO_DAILY_SIGNALS_CHECK_INTERVAL_SECONDS,
    DEFAULT_DAILY_SIGNALS_CHECK_INTERVAL_SECONDS,
  );

  return {
    enabled: normalizeBoolean(process.env.APEX_AUTO_SCHEDULER_ENABLED, true),
    runOnStart: normalizeBoolean(process.env.APEX_AUTO_SCHEDULER_RUN_ON_START, true),
    allAssetsEnabled: normalizeBoolean(process.env.APEX_AUTO_ALL_ASSETS_ENABLED, true),
    allAssetsIntervalMs: allAssetsIntervalMinutes * 60_000,
    dailySignalsEnabled: normalizeBoolean(process.env.APEX_AUTO_DAILY_SIGNALS_ENABLED, true),
    dailySignalsCheckIntervalMs: dailySignalsCheckIntervalSeconds * 1_000,
  };
}

async function acquireRedisLock(lockKey: string, ttlSeconds: number, owner: string): Promise<LockLease> {
  const client = getRedisClient();
  if (!client) {
    return {
      acquired: true,
      release: async () => undefined,
    };
  }

  try {
    const acquired = await client.set(lockKey, owner, "EX", ttlSeconds, "NX");
    if (acquired !== "OK") {
      return {
        acquired: false,
        release: async () => undefined,
      };
    }

    return {
      acquired: true,
      release: async () => {
        try {
          await client.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            lockKey,
            owner,
          );
        } catch (error) {
          logger.warn({
            module: "auto-scheduler",
            message: "Failed to release scheduler lock",
            lock_key: lockKey,
            error: String(error),
          });
        }
      },
    };
  } catch (error) {
    logger.warn({
      module: "auto-scheduler",
      message: "Redis lock acquisition failed; continuing without distributed lock",
      lock_key: lockKey,
      error: String(error),
    });
    return {
      acquired: true,
      release: async () => undefined,
    };
  }
}

async function runAllAssetsTick(config: AutoSchedulerConfig, reason: "startup" | "interval") {
  const state = getAutoSchedulerState();
  if (!state.started || state.allAssetsTickRunning || !config.allAssetsEnabled) {
    return;
  }

  state.allAssetsTickRunning = true;
  state.nextAllAssetsRunAt = Date.now() + config.allAssetsIntervalMs;
  const intervalMinutes = Math.max(1, Math.round(config.allAssetsIntervalMs / 60_000));
  const lockOwner = `${state.instanceId}:${Date.now()}:all-assets`;
  const lock = await acquireRedisLock(
    AUTO_ALL_ASSETS_LOCK_KEY,
    Math.max(intervalMinutes * 60, 300),
    lockOwner,
  );

  if (!lock.acquired) {
    await writeSchedulerHeartbeat({
      mode: "auto",
      startedAt: state.startedAt,
      intervalMinutes,
      nextRunAt: state.nextAllAssetsRunAt,
      lastSource: "auto_scheduler_all_assets_lock_skipped",
    });
    state.allAssetsTickRunning = false;
    return;
  }

  try {
    const result = await triggerAllAssetCycles({
      source: `auto_scheduler_all_assets_${reason}`,
      includeMemecoins: true,
    });
    await writeSchedulerHeartbeat({
      mode: "auto",
      startedAt: state.startedAt,
      lastRunAt: Date.now(),
      lastWorkCompletedAt: Date.now(),
      intervalMinutes,
      nextRunAt: state.nextAllAssetsRunAt,
      lastSource: result.failureCount > 0
        ? "auto_scheduler_all_assets_partial"
        : "auto_scheduler_all_assets_completed",
    });
  } catch (error) {
    logger.error({
      module: "auto-scheduler",
      message: "All-assets auto cycle failed",
      error: String(error),
    });
    await writeSchedulerHeartbeat({
      mode: "auto",
      startedAt: state.startedAt,
      lastRunAt: Date.now(),
      lastWorkCompletedAt: Date.now(),
      intervalMinutes,
      nextRunAt: state.nextAllAssetsRunAt,
      lastSource: "auto_scheduler_all_assets_failed",
    });
  } finally {
    await lock.release();
    state.allAssetsTickRunning = false;
  }
}

async function runDailySignalsTick(config: AutoSchedulerConfig, reason: "startup" | "interval") {
  const state = getAutoSchedulerState();
  if (!state.started || state.dailySignalsTickRunning || !config.dailySignalsEnabled) {
    return;
  }

  state.dailySignalsTickRunning = true;
  const lockOwner = `${state.instanceId}:${Date.now()}:daily-signals`;
  const lock = await acquireRedisLock(
    AUTO_DAILY_SIGNALS_LOCK_KEY,
    Math.max(Math.ceil(config.dailySignalsCheckIntervalMs / 1_000), 45),
    lockOwner,
  );

  if (!lock.acquired) {
    state.dailySignalsTickRunning = false;
    return;
  }

  try {
    const dailySignalsConfig = await getDailySignalsConfig();
    if (!dailySignalsConfig.enabled) {
      return;
    }

    const now = new Date();
    const dueSessions = getDueDailySignalSessions(now, dailySignalsConfig);
    if (dueSessions.length === 0) {
      return;
    }

    for (const session of dueSessions) {
      const run = await runDailySignals({
        force: false,
        dryRun: false,
        now,
        session,
        triggerSource: "operator",
        triggeredBy: "auto_scheduler",
      });
      logger.info({
        module: "auto-scheduler",
        message: "Daily signals session evaluated",
        reason,
        session,
        run_id: run.run.id,
        created: run.created,
        status: run.run.status,
        delivered_count: run.deliveredCount,
        failed_count: run.failedCount,
      });
    }
  } catch (error) {
    logger.error({
      module: "auto-scheduler",
      message: "Daily signals auto tick failed",
      reason,
      error: String(error),
    });
  } finally {
    await lock.release();
    state.dailySignalsTickRunning = false;
  }
}

export async function startAutoRuntimeScheduler(): Promise<void> {
  const state = getAutoSchedulerState();
  if (state.started) {
    return;
  }
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const config = readAutoSchedulerConfig();
  if (!config.enabled) {
    logger.info({
      module: "auto-scheduler",
      message: "Auto scheduler is disabled by configuration",
    });
    return;
  }

  state.started = true;
  state.startedAt = Date.now();
  state.nextAllAssetsRunAt = Date.now() + config.allAssetsIntervalMs;
  const intervalMinutes = Math.max(1, Math.round(config.allAssetsIntervalMs / 60_000));

  await writeSchedulerHeartbeat({
    mode: "auto",
    startedAt: state.startedAt,
    intervalMinutes,
    nextRunAt: state.nextAllAssetsRunAt,
    lastSource: "auto_scheduler_started",
  });

  if (config.allAssetsEnabled) {
    state.allAssetsTimer = setInterval(() => {
      void runAllAssetsTick(config, "interval");
    }, config.allAssetsIntervalMs);
    state.allAssetsTimer.unref?.();

    if (config.runOnStart) {
      void runAllAssetsTick(config, "startup");
    }
  }

  if (config.dailySignalsEnabled) {
    state.dailySignalsTimer = setInterval(() => {
      void runDailySignalsTick(config, "interval");
    }, config.dailySignalsCheckIntervalMs);
    state.dailySignalsTimer.unref?.();

    if (config.runOnStart) {
      void runDailySignalsTick(config, "startup");
    }
  }

  logger.info({
    module: "auto-scheduler",
    message: "Auto scheduler started",
    instance_id: state.instanceId,
    all_assets_enabled: config.allAssetsEnabled,
    all_assets_interval_ms: config.allAssetsIntervalMs,
    daily_signals_enabled: config.dailySignalsEnabled,
    daily_signals_check_interval_ms: config.dailySignalsCheckIntervalMs,
  });
}

export async function stopAutoRuntimeScheduler(): Promise<void> {
  const state = getAutoSchedulerState();
  if (state.allAssetsTimer) {
    clearInterval(state.allAssetsTimer);
    state.allAssetsTimer = null;
  }
  if (state.dailySignalsTimer) {
    clearInterval(state.dailySignalsTimer);
    state.dailySignalsTimer = null;
  }
  state.started = false;
  state.startedAt = null;
  state.allAssetsTickRunning = false;
  state.dailySignalsTickRunning = false;
  state.nextAllAssetsRunAt = null;
}

export function resetAutoRuntimeSchedulerForTests(): void {
  void stopAutoRuntimeScheduler();
  delete globalForAutoScheduler.__apexAutoSchedulerState;
}
