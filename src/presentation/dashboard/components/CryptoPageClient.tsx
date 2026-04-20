"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";
import { SectionHeader } from "@/src/components/apex-ui/SectionHeader";
import type { CryptoSignalsPayload } from "@/src/crypto/types";
import { CryptoPairTile } from "@/src/presentation/dashboard/components/CryptoPairTile";
import { ExecutableSignalCard } from "@/src/presentation/dashboard/components/ExecutableSignalCard";
import { MonitoredSignalCard } from "@/src/presentation/dashboard/components/MonitoredSignalCard";

export function CryptoPageClient({
  initialPayload,
}: {
  initialPayload: CryptoSignalsPayload;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/crypto/signals", {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const next = await response.json() as CryptoSignalsPayload;
      setPayload(next);
    } catch {
      // Keep last payload on polling failure.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function runCycle() {
    setMessage(null);

    const response = await fetch("/api/indices/amt/cycle", {
      method: "POST",
    });
    const payload = await response.json().catch(() => null) as
      | {
        queued?: boolean;
        cycleId?: string;
        cardCount?: number;
        error?: string;
      }
      | null;

    if (!response.ok) {
      setMessage(payload?.error ?? "Crypto cycle failed.");
      return;
    }

    setMessage(
      payload?.queued
        ? `Run Crypto Cycle queued (${payload.cardCount ?? 0} cards).`
        : `Crypto cycle completed${payload?.cycleId ? ` (${payload.cycleId})` : ""}.`,
    );
    await refresh();
  }

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Crypto Runtime</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => startTransition(() => void runCycle())}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-[var(--apex-radius-md)] border border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.10)] px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[#60A5FA] transition hover:border-[rgba(96,165,250,0.55)] hover:bg-[rgba(59,130,246,0.16)] disabled:opacity-60"
              >
                {pending ? "Running" : "Run Crypto Cycle"}
              </button>
              <Chip label={payload.wsConnected ? "BINANCE WS LIVE" : "REST FALLBACK"} variant={payload.wsConnected ? "active" : "watchlist"} />
            </div>
            {message ? (
              <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-accent)]">{message}</p>
            ) : null}
          </div>
          <div className="text-[12px] text-[var(--apex-text-secondary)]">
            <p>Last cycle: {payload.lastCycleAt ? new Date(payload.lastCycleAt).toLocaleString() : "Not run yet"}</p>
            <p className="mt-1">{payload.cards.length} cards built across {payload.selectedAssets.length || payload.liveMarketBoard.length} selected coins.</p>
          </div>
        </div>
      </section>

      <section className="apex-surface px-6 py-5">
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[var(--apex-border-subtle)] pb-4">
          <span className="font-[var(--apex-font-body)] text-[18px] italic text-[var(--apex-text-primary)]">Crypto Market Board</span>
          <span className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            {payload.selectedAssets.slice(0, 8).map(asset => asset.short).join(" · ") || "Dynamic selection"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {payload.liveMarketBoard.map(row => (
            <CryptoPairTile key={row.symbol} row={row} />
          ))}
          {payload.liveMarketBoard.length === 0 ? (
            <div className="col-span-full rounded-[var(--apex-radius-lg)] border border-dashed border-[var(--apex-border-subtle)] px-4 py-8 text-center text-[13px] italic text-[var(--apex-text-tertiary)]">
              Crypto cycle not yet run. Click &ldquo;Run Crypto Cycle&rdquo; to start.
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Crypto Executable"
          count={payload.executable.length}
          subtitle="Live crypto setups cleared by the SMC-driven runtime."
        />
        {payload.executable.length === 0 ? (
          <div className="apex-empty-state">No executable crypto setups in the current cycle.</div>
        ) : (
          <div className="space-y-4">
            {payload.executable.map(signal => (
              <ExecutableSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Crypto Monitored"
          count={payload.monitored.length}
          subtitle="Developing crypto structure below the executable floor."
        />
        {payload.monitored.length === 0 ? (
          <div className="apex-empty-state">No monitored crypto setups right now.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {payload.monitored.map(signal => (
              <MonitoredSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

