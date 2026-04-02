"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import { SectionHeader } from "@/src/components/apex-ui/SectionHeader";
import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import { ExecutableSignalCard } from "@/src/presentation/dashboard/components/ExecutableSignalCard";
import { MonitoredSignalCard } from "@/src/presentation/dashboard/components/MonitoredSignalCard";
import { RejectedSignalCard } from "@/src/presentation/dashboard/components/RejectedSignalCard";

type MarketBoardRow = {
  symbol: string;
  displayName: string;
  category: string;
  livePrice: number | null;
  grade: string | null;
  status: string;
  noTradeReason: string | null;
  marketStateLabels: string[];
};

type ModuleSignalsPayload<TCard extends SignalViewModel, TRow extends MarketBoardRow> = {
  enabled: boolean;
  generatedAt: number;
  lastCycleAt: number | null;
  cycleRunning: boolean;
  providerName?: string;
  providerStatus?: "ready" | "healthy" | "degraded" | "broken" | "degraded_stooq_fallback" | "degraded_yahoo_fallback" | "degraded_cached" | "healthy_stooq" | "no_data" | "plan_upgrade_required" | "not_configured";
  providerNotice?: string | null;
  cards: TCard[];
  executable: TCard[];
  monitored: TCard[];
  rejected: TCard[];
  liveMarketBoard: TRow[];
};

type FilterOption = {
  label: string;
  value: string;
};

function statusVariant(status: string) {
  if (status === "active") return "active" as const;
  if (status === "blocked" || status === "invalidated" || status === "expired") return "blocked" as const;
  if (status === "watchlist") return "watchlist" as const;
  return "neutral" as const;
}

function formatPrice(value: number | null): string {
  if (value == null) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getProviderChip(payload: ModuleSignalsPayload<SignalViewModel, MarketBoardRow>) {
  if (!payload.enabled || payload.providerStatus === "not_configured") {
    return {
      label: "DATA DISABLED",
      variant: "watchlist" as const,
    };
  }

  if (payload.providerStatus === "plan_upgrade_required") {
    return {
      label: "PLAN LIMITED",
      variant: "watchlist" as const,
    };
  }

  if (
    payload.providerStatus === "degraded"
    || payload.providerStatus === "broken"
    || payload.providerStatus === "degraded_stooq_fallback"
    || payload.providerStatus === "degraded_yahoo_fallback"
    || payload.providerStatus === "degraded_cached"
  ) {
    return {
      label: payload.providerStatus === "broken" ? "DATA BROKEN" : "DATA DEGRADED",
      variant: payload.providerStatus === "broken" ? "watchlist" as const : "developing" as const,
    };
  }

  if (payload.providerStatus === "no_data") {
    return {
      label: "NO DATA",
      variant: "watchlist" as const,
    };
  }

  return {
    label: "DATA READY",
    variant: "active" as const,
  };
}

export function ModuleSignalsPageClient<TCard extends SignalViewModel & { category: string }, TRow extends MarketBoardRow>({
  initialPayload,
  signalsPath,
  triggerPath,
  runLabel,
  emptyState,
  disabledCopy,
  pollMs = 30_000,
  filters,
  groupLabels = {},
}: {
  initialPayload: ModuleSignalsPayload<TCard, TRow>;
  signalsPath: string;
  triggerPath: string;
  runLabel: string;
  emptyState: string;
  disabledCopy: string;
  pollMs?: number;
  filters: FilterOption[];
  groupLabels?: Record<string, string>;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [selectedFilter, setSelectedFilter] = useState(filters[0]?.value ?? "all");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(signalsPath, {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const next = await response.json() as ModuleSignalsPayload<TCard, TRow>;
      setPayload(next);
    } catch {
      // Keep last known payload on polling failure.
    }
  }, [signalsPath]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, refresh]);

  async function runCycle() {
    setMessage(null);

    const response = await fetch(triggerPath, {
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
      setMessage(payload?.error ?? `${runLabel} failed.`);
      return;
    }

    setMessage(
      payload?.queued
        ? `${runLabel} queued (${payload.cardCount ?? 0} cards).`
        : `${runLabel} completed${payload?.cycleId ? ` (${payload.cycleId})` : ""}.`,
    );
    await refresh();
  }

  const filteredRows = payload.liveMarketBoard.filter(row =>
    selectedFilter === "all" || row.category === selectedFilter,
  );

  function filterCards(cards: TCard[]) {
    return cards.filter(card => selectedFilter === "all" || card.category === selectedFilter);
  }

  function renderGroupedCards(cards: TCard[], variant: "executable" | "monitored" | "rejected") {
    if (cards.length === 0) {
      return <div className="apex-empty-state">{emptyState}</div>;
    }

    const groups = new Map<string, TCard[]>();
    for (const card of cards) {
      const group = card.category;
      const bucket = groups.get(group) ?? [];
      bucket.push(card);
      groups.set(group, bucket);
    }

    const groupEntries = Array.from(groups.entries()).sort((left, right) => left[0].localeCompare(right[0]));

    return (
      <div className="space-y-6">
        {groupEntries.map(([group, groupCards]) => (
          <div key={group} className="space-y-4">
            {selectedFilter === "all" ? (
              <div className="border-b border-[var(--apex-border-subtle)] pb-2">
                <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
                  {groupLabels[group] ?? group.replaceAll("_", " ")}
                </p>
              </div>
            ) : null}
            {variant === "executable" ? (
              <div className="space-y-4">
                {groupCards.map(card => (
                  <ExecutableSignalCard key={card.id} signal={card} />
                ))}
              </div>
            ) : variant === "monitored" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {groupCards.map(card => (
                  <MonitoredSignalCard key={card.id} signal={card} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {groupCards.map(card => (
                  <RejectedSignalCard key={card.id} signal={card} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  const executable = filterCards(payload.executable);
  const monitored = filterCards(payload.monitored);
  const rejected = filterCards(payload.rejected);
  const providerChip = getProviderChip(payload as ModuleSignalsPayload<SignalViewModel, MarketBoardRow>);

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Module Control</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => startTransition(() => void runCycle())}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-[var(--apex-radius-md)] border border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.12)] px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-status-active-text)] transition hover:border-[rgba(123,201,149,0.55)] hover:bg-[rgba(80,160,100,0.18)] disabled:opacity-60"
              >
                {pending ? "Running" : runLabel}
              </button>
              <Chip label={providerChip.label} variant={providerChip.variant} />
              <Chip label={payload.cycleRunning ? "CYCLE RUNNING" : "IDLE"} variant={payload.cycleRunning ? "developing" : "neutral"} />
            </div>
            {message ? (
              <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-accent)]">{message}</p>
            ) : null}
            {!payload.enabled ? (
              <p className="text-[12px] text-[#EAB308]">{disabledCopy}</p>
            ) : null}
            {payload.enabled && payload.providerNotice ? (
              <p className="text-[12px] text-[#EAB308]">{payload.providerNotice}</p>
            ) : null}
          </div>
          <div className="text-[12px] text-[var(--apex-text-secondary)]">
            <p>Last cycle: {payload.lastCycleAt ? new Date(payload.lastCycleAt).toLocaleString() : "Not run yet"}</p>
            <p className="mt-1">{payload.cards.length} cards built in the latest module cycle.</p>
          </div>
        </div>
      </section>

      <section className="apex-surface px-6 py-5">
        <div className="mb-4 flex flex-wrap gap-2">
          {filters.map(filter => {
            const active = selectedFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSelectedFilter(filter.value)}
                className={`rounded-full border px-3 py-1.5 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] transition ${
                  active
                    ? "border-[var(--apex-border-strong)] bg-[var(--apex-bg-raised)] text-[var(--apex-text-primary)]"
                    : "border-[var(--apex-border-subtle)] text-[var(--apex-text-tertiary)] hover:border-[var(--apex-border-default)] hover:text-[var(--apex-text-secondary)]"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredRows.map(row => (
            <article
              key={row.symbol}
              className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-[var(--apex-font-mono)] text-[13px] font-medium text-[var(--apex-text-primary)]">{row.symbol}</p>
                  <p className="mt-1 text-[11px] text-[var(--apex-text-tertiary)]">{row.displayName}</p>
                </div>
                {row.grade ? <GradeTag grade={row.grade as never} /> : <span className="font-[var(--apex-font-mono)] text-[16px] text-[var(--apex-text-tertiary)]">—</span>}
              </div>
              <p className="mt-4 font-[var(--apex-font-mono)] text-[20px] text-[var(--apex-text-accent)]">{formatPrice(row.livePrice)}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Chip label={row.status} variant={statusVariant(row.status)} />
                {row.marketStateLabels.slice(0, 2).map(label => (
                  <Chip key={`${row.symbol}-${label}`} label={label} variant="neutral" />
                ))}
              </div>
              {row.noTradeReason ? (
                <p className="mt-3 text-[12px] text-[var(--apex-text-tertiary)]">{row.noTradeReason}</p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Executable"
          count={executable.length}
          subtitle="Highest-conviction setups in the current module cycle."
        />
        {renderGroupedCards(executable, "executable")}
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Monitored"
          count={monitored.length}
          subtitle="Developing structure, closed-market context, or below-floor setups."
        />
        {renderGroupedCards(monitored, "monitored")}
      </section>

      {rejected.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader
            title="Rejected"
            count={rejected.length}
            subtitle="Blocked setups or unavailable data in the latest module cycle."
          />
          {renderGroupedCards(rejected, "rejected")}
        </section>
      ) : null}
    </div>
  );
}
