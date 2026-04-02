"use client";

import { useEffect, useState } from "react";

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

type ForexSignalRow = {
  symbol: string;
  grade: string | null;
  status: "active" | "watchlist" | "blocked" | "pending" | "invalidated" | "expired";
  direction: "buy" | "sell" | "neutral" | null;
  confidence: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  generatedAt: number | null;
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

function formatPairLabel(symbol: string): string {
  if (symbol === "XAUUSD") return "XAUUSD";
  if (symbol === "XAGUSD") return "SILVER";
  return symbol;
}

function formatPrice(symbol: string, value: number | null): string {
  if (value == null) {
    return "—";
  }
  if (symbol === "XAUUSD") return value.toFixed(2);
  if (symbol === "XAGUSD") return value.toFixed(3);
  if (symbol.endsWith("JPY")) return value.toFixed(3);
  return value.toFixed(5);
}

function signalDirectionTone(direction: ForexSignalRow["direction"]) {
  if (direction === "buy") return "text-[var(--apex-status-active-text)]";
  if (direction === "sell") return "text-[#F87171]";
  return "text-[var(--apex-text-secondary)]";
}

function providerBadge(provider: ForexLivePriceRow["provider"]) {
  if (provider === "oanda") return "OANDA";
  if (provider === "twelvedata") return "12D";
  if (provider === "erapi") return "ER";
  if (provider === "cache") return "CACHE";
  return "YH";
}

function signalAge(now: number, timestamp: number | null): string {
  if (!timestamp) return "Pending";
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 60) return `Updated ${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;
  return `Updated ${Math.floor(diffMinutes / 60)}h ago`;
}

function AnimatedPrice({
  symbol,
  value,
  direction,
}: {
  symbol: string;
  value: number | null;
  direction: ForexLivePriceRow["direction"];
}) {
  const formatted = formatPrice(symbol, value);
  const cut = Math.max(0, formatted.length - 2);
  const leading = formatted.slice(0, cut);
  const trailing = formatted.slice(cut);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (value == null) {
      return;
    }
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 280);
    return () => window.clearTimeout(timer);
  }, [formatted, value]);

  return (
    <p className="font-[var(--apex-font-mono)] text-[24px] text-[var(--apex-text-primary)]">
      {leading}
      <span
        className={`inline-block transition-all duration-300 ${
          flash ? (direction === "up" ? "-translate-y-0.5 text-[var(--apex-status-active-text)]" : direction === "down" ? "translate-y-0.5 text-[#F87171]" : "scale-105 text-[var(--apex-text-primary)]") : ""
        }`}
      >
        {trailing}
      </span>
    </p>
  );
}

export function PairGrid({
  prices,
  signals,
  loading,
  now,
  signalUnavailable,
  signalError,
  onSelectPair,
}: {
  prices: ForexLivePriceRow[];
  signals: ForexSignalRow[];
  loading: boolean;
  now: number;
  signalUnavailable?: boolean;
  signalError?: string | null;
  onSelectPair: (symbol: string) => void;
}) {
  const priceMap = new Map(prices.map(price => [price.symbol, price]));
  const signalMap = new Map(signals.map(signal => [signal.symbol, signal]));

  return (
    <section className="space-y-5">
      <div className="mb-6 border-b border-[var(--apex-border-subtle)] pb-4">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="m-0 font-[var(--apex-font-body)] text-[16px] font-semibold leading-none tracking-[-0.01em] text-[var(--apex-text-primary)]">
            Pair Grid
          </h2>
          <span className="text-[13px] font-normal text-[var(--apex-text-tertiary)]">10</span>
        </div>
        <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
          Live quotes and the latest APEX signal state for the liquid FX board.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {FOREX_PAIR_ORDER.map(symbol => {
          const price = priceMap.get(symbol) ?? null;
          const signal = signalMap.get(symbol) ?? {
            symbol,
            grade: null,
            status: "pending" as const,
            direction: null,
            confidence: null,
            entry: null,
            stopLoss: null,
            takeProfit: null,
            generatedAt: null,
          };

          if (loading && !price) {
            return (
              <div
                key={symbol}
                className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4"
              >
                <div className="h-4 w-24 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
                <div className="mt-4 h-12 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
                <div className="mt-4 h-20 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
              </div>
            );
          }

          return (
            <button
              key={symbol}
              type="button"
              onClick={() => onSelectPair(symbol)}
              className="text-left rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 transition hover:border-[rgba(255,255,255,0.18)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-[var(--apex-font-mono)] text-[13px] font-medium text-[var(--apex-text-primary)]">
                      {formatPairLabel(symbol)}
                    </p>
                    {price ? (
                      <span className="rounded-full border border-[var(--apex-border-subtle)] px-2 py-0.5 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                        {providerBadge(price.provider)}
                      </span>
                    ) : null}
                    {price?.stale ? <span className="h-2.5 w-2.5 rounded-full bg-[rgba(148,163,184,0.55)]" title="Cached" /> : null}
                  </div>
                  <p className="mt-2 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                    Spread {price?.spread != null ? price.spread.toFixed(1) : "—"} pips
                  </p>
                </div>
                {signal.grade ? (
                  <span className="font-[var(--apex-font-mono)] text-[18px] font-semibold text-[var(--apex-text-primary)]">
                    {signal.grade}
                  </span>
                ) : null}
              </div>

              <div className="mt-4">
                <AnimatedPrice symbol={symbol} value={price?.mid ?? null} direction={price?.direction ?? "flat"} />
                <p className="mt-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                  Bid {formatPrice(symbol, price?.bid ?? null)} · Ask {formatPrice(symbol, price?.ask ?? null)}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <span className={price?.direction === "up" ? "text-[var(--apex-status-active-text)]" : price?.direction === "down" ? "text-[#F87171]" : "text-[var(--apex-text-secondary)]"}>
                  {price?.direction === "up" ? "▲" : price?.direction === "down" ? "▼" : "•"}
                </span>
                <span className={`font-[var(--apex-font-mono)] text-[12px] ${
                  price?.direction === "up"
                    ? "text-[var(--apex-status-active-text)]"
                    : price?.direction === "down"
                      ? "text-[#F87171]"
                      : "text-[var(--apex-text-secondary)]"
                }`}>
                  {price?.change != null ? `${price.change >= 0 ? "+" : ""}${formatPrice(symbol, price.change)}` : "—"}
                </span>
                <span className={`font-[var(--apex-font-mono)] text-[12px] ${
                  price?.direction === "up"
                    ? "text-[var(--apex-status-active-text)]"
                    : price?.direction === "down"
                      ? "text-[#F87171]"
                      : "text-[var(--apex-text-secondary)]"
                }`}>
                  {price?.changePct != null ? `${price.changePct >= 0 ? "+" : ""}${price.changePct.toFixed(2)}%` : ""}
                </span>
              </div>

              <div className="mt-5 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
                {signal.grade ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span className={`font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${signalDirectionTone(signal.direction)}`}>
                        {signal.direction === "buy" ? "LONG" : signal.direction === "sell" ? "SHORT" : "NEUTRAL"}
                      </span>
                      <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-primary)]">
                        {signal.confidence != null ? `${signal.confidence}%` : "—"}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div
                        className={`h-full rounded-full ${
                          signal.direction === "buy"
                            ? "bg-[var(--apex-status-active-text)]"
                            : signal.direction === "sell"
                              ? "bg-[#F87171]"
                              : "bg-[rgba(255,255,255,0.18)]"
                        }`}
                        style={{ width: `${Math.max(0, Math.min(100, signal.confidence ?? 0))}%` }}
                      />
                    </div>
                    <div className="mt-3 space-y-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                      <p>Entry {formatPrice(symbol, signal.entry)}</p>
                      <p>SL {formatPrice(symbol, signal.stopLoss)}</p>
                      <p>TP {formatPrice(symbol, signal.takeProfit)}</p>
                    </div>
                    <p className="mt-3 text-[11px] text-[var(--apex-text-tertiary)]">
                      {signalAge(now, signal.generatedAt)}
                    </p>
                  </>
                ) : signalUnavailable ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[12px] text-[#FCA5A5]">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#F87171]" />
                      <span>Signal feed reconnecting...</span>
                    </div>
                    <p className="text-[11px] leading-5 text-[var(--apex-text-tertiary)]">
                      {signalError ?? "Latest FX signal state is temporarily unavailable."}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[12px] text-[var(--apex-text-secondary)]">
                    <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[rgba(255,255,255,0.18)]" />
                    <span className="animate-pulse">Scanning...</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
