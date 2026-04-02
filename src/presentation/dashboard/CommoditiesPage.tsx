"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import type { RecoveryMode } from "@/src/interfaces/contracts";
import { CommodityChartDrawer } from "@/src/presentation/dashboard/components/commodities/CommodityChartDrawer";
import { CommodityGrid } from "@/src/presentation/dashboard/components/commodities/CommodityGrid";
import { SentimentBar } from "@/src/presentation/dashboard/components/commodities/SentimentBar";
import { CalendarStrip } from "@/src/presentation/dashboard/components/forex/CalendarStrip";

type CommodityCategory = "metals" | "energy";

type CommodityPriceRow = {
  symbol: string;
  label: string;
  category: CommodityCategory;
  unit: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  high: number | null;
  low: number | null;
  volume: number | null;
  provider: string;
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type CommodityPricesPayload = {
  generatedAt: number;
  assets: CommodityPriceRow[];
};

type CommoditySignalRow = {
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

type CommoditySignalsPayload = {
  generatedAt: number;
  assets: CommoditySignalRow[];
};

type EconomicCalendarEvent = {
  time: string;
  currency: string;
  event: string;
  impact: "high" | "medium" | "low";
  forecast: string;
  previous: string;
  actual?: string;
  timestamp?: number | null;
};

type EconomicCalendarPayload = {
  generatedAt: number;
  events: EconomicCalendarEvent[];
};

type SystemStatusPayload = {
  mode?: RecoveryMode;
};

const COMMODITY_ORDER = [
  "XAUUSD",
  "XAGUSD",
  "WTICOUSD",
  "BCOUSD",
  "NATGASUSD",
] as const;

const EMPTY_SIGNALS: CommoditySignalsPayload = {
  generatedAt: 0,
  assets: COMMODITY_ORDER.map(symbol => ({
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

export function CommoditiesPage() {
  const [mode, setMode] = useState<RecoveryMode>("normal");
  const [now, setNow] = useState(() => Date.now());
  const [prices, setPrices] = useState<CommodityPricesPayload | null>(null);
  const [signals, setSignals] = useState<CommoditySignalsPayload>(EMPTY_SIGNALS);
  const [calendar, setCalendar] = useState<EconomicCalendarPayload | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
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
      const response = await fetch("/api/commodities/live-prices", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as CommodityPricesPayload;
      setPrices(payload);
      setConsecutivePriceFailures(0);
    } catch {
      setConsecutivePriceFailures(current => current + 1);
    }
  });

  const fetchSignals = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/commodities/signals", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as CommoditySignalsPayload;
      setSignals(payload);
    } catch {
      // Keep the last good signal payload on polling failures.
    }
  });

  const fetchCalendar = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/market/economic-calendar", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as EconomicCalendarPayload;
      setCalendar(payload);
      setCalendarError(null);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Commodity calendar unavailable");
    }
  });

  useEffect(() => {
    void fetchSystemStatus();
    void fetchPrices();
    void fetchSignals();
    void fetchCalendar();
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
    const interval = window.setInterval(() => {
      void fetchCalendar();
    }, 30 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (consecutivePriceFailures >= 3) {
      console.log("[APEX PRICES] Commodities page is serving cached/fallback data.");
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
      title="Commodities"
      subtitle="Live commodity intelligence across metals and energy with provider-aware pricing and APEX signal context."
      mode={mode}
    >
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-[var(--apex-font-body)] text-[22px] italic text-[var(--apex-text-primary)]">
                COMMODITIES
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
              12 assets · Metals · Energy · Agriculture
            </p>
          </div>
          <span className="rounded-full border border-[var(--apex-border-subtle)] px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-secondary)]">
            Last update: {relativeAge(now, lastPriceGeneratedAt)}
          </span>
        </div>
      </section>

      <SentimentBar assets={prices?.assets ?? []} />
      <CalendarStrip
        events={calendar?.events ?? []}
        generatedAt={calendar?.generatedAt ?? null}
        now={now}
        error={calendarError}
        filterCurrencies={["USD", "CAD", "AUD", "CNY"]}
      />
      <CommodityGrid
        prices={prices?.assets ?? []}
        signals={signals.assets}
        loading={prices == null}
        now={now}
        onSelectCommodity={setSelectedSymbol}
      />
      <CommodityChartDrawer
        open={selectedSymbol != null}
        symbol={selectedSymbol}
        price={selectedPrice}
        signal={selectedSignal}
        onClose={() => setSelectedSymbol(null)}
      />
    </ApexShell>
  );
}
