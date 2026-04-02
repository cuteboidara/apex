"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";
import { ExecutableSignalCard } from "@/src/presentation/dashboard/components/ExecutableSignalCard";
import { MonitoredSignalCard } from "@/src/presentation/dashboard/components/MonitoredSignalCard";
import { RejectedSignalCard } from "@/src/presentation/dashboard/components/RejectedSignalCard";
import type { SignalViewModel } from "@/src/domain/models/signalPipeline";

type AdminSignalsPayload = {
  generatedAt: number;
  pipelineDiagnostics?: Record<string, unknown> | null;
  executable: SignalViewModel[];
  monitored: SignalViewModel[];
  rejected: SignalViewModel[];
};

export default function AdminSignalsPage() {
  const [payload, setPayload] = useState<AdminSignalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"executable" | "monitored" | "rejected">("executable");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await fetchJsonResponse<AdminSignalsPayload>("/api/admin/signals");
      if (cancelled) {
        return;
      }

      if (result.ok && result.data) {
        setPayload(result.data);
        setError(null);
      } else {
        setPayload(null);
        setError(formatApiError(result, "Failed to load canonical admin signals."));
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo(() => payload?.[tab] ?? [], [payload, tab]);

  return (
    <div className="space-y-6">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Canonical Signal Truth</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Executable, monitored, and rejected
        </h2>
        <p className="mt-3 text-[14px] leading-7 text-[var(--apex-text-secondary)]">
          Admin visibility over the same canonical signal view models used by the trader surface.
        </p>
        {payload?.pipelineDiagnostics ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries((payload.pipelineDiagnostics.stageCounts as Record<string, unknown> | undefined) ?? {}).map(([key, value]) => (
              <span
                key={key}
                className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]"
              >
                {key.replace(/([A-Z])/g, " $1").trim()}: {String(value)}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <div className="apex-tab-row">
        {(["executable", "monitored", "rejected"] as const).map(item => (
          <button key={item} onClick={() => setTab(item)} data-active={tab === item} className="apex-tab-button">
            {item}
            {payload ? ` (${payload[item].length})` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="apex-empty-state">Loading canonical signals…</div>
      ) : error ? (
        <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
          {error}
        </div>
      ) : tab === "executable" ? (
        items.length === 0 ? (
          <div className="apex-empty-state">No executable signals.</div>
        ) : (
          <div className="space-y-4">
            {items.map(signal => (
              <ExecutableSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )
      ) : tab === "monitored" ? (
        items.length === 0 ? (
          <div className="apex-empty-state">No monitored setups.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {items.map(signal => (
              <MonitoredSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <div className="apex-empty-state">No rejected signals.</div>
      ) : (
        <div className="space-y-2">
          {items.map(signal => (
            <RejectedSignalCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}
