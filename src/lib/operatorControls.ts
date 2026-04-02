import type { RecoveryMode } from "@/src/interfaces/contracts";
import type { ApexRepository } from "@/src/lib/repository";
import { getSetting, setSetting } from "@/src/lib/operatorSettings";

export const APEX_KILL_SWITCH_SETTING_KEY = "apex_kill_switch";
export const APEX_RECOVERY_MODE_SETTING_KEY = "apex_recovery_mode";

const RECOVERY_MODES: ReadonlySet<RecoveryMode> = new Set<RecoveryMode>([
  "normal",
  "reduced_confidence",
  "reduced_size",
  "pod_quarantine",
  "execution_only",
  "flat_and_observe",
  "full_stop",
]);

function parseRecoveryMode(raw: string, fallback: RecoveryMode): RecoveryMode {
  const trimmed = raw.trim() as RecoveryMode;
  return RECOVERY_MODES.has(trimmed) ? trimmed : fallback;
}

export async function hydrateOperatorControlsFromDb(
  repository: ApexRepository,
  options?: { defaultRecoveryMode?: RecoveryMode },
): Promise<void> {
  const defaultRecovery = options?.defaultRecoveryMode ?? "normal";
  const killRaw = (await getSetting(APEX_KILL_SWITCH_SETTING_KEY, "false")).trim().toLowerCase();
  repository.setKillSwitch(killRaw === "true" || killRaw === "1" || killRaw === "on");

  const modeRaw = await getSetting(APEX_RECOVERY_MODE_SETTING_KEY, defaultRecovery);
  repository.setRecoveryMode(parseRecoveryMode(modeRaw, defaultRecovery));
}

export async function persistKillSwitchToDb(active: boolean): Promise<void> {
  await setSetting(APEX_KILL_SWITCH_SETTING_KEY, active ? "true" : "false");
}

export async function persistRecoveryModeToDb(mode: RecoveryMode): Promise<void> {
  await setSetting(APEX_RECOVERY_MODE_SETTING_KEY, mode);
}

export function formatSystemModeLabel(mode: RecoveryMode): string {
  switch (mode) {
    case "normal":
      return "Normal";
    case "reduced_size":
      return "Defensive";
    case "flat_and_observe":
      return "Recovery";
    case "full_stop":
      return "Full stop";
    case "reduced_confidence":
      return "Reduced confidence";
    case "pod_quarantine":
      return "Pod quarantine";
    case "execution_only":
      return "Execution only";
    default:
      return mode;
  }
}
