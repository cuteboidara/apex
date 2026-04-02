"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import type { RecoveryMode } from "@/src/interfaces/contracts";
import { MarketStatusBanner } from "@/src/presentation/dashboard/components/stocks/MarketStatusBanner";
import { SectorSentimentBar } from "@/src/presentation/dashboard/components/stocks/SectorSentimentBar";
import { StockChartDrawer } from "@/src/presentation/dashboard/components/stocks/StockChartDrawer";
import { StockGrid } from "@/src/presentation/dashboard/components/stocks/StockGrid";

type StockSector = "tech" | "finance" | "energy";
type MarketStatus = "open" | "closed" | "pre" | "after";

type StockPriceRow = {
  symbol: string;
  label: string;
  sector: StockSector;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap?: number | null;
  provider: string;
  freshAt: number;
  marketStatus: MarketStatus;
  stale?: boolean;
  reason?: string | null;
};

type StockPricesPayload = {
  generatedAt: number;
  marketStatus: MarketStatus;
  assets: StockPriceRow[];
};

type StockSignalRow = {
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

type StockSignalsPayload = {
  generatedAt: number;
  assets: StockSignalRow[];
};

type SystemStatusPayload = {
  mode?: RecoveryMode;
};

const STOCK_ORDER = [
  "AAPL",
  "MSFT",
  "NVDA",
  "GOOGL",
  "META",
  "AMZN",
  "TSLA",
  "JPM",
  "GS",
  "BAC",
  "XOM",
  "CVX",
] as const;

const EMPTY_SIGNALS: StockSignalsPayload = {
  generatedAt: 0,
  assets: STOCK_ORDER.map(symbol => ({
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

function getEasternParts(now: number): { day: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(now));
  const weekday = parts.find(part => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[weekday] ?? 1,
    minutes: hour * 60 + minute,
  };
}

function getMarketStatus(now: number): MarketStatus {
  const eastern = getEasternParts(now);
  if (eastern.day === 0 || eastern.day === 6) {
    return "closed";
  }
  if (eastern.minutes >= 9 * 60 + 30 && eastern.minutes < 16 * 60) {
    return "open";
  }
  if (eastern.minutes >= 4 * 60 && eastern.minutes < 9 * 60 + 30) {
    return "pre";
  }
  if (eastern.minutes >= 16 * 60 && eastern.minutes < 20 * 60) {
    return "after";
  }
  return "closed";
}

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

export function StocksPage() {
  const [mode, setMode] = useState<RecoveryMode>("normal");
  const [now, setNow] = useState(() => Date.now());
  const [prices, setPrices] = useState<StockPricesPayload | null>(null);
  const [signals, setSignals] = useState<StockSignalsPayload>(EMPTY_SIGNALS);
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
      const response = await fetch("/api/stocks/live-prices", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as StockPricesPayload;
      setPrices(payload);
      setConsecutivePriceFailures(0);
    } catch {
      setConsecutivePriceFailures(current => current + 1);
    }
  });

  const fetchSignals = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/stocks/signals", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as StockSignalsPayload;
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

  const effectiveMarketStatus = prices?.marketStatus ?? getMarketStatus(now);
  const pricePollMs = useMemo(
    () => (effectiveMarketStatus === "open" ? 15_000 : 5 * 60_000),
    [effectiveMarketStatus],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchPrices();
    }, pricePollMs);
    return () => window.clearInterval(interval);
  }, [pricePollMs]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchSignals();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (consecutivePriceFailures >= 3) {
      console.log("[APEX PRICES] Stocks page is serving cached/fallback data.");
    }
  }, [consecutivePriceFailures]);

  const lastPriceGeneratedAt = prices?.generatedAt ?? null;
  const isLive = (lastPriceGeneratedAt ?? 0) > 0
    && (now - (lastPriceGeneratedAt ?? 0)) < (pricePollMs + 15_000)
    && consecutivePriceFailures < 3;
  const priceMap = new Map((prices?.assets ?? []).map(asset => [asset.symbol, asset]));
  const signalMap = new Map(signals.assets.map(asset => [asset.symbol, asset]));
  const selectedPrice = selectedSymbol ? priceMap.get(selectedSymbol) ?? null : null;
  const selectedSignal = selectedSymbol ? signalMap.get(selectedSymbol) ?? null : null;

  return (
    <ApexShell
      title="Stocks"
      subtitle="Live stock intelligence across the focused US board with market-status aware polling and APEX signal overlays."
      mode={mode}
    >
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-[var(--apex-font-body)] text-[22px] italic text-[var(--apex-text-primary)]">
                STOCKS
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
              12 stocks · NYSE &amp; NASDAQ · Last update: {relativeAge(now, lastPriceGeneratedAt)}
            </p>
          </div>
        </div>
      </section>

      <MarketStatusBanner now={now} />
      <SectorSentimentBar assets={prices?.assets ?? []} />
      <StockGrid
        prices={prices?.assets ?? []}
        signals={signals.assets}
        loading={prices == null}
        now={now}
        onSelectStock={setSelectedSymbol}
      />
      <StockChartDrawer
        open={selectedSymbol != null}
        symbol={selectedSymbol}
        price={selectedPrice}
        signal={selectedSignal}
        onClose={() => setSelectedSymbol(null)}
      />
    </ApexShell>
  );
}
