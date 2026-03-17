"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawData {
  price: {
    current:  number | null;
    change24h: number | null;
    volume:   number | null;
    high14d:  number | null;
    low14d:   number | null;
  };
  technicals: {
    rsi:        number | null;
    macdSignal: string | null;
    trend:      string | null;
  };
  macro: {
    fedFundsRate: string | null;
    cpi:          string | null;
    treasury10y:  string | null;
    fedTrend:     string | null;
    cpiTrend:     string | null;
  } | null;
  news: Array<{ title: string; source: string; publishedAt: string; sentiment: string }>;
  sentiment: { value: string; label: string } | null;
}

interface Signal {
  id:          string;
  asset:       string;
  assetClass:  string;
  direction:   string;
  rank:        string;
  total:       number;
  macro:       number;
  structure:   number;
  zones:       number;
  technical:   number;
  timing:      number;
  entry:       number | null;
  stopLoss:    number | null;
  tp1:         number | null;
  tp2:         number | null;
  tp3:         number | null;
  brief:       string;
  rawData:     RawData;
  sentTelegram: boolean;
  createdAt:   string;
}

interface TelegramSettings {
  id:                string;
  enabled:           boolean;
  minRank:           string;
  allowedAssets:     string;
  weekendCryptoOnly: boolean;
}

interface LivePrice {
  symbol: string;
  assetClass: string;
  currentPrice: number | null;
  change24h: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  provider: string;
  updatedAt: string;
  stale: boolean;
  marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  reason: string | null;
  selectedProvider: string | null;
  fallbackUsed: boolean;
  freshnessMs: number | null;
  circuitState: string | null;
  styleReadiness: Record<"SCALP" | "INTRADAY" | "SWING", { ready: boolean; missing: string[]; stale: string[] }> | null;
}

interface TradePlan {
  id: string;
  runId: string;
  signalId: string;
  symbol: string;
  assetClass: string;
  style: "SCALP" | "INTRADAY" | "SWING";
  setupFamily: string | null;
  bias: string;
  confidence: number;
  timeframe: string;
  entryType: string;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskRewardRatio: number | null;
  invalidationLevel: number | null;
  regimeTag: string | null;
  liquidityThesis: string | null;
  trapThesis: string | null;
  setupScore: number | null;
  publicationRank: "S" | "A" | "B" | "Silent" | null;
  thesis: string;
  executionNotes: string;
  status: "ACTIVE" | "NO_SETUP" | "STALE";
  createdAt: string;
  updatedAt: string;
}

interface NewsItem {
  id:             number;
  headline:       string;
  source:         string;
  url:            string;
  publishedAt:    string;
  sentiment:      "bullish" | "bearish" | "neutral";
  affectedAssets: string[];
}

interface CalendarEvent {
  event:          string;
  country:        string;
  flag:           string;
  date:           string;
  time:           string;
  impact:         string;
  actual:         number | null;
  forecast:       number | null;
  previous:       number | null;
  unit:           string;
  isToday:        boolean;
  minutesUntil:   number;
  imminent:       boolean;
  affectedAssets: string[];
}

interface InstitutionalItem {
  title:          string;
  url:            string;
  publishedAt:    string;
  source:         string;
  isTier1:        boolean;
  isTier1Bank:    boolean;
  sentiment:      "bullish" | "bearish" | "neutral";
  affectedAssets: string[];
}

interface SignalRunRecord {
  id: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  totalDurationMs: number | null;
  dataFetchDurationMs: number | null;
  scoringDurationMs: number | null;
  persistenceDurationMs: number | null;
  alertDispatchDurationMs: number | null;
  engineVersion: string;
  featureVersion: string;
  promptVersion: string;
  status: string;
  failureCode: string | null;
  failureReason: string | null;
  failureDetails: Array<{ asset?: string; failureCode: string; reason: string }> | null;
  _count: {
    signals: number;
  };
}

interface AlertRecord {
  id: string;
  signalId: string;
  channel: string;
  recipient: string;
  status: string;
  attemptedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: string;
  signal: {
    id: string;
    runId: string;
    asset: string;
    rank: string;
    direction: string;
    total: number;
    createdAt: string;
  };
}

interface AlertLog {
  id: string;
  signalId: string;
  channel: string;
  recipient: string;
  status: string;
  attemptedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: string;
}

interface ProviderStatus {
  provider: string;
  assetClass: string | null;
  status: string;
  detail: string;
  latencyMs: number | null;
  recordedAt: string | null;
  score: number | null;
  healthState: string | null;
  circuitState: string | null;
}

interface SystemStatus {
  queue: {
    status: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    failureReason?: string;
  };
  providers: ProviderStatus[];
  timestamp: string;
}

interface QueueJob {
  id: string;
  name: string;
  status: string;
  failedReason?: string;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  delay?: number;
  queueName: string;
  runId: string | null;
}

interface RunDetail extends SignalRunRecord {
  signals: Array<Signal & { alerts: AlertLog[] }>;
  tradePlans: TradePlan[];
}

interface RunsResponse {
  runs: SignalRunRecord[];
  failureBreakdown: Record<string, number>;
}

interface QueueResponse {
  paused: boolean;
  alertSendingPaused: boolean;
  jobs: QueueJob[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSETS = ["EURUSD","GBPUSD","USDJPY","XAUUSD","XAGUSD","BTCUSDT","ETHUSDT"] as const;

const ASSET_CLASS: Record<string, string> = {
  EURUSD: "FOREX", GBPUSD: "FOREX", USDJPY: "FOREX",
  XAUUSD: "COMMODITY", XAGUSD: "COMMODITY",
  BTCUSDT: "CRYPTO", ETHUSDT: "CRYPTO",
};

const RC: Record<string, { text: string; border: string; bg: string; glow: string }> = {
  S:      { text: "text-amber-300",   border: "border-amber-300/50",   bg: "bg-amber-300/8",   glow: "shadow-amber-300/10" },
  A:      { text: "text-emerald-400", border: "border-emerald-400/50", bg: "bg-emerald-400/8", glow: "shadow-emerald-400/10" },
  B:      { text: "text-sky-400",     border: "border-sky-400/50",     bg: "bg-sky-400/8",     glow: "shadow-sky-400/10" },
  Silent: { text: "text-zinc-500",    border: "border-zinc-800",       bg: "bg-zinc-900/40",   glow: "" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 4): string {
  if (n == null || !isFinite(n)) return "—";
  if (Math.abs(n) >= 10000) dec = 2;
  else if (Math.abs(n) >= 100) dec = 3;
  return n.toFixed(dec);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 15 * 60 * 1000;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function sentimentStyle(s: "bullish" | "bearish" | "neutral"): string {
  if (s === "bullish") return "text-emerald-400 bg-emerald-500/8 border-emerald-500/20";
  if (s === "bearish") return "text-red-400 bg-red-500/8 border-red-500/20";
  return "text-zinc-500 bg-zinc-800/40 border-zinc-700/30";
}

function sentimentDot(s: "bullish" | "bearish" | "neutral"): string {
  if (s === "bullish") return "🟢";
  if (s === "bearish") return "🔴";
  return "⚪";
}

function toneForStatus(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "delivered" || normalized === "configured" || normalized === "online") {
    return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  }
  if (normalized === "running" || normalized === "waiting" || normalized === "active" || normalized === "processing") {
    return "text-amber-300 bg-amber-500/10 border-amber-500/30";
  }
  if (normalized === "failed" || normalized === "offline" || normalized === "missing") {
    return "text-red-400 bg-red-500/10 border-red-500/30";
  }
  return "text-zinc-400 bg-zinc-900/60 border-zinc-800";
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function readinessSummary(readiness: LivePrice["styleReadiness"], style: "SCALP" | "INTRADAY" | "SWING"): string {
  const item = readiness?.[style];
  if (!item) return "No readiness data";
  if (item.ready) return "Ready";
  const parts = [
    item.missing.length > 0 ? `missing ${item.missing.join(", ")}` : null,
    item.stale.length > 0 ? `stale ${item.stale.join(", ")}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Not ready";
}

function planStatusTone(status: TradePlan["status"]): string {
  if (status === "ACTIVE") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  if (status === "STALE") return "text-amber-300 bg-amber-500/10 border-amber-500/30";
  return "text-zinc-400 bg-zinc-900/60 border-zinc-800";
}

// ─── RankBadge ────────────────────────────────────────────────────────────────

function RankBadge({ rank, size = "sm" }: { rank: string; size?: "sm" | "lg" }) {
  const rc  = RC[rank] ?? RC.Silent;
  const cls = size === "lg"
    ? `text-2xl font-black px-3 py-1 rounded-xl border ${rc.text} ${rc.border} ${rc.bg}`
    : `text-[10px] font-black px-2 py-0.5 rounded-md border tracking-wider ${rc.text} ${rc.border} ${rc.bg}`;
  return <span className={cls}>{rank === "Silent" ? "—" : rank}</span>;
}

// ─── ScoreBar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct   = (value / 20) * 100;
  const color = pct >= 75 ? "#C8A96E" : pct >= 50 ? "#666" : "#333";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[8px] text-zinc-700 uppercase w-12 shrink-0 tracking-wide">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-zinc-800/80">
        <div className="h-1 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[9px] tabular-nums w-5 text-right" style={{ color }}>{value}</span>
    </div>
  );
}

// ─── AssetCard ────────────────────────────────────────────────────────────────

function AssetCard({
  symbol,
  signal,
  livePrice,
  tradePlans,
}: {
  symbol: string;
  signal: Signal | null;
  livePrice: LivePrice | null;
  tradePlans: TradePlan[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeStyle, setActiveStyle] = useState<TradePlan["style"]>("SCALP");
  const activePlan = tradePlans.find(plan => plan.style === activeStyle) ?? null;
  const fresh = signal ? isFresh(signal.createdAt) : false;
  const rc = signal ? (RC[signal.rank] ?? RC.Silent) : RC.Silent;
  const quoteStatus = livePrice?.marketStatus ?? (livePrice?.stale ? "DEGRADED" : "LIVE");
  const fallbackSignalPrice =
    signal?.rawData?.price?.current != null && signal.rawData.price.current > 0
      ? signal.rawData.price.current
      : null;
  const price = livePrice?.currentPrice != null && livePrice.currentPrice > 0
    ? livePrice.currentPrice
    : fallbackSignalPrice;
  const chg = quoteStatus === "LIVE"
    ? (livePrice?.changePct ?? signal?.rawData?.price?.change24h ?? null)
    : null;

  return (
    <div className={`
      bg-[#0d0d0d] border rounded-2xl p-4 flex flex-col gap-3 transition-all duration-300 min-h-[380px]
      ${rc.border}
      ${fresh ? `shadow-lg ${rc.glow}` : ""}
      ${fresh ? "ring-1 ring-inset ring-white/3" : ""}
    `}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-zinc-100">{symbol}</p>
            <span className="text-[8px] text-zinc-700 tracking-widest uppercase border border-zinc-800 rounded px-1.5 py-0.5">
              {livePrice?.assetClass ?? signal?.assetClass ?? ASSET_CLASS[symbol]}
            </span>
            <span className={`text-[8px] tracking-widest px-1.5 py-0.5 rounded border ${
              quoteStatus === "LIVE"
                ? "text-[#C8A96E] border-[#C8A96E]/20"
                : quoteStatus === "DEGRADED"
                  ? "text-amber-300 border-amber-500/30"
                  : "text-red-400 border-red-500/30"
            }`}>
              {quoteStatus}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-base font-bold tabular-nums text-zinc-200">{fmt(price)}</span>
            {chg != null && (
              <span className={`text-[10px] font-semibold tabular-nums ${chg >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
              </span>
            )}
          </div>
          <p className="text-[9px] text-zinc-700 mt-1">
            {livePrice
              ? `${livePrice.selectedProvider ?? livePrice.provider}${livePrice.fallbackUsed ? " fallback" : ""} · ${timeAgo(livePrice.updatedAt)}${livePrice.freshnessMs != null ? ` · ${fmtMs(livePrice.freshnessMs)}` : ""}${livePrice.circuitState ? ` · circuit ${livePrice.circuitState.toLowerCase()}` : ""}${livePrice.reason ? ` · ${livePrice.reason}` : ""}`
              : "Price feed unavailable"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <RankBadge rank={signal?.rank ?? "Silent"} />
          <span className={`text-[10px] font-black tracking-wider ${rc.text}`}>{signal ? `${signal.total}/100` : "—"}</span>
        </div>
      </div>

      {signal ? (
        <>
          <div className="space-y-1">
            {(["macro","structure","zones","technical","timing"] as const).map(d => (
              <ScoreBar key={d} label={d.slice(0,4)} value={signal[d]} />
            ))}
          </div>

          <div className="border-t border-zinc-900/60 pt-2.5">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className={`text-[10px] font-black tracking-widest px-2.5 py-1 rounded-lg border ${
                signal.direction === "LONG"
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                  : "bg-red-500/10 border-red-500/40 text-red-400"
              }`}>
                {signal.direction === "LONG" ? "▲" : "▼"} {signal.direction}
              </span>
              <span className="text-[9px] text-zinc-700">Latest update {timeAgo(signal.createdAt)}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["SCALP", "INTRADAY", "SWING"] as const).map(style => (
                <button
                  key={style}
                  onClick={() => setActiveStyle(style)}
                  className={`rounded-lg border px-2 py-1.5 text-[9px] font-bold tracking-widest transition-colors ${
                    activeStyle === style
                      ? "border-[#C8A96E]/50 bg-[#C8A96E]/10 text-[#C8A96E]"
                      : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          {activePlan ? (
            <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black text-zinc-100">{activePlan.timeframe}</p>
                  <p className="text-[9px] text-zinc-700 mt-1">
                    {activePlan.setupFamily ?? "No setup family"} · {activePlan.entryType === "NONE" ? "No executable plan" : `${activePlan.entryType} execution`}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`px-2 py-1 rounded-full border text-[8px] font-bold ${planStatusTone(activePlan.status)}`}>
                    {activePlan.status}
                  </span>
                  <span className="text-[8px] text-zinc-600">
                    {activePlan.publicationRank ?? "—"} · {activePlan.setupScore ?? "—"}/100
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap text-[8px] uppercase tracking-widest text-zinc-600">
                <span className="rounded-full border border-zinc-800 px-2 py-1">{activePlan.bias}</span>
                <span className="rounded-full border border-zinc-800 px-2 py-1">{activePlan.regimeTag ?? "unclear"}</span>
                {livePrice?.styleReadiness && (
                  <span className={`rounded-full border px-2 py-1 ${
                    livePrice.styleReadiness[activeStyle].ready
                      ? "border-emerald-500/30 text-emerald-400"
                      : "border-amber-500/30 text-amber-300"
                  }`}>
                    {activeStyle} {livePrice.styleReadiness[activeStyle].ready ? "ready" : "blocked"}
                  </span>
                )}
              </div>
              {livePrice?.styleReadiness && (
                <p className="text-[9px] text-zinc-600">
                  {readinessSummary(livePrice.styleReadiness, activeStyle)}
                </p>
              )}

              {activePlan.status === "ACTIVE" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {[
                      { label: "Entry Zone", value: `${fmt(activePlan.entryMin)} - ${fmt(activePlan.entryMax)}`, color: "text-zinc-200" },
                      { label: "Stop Loss", value: fmt(activePlan.stopLoss), color: "text-red-400" },
                      { label: "TP1", value: fmt(activePlan.takeProfit1), color: "text-emerald-400" },
                      { label: "TP2", value: fmt(activePlan.takeProfit2), color: "text-emerald-400" },
                      { label: "TP3", value: fmt(activePlan.takeProfit3), color: "text-emerald-400" },
                      { label: "R:R", value: activePlan.riskRewardRatio != null ? `${activePlan.riskRewardRatio.toFixed(2)}R` : "—", color: "text-[#C8A96E]" },
                    ].map(item => (
                      <div key={item.label} className="rounded-lg bg-[#0b0b0b] px-2 py-2">
                        <p className="text-[8px] uppercase tracking-wider text-zinc-700">{item.label}</p>
                        <p className={`mt-1 font-bold tabular-nums ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg bg-[#0b0b0b] px-2 py-2">
                    <p className="text-[8px] uppercase tracking-wider text-zinc-700">Invalidation</p>
                    <p className="mt-1 text-[10px] font-bold tabular-nums text-zinc-200">{fmt(activePlan.invalidationLevel)}</p>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-zinc-900 bg-[#0b0b0b] px-3 py-3">
                  <p className="text-[10px] text-zinc-300">{activePlan.executionNotes}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className={`text-[10px] text-zinc-500 leading-relaxed ${!expanded ? "line-clamp-4" : ""}`}>
                  {activePlan.thesis}
                </p>
                {(activePlan.liquidityThesis || activePlan.trapThesis) && (
                  <div className="space-y-1 rounded-lg bg-[#0b0b0b] px-3 py-2">
                    {activePlan.liquidityThesis && (
                      <p className="text-[9px] text-zinc-600">
                        <span className="text-zinc-400">Liquidity:</span> {activePlan.liquidityThesis}
                      </p>
                    )}
                    {activePlan.trapThesis && (
                      <p className="text-[9px] text-zinc-600">
                        <span className="text-zinc-400">Trap:</span> {activePlan.trapThesis}
                      </p>
                    )}
                  </div>
                )}
                {activePlan.thesis.length > 160 && (
                  <button
                    onClick={() => setExpanded(v => !v)}
                    className="text-[9px] text-zinc-700 hover:text-[#C8A96E] transition-colors tracking-widest"
                  >
                    {expanded ? "show less ▲" : "show more ▼"}
                  </button>
                )}
                <p className="text-[9px] text-zinc-700">{activePlan.executionNotes}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-4 flex-1 flex items-center justify-center">
              <p className="text-[10px] text-zinc-700">No persisted trade plans for this instrument yet.</p>
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center rounded-xl border border-zinc-900 bg-zinc-950/60">
          <p className="text-[10px] text-zinc-700">Awaiting persisted signal and trade plans…</p>
        </div>
      )}
    </div>
  );
}

// ─── SignalFeedItem ───────────────────────────────────────────────────────────

function SignalFeedItem({ signal }: { signal: Signal }) {
  const rc = RC[signal.rank] ?? RC.Silent;
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-zinc-900/60 last:border-0">
      <RankBadge rank={signal.rank} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-zinc-200">{signal.asset}</span>
          <span className={`text-[9px] font-bold ${signal.direction === "LONG" ? "text-emerald-500" : "text-red-500"}`}>
            {signal.direction === "LONG" ? "▲" : "▼"}
          </span>
          <span className={`text-[10px] font-black ${rc.text}`}>{signal.total}</span>
        </div>
        <p className="text-[9px] text-zinc-700">{timeAgo(signal.createdAt)}</p>
      </div>
      {signal.sentTelegram && <span className="text-[8px] text-blue-500 opacity-60">TG</span>}
    </div>
  );
}

// ─── TelegramPanel ────────────────────────────────────────────────────────────

function TelegramPanel({ settings, onSave }: {
  settings: TelegramSettings | null;
  onSave: (s: Partial<TelegramSettings>) => void;
}) {
  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [minRank, setMinRank] = useState(settings?.minRank ?? "A");
  const [assets,  setAssets]  = useState(settings?.allowedAssets ?? "ALL");
  const [weekend, setWeekend] = useState(settings?.weekendCryptoOnly ?? false);
  const [saving,  setSaving]  = useState(false);

  async function save() {
    setSaving(true);
    await onSave({ enabled, minRank, allowedAssets: assets, weekendCryptoOnly: weekend });
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 tracking-widest uppercase">Telegram Alerts</span>
        <button onClick={() => setEnabled(v => !v)}
          className={`w-9 h-5 rounded-full border transition-all relative ${enabled ? "bg-[#C8A96E]/20 border-[#C8A96E]/50" : "bg-zinc-900 border-zinc-800"}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${enabled ? "left-4 bg-[#C8A96E]" : "left-0.5 bg-zinc-600"}`} />
        </button>
      </div>
      <div>
        <label className="text-[9px] text-zinc-700 tracking-widest uppercase block mb-1.5">Min Rank to Send</label>
        <div className="flex gap-1.5">
          {["S","A"].map(r => (
            <button key={r} onClick={() => setMinRank(r)}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-black tracking-widest transition-all border ${minRank === r ? `${RC[r].text} ${RC[r].border} ${RC[r].bg}` : "text-zinc-700 border-zinc-800"}`}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[9px] text-zinc-700 tracking-widests uppercase block mb-1.5">Asset Filter</label>
        <input value={assets} onChange={e => setAssets(e.target.value)} placeholder="ALL"
          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#C8A96E]/40 transition-colors" />
        <p className="text-[8px] text-zinc-800 mt-1">ALL or comma-separated: BTCUSDT,ETHUSDT</p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 tracking-widest uppercase">Weekend Crypto Only</span>
        <button onClick={() => setWeekend(v => !v)}
          className={`w-9 h-5 rounded-full border transition-all relative ${weekend ? "bg-[#C8A96E]/20 border-[#C8A96E]/50" : "bg-zinc-900 border-zinc-800"}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${weekend ? "left-4 bg-[#C8A96E]" : "left-0.5 bg-zinc-600"}`} />
        </button>
      </div>
      <button onClick={save} disabled={saving}
        className="w-full py-2 rounded-xl text-[10px] font-bold tracking-widest uppercase bg-[#C8A96E] text-black hover:bg-[#d4b87a] disabled:opacity-50 transition-colors">
        {saving ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

// ─── TickerBar ────────────────────────────────────────────────────────────────

function TickerBar({ prices }: { prices: LivePrice[] }) {
  if (prices.length === 0) return null;

  const items = [...prices, ...prices]; // duplicate for seamless loop

  return (
    <div className="border-b border-zinc-900/80 bg-[#060606] overflow-hidden">
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track {
          display: flex;
          width: max-content;
          animation: ticker-scroll 40s linear infinite;
        }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>
      <div className="ticker-track py-2">
        {items.map((p, i) => {
          const up = (p.changePct ?? 0) >= 0;
          return (
            <div key={i} className="flex items-center gap-2 px-5 border-r border-zinc-900/60 shrink-0">
              <span className="text-[10px] font-black tracking-wider text-zinc-400">{p.symbol}</span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded border ${
                p.marketStatus === "LIVE"
                  ? "text-zinc-600 border-zinc-800"
                  : p.marketStatus === "DEGRADED"
                    ? "text-amber-300 border-amber-500/30"
                    : "text-red-400 border-red-500/30"
              }`}>
                {p.provider}
              </span>
              <span className="text-[11px] font-bold tabular-nums text-zinc-200">
                {p.currentPrice != null && p.currentPrice > 0 ? fmt(p.currentPrice) : "—"}
              </span>
              {p.marketStatus === "LIVE" && p.changePct != null && (
                <span className={`text-[9px] font-semibold tabular-nums ${up ? "text-emerald-400" : "text-red-400"}`}>
                  {up ? "▲" : "▼"} {Math.abs(p.changePct).toFixed(2)}%
                </span>
              )}
              {p.marketStatus !== "LIVE" && (
                <span className={`text-[8px] ${p.marketStatus === "UNAVAILABLE" ? "text-red-400" : "text-amber-300"}`}>
                  {p.marketStatus}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BreakingBanner ───────────────────────────────────────────────────────────

function BreakingBanner({ items, onDismiss }: {
  items: NewsItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  const item = items[0];

  return (
    <div className="bg-red-950/40 border-b border-red-900/50 px-4 py-2 flex items-center gap-3">
      <span className="text-red-400 text-[10px] font-black tracking-widest shrink-0 animate-pulse">⚡ BREAKING</span>
      <p className="text-xs text-red-300 flex-1 truncate">{item.headline}</p>
      <div className="flex items-center gap-2 shrink-0">
        {item.affectedAssets.slice(0, 3).map(a => (
          <span key={a} className="text-[8px] text-red-500/70 border border-red-900/50 rounded px-1 py-0.5">{a}</span>
        ))}
        <button onClick={() => onDismiss(item.id)}
          className="text-red-600 hover:text-red-400 text-xs transition-colors ml-1">✕</button>
      </div>
    </div>
  );
}

function OpsMetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
      <p className="text-[9px] text-zinc-700 tracking-[0.22em] uppercase">{label}</p>
      <p className="text-2xl font-black text-zinc-100 mt-2">{value}</p>
      <p className="text-[10px] text-zinc-600 mt-1">{detail}</p>
    </div>
  );
}

function RunFeedItem({ run }: { run: SignalRunRecord }) {
  return (
    <div className="border-b border-zinc-900/60 py-3 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black text-zinc-200 truncate">{run.id}</p>
          <p className="text-[9px] text-zinc-700">
            Queued {timeAgo(run.queuedAt)} · {run._count.signals} persisted · {fmtMs(run.totalDurationMs)}
          </p>
        </div>
        <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(run.status)}`}>
          {run.status}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-2 flex-wrap text-[9px] text-zinc-600">
        <span>{run.engineVersion}</span>
        <span>·</span>
        <span>{run.featureVersion}</span>
        <span>·</span>
        <span>{run.promptVersion}</span>
      </div>
      {run.failureReason && (
        <p className="text-[9px] text-red-400 mt-2 leading-relaxed">{run.failureReason}</p>
      )}
      {run.failureCode && (
        <p className="text-[9px] text-amber-300 mt-1">{run.failureCode}</p>
      )}
    </div>
  );
}

function AlertFeedItem({ alert }: { alert: AlertRecord }) {
  return (
    <div className="border-b border-zinc-900/60 py-3 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-black text-zinc-200">{alert.signal.asset}</span>
            <RankBadge rank={alert.signal.rank} />
            <span className="text-[9px] text-zinc-600">{alert.channel}</span>
          </div>
          <p className="text-[9px] text-zinc-700 mt-1">
            {alert.recipient} · {timeAgo(alert.createdAt)}
          </p>
        </div>
        <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(alert.status)}`}>
          {alert.status}
        </span>
      </div>
      {alert.failureReason && (
        <p className="text-[9px] text-red-400 mt-2 leading-relaxed">{alert.failureReason}</p>
      )}
    </div>
  );
}

function ProviderHealthPanel({ providers }: { providers: ProviderStatus[] }) {
  return (
    <div className="space-y-2">
      {providers.map(provider => (
        <div key={provider.provider} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-900 bg-zinc-950/60 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-zinc-200">
              {provider.provider}
              {provider.assetClass ? <span className="text-zinc-600 font-medium"> · {provider.assetClass}</span> : null}
            </p>
            <p className="text-[9px] text-zinc-700">
              {provider.detail}
              {provider.latencyMs != null ? ` · ${provider.latencyMs}ms` : ""}
              {provider.score != null ? ` · score ${provider.score}` : ""}
              {provider.circuitState ? ` · circuit ${provider.circuitState.toLowerCase()}` : ""}
            </p>
          </div>
          <span className={`text-[8px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${toneForStatus(provider.status)}`}>
            {provider.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function QueueJobItem({ job, onRetry }: { job: QueueJob; onRetry: (jobId: string) => void }) {
  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black text-zinc-200 truncate">{job.id}</p>
          <p className="text-[9px] text-zinc-700">{timeAgo(new Date(job.timestamp).toISOString())} · {job.attemptsMade} attempt(s)</p>
        </div>
        <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(job.status)}`}>
          {job.status}
        </span>
      </div>
      {job.failedReason && <p className="text-[9px] text-red-400 mt-2">{job.failedReason}</p>}
      {job.status === "failed" && (
        <button
          onClick={() => onRetry(job.id)}
          className="mt-3 text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg bg-[#C8A96E] text-black hover:bg-[#d4b87a] transition-colors"
        >
          Retry Job
        </button>
      )}
    </div>
  );
}

// ─── MarketIntelPanel ─────────────────────────────────────────────────────────

type IntelTab = "news" | "calendar" | "institutional";

function MarketIntelPanel({
  news, calendar, institutional, now,
}: {
  news:          NewsItem[];
  calendar:      CalendarEvent[];
  institutional: InstitutionalItem[];
  now:           Date;
}) {
  const [tab, setTab] = useState<IntelTab>("news");

  const TABS: { id: IntelTab; label: string; count: number }[] = [
    { id: "news",          label: "News",          count: news.length          },
    { id: "calendar",      label: "Calendar",      count: calendar.length      },
    { id: "institutional", label: "Institutional", count: institutional.length },
  ];

  return (
    <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-900">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 px-4 py-3 text-[10px] font-bold tracking-widest uppercase transition-all border-b-2 -mb-px flex items-center justify-center gap-2 ${
              tab === t.id
                ? "border-[#C8A96E] text-[#C8A96E]"
                : "border-transparent text-zinc-600 hover:text-zinc-400"
            }`}>
            {t.label}
            {t.count > 0 && (
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${tab === t.id ? "bg-[#C8A96E]/20 text-[#C8A96E]" : "bg-zinc-800 text-zinc-600"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="max-h-[520px] overflow-y-auto">

        {/* ── NEWS ─────────────────────────────────────────────────────── */}
        {tab === "news" && (
          <div className="divide-y divide-zinc-900/60">
            {news.length === 0 ? (
              <div className="py-12 text-center text-zinc-800 text-sm">No news loaded yet.</div>
            ) : news.map(item => {
              const ageMs   = now.getTime() - new Date(item.publishedAt).getTime();
              const isBreak = ageMs < 30 * 60 * 1000;
              return (
                <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
                  className="block px-4 py-3 hover:bg-zinc-900/40 transition-colors">
                  <div className="flex items-start gap-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        {isBreak && (
                          <span className="text-[8px] font-black tracking-widest bg-red-500/20 text-red-400 border border-red-500/30 rounded px-1.5 py-0.5">
                            BREAKING
                          </span>
                        )}
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${sentimentStyle(item.sentiment)}`}>
                          {sentimentDot(item.sentiment)} {item.sentiment}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-snug hover:text-zinc-100 transition-colors">
                        {item.headline}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[9px] text-zinc-600">{item.source}</span>
                        <span className="text-[9px] text-zinc-800">·</span>
                        <span className="text-[9px] text-zinc-700">{timeAgo(item.publishedAt)}</span>
                        {item.affectedAssets.slice(0, 4).map(a => (
                          <span key={a} className="text-[8px] text-zinc-700 border border-zinc-800 rounded px-1 py-px">{a}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {/* ── CALENDAR ─────────────────────────────────────────────────── */}
        {tab === "calendar" && (
          <div className="divide-y divide-zinc-900/60">
            {calendar.length === 0 ? (
              <div className="py-12 text-center text-zinc-800 text-sm">No upcoming high-impact events.</div>
            ) : calendar.map((ev, i) => (
              <div key={i} className={`px-4 py-3 ${ev.isToday ? "bg-[#C8A96E]/3 border-l-2 border-[#C8A96E]/30" : ""}`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-lg leading-none">{ev.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      {ev.imminent && (
                        <span className="text-[8px] font-black text-red-400 animate-pulse">⚠ IMMINENT</span>
                      )}
                      {ev.isToday && !ev.imminent && (
                        <span className="text-[8px] font-bold text-[#C8A96E]">TODAY</span>
                      )}
                      <span className="text-[8px] font-black text-red-500 tracking-widest bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">
                        HIGH IMPACT
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-zinc-200">{ev.event}</p>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-zinc-600">
                      <span>{ev.date} {ev.time}</span>
                      {ev.forecast != null && <span>Fcst: <span className="text-zinc-400">{ev.forecast}{ev.unit}</span></span>}
                      {ev.previous != null && <span>Prev: <span className="text-zinc-500">{ev.previous}{ev.unit}</span></span>}
                      {ev.actual   != null && <span>Act: <span className="text-emerald-400">{ev.actual}{ev.unit}</span></span>}
                    </div>
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {ev.affectedAssets.slice(0, 4).map(a => (
                        <span key={a} className="text-[8px] text-zinc-700 border border-zinc-800 rounded px-1 py-px">{a}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── INSTITUTIONAL ────────────────────────────────────────────── */}
        {tab === "institutional" && (
          <div className="divide-y divide-zinc-900/60">
            {institutional.length === 0 ? (
              <div className="py-12 text-center text-zinc-800 text-sm">No institutional news loaded.</div>
            ) : institutional.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                className="block px-4 py-3 hover:bg-zinc-900/40 transition-colors">
                <div className="flex items-start gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      {item.isTier1Bank && (
                        <span className="text-[8px] font-black tracking-widest bg-[#C8A96E]/10 text-[#C8A96E] border border-[#C8A96E]/20 rounded px-1.5 py-0.5">
                          TIER 1
                        </span>
                      )}
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${sentimentStyle(item.sentiment)}`}>
                        {sentimentDot(item.sentiment)} {item.sentiment}
                      </span>
                      <span className="text-[9px] text-zinc-600 font-semibold">{item.source}</span>
                    </div>
                    <p className="text-xs text-zinc-300 leading-snug hover:text-zinc-100 transition-colors">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[9px] text-zinc-700">{timeAgo(item.publishedAt)}</span>
                      {item.affectedAssets.slice(0, 4).map(a => (
                        <span key={a} className="text-[8px] text-zinc-700 border border-zinc-800 rounded px-1 py-px">{a}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Existing state ────────────────────────────────────────────────────────
  const [latestSignals, setLatestSignals] = useState<Record<string, Signal>>({});
  const [latestTradePlans, setLatestTradePlans] = useState<Record<string, Record<string, TradePlan>>>({});
  const [signalFeed,    setSignalFeed]    = useState<Signal[]>([]);
  const [tgSettings,    setTgSettings]    = useState<TelegramSettings | null>(null);
  const [cycleRunning,  setCycleRunning]  = useState(false);
  const [showTelegram,  setShowTelegram]  = useState(false);
  const [now,           setNow]           = useState(new Date());
  const [lastRefresh,   setLastRefresh]   = useState<Date | null>(null);
  const [runs,          setRuns]          = useState<SignalRunRecord[]>([]);
  const [alerts,        setAlerts]        = useState<AlertRecord[]>([]);
  const [system,        setSystem]        = useState<SystemStatus | null>(null);
  const [queueJobs,     setQueueJobs]     = useState<QueueJob[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun,   setSelectedRun]   = useState<RunDetail | null>(null);
  const [failureBreakdown, setFailureBreakdown] = useState<Record<string, number>>({});
  const [alertSendingPaused, setAlertSendingPaused] = useState(false);

  // ── New market data state ─────────────────────────────────────────────────
  const [livePrices,      setLivePrices]      = useState<LivePrice[]>([]);
  const [newsItems,       setNewsItems]       = useState<NewsItem[]>([]);
  const [calendarEvents,  setCalendarEvents]  = useState<CalendarEvent[]>([]);
  const [institutionalItems, setInstitutionalItems] = useState<InstitutionalItem[]>([]);
  const [dismissedIds,    setDismissedIds]    = useState<Set<number>>(new Set());

  // ── Live clock ────────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Existing data fetch ───────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    const [latestRes, plansRes, feedRes, tgRes] = await Promise.allSettled([
      fetch("/api/signals/latest").then(r => r.json()),
      fetch("/api/trade-plans/latest").then(r => r.json()),
      fetch("/api/signals?rank=S,A&limit=20").then(r => r.json()),
      fetch("/api/telegram/settings").then(r => r.json()),
    ]);
    if (latestRes.status === "fulfilled") setLatestSignals(latestRes.value ?? {});
    if (plansRes.status === "fulfilled") setLatestTradePlans(plansRes.value ?? {});
    if (feedRes.status   === "fulfilled") setSignalFeed(feedRes.value   ?? []);
    if (tgRes.status     === "fulfilled") setTgSettings(tgRes.value     ?? null);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60_000);
    return () => clearInterval(t);
  }, [fetchData]);

  const fetchOps = useCallback(async () => {
    const [runsRes, alertsRes, systemRes, queueRes] = await Promise.allSettled([
      fetch("/api/runs").then(r => r.json()),
      fetch("/api/alerts").then(r => r.json()),
      fetch("/api/system").then(r => r.json()),
      fetch("/api/queue").then(r => r.json()),
    ]);
    if (runsRes.status === "fulfilled") {
      const payload = runsRes.value as RunsResponse;
      setRuns(Array.isArray(payload.runs) ? payload.runs : []);
      setFailureBreakdown(payload.failureBreakdown ?? {});
    }
    if (alertsRes.status === "fulfilled") setAlerts(alertsRes.value ?? []);
    if (systemRes.status === "fulfilled") setSystem(systemRes.value ?? null);
    if (queueRes.status === "fulfilled") {
      const payload = queueRes.value as QueueResponse;
      setQueueJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      setAlertSendingPaused(Boolean(payload.alertSendingPaused));
    }
  }, []);

  useEffect(() => {
    fetchOps();
    const t = setInterval(fetchOps, 20_000);
    return () => clearInterval(t);
  }, [fetchOps]);

  const fetchRunDetail = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}`);
      if (!res.ok) return;
      setSelectedRun(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    fetchRunDetail(selectedRunId);
  }, [selectedRunId, fetchRunDetail]);

  // ── Live prices — every 30 seconds ───────────────────────────────────────

  const fetchLivePrices = useCallback(async () => {
    try {
      const data = await fetch("/api/market/live").then(r => r.json());
      if (Array.isArray(data)) setLivePrices(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchLivePrices();
    const t = setInterval(fetchLivePrices, 30_000);
    return () => clearInterval(t);
  }, [fetchLivePrices]);

  // ── News — every 5 minutes ────────────────────────────────────────────────

  const fetchNews = useCallback(async () => {
    try {
      const data = await fetch("/api/market/news").then(r => r.json());
      if (Array.isArray(data)) setNewsItems(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchNews();
    const t = setInterval(fetchNews, 5 * 60_000);
    return () => clearInterval(t);
  }, [fetchNews]);

  // ── Calendar — every 30 minutes ───────────────────────────────────────────

  const fetchCalendar = useCallback(async () => {
    try {
      const data = await fetch("/api/market/calendar").then(r => r.json());
      if (Array.isArray(data)) setCalendarEvents(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchCalendar();
    const t = setInterval(fetchCalendar, 30 * 60_000);
    return () => clearInterval(t);
  }, [fetchCalendar]);

  // ── Institutional — every 10 minutes ─────────────────────────────────────

  const fetchInstitutional = useCallback(async () => {
    try {
      const data = await fetch("/api/market/institutional").then(r => r.json());
      if (Array.isArray(data)) setInstitutionalItems(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchInstitutional();
    const t = setInterval(fetchInstitutional, 10 * 60_000);
    return () => clearInterval(t);
  }, [fetchInstitutional]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function runCycle() {
    if (cycleRunning) return;
    setCycleRunning(true);
    try {
      const res  = await fetch("/api/cycle", { method: "POST" });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to queue cycle");
      }

      window.setTimeout(() => {
        fetchData().catch(() => null);
        fetchOps().catch(() => null);
      }, 5000);
    } catch { /* silent */ }
    finally { setCycleRunning(false); }
  }

  async function saveTelegramSettings(update: Partial<TelegramSettings>) {
    try {
      const res  = await fetch("/api/telegram/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      setTgSettings(await res.json());
    } catch { /* silent */ }
  }

  async function retryQueueJob(jobId: string) {
    try {
      await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_job", jobId }),
      });
      fetchOps().catch(() => null);
    } catch { /* silent */ }
  }

  async function enqueueCycleManually() {
    if (cycleRunning) return;
    setCycleRunning(true);
    try {
      await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue_cycle" }),
      });
      window.setTimeout(() => {
        fetchOps().catch(() => null);
      }, 1500);
    } catch { /* silent */ }
    finally { setCycleRunning(false); }
  }

  async function retryFailedRun(runId: string) {
    try {
      await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_run", runId }),
      });
      fetchOps().catch(() => null);
    } catch { /* silent */ }
  }

  async function requeueFailedAlerts(runId?: string) {
    try {
      await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "requeue_alerts", runId }),
      });
      fetchOps().catch(() => null);
    } catch { /* silent */ }
  }

  async function toggleAlertsPause() {
    try {
      await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: alertSendingPaused ? "resume_alerts" : "pause_alerts" }),
      });
      fetchOps().catch(() => null);
    } catch { /* silent */ }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const lastCycleTime = Object.values(latestSignals)
    .map(s => new Date(s.createdAt).getTime())
    .sort((a, b) => b - a)[0] ?? null;

  const lastCycleStr = lastCycleTime
    ? timeAgo(new Date(lastCycleTime).toISOString()) : "never";

  const activeSignals = Object.values(latestSignals)
    .filter(s => s.rank === "S" || s.rank === "A").length;

  const latestRun = runs[0] ?? null;
  const deliveredAlerts = alerts.filter(a => a.status === "DELIVERED").length;
  const failedAlerts = alerts.filter(a => a.status === "FAILED").length;

  // Breaking news: < 15 min old, non-neutral, not dismissed
  const breakingItems = newsItems.filter(n => {
    if (dismissedIds.has(n.id)) return false;
    if (n.sentiment === "neutral") return false;
    return Date.now() - new Date(n.publishedAt).getTime() < 15 * 60 * 1000;
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#080808] text-zinc-100">

      {/* ── BREAKING BANNER ─────────────────────────────────────────────── */}
      <BreakingBanner
        items={breakingItems}
        onDismiss={id => setDismissedIds(prev => new Set([...prev, id]))}
      />

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-900/80 px-4 sm:px-6 py-3 sticky top-0 z-30 bg-[#080808]/95 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#C8A96E]/10 flex items-center justify-center border border-[#C8A96E]/20">
              <div className="w-2.5 h-2.5 rounded-sm bg-[#C8A96E]" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-[0.28em] uppercase text-[#C8A96E]">APEX</h1>
              <p className="text-[8px] text-zinc-700 tracking-[0.3em] uppercase">Institutional Signal Operations</p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-5">
            <div className="text-right">
              <p className="text-[8px] text-zinc-700 tracking-widests uppercase">UTC Time</p>
              <p className="text-xs font-black tabular-nums text-zinc-300">{fmtTime(now)}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] text-zinc-700 tracking-widests uppercase">Last Cycle</p>
              <p className="text-xs font-black tabular-nums text-zinc-300">{lastCycleStr}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] text-zinc-700 tracking-widests uppercase">Active Signals</p>
              <p className={`text-xs font-black tabular-nums ${activeSignals > 0 ? "text-[#C8A96E]" : "text-zinc-600"}`}>
                {activeSignals} / {Object.keys(latestSignals).length || "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setShowTelegram(v => !v)}
              className={`text-[10px] font-bold tracking-widests uppercase px-3 py-1.5 rounded-lg border transition-all ${
                showTelegram ? "border-[#C8A96E]/50 text-[#C8A96E] bg-[#C8A96E]/5" : "border-zinc-800 text-zinc-600 hover:text-zinc-400"
              }`}>
              TG Settings
            </button>
            <button onClick={runCycle} disabled={cycleRunning}
              className="text-[10px] font-bold tracking-widests uppercase px-3 py-1.5 rounded-lg bg-[#C8A96E] text-black hover:bg-[#d4b87a] disabled:opacity-50 transition-colors">
              {cycleRunning ? "Running…" : "⬡ Run Cycle"}
            </button>
            <button onClick={enqueueCycleManually} disabled={cycleRunning}
              className="text-[10px] font-bold tracking-widests uppercase px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:border-[#C8A96E]/40 hover:text-[#C8A96E] transition-colors">
              Enqueue
            </button>
          </div>
        </div>
      </header>

      {/* ── LIVE TICKER ─────────────────────────────────────────────────── */}
      <TickerBar prices={livePrices} />

      <div className="max-w-[1600px] mx-auto px-4 py-5">

        {/* ── Telegram settings panel ───────────────────────────────────── */}
        {showTelegram && (
          <div className="bg-[#0d0d0d] border border-[#C8A96E]/20 rounded-2xl p-5 mb-5 fade-in max-w-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-[#C8A96E]" />
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-[#C8A96E]">Telegram Settings</h2>
            </div>
            <TelegramPanel
              key={tgSettings ? `${tgSettings.id}:${tgSettings.enabled}:${tgSettings.minRank}:${tgSettings.allowedAssets}:${tgSettings.weekendCryptoOnly}` : "telegram-default"}
              settings={tgSettings}
              onSave={saveTelegramSettings}
            />
          </div>
        )}

        {/* ── Cycle running overlay ─────────────────────────────────────── */}
        {cycleRunning && (
          <div className="bg-[#0d0d0d] border border-[#C8A96E]/20 rounded-2xl p-4 mb-5 fade-in">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-[#C8A96E] animate-pulse" />
              <p className="text-xs text-[#C8A96E] font-bold tracking-widest">
                Queueing institutional signal cycle for worker execution…
              </p>
              <span className="text-[9px] text-zinc-700 ml-auto">worker</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
          <OpsMetricCard
            label="Queue"
            value={system ? `${system.queue.waiting}` : "—"}
            detail={system ? `${system.queue.active} active · ${system.queue.failed} failed` : "Awaiting system telemetry"}
          />
          <OpsMetricCard
            label="Latest Run"
            value={latestRun ? latestRun.status : "—"}
            detail={latestRun ? `${latestRun._count.signals} signals · ${timeAgo(latestRun.startedAt ?? latestRun.queuedAt)}` : "No recorded runs"}
          />
          <OpsMetricCard
            label="Alerts"
            value={String(deliveredAlerts)}
            detail={`${failedAlerts} failed in recent delivery history`}
          />
          <OpsMetricCard
            label="Providers"
            value={system ? `${system.providers.filter(p => p.status === "configured" || p.status === "online").length}/${system.providers.length}` : "—"}
            detail={system ? "Configured or online dependencies" : "No provider data"}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">

          {/* ── ASSET GRID ────────────────────────────────────────────── */}
          <div className="xl:col-span-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Asset Universe</h2>
              {lastRefresh && (
                <p className="text-[9px] text-zinc-800">Refreshed {timeAgo(lastRefresh.toISOString())}</p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3">
              {ASSETS.map(symbol => (
                <AssetCard
                  key={symbol}
                  symbol={symbol}
                  signal={latestSignals[symbol] ?? null}
                  livePrice={livePrices.find(price => price.symbol === symbol) ?? null}
                  tradePlans={Object.values(latestTradePlans[symbol] ?? {}) as TradePlan[]}
                />
              ))}
            </div>
          </div>

          {/* ── SIDEBAR ───────────────────────────────────────────────── */}
          <div className="xl:col-span-1 space-y-4">
            {/* Signal Feed */}
            <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#C8A96E] animate-pulse" />
                  <h3 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Signal Feed</h3>
                </div>
                <span className="text-[9px] text-zinc-800">A+ only</span>
              </div>
              {signalFeed.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-zinc-800 text-xs">No A/S signals yet.</p>
                  <p className="text-zinc-900 text-[9px] mt-1">Run a cycle to generate signals.</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {signalFeed.map(s => <SignalFeedItem key={s.id} signal={s} />)}
                </div>
              )}
            </div>

            {/* Macro snapshot */}
            {(() => {
              const macro = Object.values(latestSignals)[0]?.rawData?.macro;
              if (!macro) return null;
              return (
                <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
                  <h3 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600 mb-3">Macro</h3>
                  <div className="space-y-2">
                    {[
                      { label: "Fed Funds", val: macro.fedFundsRate ? `${macro.fedFundsRate}%` : "—", trend: macro.fedTrend },
                      { label: "CPI",       val: macro.cpi          ? String(macro.cpi)         : "—", trend: macro.cpiTrend },
                      { label: "10Y Yield", val: macro.treasury10y  ? `${macro.treasury10y}%`   : "—", trend: null },
                    ].map(({ label, val, trend }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[9px] text-zinc-700 tracking-widests uppercase">{label}</span>
                        <div className="flex items-center gap-1.5">
                          {trend && (
                            <span className={`text-[8px] ${trend === "rising" ? "text-red-500" : trend === "falling" ? "text-emerald-500" : "text-zinc-700"}`}>
                              {trend === "rising" ? "▲" : trend === "falling" ? "▼" : "—"}
                            </span>
                          )}
                          <span className="text-[10px] font-bold text-zinc-300 tabular-nums">{val}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Rank legend */}
            <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
              <h3 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600 mb-3">Rank Scale</h3>
              <div className="space-y-1.5">
                {[
                  { rank: "S",      range: "85–100", label: "Prime Setup" },
                  { rank: "A",      range: "70–84",  label: "Strong Setup" },
                  { rank: "B",      range: "55–69",  label: "Valid Setup" },
                  { rank: "Silent", range: "< 55",   label: "Stand Aside" },
                ].map(({ rank, range, label }) => {
                  const rc = RC[rank];
                  return (
                    <div key={rank} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${rc.bg} border ${rc.border}`}>
                      <span className={`text-[10px] font-black w-6 ${rc.text}`}>{rank === "Silent" ? "—" : rank}</span>
                      <span className="text-[9px] text-zinc-600 tabular-nums w-12">{range}</span>
                      <span className="text-[9px] text-zinc-700">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── MARKET INTELLIGENCE PANEL ─────────────────────────────────── */}
        <div className="mt-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[#C8A96E] animate-pulse" />
            <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Market Intelligence</h2>
            <span className="text-[9px] text-zinc-800">
              {newsItems.length} articles · {calendarEvents.length} events · {institutionalItems.length} institutional
            </span>
          </div>
          <MarketIntelPanel
            news={newsItems}
            calendar={calendarEvents}
            institutional={institutionalItems}
            now={now}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Cycle Audit</h2>
              {latestRun && (
                <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(latestRun.status)}`}>
                  {latestRun.status}
                </span>
              )}
            </div>
            {runs.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs text-zinc-700">No signal runs recorded yet.</p>
                <p className="text-[9px] text-zinc-800 mt-1">Queue a cycle to create an auditable run.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {runs.map(run => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className="block w-full text-left hover:bg-zinc-950/40 rounded-xl px-2 transition-colors"
                  >
                    <RunFeedItem run={run} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Alert Delivery</h2>
              <span className="text-[9px] text-zinc-800">{alerts.length} recent records</span>
            </div>
            {alerts.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs text-zinc-700">No alerts recorded yet.</p>
                <p className="text-[9px] text-zinc-800 mt-1">Delivered, skipped, and failed sends will appear here.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {alerts.map(alert => <AlertFeedItem key={alert.id} alert={alert} />)}
              </div>
            )}
          </div>

          <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">System Health</h2>
              {system && (
                <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(system.queue.status)}`}>
                  queue {system.queue.status}
                </span>
              )}
            </div>
            {system ? (
              <>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Waiting</p>
                    <p className="text-lg font-black text-zinc-100 mt-1">{system.queue.waiting}</p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Active</p>
                    <p className="text-lg font-black text-zinc-100 mt-1">{system.queue.active}</p>
                  </div>
                </div>
                <ProviderHealthPanel providers={system.providers} />
                <div className="mt-4 flex gap-2 flex-wrap">
                  <button
                    onClick={toggleAlertsPause}
                    className={`text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border transition-colors ${
                      alertSendingPaused ? "border-emerald-500/30 text-emerald-400" : "border-red-500/30 text-red-400"
                    }`}
                  >
                    {alertSendingPaused ? "Resume Alerts" : "Pause Alerts"}
                  </button>
                  <button
                    onClick={() => requeueFailedAlerts()}
                    className="text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:border-[#C8A96E]/40 hover:text-[#C8A96E] transition-colors"
                  >
                    Requeue Alerts
                  </button>
                </div>
              </>
            ) : (
              <div className="py-10 text-center">
                <p className="text-xs text-zinc-700">System telemetry unavailable.</p>
                <p className="text-[9px] text-zinc-800 mt-1">Queue and provider checks will appear here.</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Queue Control</h2>
              <span className="text-[9px] text-zinc-800">{queueJobs.length} visible jobs</span>
            </div>
            {queueJobs.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-xs text-zinc-700">No queued or failed jobs visible.</p>
                <p className="text-[9px] text-zinc-800 mt-1">Waiting, active, delayed, and failed jobs will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {queueJobs.map(job => (
                  <QueueJobItem key={job.id} job={job} onRetry={retryQueueJob} />
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Run Detail</h2>
              {selectedRun && (
                <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(selectedRun.status)}`}>
                  {selectedRun.status}
                </span>
              )}
            </div>
            {!selectedRun ? (
              <div className="py-10 text-center">
                <p className="text-xs text-zinc-700">Select a cycle from the audit feed.</p>
                <p className="text-[9px] text-zinc-800 mt-1">You’ll see persisted signals, scores, and alert outcomes here.</p>
              </div>
            ) : (
              <div>
                <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3 mb-3">
                  <p className="text-[10px] font-black text-zinc-200">{selectedRun.id}</p>
                  <p className="text-[9px] text-zinc-700 mt-1">
                    Queued {timeAgo(selectedRun.queuedAt)} · {selectedRun.signals.length} signals
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    {[
                      { label: "Total", value: selectedRun.totalDurationMs },
                      { label: "Fetch", value: selectedRun.dataFetchDurationMs },
                      { label: "Scoring", value: selectedRun.scoringDurationMs },
                      { label: "Persist", value: selectedRun.persistenceDurationMs },
                      { label: "Alerts", value: selectedRun.alertDispatchDurationMs },
                    ].map(item => (
                      <div key={item.label} className="rounded-lg bg-[#0b0b0b] px-2 py-2">
                        <p className="text-[8px] uppercase text-zinc-700">{item.label}</p>
                        <p className="text-[10px] font-bold text-zinc-200 mt-1">{fmtMs(item.value)}</p>
                      </div>
                    ))}
                  </div>
                  {selectedRun.failureReason && (
                    <p className="text-[9px] text-red-400 mt-2">{selectedRun.failureReason}</p>
                  )}
                  {selectedRun.failureCode && (
                    <p className="text-[9px] text-amber-300 mt-1">{selectedRun.failureCode}</p>
                  )}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button
                      onClick={() => retryFailedRun(selectedRun.id)}
                      disabled={selectedRun.status !== "FAILED"}
                      className="text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg bg-[#C8A96E] text-black hover:bg-[#d4b87a] disabled:opacity-40 transition-colors"
                    >
                      Retry Failed Run
                    </button>
                    <button
                      onClick={() => requeueFailedAlerts(selectedRun.id)}
                      className="text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:border-[#C8A96E]/40 hover:text-[#C8A96E] transition-colors"
                    >
                      Requeue Alerts
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                  {selectedRun.signals.map(signal => (
                    <div key={signal.id} className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                      {(() => {
                        const runPlans = selectedRun.tradePlans.filter(plan => plan.signalId === signal.id);
                        return (
                          <>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-zinc-200">{signal.asset}</span>
                            <RankBadge rank={signal.rank} />
                          </div>
                          <p className="text-[9px] text-zinc-700 mt-1">
                            {signal.direction} · {signal.total}/100 · {timeAgo(signal.createdAt)}
                          </p>
                        </div>
                        <span className="text-[9px] text-zinc-600">{signal.alerts.length} alert(s)</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1 mt-3">
                        {(["macro","structure","zones","technical","timing"] as const).map(key => (
                          <div key={key} className="rounded-lg bg-[#0b0b0b] px-2 py-1.5">
                            <p className="text-[8px] uppercase text-zinc-700">{key.slice(0, 4)}</p>
                            <p className="text-[10px] font-bold text-zinc-200 mt-1">{signal[key]}</p>
                          </div>
                        ))}
                      </div>
                      {signal.alerts.length > 0 && (
                        <div className="mt-3 space-y-1">
                          {signal.alerts.slice(0, 3).map(alert => (
                            <div key={alert.id} className="flex items-center justify-between gap-2 text-[9px]">
                              <span className="text-zinc-700">{alert.channel} · {alert.recipient}</span>
                              <span className={`px-2 py-1 rounded-full border ${toneForStatus(alert.status)}`}>{alert.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {runPlans.length > 0 && (
                        <div className="mt-3 grid grid-cols-1 gap-2">
                          {runPlans.map(plan => (
                            <div key={plan.id} className="rounded-lg bg-[#0b0b0b] px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-black text-zinc-200">{plan.style}</span>
                                  {plan.setupFamily && <span className="text-[8px] text-zinc-600">{plan.setupFamily}</span>}
                                  <span className={`px-2 py-0.5 rounded-full border text-[8px] font-bold ${planStatusTone(plan.status)}`}>{plan.status}</span>
                                </div>
                                <span className="text-[9px] text-zinc-600">{plan.timeframe} · {plan.publicationRank ?? "—"}</span>
                              </div>
                              <p className="text-[9px] text-zinc-700 mt-2">
                                Entry {fmt(plan.entryMin)} - {fmt(plan.entryMax)} · SL {fmt(plan.stopLoss)} · TP2 {fmt(plan.takeProfit2)} · RR {plan.riskRewardRatio != null ? plan.riskRewardRatio.toFixed(2) : "—"}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                          </>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Failure Breakdown</h2>
              <span className="text-[9px] text-zinc-800">{Object.keys(failureBreakdown).length} codes</span>
            </div>
            {Object.keys(failureBreakdown).length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-xs text-zinc-700">No recent failure codes.</p>
                <p className="text-[9px] text-zinc-800 mt-1">Structured failures will aggregate here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(failureBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([code, count]) => (
                    <div key={code} className="flex items-center justify-between rounded-xl border border-zinc-900 bg-zinc-950/60 px-3 py-2">
                      <span className="text-[10px] font-bold text-zinc-200">{code}</span>
                      <span className="text-[10px] font-black text-zinc-400">{count}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Run Timings</h2>
              <span className="text-[9px] text-zinc-800">latest run</span>
            </div>
            {latestRun ? (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Total", value: latestRun.totalDurationMs },
                  { label: "Fetch", value: latestRun.dataFetchDurationMs },
                  { label: "Scoring", value: latestRun.scoringDurationMs },
                  { label: "Persist", value: latestRun.persistenceDurationMs },
                  { label: "Alerts", value: latestRun.alertDispatchDurationMs },
                ].map(item => (
                  <div key={item.label} className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                    <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">{item.label}</p>
                    <p className="text-lg font-black text-zinc-100 mt-1">{fmtMs(item.value)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-xs text-zinc-700">No completed runs yet.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
