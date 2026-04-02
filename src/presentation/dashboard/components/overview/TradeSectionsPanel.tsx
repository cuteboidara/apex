"use client";

import { useEffect, useEffectEvent, useState } from "react";

type TradeType = "scalp" | "intraday" | "swing";

type TradeTypeCard = {
  id: string;
  symbol: string;
  assetClass: string;
  direction: "buy" | "sell" | "neutral";
  grade: string;
  confidence: number;
  apexScore: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  reasoning: string;
  generatedAt: number;
  setupType: string;
  timeframe: string | null;
  weeklyBias: string | null;
  expectedDuration: string | null;
};

type TradeTypePayload = {
  type: TradeType;
  generatedAt: number;
  nextScanInMinutes: number;
  signals: TradeTypeCard[];
  source?: "typed" | "latest_fallback";
};

const TABS: Array<{
  type: TradeType;
  label: string;
  tone: string;
  cardTone: string;
}> = [
  { type: "scalp", label: "⚡ SCALP", tone: "border-sky-400/30 bg-sky-500/10 text-sky-200", cardTone: "border-sky-500/30" },
  { type: "intraday", label: "INTRADAY", tone: "border-indigo-400/30 bg-indigo-500/10 text-indigo-200", cardTone: "border-indigo-500/30" },
  { type: "swing", label: "SWING", tone: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200", cardTone: "border-emerald-500/30" },
];

function formatPrice(value: number | null): string {
  return value == null ? "—" : value.toFixed(4);
}

function signalDirection(direction: TradeTypeCard["direction"]): string {
  if (direction === "buy") return "LONG";
  if (direction === "sell") return "SHORT";
  return "NEUTRAL";
}

function relativeAge(timestamp: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  return `${Math.floor(diffMinutes / 60)}h ago`;
}

export function TradeSectionsPanel() {
  const [activeType, setActiveType] = useState<TradeType>("scalp");
  const [payloads, setPayloads] = useState<Partial<Record<TradeType, TradeTypePayload>>>({});
  const [loadingExpired, setLoadingExpired] = useState(false);

  const fetchType = useEffectEvent(async (type: TradeType) => {
    try {
      const response = await fetch(`/api/signals/by-type?type=${type}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as TradeTypePayload;
      setPayloads(current => ({ ...current, [type]: payload }));
    } catch (err) {
      console.error("[TRADE SECTIONS] fetch error:", err);
    }
  });

  useEffect(() => {
    void Promise.all(TABS.map(tab => fetchType(tab.type)));
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setLoadingExpired(true);
    }, 5_000);

    return () => window.clearTimeout(timeout);
  }, []);

  const current = payloads[activeType];
  const fallbackPayload = TABS
    .map(tab => payloads[tab.type])
    .find(payload => payload?.signals.length);
  const activeMeta = TABS.find(tab => tab.type === activeType) ?? TABS[0];
  const displaySignals = current?.signals.length
    ? current.signals
    : fallbackPayload?.signals ?? [];
  const showFallbackMessage = current?.source === "latest_fallback"
    || (!!current && current.signals.length === 0 && displaySignals.length > 0)
    || (!current && loadingExpired && displaySignals.length > 0);
  const nextScan = current?.nextScanInMinutes ?? fallbackPayload?.nextScanInMinutes ?? 15;

  return (
    <section className="apex-surface px-6 py-5">
      <div className="mb-5 flex flex-col gap-3 border-b border-[var(--apex-border-subtle)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Trade Sections
          </p>
          <h2 className="mt-2 text-[16px] font-semibold text-[var(--apex-text-primary)]">Scalp, intraday, and swing board</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map(tab => (
            <button
              key={tab.type}
              type="button"
              onClick={() => setActiveType(tab.type)}
              className={`rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] ${
                activeType === tab.type
                  ? tab.tone
                  : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {!current && !loadingExpired ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`trade-type-skeleton-${index}`}
              className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4"
            >
              <div className="h-4 w-24 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
              <div className="mt-4 h-12 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
              <div className="mt-4 h-20 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
            </div>
          ))}
        </div>
      ) : displaySignals.length === 0 ? (
        <div className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-6 text-[13px] text-[var(--apex-text-secondary)]">
          No {activeType} setups active. Showing latest signals when available. Next scan in {nextScan}m.
        </div>
      ) : (
        <div className="space-y-3">
          {showFallbackMessage ? (
            <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[12px] text-[var(--apex-text-secondary)]">
              No {activeType} setups active. Showing latest signals.
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {displaySignals.map(card => (
            <article
              key={card.id}
              className={`rounded-[var(--apex-radius-lg)] border bg-[var(--apex-bg-raised)] px-4 py-4 ${activeMeta.cardTone}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--apex-border-subtle)] px-2 py-0.5 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                    {card.assetClass}
                  </span>
                  <span className={`font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] ${
                    card.direction === "buy"
                      ? "text-[var(--apex-status-active-text)]"
                      : card.direction === "sell"
                        ? "text-[#F87171]"
                        : "text-[var(--apex-text-secondary)]"
                  }`}>
                    {signalDirection(card.direction)}
                  </span>
                </div>
                <span className="font-[var(--apex-font-mono)] text-[18px] text-[var(--apex-text-primary)]">{card.grade}</span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="font-[var(--apex-font-mono)] text-[15px] text-[var(--apex-text-primary)]">{card.symbol}</p>
                <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{card.apexScore}</span>
              </div>

              <div className="mt-4 space-y-1 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                <p>Entry: {formatPrice(card.entry)} | SL: {formatPrice(card.stopLoss)} | TP: {formatPrice(card.takeProfit)}</p>
                <p>R:R {card.riskReward != null ? `1:${card.riskReward.toFixed(1)}` : "—"} | Confidence: {card.confidence}% | {relativeAge(card.generatedAt)}</p>
                {activeType === "swing" ? (
                  <p>Expected duration: {card.expectedDuration ?? "—"} | Weekly bias: {card.weeklyBias ?? "neutral"}</p>
                ) : null}
              </div>

              <p className="mt-4 text-[13px] italic text-[var(--apex-text-secondary)]">
                <span aria-hidden="true">&ldquo;</span>
                {card.reasoning}
                <span aria-hidden="true">&rdquo;</span>
              </p>
            </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
