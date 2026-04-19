"use client";

import { useEffect, useState } from "react";

import type { CryptoNewsItem, CryptoSelectedAsset } from "@/src/crypto/types";

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

function buildTradingViewUrl(symbol: string | null, assets: CryptoSelectedAsset[]): string {
  const asset = symbol ? assets.find(item => item.symbol === symbol) ?? null : null;
  const params = new URLSearchParams({
    symbol: asset?.tv ?? "BINANCE:BTCUSDT",
    interval: "60",
    theme: "dark",
    style: "1",
    timezone: "Etc/UTC",
    studies: "[]",
    withdateranges: "1",
    hideideas: "1",
    symboledit: "0",
    saveimage: "0",
    toolbarbg: "#0b0b0d",
  });
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

export function CryptoChartDrawer({
  open,
  symbol,
  assets,
  price,
  signal,
  onClose,
}: {
  open: boolean;
  symbol: string | null;
  assets: CryptoSelectedAsset[];
  price: CryptoPriceRow | null;
  signal: CryptoSignalRow | null;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }

    document.body.style.overflow = "";
    const timer = window.setTimeout(() => {
      setMounted(false);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open && !mounted) {
    return null;
  }

  return (
    <div className={`fixed inset-0 z-50 ${open ? "pointer-events-auto" : "pointer-events-none"}`}>
      <button
        type="button"
        aria-label="Close crypto chart drawer"
        onClick={onClose}
        className={`absolute inset-0 bg-[rgba(0,0,0,0.6)] transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />

      <section
        className={`absolute inset-x-0 bottom-0 mx-auto h-[80vh] max-w-[1600px] rounded-t-[24px] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-base)] transition-transform duration-300 ${open ? "translate-y-0" : "translate-y-full"}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--apex-border-subtle)] px-6 py-4">
          <div>
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
              {price?.label ?? symbol ?? "Crypto"}
            </p>
            <p className="mt-2 font-[var(--apex-font-mono)] text-[24px] text-[var(--apex-text-primary)]">
              ${formatPrice(price?.price ?? null)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--apex-border-subtle)] text-[var(--apex-text-primary)]"
          >
            ×
          </button>
        </div>

        <div className="grid h-[calc(80vh-82px)] gap-4 overflow-hidden p-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
          <div className="overflow-hidden rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[#0b0b0d]">
            {symbol ? (
              <iframe
                key={symbol}
                title={`${symbol} chart`}
                src={buildTradingViewUrl(symbol, assets)}
                className="h-full w-full"
              />
            ) : null}
          </div>

          <aside className="overflow-y-auto rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-[var(--apex-font-body)] text-[18px] italic text-[var(--apex-text-primary)]">
                APEX Signal Detail
              </h3>
              {signal?.grade ? (
                <span className="font-[var(--apex-font-mono)] text-[18px] text-[var(--apex-text-primary)]">{signal.grade}</span>
              ) : null}
            </div>

            {signal?.grade ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${
                    signal.direction === "buy"
                      ? "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]"
                      : signal.direction === "sell"
                        ? "border-[rgba(239,68,68,0.30)] bg-[rgba(239,68,68,0.10)] text-[#F87171]"
                        : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
                  }`}>
                    {signal.direction === "buy" ? "LONG" : signal.direction === "sell" ? "SHORT" : "NEUTRAL"}
                  </span>
                  <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">
                    Confidence {signal.confidence ?? 0}%
                  </span>
                </div>

                <div className="space-y-3 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-4 py-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                  <p>Entry Zone {formatPrice(signal.entry)}</p>
                  <p>Stop Loss {formatPrice(signal.stopLoss)}</p>
                  <p>Take Profit 1 {formatPrice(signal.takeProfit)}</p>
                  <p>Take Profit 2 {formatPrice(signal.takeProfit2)}</p>
                  <p>Take Profit 3 {formatPrice(signal.takeProfit3)}</p>
                </div>

                <div>
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
                    Reasoning
                  </p>
                  <p className="mt-3 text-[14px] leading-6 text-[var(--apex-text-secondary)]">
                    {signal.reasoning ?? "No reasoning available yet."}
                  </p>
                </div>

                {signal.news.length > 0 ? (
                  <div>
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
                      Coin News
                    </p>
                    <div className="mt-3 space-y-3">
                      {signal.news.slice(0, 5).map(item => (
                        <a
                          key={`${item.url}-${item.publishedAt}`}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                              {item.source}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                              item.sentiment === "bullish"
                                ? "bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]"
                                : item.sentiment === "bearish"
                                  ? "bg-[rgba(239,68,68,0.10)] text-[#F87171]"
                                  : "bg-[rgba(255,255,255,0.06)] text-[var(--apex-text-secondary)]"
                            }`}>
                              {item.sentiment}
                            </span>
                          </div>
                          <p className="mt-2 text-[13px] leading-6 text-[var(--apex-text-primary)]">{item.headline}</p>
                          <p className="mt-2 text-[11px] text-[var(--apex-text-tertiary)]">{new Date(item.publishedAt).toLocaleString()}</p>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                <p className="text-[12px] text-[var(--apex-text-tertiary)]">
                  Generated at {signal.generatedAt ? new Date(signal.generatedAt).toLocaleString() : "—"}
                </p>
              </div>
            ) : (
              <div className="mt-5 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-4 py-4">
                <p className="text-[13px] text-[var(--apex-text-secondary)]">
                  No active APEX signal is available for this asset yet.
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
