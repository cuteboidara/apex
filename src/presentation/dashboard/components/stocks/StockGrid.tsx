"use client";

import { useMemo, useState } from "react";

type StockSector = "tech" | "finance" | "energy";

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
  marketStatus: "open" | "closed" | "pre" | "after";
  stale?: boolean;
  reason?: string | null;
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

type GridFilter = "all" | StockSector;

const FILTERS: Array<{ label: string; value: GridFilter }> = [
  { label: "All", value: "all" },
  { label: "Tech", value: "tech" },
  { label: "Finance", value: "finance" },
  { label: "Energy", value: "energy" },
];

function formatPrice(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function providerBadge(provider: string): string {
  if (provider.toLowerCase().includes("polygon")) return "POLY";
  if (provider.toLowerCase().includes("cache")) return "CACHE";
  return "YH";
}

function sectorTone(sector: StockSector): string {
  if (sector === "tech") return "border-sky-500/30";
  if (sector === "finance") return "border-emerald-500/30";
  return "border-orange-500/30";
}

function directionTone(direction: StockSignalRow["direction"]) {
  if (direction === "buy") return "text-[var(--apex-status-active-text)]";
  if (direction === "sell") return "text-[#F87171]";
  return "text-[var(--apex-text-secondary)]";
}

function gradeTone(grade: string | null): string {
  if (grade === "S+" || grade === "S" || grade === "A") return "text-[var(--apex-status-active-text)]";
  if (grade === "B" || grade === "C") return "text-[#FCD34D]";
  if (grade === "D" || grade === "F") return "text-[#F87171]";
  return "text-[var(--apex-text-secondary)]";
}

function signalAge(now: number, timestamp: number | null): string {
  if (!timestamp) return "Pending";
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 60) return `Updated ${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `Updated ${diffMinutes}m ago`;
  return `Updated ${Math.floor(diffMinutes / 60)}h ago`;
}

function rangePosition(price: number | null, low: number | null, high: number | null): number {
  if (price == null || low == null || high == null || high <= low) {
    return 0;
  }
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}

export function StockGrid({
  prices,
  signals,
  loading,
  now,
  onSelectStock,
}: {
  prices: StockPriceRow[];
  signals: StockSignalRow[];
  loading: boolean;
  now: number;
  onSelectStock: (symbol: string) => void;
}) {
  const [filter, setFilter] = useState<GridFilter>("all");
  const signalMap = useMemo(() => new Map(signals.map(signal => [signal.symbol, signal])), [signals]);
  const filteredPrices = filter === "all"
    ? prices
    : prices.filter(price => price.sector === filter);

  return (
    <section className="space-y-5">
      <div className="mb-6 border-b border-[var(--apex-border-subtle)] pb-4">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="m-0 font-[var(--apex-font-body)] text-[16px] font-semibold leading-none tracking-[-0.01em] text-[var(--apex-text-primary)]">
            Stock Grid
          </h2>
          <span className="text-[13px] font-normal text-[var(--apex-text-tertiary)]">{prices.length || 12}</span>
        </div>
        <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
          Live prices for the focused US board with latest APEX signal coverage.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] ${
              filter === item.value
                ? "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)] text-[var(--apex-text-primary)]"
                : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {loading && prices.length === 0
          ? Array.from({ length: 12 }).map((_, index) => (
              <div
                key={`stock-skeleton-${index}`}
                className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4"
              >
                <div className="h-4 w-32 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
                <div className="mt-4 h-12 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
                <div className="mt-4 h-24 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
              </div>
            ))
          : filteredPrices.length === 0
            ? (
                <div className="col-span-full rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-6 text-[13px] text-[var(--apex-text-secondary)]">
                  No stock rows are available for this sector yet.
                </div>
              )
            : filteredPrices.map(price => {
              const signal = signalMap.get(price.symbol) ?? {
                symbol: price.symbol,
                grade: null,
                status: "pending" as const,
                direction: null,
                confidence: null,
                entry: null,
                stopLoss: null,
                takeProfit: null,
                takeProfit2: null,
                takeProfit3: null,
                reasoning: null,
                generatedAt: null,
              };

              return (
                <button
                  key={price.symbol}
                  type="button"
                  onClick={() => onSelectStock(price.symbol)}
                  className={`rounded-[var(--apex-radius-lg)] border bg-[var(--apex-bg-raised)] px-4 py-4 text-left transition hover:border-[rgba(255,255,255,0.18)] ${sectorTone(price.sector)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-[var(--apex-font-mono)] text-[13px] font-medium text-[var(--apex-text-primary)]">
                          {price.label}
                        </p>
                        <span className="rounded-full border border-[var(--apex-border-subtle)] px-2 py-0.5 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                          {price.symbol}
                        </span>
                        <span className="rounded-full border border-[var(--apex-border-subtle)] px-2 py-0.5 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                          {providerBadge(price.provider)}
                        </span>
                        {price.stale ? <span className="h-2.5 w-2.5 rounded-full bg-[rgba(148,163,184,0.55)]" title="Cached" /> : null}
                      </div>
                      <p className="mt-2 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                        {price.sector} · {price.marketStatus}
                      </p>
                    </div>
                    {signal.grade ? (
                      <span className={`font-[var(--apex-font-mono)] text-[18px] font-semibold ${gradeTone(signal.grade)}`}>
                        {signal.grade}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <p className="font-[var(--apex-font-mono)] text-[24px] text-[var(--apex-text-primary)]">
                      {formatPrice(price.price)}
                    </p>
                    <p className="mt-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                      {price.direction === "up" ? "▲" : price.direction === "down" ? "▼" : "•"}{" "}
                      {price.change != null ? `${price.change >= 0 ? "+" : ""}${formatPrice(price.change)}` : "—"}
                      {" · "}
                      {price.changePct != null ? `${price.changePct >= 0 ? "+" : ""}${price.changePct.toFixed(2)}%` : "—"}
                    </p>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                      <span>{formatPrice(price.low)}</span>
                      <span>Day Range</span>
                      <span>{formatPrice(price.high)}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div
                        className="h-full rounded-full bg-[rgba(255,255,255,0.28)]"
                        style={{ width: `${rangePosition(price.price, price.low, price.high)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                    <div>
                      <p>Volume</p>
                      <p className="mt-1 text-[12px] text-[var(--apex-text-primary)]">{formatCompactNumber(price.volume)}</p>
                    </div>
                    <div>
                      <p>Market Cap</p>
                      <p className="mt-1 text-[12px] text-[var(--apex-text-primary)]">{formatCompactNumber(price.marketCap)}</p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
                    {signal.grade ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <span className={`font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${directionTone(signal.direction)}`}>
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
                          <p>Entry {formatPrice(signal.entry)}</p>
                          <p>SL {formatPrice(signal.stopLoss)}</p>
                          <p>TP {formatPrice(signal.takeProfit)}</p>
                        </div>
                        <p className="mt-3 text-[11px] text-[var(--apex-text-tertiary)]">
                          {signalAge(now, signal.generatedAt)}
                        </p>
                      </>
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
