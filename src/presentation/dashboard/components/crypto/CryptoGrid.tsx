"use client";

import { useEffect, useMemo, useState } from "react";

import type { CryptoNewsItem } from "@/src/crypto/types";

type CryptoPriceRow = {
  symbol: string;
  label: string;
  short: string;
  price: number | null;
  change24h: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  marketCap?: number | null;
  direction: "up" | "down" | "flat";
  provider: string;
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type CryptoSignalRow = {
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
  news: CryptoNewsItem[];
};

function formatPrice(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function directionTone(direction: CryptoSignalRow["direction"]) {
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

function logoTone(symbol: string): string {
  if (symbol.startsWith("BTC")) return "bg-[#F59E0B]";
  if (symbol.startsWith("ETH")) return "bg-[#64748B]";
  if (symbol.startsWith("SOL")) return "bg-[#8B5CF6]";
  if (symbol.startsWith("BNB")) return "bg-[#EAB308]";
  if (symbol.startsWith("XRP")) return "bg-[#38BDF8]";
  if (symbol.startsWith("DOGE")) return "bg-[#D4A017]";
  if (symbol.startsWith("ADA")) return "bg-[#2563EB]";
  return "bg-[#DC2626]";
}

function AnimatedPrice({
  value,
  direction,
}: {
  value: number | null;
  direction: "up" | "down" | "flat";
}) {
  const formatted = formatPrice(value);
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

export function CryptoGrid({
  prices,
  signals,
  loading,
  now,
  onSelectAsset,
}: {
  prices: CryptoPriceRow[];
  signals: CryptoSignalRow[];
  loading: boolean;
  now: number;
  onSelectAsset: (symbol: string) => void;
}) {
  const signalMap = useMemo(() => new Map(signals.map(signal => [signal.symbol, signal])), [signals]);

  return (
    <section className="space-y-5">
      <div className="mb-6 border-b border-[var(--apex-border-subtle)] pb-4">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="m-0 font-[var(--apex-font-body)] text-[16px] font-semibold leading-none tracking-[-0.01em] text-[var(--apex-text-primary)]">
            Crypto Grid
          </h2>
          <span className="text-[13px] font-normal text-[var(--apex-text-tertiary)]">{prices.length || 8}</span>
        </div>
        <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
          Live price board with websocket-first updates and APEX signal state.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
        {loading && prices.length === 0
          ? Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`crypto-skeleton-${index}`}
                className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4"
              >
                <div className="h-4 w-24 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
                <div className="mt-4 h-12 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
                <div className="mt-4 h-20 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
              </div>
            ))
          : prices.map(price => {
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
                news: [],
              };

              return (
                <button
                  key={price.symbol}
                  type="button"
                  onClick={() => onSelectAsset(price.symbol)}
                  className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 text-left transition hover:border-[rgba(255,255,255,0.18)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full font-[var(--apex-font-mono)] text-[12px] text-white ${logoTone(price.symbol)}`}>
                        {price.short}
                      </span>
                      <div>
                        <p className="font-[var(--apex-font-mono)] text-[13px] font-medium text-[var(--apex-text-primary)]">
                          {price.label}
                        </p>
                        <p className="mt-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                          {price.short}
                        </p>
                      </div>
                    </div>
                    {signal.grade ? (
                      <span className={`font-[var(--apex-font-mono)] text-[18px] font-semibold ${gradeTone(signal.grade)}`}>
                        {signal.grade}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <AnimatedPrice value={price.price} direction={price.direction} />
                    <p className={`mt-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${
                      price.direction === "up"
                        ? "text-[var(--apex-status-active-text)]"
                        : price.direction === "down"
                          ? "text-[#F87171]"
                          : "text-[var(--apex-text-secondary)]"
                    }`}>
                      {price.direction === "up" ? "▲" : price.direction === "down" ? "▼" : "•"}{" "}
                      {price.change24h != null ? `${price.change24h >= 0 ? "+" : ""}${formatPrice(price.change24h)}` : "—"}
                      {" · "}
                      {price.changePct24h != null ? `${price.changePct24h >= 0 ? "+" : ""}${price.changePct24h.toFixed(2)}%` : "—"}
                    </p>
                    {price.stale ? <span className="mt-2 inline-block h-2.5 w-2.5 rounded-full bg-[rgba(148,163,184,0.55)]" title="Cached" /> : null}
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                      <span>{formatPrice(price.low24h)}</span>
                      <span>24h Range</span>
                      <span>{formatPrice(price.high24h)}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div
                        className="h-full rounded-full bg-[rgba(255,255,255,0.28)]"
                        style={{ width: `${rangePosition(price.price, price.low24h, price.high24h)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                    <div>
                      <p>24h Volume</p>
                      <p className="mt-1 text-[12px] text-[var(--apex-text-primary)]">{formatCompactCurrency(price.volume24h)}</p>
                    </div>
                    <div>
                      <p>Market Cap</p>
                      <p className="mt-1 text-[12px] text-[var(--apex-text-primary)]">{formatCompactCurrency(price.marketCap)}</p>
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
                        {signal.news.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {signal.news.slice(0, 2).map(item => (
                              <div key={`${price.symbol}-${item.url}-${item.publishedAt}`} className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] px-2 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                                    {item.source}
                                  </span>
                                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] ${
                                    item.sentiment === "bullish"
                                      ? "bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]"
                                      : item.sentiment === "bearish"
                                        ? "bg-[rgba(239,68,68,0.10)] text-[#F87171]"
                                        : "bg-[rgba(255,255,255,0.06)] text-[var(--apex-text-secondary)]"
                                  }`}>
                                    {item.sentiment}
                                  </span>
                                </div>
                                <p className="mt-2 text-[11px] leading-5 text-[var(--apex-text-secondary)]">{item.headline}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
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
