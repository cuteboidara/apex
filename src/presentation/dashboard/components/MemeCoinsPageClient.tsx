"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import { SectionHeader } from "@/src/components/apex-ui/SectionHeader";
import type { MemeLiveMarketBoardRow, MemeSignalsPayload, MemeUniverseEntry } from "@/src/assets/memecoins/types";
import { ExecutableSignalCard } from "@/src/presentation/dashboard/components/ExecutableSignalCard";
import { MemeIntelligenceSections } from "@/src/presentation/dashboard/components/MemeIntelligenceSections";
import { MonitoredSignalCard } from "@/src/presentation/dashboard/components/MonitoredSignalCard";

function formatMemePrice(price: number | null, symbol: string): string {
  void symbol;
  if (price === null) return "—";
  if (price >= 1000) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toFixed(4);
  }
  if (price >= 0.001) {
    return price.toFixed(6);
  }
  return price.toExponential(4);
}

function formatDiscoveryTime(timestamp: number | null): string {
  if (timestamp == null) {
    return "Discovery pending";
  }
  const hours = Math.max(0, Math.round((Date.now() - timestamp) / 3_600_000));
  return `Updated ${hours}h ago`;
}

function VolumeBadge({ row }: { row: MemeLiveMarketBoardRow }) {
  if (!row.volumeSpike) {
    return null;
  }

  const variant = row.volumeSpikeStrength === "extreme"
    ? "rgba(239,68,68,0.15)"
    : row.volumeSpikeStrength === "strong"
      ? "rgba(234,179,8,0.15)"
      : "rgba(59,130,246,0.10)";
  const color = row.volumeSpikeStrength === "extreme"
    ? "#F87171"
    : row.volumeSpikeStrength === "strong"
      ? "#EAB308"
      : "#60A5FA";
  const border = row.volumeSpikeStrength === "extreme"
    ? "rgba(239,68,68,0.30)"
    : "rgba(234,179,8,0.25)";

  return (
    <span
      style={{
        background: variant,
        color,
        border: `1px solid ${border}`,
        borderRadius: "4px",
        fontFamily: "var(--apex-font-mono)",
        fontSize: "9px",
        letterSpacing: "0.08em",
        padding: "3px 8px",
      }}
    >
      {row.volumeSpikeStrength.toUpperCase()} VOLUME
    </span>
  );
}

function UniverseChip({ coin }: { coin: MemeUniverseEntry }) {
  return (
    <div
      className={`rounded-full border px-3 py-2 ${
        coin.isBase
          ? "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)]"
          : "border-[var(--apex-border-subtle)] bg-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]">
          {coin.displayName}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-[var(--apex-font-mono)] text-[8px] uppercase tracking-[0.12em] ${
            coin.isBase
              ? "bg-[rgba(80,160,100,0.16)] text-[var(--apex-status-active-text)]"
              : "bg-[rgba(168,85,247,0.10)] text-[#C084FC]"
          }`}
        >
          {coin.isBase ? "BASE" : "TRENDING"}
        </span>
      </div>
    </div>
  );
}

function MemeMarketTile({ row }: { row: MemeLiveMarketBoardRow }) {
  return (
    <article className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-[var(--apex-font-mono)] text-[13px] font-medium text-[var(--apex-text-primary)]">{row.symbol}</p>
            <span className="text-[11px] text-[var(--apex-text-tertiary)]">{row.displayName}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Chip label={row.isBase ? "BASE" : "TRENDING"} variant={row.isBase ? "active" : "developing"} />
            <Chip label={row.dataSource.toUpperCase()} variant="neutral" />
          </div>
        </div>
        {row.grade ? <GradeTag grade={row.grade as never} /> : null}
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="font-[var(--apex-font-mono)] text-[20px] text-[var(--apex-text-accent)]">{formatMemePrice(row.livePrice, row.symbol)}</p>
        {row.priceChange24h !== null ? (
          <span
            style={{
              fontFamily: "var(--apex-font-mono)",
              fontSize: "11px",
              color: row.priceChange24h >= 0 ? "var(--apex-status-active-text)" : "#F87171",
            }}
          >
            {row.priceChange24h >= 0 ? "+" : ""}
            {row.priceChange24h.toFixed(1)}%
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip label={row.direction.toUpperCase()} variant={row.direction === "buy" ? "active" : row.direction === "sell" ? "blocked" : "neutral"} />
        <VolumeBadge row={row} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
          PD {row.pdLocation}
        </span>
        {row.marketCapRank != null ? (
          <span className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
            Rank #{row.marketCapRank}
          </span>
        ) : null}
      </div>

      {row.noTradeReason ? (
        <p className="mt-3 text-[12px] text-[var(--apex-text-tertiary)]">{row.noTradeReason}</p>
      ) : null}
    </article>
  );
}

export function MemeCoinsPageClient({
  initialPayload,
}: {
  initialPayload: MemeSignalsPayload;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [message, setMessage] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/meme-scanner", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const next = await response.json() as MemeSignalsPayload;
      setPayload(next);
    } catch {
      // Keep last payload on polling failure.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function runCycle() {
    setMessage(null);
    const response = await fetch("/api/indices/amt/cycle", { method: "POST" });
    const next = await response.json().catch(() => null) as
      | { queued?: boolean; cardCount?: number; universeSize?: number; error?: string }
      | null;

    if (!response.ok) {
      setMessage(next?.error ?? "Meme cycle trigger failed.");
      return;
    }

    setMessage(
      next?.queued
        ? `Meme cycle queued (${next.cardCount ?? 0} cards across ${next.universeSize ?? payload.universeSize} coins).`
        : "Meme cycle completed.",
    );
    await refresh();
  }

  async function runDiscovery() {
    setMessage(null);
    setDiscovering(true);
    try {
      const response = await fetch("/api/meme-discovery-trigger", { method: "POST" });
      const next = await response.json().catch(() => null) as
        | { success?: boolean; universeSize?: number; error?: string }
        | null;

      if (!response.ok) {
        setMessage(next?.error ?? "Meme discovery failed.");
        return;
      }

      setMessage(`Discovery refreshed. Universe now tracks ${next?.universeSize ?? payload.universeSize} coins.`);
      await refresh();
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
              Dynamic universe · Volume spike detection · SMC confluence
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => startTransition(() => void runCycle())}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-[var(--apex-radius-md)] border border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.12)] px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-status-active-text)] transition hover:border-[rgba(123,201,149,0.55)] hover:bg-[rgba(80,160,100,0.18)] disabled:opacity-60"
              >
                {pending ? "Running" : "Run Cycle"}
              </button>
              <button
                type="button"
                onClick={() => void runDiscovery()}
                disabled={discovering}
                style={{
                  background: "rgba(168,85,247,0.10)",
                  border: "1px solid rgba(168,85,247,0.30)",
                  borderRadius: "6px",
                  color: "#C084FC",
                  cursor: "pointer",
                  fontFamily: "var(--apex-font-mono)",
                  fontSize: "10px",
                  height: "32px",
                  letterSpacing: "0.12em",
                  padding: "0 16px",
                  textTransform: "uppercase",
                  opacity: discovering ? 0.7 : 1,
                }}
              >
                {discovering ? "Discovering..." : "Discover New Coins"}
              </button>
              <Chip label={`UNIVERSE ${payload.universeSize}`} variant="developing" />
              <Chip label={payload.wsConnected ? "BINANCE WS LIVE" : "REST / COINGECKO"} variant={payload.wsConnected ? "active" : "watchlist"} />
            </div>
            {message ? (
              <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-accent)]">{message}</p>
            ) : null}
          </div>
          <div className="text-[12px] text-[var(--apex-text-secondary)]">
            <p>Last cycle: {payload.lastCycleAt ? new Date(payload.lastCycleAt).toLocaleString() : "Not run yet"}</p>
            <p className="mt-1">{formatDiscoveryTime(payload.lastDiscoveryAt)}</p>
          </div>
        </div>
      </section>

      <section className="apex-surface px-6 py-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--apex-border-subtle)] pb-4">
          <div>
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Active Universe</p>
            <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">Base meme coins stay pinned. Trending additions refresh every six hours.</p>
          </div>
          <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">{payload.universeSize} tracked</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {payload.universe.map(coin => (
            <UniverseChip key={coin.symbol} coin={coin} />
          ))}
        </div>
      </section>

      <section className="apex-surface px-6 py-5">
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[var(--apex-border-subtle)] pb-4">
          <span className="font-[var(--apex-font-body)] text-[18px] italic text-[var(--apex-text-primary)]">Live Board</span>
          <span className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            DOGE · SHIB · PEPE · WIF + dynamic discovery
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {payload.liveMarketBoard.map(row => (
            <MemeMarketTile key={row.symbol} row={row} />
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Executable Signals"
          count={payload.executable.length}
          subtitle="High-velocity meme setups with sufficient confluence to publish."
        />
        {payload.executable.length === 0 ? (
          <div className="apex-empty-state">Run a meme cycle to see executable signals.</div>
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
          title="Monitoring"
          count={payload.monitored.length}
          subtitle="Trending meme coins and below-floor setups that are still worth tracking."
        />
        {payload.monitored.length === 0 ? (
          <div className="apex-empty-state">No monitored meme setups are active right now.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {payload.monitored.map(signal => (
              <MonitoredSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </section>

      <MemeIntelligenceSections />
    </div>
  );
}

