import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const APEX_SCHEDULER_HEARTBEAT_KEY = "apex:scheduler:heartbeat";

export type SchedulerHeartbeat = {
  mode: "manual" | "auto";
  startedAt: number | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  intervalMinutes: number;
  lastSource: string | null;
  /** Last time `executeApexCycle` finished (success, skip, or failure). */
  lastWorkCompletedAt: number | null;
  /** Throttle for stall Telegram alerts. */
  lastStallAlertAt: number | null;
  updatedAt: number;
};

const HEARTBEAT_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function getSchedulerHeartbeat(): Promise<SchedulerHeartbeat | null> {
  return getCachedJson<SchedulerHeartbeat>(APEX_SCHEDULER_HEARTBEAT_KEY);
}

export async function writeSchedulerHeartbeat(
  update: Partial<SchedulerHeartbeat> & { intervalMinutes: number },
): Promise<SchedulerHeartbeat> {
  const current = await getSchedulerHeartbeat();
  const lastRunAt = update.lastRunAt ?? current?.lastRunAt ?? null;
  const next: SchedulerHeartbeat = {
    ...current,
    ...update,
    mode: update.mode ?? current?.mode ?? "manual",
    startedAt: update.startedAt ?? current?.startedAt ?? lastRunAt,
    lastRunAt,
    nextRunAt: update.nextRunAt ?? null,
    lastSource: update.lastSource ?? current?.lastSource ?? null,
    lastWorkCompletedAt: update.lastWorkCompletedAt ?? current?.lastWorkCompletedAt ?? null,
    lastStallAlertAt: update.lastStallAlertAt ?? current?.lastStallAlertAt ?? null,
    updatedAt: Date.now(),
  };

  await setCachedJson(APEX_SCHEDULER_HEARTBEAT_KEY, next, HEARTBEAT_TTL_SECONDS);
  return next;
}
