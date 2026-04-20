"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { RecoveryMode } from "@/src/interfaces/contracts";

type RecoveryFamily = "normal" | "defensive" | "recovery";

const RECOVERY_FAMILIES: Array<{ family: RecoveryFamily; label: string; mode: RecoveryMode }> = [
  { family: "normal", label: "Normal", mode: "normal" },
  { family: "defensive", label: "Defensive", mode: "reduced_size" },
  { family: "recovery", label: "Recovery", mode: "flat_and_observe" },
];

function familyForMode(mode: RecoveryMode): RecoveryFamily {
  if (mode === "normal") {
    return "normal";
  }
  if (mode === "reduced_confidence" || mode === "reduced_size") {
    return "defensive";
  }
  return "recovery";
}

function formatModeLabel(mode: RecoveryMode) {
  return mode.replaceAll("_", " ");
}

export function SystemControls({
  mode,
  killSwitchActive,
}: {
  mode: RecoveryMode;
  killSwitchActive: boolean;
}) {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState(mode);
  const [selectedFamily, setSelectedFamily] = useState<RecoveryFamily>(familyForMode(mode));
  const [cycleMessage, setCycleMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setSelectedMode(mode);
    setSelectedFamily(familyForMode(mode));
  }, [mode]);

  async function updateMode(nextMode: RecoveryMode) {
    const response = await fetch("/api/ops/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: nextMode }),
    });
    if (response.ok) {
      router.refresh();
    }
  }

  async function updateKillSwitch(active: boolean) {
    if (!window.confirm(active ? "Activate the global kill switch?" : "Deactivate the global kill switch?")) {
      return;
    }

    const response = await fetch("/api/system/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (response.ok) {
      router.refresh();
    }
  }

  async function runCycle() {
    setCycleMessage(null);

    const response = await fetch("/api/indices/amt/cycle", {
      method: "POST",
    });
    const payload = await response.json().catch(() => null) as
      | {
        ok?: boolean;
        cycleId?: string;
        executableCount?: number;
        watchlistCount?: number;
        error?: string;
      }
      | null;

    if (!response.ok) {
      setCycleMessage(
        response.status === 401
          ? "AMT cycle trigger is unauthorized."
          : payload?.error ?? "AMT cycle trigger failed.",
      );
      return;
    }

    setCycleMessage(
      payload?.ok
        ? `AMT cycle complete${payload?.cycleId ? ` (${payload.cycleId})` : ""} · executable ${payload?.executableCount ?? 0} · watchlist ${payload?.watchlistCount ?? 0}.`
        : payload?.error ?? "AMT cycle trigger failed.",
    );
    router.refresh();
  }

  async function runSniperCycle() {
    setCycleMessage(null);

    const response = await fetch("/api/sniper/cycle", {
      method: "POST",
    });
    const payload = await response.json().catch(() => null) as
      | {
        signals?: Array<unknown>;
        errors?: string[];
        session?: string;
        error?: string;
      }
      | null;

    if (!response.ok) {
      setCycleMessage(payload?.error ?? "Sniper cycle trigger failed.");
      return;
    }

    setCycleMessage(
      `Sniper cycle complete · signals ${payload?.signals?.length ?? 0} · errors ${payload?.errors?.length ?? 0} · session ${payload?.session ?? "-"}.`,
    );
    router.refresh();
  }

  return (
    <section className="apex-surface px-6 py-6">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">System Controls</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => startTransition(() => void runCycle())}
              disabled={pending}
              className="apex-button apex-button-amber disabled:opacity-60"
            >
              {pending ? "Running AMT" : "Run AMT Cycle"}
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => void runSniperCycle())}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-[var(--apex-radius-md)] border border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.10)] px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[#60A5FA] transition hover:border-[rgba(96,165,250,0.55)] hover:bg-[rgba(59,130,246,0.16)] disabled:opacity-60"
            >
              {pending ? "Running Sniper" : "Run Sniper Cycle"}
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => void updateKillSwitch(!killSwitchActive))}
              disabled={pending}
              className={`apex-button ${killSwitchActive ? "apex-button-danger" : "apex-button-muted"} disabled:opacity-60`}
            >
              {pending ? "Updating" : killSwitchActive ? "Deactivate Kill Switch" : "Activate Kill Switch"}
            </button>
          </div>
          {cycleMessage ? (
            <div className="flex items-center gap-2 font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-accent)]">
              <span className="apex-pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--apex-text-accent)]" />
              <span>{cycleMessage}</span>
            </div>
          ) : null}
        </div>

        <div className="min-w-[300px]">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Recovery Mode</p>
          <div className="mt-2 inline-flex overflow-hidden rounded-[var(--apex-radius-md)]">
            {RECOVERY_FAMILIES.map(item => {
              const active = selectedFamily === item.family;
              return (
                <button
                  key={item.family}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setSelectedFamily(item.family);
                    setSelectedMode(item.mode);
                    startTransition(() => void updateMode(item.mode));
                  }}
                  className={`h-9 border px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] disabled:opacity-60 ${
                    active
                      ? "border-[var(--apex-border-strong)] bg-[var(--apex-bg-raised)] text-[var(--apex-text-primary)]"
                      : "border-[var(--apex-border-subtle)] bg-transparent text-[var(--apex-text-tertiary)] hover:border-[var(--apex-border-default)] hover:text-[var(--apex-text-secondary)]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">
            Current mode: {formatModeLabel(selectedMode)}
          </p>
        </div>
      </div>
    </section>
  );
}

