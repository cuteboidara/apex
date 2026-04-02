"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import type { RecoveryMode } from "@/src/interfaces/contracts";
import { CalendarStrip } from "@/src/presentation/dashboard/components/forex/CalendarStrip";
import { ChartDrawer } from "@/src/presentation/dashboard/components/forex/ChartDrawer";
import { PairGrid } from "@/src/presentation/dashboard/components/forex/PairGrid";
import { SessionBar } from "@/src/presentation/dashboard/components/forex/SessionBar";

type ForexLivePriceRow = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  spread: number | null;
  provider: "oanda" | "twelvedata" | "yahoo" | "erapi" | "cache";
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type ForexLivePricesPayload = {
  generatedAt: number;
  pairs: ForexLivePriceRow[];
};

type ForexSignalRow = {
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

type ForexSignalsPayload = {
  generatedAt: number;
  pairs: ForexSignalRow[];
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

const FOREX_PAIR_ORDER = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "EURJPY",
  "AUDUSD",
  "NZDUSD",
  "USDCHF",
  "USDCAD",
  "XAUUSD",
  "XAGUSD",
] as const;

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

function buildEmptySignals(): ForexSignalsPayload {
  return {
    generatedAt: 0,
    pairs: FOREX_PAIR_ORDER.map(symbol => ({
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
}

export function ForexPage() {
  const [mode, setMode] = useState<RecoveryMode>("normal");
  const [now, setNow] = useState(() => Date.now());
  const [prices, setPrices] = useState<ForexLivePricesPayload | null>(null);
  const [signals, setSignals] = useState<ForexSignalsPayload>(buildEmptySignals());
  const [calendar, setCalendar] = useState<EconomicCalendarPayload | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [consecutivePriceFailures, setConsecutivePriceFailures] = useState(0);
  const [consecutiveSignalFailures, setConsecutiveSignalFailures] = useState(0);
  const [signalLoadedOnce, setSignalLoadedOnce] = useState(false);
  const [signalError, setSignalError] = useState<string | null>(null);
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
      // Keep the default shell mode.
    }
  });

  const fetchPrices = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/forex/live-prices", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as ForexLivePricesPayload;
      setPrices(payload);
      setConsecutivePriceFailures(0);
    } catch {
      setConsecutivePriceFailures(current => current + 1);
    }
  });

  const fetchSignals = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/forex/signals", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as ForexSignalsPayload;
      setSignals(payload);
      setSignalLoadedOnce(true);
      setConsecutiveSignalFailures(0);
      setSignalError(null);
    } catch (error) {
      setConsecutiveSignalFailures(current => current + 1);
      setSignalError(error instanceof Error ? error.message : "Signal feed unavailable");
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
      setCalendarError(error instanceof Error ? error.message : "Calendar unavailable");
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
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const intervalMs = !signalLoadedOnce || consecutiveSignalFailures > 0 ? 10_000 : 60_000;
    const interval = window.setInterval(() => {
      void fetchSignals();
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [consecutiveSignalFailures, signalLoadedOnce]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchCalendar();
    }, 30 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (consecutivePriceFailures >= 3) {
      console.log("[APEX PRICES] Forex page is serving cached/fallback data.");
    }
  }, [consecutivePriceFailures]);

  const livePriceMap = new Map((prices?.pairs ?? []).map(pair => [pair.symbol, pair]));
  const signalMap = new Map(signals.pairs.map(pair => [pair.symbol, pair]));
  const lastPriceGeneratedAt = prices?.generatedAt ?? null;
  const isLive = (lastPriceGeneratedAt ?? 0) > 0 && (now - (lastPriceGeneratedAt ?? 0)) < 15_000 && consecutivePriceFailures < 3;
  const signalUnavailable = !signalLoadedOnce && consecutiveSignalFailures > 0;
  const selectedPrice = selectedSymbol ? livePriceMap.get(selectedSymbol) ?? null : null;
  const selectedSignal = selectedSymbol ? signalMap.get(selectedSymbol) ?? null : null;

  return (
    <ApexShell
      title="Forex Markets"
      subtitle="Institutional-grade FX intelligence across the liquid majors, yen crosses, and metals proxy board."
      mode={mode}
    >
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-[var(--apex-font-body)] text-[22px] italic text-[var(--apex-text-primary)]">
                FOREX MARKETS
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
              10 pairs · Last update: {relativeAge(now, lastPriceGeneratedAt)}
            </p>
            {signalUnavailable ? (
              <p className="mt-2 text-[12px] text-[#FCA5A5]">
                Signal board reconnecting. {signalError ?? "Latest signal state is temporarily unavailable."}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[var(--apex-border-subtle)] px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-secondary)]">
              Oanda + Twelve Data + Yahoo fallback
            </span>
          </div>
        </div>
      </section>

      <SessionBar />
      <CalendarStrip events={calendar?.events ?? []} generatedAt={calendar?.generatedAt ?? null} now={now} error={calendarError} />
      <PairGrid
        prices={prices?.pairs ?? []}
        signals={signals.pairs}
        loading={prices == null}
        now={now}
        signalUnavailable={signalUnavailable}
        signalError={signalError}
        onSelectPair={setSelectedSymbol}
      />
      <ChartDrawer
        open={selectedSymbol != null}
        symbol={selectedSymbol}
        price={selectedPrice}
        signal={selectedSignal}
        onClose={() => setSelectedSymbol(null)}
      />
    </ApexShell>
  );
}
