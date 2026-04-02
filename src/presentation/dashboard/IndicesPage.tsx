"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import type { RecoveryMode } from "@/src/interfaces/contracts";
import { DXYVIXWidget } from "@/src/presentation/dashboard/components/indices/DXYVIXWidget";
import { GlobalMarketOverview } from "@/src/presentation/dashboard/components/indices/GlobalMarketOverview";
import { IndicesChartDrawer } from "@/src/presentation/dashboard/components/indices/IndicesChartDrawer";
import { IndicesGrid } from "@/src/presentation/dashboard/components/indices/IndicesGrid";

type IndexRegion = "us" | "europe" | "asia";

type IndexPriceRow = {
  symbol: string;
  label: string;
  region: IndexRegion;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  high: number | null;
  low: number | null;
  provider: string;
  freshAt: number;
  marketStatus: "open" | "closed";
  stale?: boolean;
  reason?: string | null;
};

type IndexPricesPayload = {
  generatedAt: number;
  assets: IndexPriceRow[];
};

type IndexSignalRow = {
  symbol: string;
  grade: string | null;
  status: "active" | "watchlist" | "blocked" | "pending" | "invalidated" | "expired";
  direction: "buy" | "sell" | "neutral" | null;
  confidence: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  reasoning: string | null;
  generatedAt: number | null;
};

type IndexSignalsPayload = {
  generatedAt: number;
  assets: IndexSignalRow[];
};

type SystemStatusPayload = {
  mode?: RecoveryMode;
};

const INDEX_ORDER = [
  "^GSPC",
  "^DJI",
  "^IXIC",
  "^RUT",
  "^FTSE",
  "^GDAXI",
  "^FCHI",
  "^N225",
  "^HSI",
  "^AXJO",
  "DX-Y.NYB",
  "^VIX",
] as const;

const EMPTY_SIGNALS: IndexSignalsPayload = {
  generatedAt: 0,
  assets: INDEX_ORDER.map(symbol => ({
    symbol,
    grade: null,
    status: "pending",
    direction: null,
    confidence: null,
    entry: null,
    stopLoss: null,
    takeProfit: null,
    takeProfit2: null,
    takeProfit3: null,
    reasoning: null,
    generatedAt: null,
  })),
};

function relativeAge(now: number, timestamp: number | null): string {
  if (!timestamp) {
    return "Never";
  }
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  return `${Math.floor(diffMinutes / 60)}h ago`;
}

export function IndicesPage() {
  const [mode, setMode] = useState<RecoveryMode>("normal");
  const [now, setNow] = useState(() => Date.now());
  const [prices, setPrices] = useState<IndexPricesPayload | null>(null);
  const [signals, setSignals] = useState<IndexSignalsPayload>(EMPTY_SIGNALS);
  const [consecutivePriceFailures, setConsecutivePriceFailures] = useState(0);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const fetchSystemStatus = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/system/status", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json() as SystemStatusPayload;
      if (payload.mode) {
        setMode(payload.mode);
      }
    } catch {
      // Keep default mode.
    }
  });

  const fetchPrices = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/indices/live-prices", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as IndexPricesPayload;
      setPrices(payload);
      setConsecutivePriceFailures(0);
    } catch {
      setConsecutivePriceFailures(current => current + 1);
    }
  });

  const fetchSignals = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/indices/signals", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as IndexSignalsPayload;
      setSignals(payload);
    } catch {
      // Keep the last good signal payload on polling failures.
    }
  });

  useEffect(() => {
    void fetchSystemStatus();
    void fetchPrices();
    void fetchSignals();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchPrices();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchSignals();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (consecutivePriceFailures >= 3) {
      console.log("[APEX PRICES] Indices page is serving cached/fallback data.");
    }
  }, [consecutivePriceFailures]);

  const lastPriceGeneratedAt = prices?.generatedAt ?? null;
  const isLive = (lastPriceGeneratedAt ?? 0) > 0
    && (now - (lastPriceGeneratedAt ?? 0)) < 45_000
    && consecutivePriceFailures < 3;
  const priceMap = new Map((prices?.assets ?? []).map(asset => [asset.symbol, asset]));
  const signalMap = new Map(signals.assets.map(asset => [asset.symbol, asset]));
  const selectedPrice = selectedSymbol ? priceMap.get(selectedSymbol) ?? null : null;
  const selectedSignal = selectedSymbol ? signalMap.get(selectedSymbol) ?? null : null;

  return (
    <ApexShell
      title="Indices"
      subtitle="Live index intelligence across global benchmarks with DXY and VIX context and APEX signal overlays."
      mode={mode}
    >
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-[var(--apex-font-body)] text-[22px] italic text-[var(--apex-text-primary)]">
                INDICES
              </h2>
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] ${
                  isLive
                    ? "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]"
                    : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${isLive ? "animate-pulse bg-[var(--apex-status-active-text)]" : "bg-[rgba(255,255,255,0.16)]"}`} />
                LIVE
              </span>
            </div>
            <p className="mt-3 text-[13px] text-[var(--apex-text-secondary)]">
              12 indices · Americas · Europe · Asia-Pacific
            </p>
          </div>
          <span className="rounded-full border border-[var(--apex-border-subtle)] px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-secondary)]">
            Last update: {relativeAge(now, lastPriceGeneratedAt)}
          </span>
        </div>
      </section>

      <GlobalMarketOverview assets={prices?.assets ?? []} />
      <DXYVIXWidget assets={prices?.assets ?? []} />
      <IndicesGrid
        prices={prices?.assets ?? []}
        signals={signals.assets}
        loading={prices == null}
        now={now}
        onSelectIndex={setSelectedSymbol}
      />
      <IndicesChartDrawer
        open={selectedSymbol != null}
        symbol={selectedSymbol}
        price={selectedPrice}
        signal={selectedSignal}
        onClose={() => setSelectedSymbol(null)}
      />
    </ApexShell>
  );
}
