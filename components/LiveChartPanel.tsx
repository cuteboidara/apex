"use client";

import { useCallback, useEffect, useState } from "react";
import { TradingViewChartSurface } from "@/components/TradingViewChartSurface";
import { LightweightChart } from "@/components/LightweightChart";
import { SUPPORTED_ASSETS, type TradePlanStyle } from "@/lib/assets";
import type { Timeframe } from "@/lib/marketData/types";

type ChartCandle = {
  timestamp: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

type ChartPlan = {
  id: string;
  symbol: string;
  style: TradePlanStyle;
  setupFamily: string | null;
  bias: string;
  status: "ACTIVE" | "NO_SETUP" | "STALE";
  publicationRank: "S" | "A" | "B" | "Silent" | null;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  invalidationLevel: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  providerAtSignal: string | null;
  providerFallbackUsedAtSignal: boolean;
  detectedAt: string | null;
  entryHitAt: string | null;
  stopHitAt: string | null;
  tp1HitAt: string | null;
  tp2HitAt: string | null;
  tp3HitAt: string | null;
  invalidatedAt: string | null;
  expiredAt: string | null;
  realizedRR: number | null;
  outcome: "PENDING_ENTRY" | "OPEN" | "TP1" | "TP2" | "TP3" | "STOP" | "STOP_AFTER_TP1" | "STOP_AFTER_TP2" | "INVALIDATED" | "EXPIRED" | null;
};

type ChartResponse = {
  symbol: string;
  assetClass: string;
  timeframe: Timeframe;
  candles: ChartCandle[];
  selectedProvider: string | null;
  provider: string;
  fallbackUsed: boolean;
  freshnessMs: number | null;
  marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  stale: boolean;
  reason: string | null;
  circuitState: string | null;
  fromCache: boolean;
  requestedLimit: number;
  range: {
    from: number | null;
    to: number | null;
  };
};

type Props = {
  latestTradePlans: Record<string, Record<string, ChartPlan>>;
};

const TIMEFRAME_OPTIONS: Array<{ timeframe: Timeframe; resolution: "1" | "5" | "15" | "60" | "240" | "D" }> = [
  { timeframe: "1m", resolution: "1" },
  { timeframe: "5m", resolution: "5" },
  { timeframe: "15m", resolution: "15" },
  { timeframe: "1h", resolution: "60" },
  { timeframe: "4h", resolution: "240" },
  { timeframe: "1D", resolution: "D" },
];
type LifecycleEvent = {
  key: string;
  label: string;
  shortLabel: string;
  timestamp: number;
  level: number | null;
  color: string;
};

function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return value.toFixed(2);
  if (value >= 100) return value.toFixed(3);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatFreshness(value: number | null) {
  if (value == null) return "—";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${Math.round(value / 1000)}s`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m`;
  return `${Math.round(value / 3_600_000)}h`;
}

function formatEventTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseEventTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRealizedRr(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function preferredStyleForTimeframe(timeframe: Timeframe): TradePlanStyle {
  if (timeframe === "1m" || timeframe === "5m") return "SCALP";
  if (timeframe === "15m" || timeframe === "1h") return "INTRADAY";
  return "SWING";
}

function entryMidpoint(plan: Pick<ChartPlan, "entryMin" | "entryMax">) {
  if (plan.entryMin == null && plan.entryMax == null) return null;
  if (plan.entryMin == null) return plan.entryMax;
  if (plan.entryMax == null) return plan.entryMin;
  return (plan.entryMin + plan.entryMax) / 2;
}

function stopLevel(plan: Pick<ChartPlan, "stopLoss" | "invalidationLevel">) {
  return plan.stopLoss ?? plan.invalidationLevel ?? null;
}

function hasActionableLevels(plan: ChartPlan | null | undefined) {
  if (!plan || plan.status === "NO_SETUP") return false;
  return [plan.entryMin, plan.entryMax, plan.stopLoss, plan.takeProfit1, plan.takeProfit2, plan.takeProfit3].some(level => level != null && Number.isFinite(level));
}

function pickOverlayPlan(plans: ChartPlan[], timeframe: Timeframe): ChartPlan | null {
  const preferredStyle = preferredStyleForTimeframe(timeframe);
  return plans.find(plan => plan.style === preferredStyle && hasActionableLevels(plan))
    ?? plans.find(plan => plan.status === "ACTIVE" && hasActionableLevels(plan))
    ?? plans.find(plan => hasActionableLevels(plan))
    ?? null;
}

function buildLifecycleEvents(plan: ChartPlan | null): LifecycleEvent[] {
  if (!plan) return [];

  const entry = entryMidpoint(plan);
  const invalidation = plan.invalidationLevel ?? stopLevel(plan);
  const candidates: Array<Omit<LifecycleEvent, "timestamp"> & { timestamp: number | null }> = [
    {
      key: "detected",
      label: "Detected",
      shortLabel: "D",
      timestamp: parseEventTimestamp(plan.detectedAt),
      level: entry,
      color: "rgb(82 82 91)",
    },
    {
      key: "entry",
      label: "Entry Hit",
      shortLabel: "E",
      timestamp: parseEventTimestamp(plan.entryHitAt),
      level: entry,
      color: plan.bias === "LONG" ? "rgb(74 222 128)" : "rgb(228 228 231)",
    },
    {
      key: "tp1",
      label: "TP1 Hit",
      shortLabel: "1",
      timestamp: parseEventTimestamp(plan.tp1HitAt),
      level: plan.takeProfit1,
      color: "rgb(34 197 94)",
    },
    {
      key: "tp2",
      label: "TP2 Hit",
      shortLabel: "2",
      timestamp: parseEventTimestamp(plan.tp2HitAt),
      level: plan.takeProfit2,
      color: "rgb(22 163 74)",
    },
    {
      key: "tp3",
      label: "TP3 Hit",
      shortLabel: "3",
      timestamp: parseEventTimestamp(plan.tp3HitAt),
      level: plan.takeProfit3,
      color: "rgb(21 128 61)",
    },
    {
      key: "stop",
      label: "Stop Hit",
      shortLabel: "S",
      timestamp: parseEventTimestamp(plan.stopHitAt),
      level: stopLevel(plan),
      color: "rgb(251 191 36)",
    },
    {
      key: "invalidated",
      label: "Invalidated",
      shortLabel: "I",
      timestamp: parseEventTimestamp(plan.invalidatedAt),
      level: invalidation,
      color: "rgb(244 114 182)",
    },
    {
      key: "expired",
      label: "Expired",
      shortLabel: "X",
      timestamp: parseEventTimestamp(plan.expiredAt),
      level: null,
      color: "rgb(113 113 122)",
    },
  ];

  return candidates
    .filter((event): event is LifecycleEvent => event.timestamp != null)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function outcomeBadge(plan: ChartPlan | null) {
  if (!plan) {
    return {
      label: "NO PLAN",
      tone: "text-zinc-500 border-zinc-900 bg-zinc-950/80",
    };
  }

  if (plan.invalidatedAt || plan.outcome === "INVALIDATED") {
    return {
      label: "INVALIDATED",
      tone: "text-pink-300 border-pink-500/30 bg-pink-500/10",
    };
  }

  if (plan.stopHitAt || plan.outcome === "STOP" || plan.outcome === "STOP_AFTER_TP1" || plan.outcome === "STOP_AFTER_TP2") {
    return {
      label: "STOP HIT",
      tone: "text-amber-300 border-amber-500/30 bg-amber-500/10",
    };
  }

  if (plan.tp3HitAt || plan.outcome === "TP3") {
    return {
      label: "TP3 HIT",
      tone: "text-green-200 border-green-500/40 bg-green-500/12",
    };
  }

  if (plan.tp2HitAt || plan.outcome === "TP2") {
    return {
      label: "TP2 HIT",
      tone: "text-green-300 border-green-500/30 bg-green-500/10",
    };
  }

  if (plan.tp1HitAt || plan.outcome === "TP1") {
    return {
      label: "TP1 HIT",
      tone: "text-green-300 border-green-500/30 bg-green-500/10",
    };
  }

  if (plan.expiredAt || plan.outcome === "EXPIRED") {
    return {
      label: "EXPIRED",
      tone: "text-zinc-400 border-zinc-800 bg-zinc-950",
    };
  }

  if (plan.entryHitAt || plan.outcome === "OPEN") {
    return {
      label: "ENTRY HIT",
      tone: plan.bias === "LONG"
        ? "text-green-300 border-green-500/30 bg-green-500/10"
        : "text-zinc-200 border-zinc-700 bg-zinc-950",
    };
  }

  return {
    label: "PENDING",
    tone: "text-zinc-400 border-zinc-800 bg-zinc-950",
  };
}

export function LiveChartPanel({ latestTradePlans }: Props) {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [response, setResponse] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCandles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=80`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null) as ChartResponse | { error?: string } | null;
      if (!res.ok) {
        throw new Error((data as { error?: string } | null)?.error ?? "Chart data unavailable");
      }
      setResponse(data as ChartResponse);
      setError(null);
    } catch (fetchError) {
      setResponse(null);
      setError(fetchError instanceof Error ? fetchError.message : "Chart data unavailable");
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    fetchCandles().catch(() => null);
    const timer = window.setInterval(() => {
      fetchCandles().catch(() => null);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [fetchCandles]);

  const plansForSymbol = Object.values(latestTradePlans[symbol] ?? {}) as ChartPlan[];
  const overlayPlan = pickOverlayPlan(plansForSymbol, timeframe);
  const lifecycleEvents = buildLifecycleEvents(overlayPlan);
  const usableCandles = (response?.candles ?? []).filter((candle): candle is Required<Pick<ChartCandle, "timestamp">> & {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
  } => (
    Number.isFinite(candle.timestamp) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  ));

  const statusTone = response?.marketStatus === "LIVE"
    ? "text-green-300 border-green-500/30 bg-green-500/10"
    : response?.marketStatus === "DEGRADED"
      ? "text-zinc-200 border-zinc-700 bg-zinc-950"
      : "text-zinc-500 border-zinc-900 bg-zinc-950/80";

  const overlayTone = overlayPlan?.bias === "LONG"
    ? "text-green-300 border-green-500/30 bg-green-500/10"
    : "text-zinc-200 border-zinc-700 bg-zinc-950";
  const outcome = outcomeBadge(overlayPlan);
  const widgetOverlay = overlayPlan ? {
    style: overlayPlan.style,
    bias: overlayPlan.bias,
    setupFamily: overlayPlan.setupFamily,
    levels: [
      overlayPlan.entryMin != null ? { key: "entry-min", label: overlayPlan.entryMax != null && overlayPlan.entryMax !== overlayPlan.entryMin ? "Entry Low" : "Entry", price: overlayPlan.entryMin, color: overlayPlan.bias === "LONG" ? "#4ade80" : "#d4d4d8", dashed: true } : null,
      overlayPlan.entryMax != null && overlayPlan.entryMax !== overlayPlan.entryMin ? { key: "entry-max", label: "Entry High", price: overlayPlan.entryMax, color: overlayPlan.bias === "LONG" ? "#4ade80" : "#d4d4d8", dashed: true } : null,
      overlayPlan.stopLoss != null ? { key: "stop", label: "Stop", price: overlayPlan.stopLoss, color: "#fbbf24" } : null,
      overlayPlan.takeProfit1 != null ? { key: "tp1", label: "TP1", price: overlayPlan.takeProfit1, color: "#22c55e" } : null,
      overlayPlan.takeProfit2 != null ? { key: "tp2", label: "TP2", price: overlayPlan.takeProfit2, color: "#16a34a" } : null,
      overlayPlan.takeProfit3 != null ? { key: "tp3", label: "TP3", price: overlayPlan.takeProfit3, color: "#15803d" } : null,
    ].filter((level): level is NonNullable<typeof level> => level != null),
  } : null;

  return (
    <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4 mb-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">TradingView Chart</h2>
          <p className="text-[9px] text-zinc-700 mt-1">The widget reads our internal datafeed adapter, so chart candles stay aligned with the strategy engine.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-col gap-1">
            <span className="text-[8px] uppercase tracking-[0.2em] text-zinc-700">Symbol</span>
            <select
              value={symbol}
              onChange={event => setSymbol(event.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] font-bold text-zinc-200 outline-none"
            >
              {SUPPORTED_ASSETS.map(asset => (
                <option key={asset.symbol} value={asset.symbol}>
                  {asset.symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[8px] uppercase tracking-[0.2em] text-zinc-700">Resolution</span>
            <select
              value={timeframe}
              onChange={event => setTimeframe(event.target.value as Timeframe)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] font-bold text-zinc-200 outline-none"
            >
              {TIMEFRAME_OPTIONS.map(option => (
                <option key={option.timeframe} value={option.timeframe}>
                  {option.resolution}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-3">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${statusTone}`}>
              {response?.marketStatus ?? (loading ? "LOADING" : "UNAVAILABLE")}
            </span>
            <span className="text-[8px] font-bold px-2 py-1 rounded-full border border-zinc-800 text-zinc-400">
              {response?.selectedProvider ?? "No provider"}
            </span>
            <span className="text-[8px] font-bold px-2 py-1 rounded-full border border-zinc-900 text-zinc-500">
              {response?.fallbackUsed ? "fallback used" : "primary path"}
            </span>
            <span className="text-[8px] font-bold px-2 py-1 rounded-full border border-zinc-900 text-zinc-500">
              freshness {formatFreshness(response?.freshnessMs ?? null)}
            </span>
            {response?.fromCache && (
              <span className="text-[8px] font-bold px-2 py-1 rounded-full border border-zinc-800 text-zinc-300">
                cached
              </span>
            )}
            <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${outcome.tone}`}>
              {outcome.label}
            </span>
          </div>

          {response && (response.marketStatus !== "LIVE" || response.stale) && (
            <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-400">Chart State</p>
              <p className="text-[10px] text-zinc-300 mt-1">
                {response.reason ?? "Candle data is degraded or stale."}
                {response.circuitState ? ` Circuit ${response.circuitState.toLowerCase()}.` : ""}
              </p>
            </div>
          )}

          {!loading && usableCandles.length === 0 && (
            <div className="min-h-[300px] md:min-h-[420px] rounded-xl border border-zinc-900 bg-[#0b0b0b] flex items-center justify-center text-center px-6">
              <div>
                <p className="text-sm font-bold text-zinc-200">Candle data unavailable</p>
                <p className="text-[10px] text-zinc-500 mt-2">
                  {error ?? response?.reason ?? "The market-data layer did not return usable candles for this symbol and timeframe."}
                </p>
              </div>
            </div>
          )}

          {(loading || usableCandles.length > 0) && (
            <TradingViewChartSurface
              symbol={symbol}
              timeframe={timeframe}
              loading={loading && !response}
              hasUsableCandles={usableCandles.length > 0}
              overlay={widgetOverlay}
              fallback={usableCandles.length > 0 ? (
                <LightweightChart
                  candles={usableCandles}
                  overlayLevels={widgetOverlay?.levels}
                />
              ) : null}
            />
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Overlay Plan</p>
                <p className="text-sm font-black text-zinc-100 mt-1">{overlayPlan ? `${overlayPlan.style} ${overlayPlan.bias}` : "No actionable plan"}</p>
              </div>
              <div className="flex items-center gap-2">
                {overlayPlan && (
                  <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${overlayTone}`}>
                    {overlayPlan.publicationRank ?? overlayPlan.status}
                  </span>
                )}
                <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${outcome.tone}`}>
                  {outcome.label}
                </span>
              </div>
            </div>

            {!overlayPlan ? (
              <p className="text-[10px] text-zinc-500 mt-3">
                No active or stale trade plan with usable levels was found for this symbol.
              </p>
            ) : (
              <div className="space-y-2 mt-3">
                <p className="text-[10px] text-zinc-400">
                  {overlayPlan.setupFamily ?? "Setup family unavailable"} · {overlayPlan.status.toLowerCase()}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-zinc-900 bg-[#0b0b0b] px-3 py-2">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Entry</p>
                    <p className="text-[10px] font-bold text-zinc-200 mt-1">
                      {formatPrice(overlayPlan.entryMin)}{overlayPlan.entryMax != null && overlayPlan.entryMax !== overlayPlan.entryMin ? ` - ${formatPrice(overlayPlan.entryMax)}` : ""}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-[#0b0b0b] px-3 py-2">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Stop</p>
                    <p className="text-[10px] font-bold text-zinc-200 mt-1">{formatPrice(overlayPlan.stopLoss)}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-[#0b0b0b] px-3 py-2">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">TP1</p>
                    <p className="text-[10px] font-bold text-zinc-200 mt-1">{formatPrice(overlayPlan.takeProfit1)}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-[#0b0b0b] px-3 py-2">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">TP2</p>
                    <p className="text-[10px] font-bold text-zinc-200 mt-1">{formatPrice(overlayPlan.takeProfit2)}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-[#0b0b0b] px-3 py-2 col-span-2">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">TP3</p>
                    <p className="text-[10px] font-bold text-zinc-200 mt-1">{formatPrice(overlayPlan.takeProfit3)}</p>
                  </div>
                </div>
                <p className="text-[9px] text-zinc-500">
                  Provider at signal: {overlayPlan.providerAtSignal ?? "unknown"}
                  {overlayPlan.providerFallbackUsedAtSignal ? " · fallback path" : ""}
                </p>
                <p className="text-[9px] text-zinc-500">
                  Realized RR: {formatRealizedRr(overlayPlan.realizedRR)}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-4">
            <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Lifecycle</p>
            {!overlayPlan ? (
              <p className="text-[10px] text-zinc-500 mt-3">No trade plan selected, so there is no lifecycle to display.</p>
            ) : lifecycleEvents.length === 0 ? (
              <div className="mt-3">
                <p className="text-[10px] text-zinc-300">No lifecycle hits recorded yet.</p>
                <p className="text-[9px] text-zinc-500 mt-1">
                  The chart will only mark entry, targets, stop, invalidation, or expiry after diagnostics observe them.
                </p>
              </div>
            ) : (
              <div className="space-y-2 mt-3">
                {lifecycleEvents.map(event => (
                  <div key={event.key} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900 bg-[#0b0b0b] px-3 py-2">
                    <div>
                      <p className="text-[10px] font-bold text-zinc-200">{event.label}</p>
                      <p className="text-[9px] text-zinc-600 mt-1">{formatEventTime(new Date(event.timestamp).toISOString())}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold" style={{ color: event.color }}>{event.shortLabel}</p>
                      <p className="text-[9px] text-zinc-600 mt-1">{event.level != null ? formatPrice(event.level) : "time only"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-4">
            <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Candle Source</p>
            <div className="space-y-2 mt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-zinc-600">Provider</span>
                <span className="text-[10px] font-bold text-zinc-200">{response?.selectedProvider ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-zinc-600">Fallback</span>
                <span className="text-[10px] font-bold text-zinc-200">{response?.fallbackUsed ? "Yes" : "No"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-zinc-600">Freshness</span>
                <span className="text-[10px] font-bold text-zinc-200">{formatFreshness(response?.freshnessMs ?? null)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-zinc-600">Candles</span>
                <span className="text-[10px] font-bold text-zinc-200">{usableCandles.length}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-zinc-600">State</span>
                <span className="text-[10px] font-bold text-zinc-200">{response?.marketStatus ?? "UNAVAILABLE"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
