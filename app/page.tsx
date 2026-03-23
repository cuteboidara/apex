"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { useSession, signOut } from "next-auth/react";
import { TradingViewChartPanel } from "@/components/TradingViewChartPanel";

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

  // 3-stage AI pipeline fields (populated async after persistence)
  aiExplanation?:       string | null;
  aiRiskAssessment?:    string | null;
  aiMarketContext?:     string | null;
  aiEntryRefinement?:   string | null;
  aiInvalidationLevel?: string | null;
  aiUnifiedAnalysis?:   string | null;
  aiGptConfidence?:     number | null;
  aiClaudeConfidence?:  number | null;
  aiGeminiConfidence?:  number | null;
  aiVerdict?:           string | null;
  aiGeneratedAt?:       string | null;
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
  providerAtSignal: string | null;
  providerHealthStateAtSignal: "HEALTHY" | "DEGRADED" | "UNHEALTHY" | null;
  providerMarketStatusAtSignal: "LIVE" | "DEGRADED" | "UNAVAILABLE" | null;
  providerFallbackUsedAtSignal: boolean;
  qualityGateReason: string | null;
  detectedAt: string | null;
  entryHitAt: string | null;
  stopHitAt: string | null;
  tp1HitAt: string | null;
  tp2HitAt: string | null;
  tp3HitAt: string | null;
  invalidatedAt: string | null;
  expiredAt: string | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  realizedRR: number | null;
  outcome: "PENDING_ENTRY" | "OPEN" | "TP1" | "TP2" | "TP3" | "STOP" | "STOP_AFTER_TP1" | "STOP_AFTER_TP2" | "INVALIDATED" | "EXPIRED" | null;
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
  availability: string;
  blockedReason: string | null;
}

interface SetupBreakdown {
  runId: string | null;
  long: number;
  short: number;
  noSetup: number;
  active: number;
  stale: number;
  total: number;
  directionBalance: string;
  generatedAt: string | null;
}

interface CommentaryStatus {
  provider: string;
  available: boolean;
  status: string;
  detail: string;
  blockedReason: string | null;
}

interface LatestTradePlansResponse {
  runId: string | null;
  plans: Record<string, Record<string, TradePlan>>;
  breakdown: SetupBreakdown;
  timestamp: string;
}

interface PerformanceBucket {
  key: string;
  label: string;
  publishedCount: number;
  enteredCount: number;
  resolvedCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  pendingCount: number;
  openCount: number;
  invalidatedCount: number;
  expiredCount: number;
  winRate: number | null;
  tp1HitRate: number | null;
  tp2HitRate: number | null;
  tp3HitRate: number | null;
  averageRR: number | null;
}

interface StyleGate {
  style: "SCALP" | "INTRADAY" | "SWING";
  disabled: boolean;
  sampleSize: number;
  winRate: number | null;
  averageRR: number | null;
  reason: string | null;
  lookbackDays: number;
  minimumSampleSize: number;
}

interface PerformanceResponse {
  summary: PerformanceBucket;
  breakdowns: {
    bySymbol: PerformanceBucket[];
    byStyle: PerformanceBucket[];
    bySetupFamily: PerformanceBucket[];
    byDirection: PerformanceBucket[];
    byRegime: PerformanceBucket[];
    byProviderHealthState: PerformanceBucket[];
  };
  worstPerformers: {
    setupFamilies: PerformanceBucket[];
    symbols: PerformanceBucket[];
  };
  qualityGate: {
    degradedConfidenceFloor: number;
    byStyle: Record<"SCALP" | "INTRADAY" | "SWING", StyleGate>;
  };
  timestamp: string;
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
    mode: "queue" | "direct";
    connectionSource: string | null;
  };
  providers: ProviderStatus[];
  blockedProviders: ProviderStatus[];
  commentary: CommentaryStatus;
  latestSetupBreakdown: SetupBreakdown;
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

interface CycleNotice {
  tone: "info" | "error";
  message: string;
}

interface CoverageSummary {
  label: string;
  status: string;
  summary: string;
  detail: string;
  providers: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSETS = [
  "EURUSD","GBPUSD","USDJPY","USDCAD","AUDUSD","NZDUSD","USDCHF","EURJPY","GBPJPY",
  "XAUUSD","XAGUSD",
  "BTCUSDT","ETHUSDT",
] as const;
const ASSET_CLASS_ORDER = ["CRYPTO", "FOREX", "COMMODITY"] as const;
const PROVIDER_ORDER = ["Postgres", "Redis", "Anthropic", "OpenAI", "Gemini", "RSS", "FRED", "Telegram", "Yahoo Finance", "Binance"] as const;

const ASSET_CLASS: Record<string, string> = {
  EURUSD: "FOREX", GBPUSD: "FOREX", USDJPY: "FOREX",
  USDCAD: "FOREX", AUDUSD: "FOREX", NZDUSD: "FOREX",
  USDCHF: "FOREX", EURJPY: "FOREX", GBPJPY: "FOREX",
  XAUUSD: "COMMODITY", XAGUSD: "COMMODITY",
  BTCUSDT: "CRYPTO", ETHUSDT: "CRYPTO",
};

const RC: Record<string, { text: string; border: string; bg: string; glow: string }> = {
  S:      { text: "text-green-300", border: "border-green-500/60", bg: "bg-green-500/10", glow: "shadow-green-500/10" },
  A:      { text: "text-green-200", border: "border-green-700/70", bg: "bg-green-500/8", glow: "shadow-green-500/5" },
  B:      { text: "text-green-500", border: "border-green-900/70", bg: "bg-green-950/40", glow: "" },
  Silent: { text: "text-zinc-400", border: "border-zinc-900", bg: "bg-zinc-950/70", glow: "" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dec = 4): string {
  if (n == null || !isFinite(n)) return "—";
  if (Math.abs(n) >= 10000) dec = 2;
  else if (Math.abs(n) >= 100) dec = 3;
  return n.toFixed(dec);
}

function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value == null || !isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtRR(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
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
  if (s === "bullish") return "text-green-300 bg-green-500/10 border-green-500/30";
  if (s === "bearish") return "text-zinc-200 bg-zinc-950 border-zinc-800";
  return "text-zinc-500 bg-zinc-800/40 border-zinc-700/30";
}

function sentimentDot(s: "bullish" | "bearish" | "neutral"): string {
  if (s === "bullish") return "UP";
  if (s === "bearish") return "DN";
  return "FLAT";
}

function toneForStatus(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "delivered" || normalized === "configured" || normalized === "online" || normalized === "healthy" || normalized === "live" || normalized === "ok") {
    return "text-green-300 bg-green-500/10 border-green-500/30";
  }
  if (normalized === "running" || normalized === "waiting" || normalized === "active" || normalized === "processing" || normalized === "degraded") {
    return "text-white bg-zinc-950 border-zinc-800";
  }
  if (normalized === "failed" || normalized === "offline" || normalized === "missing" || normalized === "error" || normalized === "unavailable") {
    return "text-zinc-400 bg-zinc-950/80 border-zinc-900";
  }
  return "text-zinc-400 bg-zinc-900/60 border-zinc-800";
}

function marketStatusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "live" || normalized === "healthy") return "text-green-300 border-green-500/30 bg-green-500/10";
  if (normalized === "degraded" || normalized === "stale") return "text-zinc-300 border-zinc-800 bg-zinc-950";
  return "text-zinc-500 border-zinc-900 bg-zinc-950/80";
}

function deltaTone(value: number): string {
  return value >= 0 ? "text-green-300" : "text-zinc-400";
}

function directionTone(direction: string): string {
  return direction === "LONG"
    ? "bg-green-500/10 border-green-500/30 text-green-300"
    : "bg-zinc-950 border-zinc-800 text-zinc-300";
}

function readinessTone(ready: boolean): string {
  return ready ? "border-green-500/30 text-green-300" : "border-zinc-800 text-zinc-500";
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
  if (status === "ACTIVE") return "text-green-300 bg-green-500/10 border-green-500/30";
  if (status === "STALE") return "text-zinc-300 bg-zinc-950 border-zinc-800";
  return "text-zinc-400 bg-zinc-900/60 border-zinc-800";
}

function outcomeTone(outcome: TradePlan["outcome"]): string {
  if (outcome === "TP1" || outcome === "TP2" || outcome === "TP3" || outcome === "STOP_AFTER_TP1" || outcome === "STOP_AFTER_TP2") {
    return "text-green-300 bg-green-500/10 border-green-500/30";
  }
  if (outcome === "STOP" || outcome === "INVALIDATED" || outcome === "EXPIRED") {
    return "text-zinc-300 bg-zinc-950 border-zinc-800";
  }
  return "text-zinc-500 bg-zinc-900/60 border-zinc-800";
}

function outcomeLabel(outcome: TradePlan["outcome"]): string {
  if (!outcome) return "Pending";
  return outcome.replaceAll("_", " ");
}

function rrTone(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "text-zinc-500";
  if (value > 0) return "text-green-300";
  if (value < 0) return "text-zinc-300";
  return "text-zinc-500";
}

function blockedReasonLabel(reason: string | null | undefined): string {
  if (reason === "credits") return "credits";
  if (reason === "rate_limit") return "rate limit";
  if (reason === "permissions") return "permissions";
  if (reason === "configuration") return "configuration";
  return "blocked";
}

function verdictTone(verdict: string): string {
  if (verdict === "STRONG")   return "border-green-500/30 text-green-300 bg-green-500/10";
  if (verdict === "MODERATE") return "border-yellow-500/30 text-yellow-300 bg-yellow-500/10";
  if (verdict === "WEAK")     return "border-orange-500/30 text-orange-300 bg-orange-500/10";
  if (verdict === "AVOID")    return "border-red-500/30 text-red-300 bg-red-500/10";
  return "border-zinc-800 text-zinc-500 bg-zinc-900/60";
}

function qualityGateLabel(reason: string | null | undefined): string {
  if (reason === "degraded_low_confidence") return "Degraded low-confidence";
  if (reason === "style_disabled_poor_performance") return "Style paused";
  return "No gate";
}

function compactProviderDetail(detail: string): string {
  const normalized = detail.toLowerCase();
  if (normalized.includes("rate_limit_error") || normalized.includes("concurrent connections has exceeded your rate limit")) {
    return "Rate limit reached.";
  }
  if (normalized.includes("credit balance is too low")) return "Credit balance too low.";
  if (normalized.includes("out of api credits")) return "Daily API credits exhausted.";
  if (normalized.includes("exceeded your current quota")) return "Provider quota exhausted.";
  if (normalized.includes("insufficient_quota") || normalized.includes("resource exhausted")) return "Provider quota exhausted.";
  if (normalized.includes("premium endpoint")) return "Endpoint requires a paid plan.";
  if (normalized.includes("api key not valid")) return "Provider rejected the API key.";
  if (normalized.includes("please consider spreading out") || normalized.includes("rate limit")) return "Free-tier rate limit reached.";
  if (normalized.includes("403")) return "Provider rejected the request.";
  if (normalized.includes("signal cycle queue")) return "Background queue unavailable.";
  return detail.length > 120 ? `${detail.slice(0, 117)}...` : detail;
}

function providerRole(provider: ProviderStatus): string {
  if (provider.assetClass === "CRYPTO" && provider.provider === "Binance") return "Primary crypto quotes and candles";
  if (provider.assetClass === "FOREX" && provider.provider === "Yahoo Finance") return "Primary FX quotes and candles";
  if (provider.assetClass === "COMMODITY" && provider.provider === "Yahoo Finance") return "Primary metals quotes and candles";
  if (provider.provider === "Postgres") return "Primary persistence";
  if (provider.provider === "Redis") return "Queue and retries";
  if (provider.provider === "Anthropic") return "Primary reasoning and summaries";
  if (provider.provider === "OpenAI") return "Secondary reasoning fallback";
  if (provider.provider === "Gemini") return "Final reasoning fallback";
  if (provider.provider === "RSS") return "Free market news feeds";
  if (provider.provider === "FRED") return "Macro data";
  if (provider.provider === "Telegram") return "Alert delivery";
  return provider.detail;
}

function compareProviders(a: ProviderStatus, b: ProviderStatus): number {
  const assetOrder = (assetClass: string | null) => {
    if (!assetClass) return -1;
    const index = ASSET_CLASS_ORDER.indexOf(assetClass as (typeof ASSET_CLASS_ORDER)[number]);
    return index === -1 ? ASSET_CLASS_ORDER.length : index;
  };
  const providerOrder = (providerName: string) => {
    const index = PROVIDER_ORDER.indexOf(providerName as (typeof PROVIDER_ORDER)[number]);
    return index === -1 ? PROVIDER_ORDER.length : index;
  };

  return assetOrder(a.assetClass) - assetOrder(b.assetClass) || providerOrder(a.provider) - providerOrder(b.provider);
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
  const color = pct >= 75 ? "#4ade80" : pct >= 50 ? "#22c55e" : "#14532d";
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
  const [planVisible, setPlanVisible] = useState(false);
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
      bg-[#0d0d0d] border rounded-2xl p-3 md:p-4 flex flex-col gap-3 transition-all duration-300 md:min-h-[380px]
      ${rc.border}
      ${fresh ? `shadow-lg ${rc.glow}` : ""}
      ${fresh ? "ring-1 ring-inset ring-white/3" : ""}
    `}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-white">{symbol}</p>
            <span className="text-[8px] text-zinc-700 tracking-widest uppercase border border-zinc-800 rounded px-1.5 py-0.5">
              {livePrice?.assetClass ?? signal?.assetClass ?? ASSET_CLASS[symbol]}
            </span>
            <span className={`text-[8px] tracking-widest px-1.5 py-0.5 rounded border ${marketStatusTone(quoteStatus)}`}>
              {quoteStatus}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-base font-bold tabular-nums text-white">{fmt(price)}</span>
            {chg != null && (
              <span className={`text-[10px] font-semibold tabular-nums ${deltaTone(chg)}`}>
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

          {/* AI Analysis section */}
          {signal.aiUnifiedAnalysis && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/40 p-3 space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-600">AI Analysis</p>
                <span className="text-[7px] font-bold px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-300 bg-blue-500/10">GPT-4</span>
                <span className="text-[7px] font-bold px-1.5 py-0.5 rounded border border-green-500/30 text-green-300 bg-green-500/10">CLAUDE</span>
                <span className="text-[7px] font-bold px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-300 bg-purple-500/10">GEMINI</span>
                {signal.aiVerdict && (
                  <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded border ${verdictTone(signal.aiVerdict)}`}>
                    {signal.aiVerdict}
                  </span>
                )}
              </div>
              <p className="text-[9px] text-zinc-400 leading-relaxed">{signal.aiUnifiedAnalysis}</p>
              {(signal.aiGptConfidence != null || signal.aiClaudeConfidence != null || signal.aiGeminiConfidence != null) && (
                <div className="space-y-1 pt-1">
                  {signal.aiGptConfidence != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-[7px] text-blue-400 w-10 shrink-0">GPT-4</span>
                      <div className="flex-1 h-1 rounded-full bg-zinc-800">
                        <div className="h-1 rounded-full bg-blue-500 transition-all" style={{ width: `${signal.aiGptConfidence}%` }} />
                      </div>
                      <span className="text-[7px] tabular-nums text-blue-400 w-6 text-right">{signal.aiGptConfidence}</span>
                    </div>
                  )}
                  {signal.aiClaudeConfidence != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-[7px] text-green-400 w-10 shrink-0">Claude</span>
                      <div className="flex-1 h-1 rounded-full bg-zinc-800">
                        <div className="h-1 rounded-full bg-green-500 transition-all" style={{ width: `${signal.aiClaudeConfidence}%` }} />
                      </div>
                      <span className="text-[7px] tabular-nums text-green-400 w-6 text-right">{signal.aiClaudeConfidence}</span>
                    </div>
                  )}
                  {signal.aiGeminiConfidence != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-[7px] text-purple-400 w-10 shrink-0">Gemini</span>
                      <div className="flex-1 h-1 rounded-full bg-zinc-800">
                        <div className="h-1 rounded-full bg-purple-500 transition-all" style={{ width: `${signal.aiGeminiConfidence}%` }} />
                      </div>
                      <span className="text-[7px] tabular-nums text-purple-400 w-6 text-right">{signal.aiGeminiConfidence}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-zinc-900/60 pt-2.5">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className={`text-[10px] font-black tracking-widest px-2.5 py-1 rounded-lg border min-h-[44px] flex items-center ${directionTone(signal.direction)}`}>
                {signal.direction === "LONG" ? "▲" : "▼"} {signal.direction}
              </span>
              <span className="hidden md:block text-[9px] text-zinc-700">Latest update {timeAgo(signal.createdAt)}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["SCALP", "INTRADAY", "SWING"] as const).map(style => (
                <button
                  key={style}
                  onClick={() => setActiveStyle(style)}
                  className={`rounded-lg border px-2 py-1.5 text-[9px] font-bold tracking-widest transition-colors ${
                    activeStyle === style
                      ? "border-green-500/30 bg-green-500/10 text-green-300"
                      : "border-zinc-800 text-zinc-500 hover:text-white"
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile: View Plan toggle */}
          <button
            onClick={() => setPlanVisible(v => !v)}
            className="md:hidden w-full text-[9px] font-bold tracking-widest uppercase px-3 py-2.5 rounded-lg border border-zinc-800 text-zinc-400 min-h-[44px] transition-colors hover:border-green-500/30 hover:text-green-300"
          >
            {planVisible ? "Hide Plan ▲" : "View Plan ▼"}
          </button>

          <div className={planVisible ? "" : "hidden md:block"}>
          {activePlan ? (
            <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-black text-white">{activePlan.timeframe}</p>
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
                  <span className={`rounded-full border px-2 py-1 ${readinessTone(livePrice.styleReadiness[activeStyle].ready)}`}>
                    {activeStyle} {livePrice.styleReadiness[activeStyle].ready ? "ready" : "blocked"}
                  </span>
                )}
              </div>
              {livePrice?.styleReadiness && (
                <p className="text-[9px] text-zinc-600">
                  {readinessSummary(livePrice.styleReadiness, activeStyle)}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-lg bg-[#0b0b0b] px-2 py-2">
                  <p className="text-[8px] uppercase tracking-wider text-zinc-700">Outcome</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-full border text-[8px] font-bold ${outcomeTone(activePlan.outcome)}`}>
                      {outcomeLabel(activePlan.outcome)}
                    </span>
                    <span className={`text-[10px] font-bold tabular-nums ${rrTone(activePlan.realizedRR)}`}>
                      {fmtRR(activePlan.realizedRR)}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg bg-[#0b0b0b] px-2 py-2">
                  <p className="text-[8px] uppercase tracking-wider text-zinc-700">Excursion</p>
                  <p className="mt-1 text-[10px] font-bold text-white">
                    MFE {fmtRR(activePlan.maxFavorableExcursion)}
                  </p>
                  <p className="text-[9px] text-zinc-600 mt-0.5">
                    MAE {fmtRR(activePlan.maxAdverseExcursion)}
                  </p>
                </div>
              </div>
              {(activePlan.providerHealthStateAtSignal || activePlan.providerAtSignal) && (
                <p className="text-[9px] text-zinc-600">
                  {activePlan.providerAtSignal ?? "Unknown provider"} · {activePlan.providerHealthStateAtSignal ?? "unknown"}
                  {activePlan.providerMarketStatusAtSignal ? ` · ${activePlan.providerMarketStatusAtSignal.toLowerCase()}` : ""}
                  {activePlan.providerFallbackUsedAtSignal ? " · fallback" : ""}
                </p>
              )}
              {activePlan.qualityGateReason && (
                <div className="rounded-lg border border-zinc-900 bg-[#0b0b0b] px-3 py-2">
                  <p className="text-[9px] text-zinc-400">
                    Quality gate: {qualityGateLabel(activePlan.qualityGateReason)}
                  </p>
                </div>
              )}

              {activePlan.status === "ACTIVE" ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {[
                      { label: "Entry Zone", value: `${fmt(activePlan.entryMin)} - ${fmt(activePlan.entryMax)}`, color: "text-white" },
                      { label: "Stop Loss", value: fmt(activePlan.stopLoss), color: "text-zinc-400" },
                      { label: "TP1", value: fmt(activePlan.takeProfit1), color: "text-white" },
                      { label: "TP2", value: fmt(activePlan.takeProfit2), color: "text-white" },
                      { label: "TP3", value: fmt(activePlan.takeProfit3), color: "text-white" },
                      { label: "R:R", value: activePlan.riskRewardRatio != null ? `${activePlan.riskRewardRatio.toFixed(2)}R` : "—", color: "text-zinc-300" },
                    ].map(item => (
                      <div key={item.label} className="rounded-lg bg-[#0b0b0b] px-2 py-2">
                        <p className="text-[8px] uppercase tracking-wider text-zinc-700">{item.label}</p>
                        <p className={`mt-1 font-bold tabular-nums ${item.color}`}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg bg-[#0b0b0b] px-2 py-2">
                    <p className="text-[8px] uppercase tracking-wider text-zinc-700">Invalidation</p>
                    <p className="mt-1 text-[10px] font-bold tabular-nums text-white">{fmt(activePlan.invalidationLevel)}</p>
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
                    className="text-[9px] text-zinc-500 hover:text-green-300 transition-colors tracking-widest"
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
          </div>{/* end mobile collapsible plan */}
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
          <span className="text-xs font-bold text-white">{signal.asset}</span>
          <span className={`text-[9px] font-bold ${signal.direction === "LONG" ? "text-green-300" : "text-zinc-500"}`}>
            {signal.direction === "LONG" ? "▲" : "▼"}
          </span>
          <span className={`text-[10px] font-black ${rc.text}`}>{signal.total}</span>
        </div>
        <p className="text-[9px] text-zinc-700">{timeAgo(signal.createdAt)}</p>
      </div>
      {signal.sentTelegram && <span className="text-[8px] text-zinc-500 opacity-70">TG</span>}
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
          className={`w-9 h-5 rounded-full border transition-all relative ${enabled ? "bg-green-500/15 border-green-500/40" : "bg-zinc-900 border-zinc-800"}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${enabled ? "left-4 bg-green-400" : "left-0.5 bg-zinc-600"}`} />
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
        <label className="text-[9px] text-zinc-700 tracking-widest uppercase block mb-1.5">Asset Filter</label>
        <input value={assets} onChange={e => setAssets(e.target.value)} placeholder="ALL"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-green-500/40 transition-colors" />
        <p className="text-[8px] text-zinc-800 mt-1">ALL or comma-separated: BTCUSDT,ETHUSDT</p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 tracking-widest uppercase">Weekend Crypto Only</span>
        <button onClick={() => setWeekend(v => !v)}
          className={`w-9 h-5 rounded-full border transition-all relative ${weekend ? "bg-green-500/15 border-green-500/40" : "bg-zinc-900 border-zinc-800"}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${weekend ? "left-4 bg-green-400" : "left-0.5 bg-zinc-600"}`} />
        </button>
      </div>
      <button onClick={save} disabled={saving}
        className="w-full py-2 rounded-xl text-[10px] font-bold tracking-widest uppercase border border-green-500/40 bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-colors">
        {saving ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}

// ─── MobileBottomNav ──────────────────────────────────────────────────────────

function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-black/95 border-t border-zinc-900 backdrop-blur-sm pb-safe">
      <div className="flex items-center justify-around px-2 py-1">
        {([
          { href: "#section-dashboard", label: "Dashboard", icon: "⬡" },
          { href: "#section-signals",   label: "Signals",   icon: "◈" },
          { href: "#section-chart",     label: "Chart",     icon: "◱" },
          { href: "#section-settings",  label: "Settings",  icon: "⚙" },
        ] as const).map(({ href, label, icon }) => (
          <a
            key={label}
            href={href}
            className="flex flex-col items-center justify-center min-w-[44px] min-h-[44px] gap-0.5 text-zinc-500 active:text-green-300 transition-colors"
          >
            <span className="text-base leading-none">{icon}</span>
            <span className="text-[8px] uppercase tracking-widest">{label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

// ─── TickerBar ────────────────────────────────────────────────────────────────

function TickerItem({ p }: { p: LivePrice }) {
  const up = (p.changePct ?? 0) >= 0;
  return (
    <div className="flex items-center gap-2 px-4 border-r border-zinc-900/60 shrink-0">
      <span className="text-[10px] md:text-[10px] font-black tracking-wider text-zinc-400">{p.symbol}</span>
      <span className={`text-[8px] px-1.5 py-0.5 rounded border ${marketStatusTone(p.marketStatus)}`}>
        {p.provider}
      </span>
      <span className="text-[10px] md:text-[11px] font-bold tabular-nums text-white">
        {p.currentPrice != null && p.currentPrice > 0 ? fmt(p.currentPrice) : "—"}
      </span>
      {p.marketStatus === "LIVE" && p.changePct != null && (
        <span className={`text-[9px] font-semibold tabular-nums ${up ? "text-green-300" : "text-zinc-500"}`}>
          {up ? "▲" : "▼"} {Math.abs(p.changePct).toFixed(2)}%
        </span>
      )}
      {p.marketStatus !== "LIVE" && (
        <span className={`text-[8px] ${p.marketStatus === "UNAVAILABLE" ? "text-zinc-500" : "text-zinc-400"}`}>
          {p.marketStatus}
        </span>
      )}
    </div>
  );
}

function TickerBar({ prices }: { prices: LivePrice[] }) {
  if (prices.length === 0) return null;
  const items = [...prices, ...prices]; // duplicate for seamless loop

  return (
    <div className="border-b border-zinc-900/80 bg-black">
      {/* Mobile: touch-scrollable, no animation */}
      <div className="md:hidden overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" } as CSSProperties}>
        <div className="flex py-1.5 w-max">
          {prices.map((p, i) => <TickerItem key={i} p={p} />)}
        </div>
      </div>
      {/* Desktop: infinite scroll animation */}
      <div className="hidden md:block overflow-hidden">
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
          {items.map((p, i) => <TickerItem key={i} p={p} />)}
        </div>
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
    <div className="bg-black border-b border-zinc-900 px-4 py-2 flex items-center gap-3">
      <span className="text-green-300 text-[10px] font-black tracking-widest shrink-0 animate-pulse">BREAKING</span>
      <p className="text-xs text-white flex-1 truncate">{item.headline}</p>
      <div className="flex items-center gap-2 shrink-0">
        {item.affectedAssets.slice(0, 3).map(a => (
          <span key={a} className="text-[8px] text-zinc-500 border border-zinc-900 rounded px-1 py-0.5">{a}</span>
        ))}
        <button onClick={() => onDismiss(item.id)}
          className="text-zinc-600 hover:text-zinc-300 text-xs transition-colors ml-1">✕</button>
      </div>
    </div>
  );
}

function OpsMetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
      <p className="text-[9px] text-green-400 tracking-[0.22em] uppercase">{label}</p>
      <p className="text-2xl font-black text-white mt-2">{value}</p>
      <p className="text-[10px] text-zinc-600 mt-1">{detail}</p>
    </div>
  );
}

function PerformanceMetricCard({ label, value, detail, accent }: {
  label: string;
  value: string;
  detail: string;
  accent?: string;
}) {
  return (
    <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
      <p className="text-[9px] text-zinc-600 tracking-[0.22em] uppercase">{label}</p>
      <p className={`text-2xl font-black mt-2 ${accent ?? "text-white"}`}>{value}</p>
      <p className="text-[10px] text-zinc-600 mt-1">{detail}</p>
    </div>
  );
}

function PerformanceListPanel({ title, subtitle, items, empty }: {
  title: string;
  subtitle: string;
  items: PerformanceBucket[];
  empty: string;
}) {
  return (
    <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">{title}</h3>
        <span className="text-[9px] text-zinc-800">{subtitle}</span>
      </div>
      {items.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xs text-zinc-700">{empty}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.key} className="rounded-xl border border-zinc-900 bg-zinc-950/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-zinc-200">{item.label}</span>
                <span className={`text-[10px] font-black ${rrTone(item.averageRR)}`}>{fmtRR(item.averageRR)}</span>
              </div>
              <p className="text-[9px] text-zinc-600 mt-1">
                Win {fmtPct(item.winRate)} · TP1 {fmtPct(item.tp1HitRate)} · {item.resolvedCount} resolved
              </p>
            </div>
          ))}
        </div>
      )}
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
        <p className="text-[9px] text-zinc-400 mt-2 leading-relaxed">{run.failureReason}</p>
      )}
      {run.failureCode && (
        <p className="text-[9px] text-zinc-500 mt-1">{run.failureCode}</p>
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
        <p className="text-[9px] text-zinc-400 mt-2 leading-relaxed">{alert.failureReason}</p>
      )}
    </div>
  );
}

function ProviderHealthRow({ provider }: { provider: ProviderStatus }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-zinc-900 bg-zinc-950/60 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] font-bold text-zinc-200">
            {provider.assetClass ? `${provider.assetClass} · ${provider.provider}` : provider.provider}
          </p>
          {provider.availability === "blocked" && (
            <span className="text-[8px] font-bold px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300">
              {blockedReasonLabel(provider.blockedReason)}
            </span>
          )}
        </div>
        <p className="text-[9px] text-zinc-500 mt-1">{providerRole(provider)}</p>
        <p className="text-[9px] text-zinc-700 mt-1">
          {compactProviderDetail(provider.detail)}
          {provider.latencyMs != null ? ` · ${provider.latencyMs}ms` : ""}
          {provider.score != null ? ` · score ${provider.score}` : ""}
          {provider.circuitState ? ` · circuit ${provider.circuitState.toLowerCase()}` : ""}
        </p>
      </div>
      <span className={`text-[8px] font-bold px-2 py-1 rounded-full border whitespace-nowrap ${toneForStatus(provider.status)}`}>
        {provider.status}
      </span>
    </div>
  );
}

function ProviderHealthPanel({ providers }: { providers: ProviderStatus[] }) {
  const coreProviders = providers.filter(provider => !provider.assetClass).sort(compareProviders);
  const marketProviders = providers.filter(provider => provider.assetClass).sort(compareProviders);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[8px] font-bold tracking-[0.18em] uppercase text-zinc-600">Core APIs</p>
        {coreProviders.map(provider => (
          <ProviderHealthRow key={provider.provider} provider={provider} />
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-[8px] font-bold tracking-[0.18em] uppercase text-zinc-600">Market Data APIs</p>
        {marketProviders.map(provider => (
          <ProviderHealthRow key={`${provider.assetClass}:${provider.provider}`} provider={provider} />
        ))}
      </div>
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
      {job.failedReason && <p className="text-[9px] text-zinc-400 mt-2">{job.failedReason}</p>}
      {job.status === "failed" && (
        <button
          onClick={() => onRetry(job.id)}
          className="mt-3 text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-green-500/40 bg-green-600 text-white hover:bg-green-500 transition-colors"
        >
          Retry Job
        </button>
      )}
    </div>
  );
}

function CoverageSummaryCard({ item }: { item: CoverageSummary }) {
  return (
    <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] text-green-400 tracking-[0.22em] uppercase">{item.label}</p>
        <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(item.status)}`}>
          {item.status}
        </span>
      </div>
      <p className="text-lg font-black text-white mt-3">{item.summary}</p>
      <p className="text-[10px] text-zinc-600 mt-1">{item.providers}</p>
      <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">{item.detail}</p>
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
                ? "border-green-500 text-green-300"
                : "border-transparent text-zinc-600 hover:text-white"
            }`}>
            {t.label}
            {t.count > 0 && (
              <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${tab === t.id ? "bg-green-500/10 text-green-300" : "bg-zinc-800 text-zinc-600"}`}>
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
                          <span className="text-[8px] font-black tracking-widest bg-zinc-900 text-zinc-300 border border-zinc-700 rounded px-1.5 py-0.5">
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
              <div key={i} className={`px-4 py-3 ${ev.isToday ? "bg-zinc-950 border-l-2 border-zinc-700/50" : ""}`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-lg leading-none">{ev.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      {ev.imminent && (
                        <span className="text-[8px] font-black text-zinc-300 animate-pulse">IMMINENT</span>
                      )}
                      {ev.isToday && !ev.imminent && (
                        <span className="text-[8px] font-bold text-zinc-300">TODAY</span>
                      )}
                      <span className="text-[8px] font-black text-zinc-400 tracking-widest bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5">
                        HIGH IMPACT
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-zinc-200">{ev.event}</p>
                    <div className="flex items-center gap-3 mt-1 text-[9px] text-zinc-600">
                      <span>{ev.date} {ev.time}</span>
                      {ev.forecast != null && <span>Fcst: <span className="text-zinc-400">{ev.forecast}{ev.unit}</span></span>}
                      {ev.previous != null && <span>Prev: <span className="text-zinc-500">{ev.previous}{ev.unit}</span></span>}
                      {ev.actual   != null && <span>Act: <span className="text-zinc-200">{ev.actual}{ev.unit}</span></span>}
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
                        <span className="text-[8px] font-black tracking-widest bg-zinc-900 text-zinc-300 border border-zinc-700 rounded px-1.5 py-0.5">
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
  const { data: session } = useSession();

  // ── Mobile UI state ───────────────────────────────────────────────────────
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAllSignals, setShowAllSignals] = useState(false);

  // ── Existing state ────────────────────────────────────────────────────────
  const [latestSignals, setLatestSignals] = useState<Record<string, Signal>>({});
  const [latestTradePlans, setLatestTradePlans] = useState<Record<string, Record<string, TradePlan>>>({});
  const [setupBreakdown, setSetupBreakdown] = useState<SetupBreakdown | null>(null);
  const [signalFeed,    setSignalFeed]    = useState<Signal[]>([]);
  const [tgSettings,    setTgSettings]    = useState<TelegramSettings | null>(null);
  const [cycleRunning,  setCycleRunning]  = useState(false);
  const [cycleNotice,   setCycleNotice]   = useState<CycleNotice | null>(null);
  const [showTelegram,  setShowTelegram]  = useState(false);
  const [now,           setNow]           = useState(new Date());
  const [lastRefresh,   setLastRefresh]   = useState<Date | null>(null);
  const [runs,          setRuns]          = useState<SignalRunRecord[]>([]);
  const [alerts,        setAlerts]        = useState<AlertRecord[]>([]);
  const [system,        setSystem]        = useState<SystemStatus | null>(null);
  const [queueJobs,     setQueueJobs]     = useState<QueueJob[]>([]);
  const [performance,   setPerformance]   = useState<PerformanceResponse | null>(null);
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
    const [latestRes, plansRes, feedRes, tgRes, performanceRes] = await Promise.allSettled([
      fetch("/api/signals/latest").then(r => r.json()),
      fetch("/api/trade-plans/latest").then(r => r.json()),
      fetch("/api/signals?rank=S,A&limit=20").then(r => r.json()),
      fetch("/api/telegram/settings").then(r => r.json()),
      fetch("/api/performance").then(r => r.json()),
    ]);
    if (latestRes.status === "fulfilled") setLatestSignals(latestRes.value ?? {});
    if (plansRes.status === "fulfilled") {
      const payload = plansRes.value as unknown;
      if (
        payload &&
        typeof payload === "object" &&
        "plans" in payload &&
        "breakdown" in payload
      ) {
        const response = payload as LatestTradePlansResponse;
        setLatestTradePlans(response.plans ?? {});
        setSetupBreakdown(response.breakdown ?? null);
      } else {
        setLatestTradePlans((payload as Record<string, Record<string, TradePlan>>) ?? {});
        setSetupBreakdown(null);
      }
    }
    if (feedRes.status   === "fulfilled") setSignalFeed(feedRes.value   ?? []);
    if (tgRes.status     === "fulfilled") setTgSettings(tgRes.value     ?? null);
    if (performanceRes.status === "fulfilled") setPerformance(performanceRes.value ?? null);
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
    setCycleNotice(null);
    try {
      const res  = await fetch("/api/cycle", { method: "POST" });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to run cycle");
      }

      if (body?.mode === "direct") {
        setCycleNotice({
          tone: "info",
          message: "Signal cycle completed inline because Redis is unavailable.",
        });
        await Promise.allSettled([fetchData(), fetchOps()]);
      } else {
        setCycleNotice({
          tone: "info",
          message: "Signal cycle queued for worker execution.",
        });
        window.setTimeout(() => {
          fetchData().catch(() => null);
          fetchOps().catch(() => null);
        }, 5000);
      }
    } catch (error) {
      setCycleNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to run cycle.",
      });
    }
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
    if (!queueAvailable) {
      setCycleNotice({
        tone: "info",
        message: "Redis queue is unavailable. Use Run Cycle to execute inline.",
      });
      return;
    }
    setCycleRunning(true);
    setCycleNotice(null);
    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue_cycle" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Failed to enqueue cycle");
      }
      setCycleNotice({
        tone: "info",
        message: "Signal cycle queued for worker execution.",
      });
      window.setTimeout(() => {
        fetchOps().catch(() => null);
      }, 1500);
    } catch (error) {
      setCycleNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to enqueue cycle.",
      });
    }
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
  const queueAvailable = system?.queue.status?.toLowerCase() === "online";
  const deliveredAlerts = alerts.filter(a => a.status === "DELIVERED").length;
  const failedAlerts = alerts.filter(a => a.status === "FAILED").length;
  const configuredProviderCount = system
    ? system.providers.filter(provider => provider.availability === "available").length
    : 0;
  const coreProviders = system?.providers.filter(provider => !provider.assetClass) ?? [];
  const coreIssues = coreProviders.filter(provider => provider.availability !== "available");
  const marketCoverage: CoverageSummary[] = system ? (ASSET_CLASS_ORDER as readonly string[]).map(assetClass => {
    const assetProviders = system.providers.filter(provider => provider.assetClass === assetClass);
    const assetQuotes = livePrices.filter(price => price.assetClass === assetClass);
    const expectedSymbols = ASSETS.filter(symbol => ASSET_CLASS[symbol] === assetClass).length;
    const liveQuotes = assetQuotes.filter(price => price.marketStatus === "LIVE" && price.currentPrice != null);
    const issueDetails = assetProviders
      .filter(provider => provider.availability !== "available")
      .map(provider => `${provider.provider}: ${compactProviderDetail(provider.detail)}`)
      .slice(0, 2);
    const providerList = Array.from(new Set(assetProviders.map(provider => provider.provider))).join(" · ") || "No provider data";
    const label = assetClass === "COMMODITY" ? "Metals" : assetClass === "FOREX" ? "Forex" : "Crypto";

    if (liveQuotes.length > 0) {
      return {
        label,
        status: "LIVE",
        summary: `${liveQuotes.length}/${expectedSymbols} live quotes`,
        providers: providerList,
        detail: `${providerList} are returning usable prices for this asset class.`,
      };
    }

    return {
      label,
      status: assetProviders.length > 0 ? "DEGRADED" : "MISSING",
      summary: assetProviders.length > 0 ? "Configured but blocked" : "No provider data",
      providers: providerList,
      detail: issueDetails.join(" · ") || "Awaiting market data checks.",
    };
  }) : [];
  const serviceCoverage: CoverageSummary[] = system ? [{
    label: "Core Services",
    status: queueAvailable && coreIssues.length === 0 ? "ONLINE" : "DEGRADED",
    summary: queueAvailable ? "Control plane available" : "Run Cycle executes inline",
    providers: "Postgres · Redis · Anthropic/OpenAI/Gemini · Telegram",
      detail: coreIssues.length > 0
        ? coreIssues.map(provider => `${provider.provider}: ${compactProviderDetail(provider.detail)}`).join(" · ")
        : "Postgres persistence, Redis queueing, the LLM explanation chain, and Telegram delivery are responding normally.",
  }] : [];
  const coverageSummaries = [...marketCoverage, ...serviceCoverage];
  const degradedCoverage = marketCoverage.filter(item => item.status !== "LIVE");
  const latestSetupMix = system?.latestSetupBreakdown ?? setupBreakdown;
  const performanceSummary = performance?.summary ?? null;
  const longPerformance = performance?.breakdowns.byDirection.find(item => item.key === "LONG") ?? null;
  const shortPerformance = performance?.breakdowns.byDirection.find(item => item.key === "SHORT") ?? null;
  const directionPerformance = [longPerformance, shortPerformance].filter((item): item is PerformanceBucket => Boolean(item));
  const scalpGate = performance?.qualityGate.byStyle.SCALP ?? null;
  const systemNotice = system
    ? [
        queueAvailable
          ? `Queue is online${system.queue.connectionSource ? ` via ${system.queue.connectionSource}` : ""}.`
          : "Queue is offline, so Run Cycle executes inline.",
        system.commentary.available
          ? "Commentary provider is available."
          : `Commentary provider unavailable${system.commentary.blockedReason ? ` due to ${blockedReasonLabel(system.commentary.blockedReason)}` : ""}.`,
        marketCoverage.find(item => item.label === "Crypto")?.status === "LIVE"
          ? "Crypto market data is live."
          : "Crypto market data is degraded.",
        degradedCoverage
          .filter(item => item.label !== "Crypto")
          .length > 0
          ? `${degradedCoverage
            .filter(item => item.label !== "Crypto")
            .map(item => item.label.toLowerCase())
            .join(" and ")} feeds are configured but currently blocked by provider limits or plan restrictions.`
          : "Forex and metals feeds are responding normally.",
      ].join(" ")
    : null;

  // Breaking news: < 15 min old, non-neutral, not dismissed
  const breakingItems = newsItems.filter(n => {
    if (dismissedIds.has(n.id)) return false;
    if (n.sentiment === "neutral") return false;
    return Date.now() - new Date(n.publishedAt).getTime() < 15 * 60 * 1000;
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white pb-16 md:pb-0">
      <MobileBottomNav />

      {/* ── BREAKING BANNER ─────────────────────────────────────────────── */}
      <BreakingBanner
        items={breakingItems}
        onDismiss={id => setDismissedIds(prev => new Set([...prev, id]))}
      />

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header id="section-dashboard" className="border-b border-zinc-900/80 px-4 sm:px-6 py-3 sticky top-0 z-30 bg-black/95 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center border border-green-500/30">
              <div className="w-2.5 h-2.5 rounded-sm bg-green-400" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-[0.28em] uppercase text-white">APEX</h1>
              <p className="text-[8px] text-green-400 tracking-[0.3em] uppercase hidden sm:block">Institutional Signal Operations</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-5">
            <div className="text-right">
              <p className="text-[8px] text-zinc-700 tracking-widest uppercase">UTC Time</p>
              <p className="text-xs font-black tabular-nums text-white">{fmtTime(now)}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] text-zinc-700 tracking-widest uppercase">Last Cycle</p>
              <p className="text-xs font-black tabular-nums text-white">{lastCycleStr}</p>
            </div>
            <div className="text-right">
              <p className="text-[8px] text-zinc-700 tracking-widest uppercase">Active Signals</p>
              <p className={`text-xs font-black tabular-nums ${activeSignals > 0 ? "text-green-300" : "text-zinc-600"}`}>
                {activeSignals} / {Object.keys(latestSignals).length || "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Desktop buttons */}
            {session?.user?.name && (
              <span className="hidden md:block text-[10px] text-zinc-500 font-medium">
                {session.user.name}
              </span>
            )}
            <button onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="hidden md:block text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:border-red-500/30 hover:text-red-400 transition-colors">
              Sign Out
            </button>
            <button onClick={() => setShowTelegram(v => !v)}
              className={`hidden md:block text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border transition-all ${
                showTelegram ? "border-green-500/40 text-green-300 bg-green-500/10" : "border-zinc-800 text-zinc-400 hover:border-green-500/30 hover:text-green-300"
              }`}>
              TG Settings
            </button>
            {/* Run Cycle — always visible */}
            <button onClick={runCycle} disabled={cycleRunning}
              className="text-[10px] font-bold tracking-widest uppercase px-3 py-2 md:py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-colors min-h-[44px] md:min-h-0">
              {cycleRunning ? "Running…" : "⬡ Run Cycle"}
            </button>
            {/* Enqueue — desktop only */}
            <button onClick={enqueueCycleManually} disabled={cycleRunning || !queueAvailable}
              className="hidden md:block text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:border-green-500/30 hover:text-green-300 disabled:opacity-40 disabled:hover:border-zinc-800 disabled:hover:text-zinc-300 transition-colors">
              {queueAvailable ? "Enqueue" : "Queue Offline"}
            </button>
            {/* Hamburger — mobile only */}
            <button
              onClick={() => setMobileMenuOpen(v => !v)}
              className="md:hidden flex flex-col items-center justify-center gap-1 w-10 h-10 rounded-lg border border-zinc-800 text-zinc-400"
              aria-label="Menu"
            >
              <span className="w-4 h-0.5 bg-current" />
              <span className="w-4 h-0.5 bg-current" />
              <span className="w-4 h-0.5 bg-current" />
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-zinc-900/60 mt-3 pt-3 pb-1 space-y-2 fade-in">
            <div className="flex gap-3 text-[9px] text-zinc-500 px-1 pb-1">
              <span>UTC {fmtTime(now)}</span>
              <span>·</span>
              <span>Last cycle {lastCycleStr}</span>
              <span>·</span>
              <span className={activeSignals > 0 ? "text-green-300" : "text-zinc-600"}>
                {activeSignals} active
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { enqueueCycleManually(); setMobileMenuOpen(false); }} disabled={cycleRunning || !queueAvailable}
                className="text-[10px] font-bold tracking-widest uppercase px-3 py-2.5 rounded-lg border border-zinc-800 text-zinc-300 disabled:opacity-40 transition-colors min-h-[44px]">
                {queueAvailable ? "Enqueue" : "Queue Offline"}
              </button>
              <button onClick={() => { setShowTelegram(v => !v); setMobileMenuOpen(false); }}
                className={`text-[10px] font-bold tracking-widest uppercase px-3 py-2.5 rounded-lg border min-h-[44px] transition-all ${
                  showTelegram ? "border-green-500/40 text-green-300 bg-green-500/10" : "border-zinc-800 text-zinc-400"
                }`}>
                TG Settings
              </button>
              <button onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                className="text-[10px] font-bold tracking-widest uppercase px-3 py-2.5 rounded-lg border border-zinc-800 text-zinc-400 min-h-[44px] transition-colors">
                Sign Out{session?.user?.name ? ` (${session.user.name})` : ""}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── LIVE TICKER ─────────────────────────────────────────────────── */}
      <TickerBar prices={livePrices} />

      <div className="max-w-[1600px] mx-auto px-4 py-5">

        {cycleNotice && (
          <div
            className={`mb-5 rounded-2xl border px-4 py-3 text-[10px] font-bold tracking-[0.18em] uppercase ${
              cycleNotice.tone === "error"
                ? "border-zinc-800 bg-zinc-950 text-zinc-200"
                : "border-green-500/20 bg-green-500/8 text-green-300"
            }`}
          >
              {cycleNotice.message}
          </div>
        )}

        {systemNotice && (
          <div className="mb-5 rounded-2xl border border-zinc-800 bg-[#0d0d0d] px-4 py-3">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-green-400">System Mode</p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-500">{systemNotice}</p>
          </div>
        )}

        {coverageSummaries.length > 0 && (
          <div className="mb-5 grid grid-cols-2 xl:grid-cols-4 gap-3">
            {coverageSummaries.map(item => (
              <CoverageSummaryCard key={item.label} item={item} />
            ))}
          </div>
        )}

        {/* ── Telegram settings panel ───────────────────────────────────── */}
        <div id="section-settings" />
        {showTelegram && (
          <div className="bg-[#0d0d0d] border border-zinc-800 rounded-2xl p-5 mb-5 fade-in max-w-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-white">Telegram Settings</h2>
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
          <div className="bg-[#0d0d0d] border border-zinc-800 rounded-2xl p-4 mb-5 fade-in">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <p className="text-xs text-white font-bold tracking-widest">
                Executing institutional signal cycle…
              </p>
              <span className="text-[9px] text-zinc-700 ml-auto">control plane</span>
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
            value={system ? `${configuredProviderCount}/${system.providers.length}` : "—"}
            detail={system ? "Configured or online dependencies" : "No provider data"}
          />
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Execution Diagnostics</h2>
            <span className="text-[9px] text-zinc-800">
              {performance ? `${performance.summary.publishedCount} published · ${performance.summary.resolvedCount} resolved` : "Awaiting tracked outcomes"}
            </span>
          </div>
          <div className="overflow-x-auto mb-5">
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 min-w-[560px] xl:min-w-0">
            <PerformanceMetricCard
              label="Win Rate"
              value={fmtPct(performanceSummary?.winRate)}
              detail={performanceSummary ? `${performanceSummary.wins} wins · ${performanceSummary.losses} losses` : "Waiting for resolved trades"}
              accent="text-green-300"
            />
            <PerformanceMetricCard
              label="TP1 Hit"
              value={fmtPct(performanceSummary?.tp1HitRate)}
              detail={performanceSummary ? `${performanceSummary.enteredCount} entered plans` : "No entered plans yet"}
            />
            <PerformanceMetricCard
              label="TP2 Hit"
              value={fmtPct(performanceSummary?.tp2HitRate)}
              detail={performanceSummary ? `${performanceSummary.resolvedCount} resolved with RR` : "No resolved plans yet"}
            />
            <PerformanceMetricCard
              label="TP3 Hit"
              value={fmtPct(performanceSummary?.tp3HitRate)}
              detail={performanceSummary ? `${performanceSummary.openCount} still open` : "No tracked outcomes yet"}
            />
            <PerformanceMetricCard
              label="Average RR"
              value={fmtRR(performanceSummary?.averageRR)}
              detail={performanceSummary ? `${performanceSummary.pendingCount} pending · ${performanceSummary.invalidatedCount} invalidated` : "No realized RR yet"}
              accent={rrTone(performanceSummary?.averageRR)}
            />
          </div>
          </div>{/* end overflow-x-auto */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
            <PerformanceListPanel
              title="Worst Setup Families"
              subtitle="lowest avg RR"
              items={performance?.worstPerformers.setupFamilies ?? []}
              empty="No setup-family samples have cleared the minimum resolved count."
            />
            <PerformanceListPanel
              title="Worst Symbols"
              subtitle="lowest avg RR"
              items={performance?.worstPerformers.symbols ?? []}
              empty="No symbol samples have cleared the minimum resolved count."
            />
            <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Long Vs Short</h3>
                <span className="text-[9px] text-zinc-800">
                  {performance ? `${performance.breakdowns.byDirection.length} sides` : "No samples"}
                </span>
              </div>
              <div className="space-y-2">
                {directionPerformance.map(item => (
                  <div key={item.key} className="rounded-xl border border-zinc-900 bg-zinc-950/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-zinc-200">{item.label}</span>
                      <span className={`text-[10px] font-black ${rrTone(item.averageRR)}`}>{fmtRR(item.averageRR)}</span>
                    </div>
                    <p className="text-[9px] text-zinc-600 mt-1">
                      Win {fmtPct(item.winRate)} · TP1 {fmtPct(item.tp1HitRate)} · {item.resolvedCount} resolved
                    </p>
                  </div>
                ))}
                {!performance && (
                  <div className="py-8 text-center">
                    <p className="text-xs text-zinc-700">Direction performance unavailable.</p>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-[#0d0d0d] border border-zinc-900 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] font-bold tracking-[0.22em] uppercase text-zinc-600">Quality Gate</h3>
                <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(scalpGate?.disabled ? "degraded" : "online")}`}>
                  {scalpGate?.disabled ? "scalp paused" : "scalp live"}
                </span>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                  <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Degraded Confidence Floor</p>
                  <p className="text-lg font-black text-zinc-100 mt-1">{performance?.qualityGate.degradedConfidenceFloor ?? "—"}</p>
                  <p className="text-[9px] text-zinc-500 mt-1">Degraded market data suppresses setups below this confidence.</p>
                </div>
                <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                  <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Scalp Gate</p>
                  <p className="text-[10px] font-bold text-zinc-100 mt-2">
                    {scalpGate ? `${scalpGate.sampleSize} samples · win ${fmtPct(scalpGate.winRate)} · avg ${fmtRR(scalpGate.averageRR)}` : "No scalp samples yet"}
                  </p>
                  <p className="text-[9px] text-zinc-500 mt-1">
                    {scalpGate?.reason ?? "Scalp remains enabled unless recent tracked performance degrades."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div id="section-chart">
          <TradingViewChartPanel latestTradePlans={latestTradePlans} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">

          {/* ── ASSET GRID ────────────────────────────────────────────── */}
          <div className="xl:col-span-3" id="section-signals">
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
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <h3 className="text-[10px] font-bold tracking-[0.22em] uppercase text-green-400">Signal Feed</h3>
                </div>
                <span className="text-[9px] text-zinc-800">A+ only</span>
              </div>
              {signalFeed.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-zinc-800 text-xs">No A/S signals yet.</p>
                  <p className="text-zinc-900 text-[9px] mt-1">Run a cycle to generate signals.</p>
                </div>
              ) : (
                <>
                  <div className="space-y-0">
                    {(showAllSignals ? signalFeed : signalFeed.slice(0, 3)).map(s => (
                      <SignalFeedItem key={s.id} signal={s} />
                    ))}
                  </div>
                  {signalFeed.length > 3 && (
                    <button
                      onClick={() => setShowAllSignals(v => !v)}
                      className="md:hidden mt-2 w-full text-[9px] font-bold tracking-widest uppercase px-3 py-2 rounded-lg border border-zinc-800 text-zinc-500 min-h-[44px] transition-colors"
                    >
                      {showAllSignals ? `Show less ▲` : `View all ${signalFeed.length} ▼`}
                    </button>
                  )}
                </>
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
                        <span className="text-[9px] text-zinc-700 tracking-widest uppercase">{label}</span>
                        <div className="flex items-center gap-1.5">
                          {trend && (
                            <span className={`text-[8px] ${trend === "rising" ? "text-zinc-400" : trend === "falling" ? "text-zinc-300" : "text-zinc-700"}`}>
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
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-green-400">Market Intelligence</h2>
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
                  queue {String(system.queue.status).toUpperCase()}
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
                <div className="grid grid-cols-1 gap-2 mb-4">
                  <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Runtime</p>
                      <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(system.queue.status)}`}>
                        {system.queue.mode}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-zinc-100 mt-2">
                      Queue {String(system.queue.status).toUpperCase()}
                      {system.queue.connectionSource ? ` via ${system.queue.connectionSource}` : ""}
                    </p>
                    <p className="text-[9px] text-zinc-500 mt-1">
                      {system.queue.failureReason ?? "Redis-backed queue is reachable."}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Commentary</p>
                      <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(system.commentary.available ? "online" : "unavailable")}`}>
                        {system.commentary.available ? "available" : "unavailable"}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-zinc-100 mt-2">{system.commentary.provider}</p>
                    <p className="text-[9px] text-zinc-500 mt-1">
                      {system.commentary.blockedReason
                        ? `${blockedReasonLabel(system.commentary.blockedReason)} · ${compactProviderDetail(system.commentary.detail)}`
                        : compactProviderDetail(system.commentary.detail)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Provider Blocks</p>
                      <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(system.blockedProviders.length > 0 ? "degraded" : "online")}`}>
                        {system.blockedProviders.length}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-zinc-100 mt-2">
                      {system.blockedProviders.length > 0 ? system.blockedProviders.map(provider => provider.provider).join(" · ") : "No provider blocks"}
                    </p>
                    <p className="text-[9px] text-zinc-500 mt-1">
                      {system.blockedProviders.length > 0
                        ? system.blockedProviders
                            .slice(0, 3)
                            .map(provider => `${provider.provider}: ${blockedReasonLabel(provider.blockedReason)}`)
                            .join(" · ")
                        : "Credits, rate limits, and permission blocks appear here."}
                    </p>
                  </div>
                  <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[8px] uppercase tracking-[0.22em] text-zinc-700">Latest Setup Mix</p>
                      <span className={`text-[8px] font-bold px-2 py-1 rounded-full border ${toneForStatus(latestSetupMix?.directionBalance === "balanced" ? "online" : latestSetupMix?.active ? "degraded" : "unavailable")}`}>
                        {latestSetupMix?.directionBalance ?? "unknown"}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-zinc-100 mt-2">
                      LONG {latestSetupMix?.long ?? "—"} · SHORT {latestSetupMix?.short ?? "—"} · NO_SETUP {latestSetupMix?.noSetup ?? "—"}
                    </p>
                    <p className="text-[9px] text-zinc-500 mt-1">
                      {latestSetupMix?.runId
                        ? `Latest run ${latestSetupMix.runId} · ${latestSetupMix.total} plans`
                        : "Latest setup-direction breakdown unavailable."}
                    </p>
                  </div>
                </div>
                <ProviderHealthPanel providers={system.providers} />
                <div className="mt-4 flex gap-2 flex-wrap">
                  <button
                    onClick={toggleAlertsPause}
                    className={`text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border transition-colors ${
                      alertSendingPaused ? "border-zinc-700 text-zinc-300" : "border-zinc-800 text-zinc-500"
                    }`}
                  >
                    {alertSendingPaused ? "Resume Alerts" : "Pause Alerts"}
                  </button>
                  <button
                    onClick={() => requeueFailedAlerts()}
                    className="text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:border-green-500/30 hover:text-green-300 transition-colors"
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
                    <p className="text-[9px] text-zinc-400 mt-2">{selectedRun.failureReason}</p>
                  )}
                  {selectedRun.failureCode && (
                    <p className="text-[9px] text-zinc-500 mt-1">{selectedRun.failureCode}</p>
                  )}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <button
                      onClick={() => retryFailedRun(selectedRun.id)}
                      disabled={selectedRun.status !== "FAILED"}
                      className="text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-green-500/40 bg-green-600 text-white hover:bg-green-500 disabled:opacity-40 transition-colors"
                    >
                      Retry Failed Run
                    </button>
                    <button
                      onClick={() => requeueFailedAlerts(selectedRun.id)}
                      className="text-[9px] font-bold tracking-widest uppercase px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-300 hover:border-green-500/30 hover:text-green-300 transition-colors"
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
                                  {plan.outcome && (
                                    <span className={`px-2 py-0.5 rounded-full border text-[8px] font-bold ${outcomeTone(plan.outcome)}`}>
                                      {outcomeLabel(plan.outcome)}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[9px] text-zinc-600">{plan.timeframe} · {plan.publicationRank ?? "—"}</span>
                              </div>
                              <p className="text-[9px] text-zinc-700 mt-2">
                                Entry {fmt(plan.entryMin)} - {fmt(plan.entryMax)} · SL {fmt(plan.stopLoss)} · TP2 {fmt(plan.takeProfit2)} · RR {plan.riskRewardRatio != null ? plan.riskRewardRatio.toFixed(2) : "—"}
                              </p>
                              <p className="text-[9px] text-zinc-600 mt-1">
                                Realized {fmtRR(plan.realizedRR)} · MFE {fmtRR(plan.maxFavorableExcursion)} · MAE {fmtRR(plan.maxAdverseExcursion)}
                              </p>
                              {(plan.providerAtSignal || plan.providerHealthStateAtSignal) && (
                                <p className="text-[9px] text-zinc-700 mt-1">
                                  {plan.providerAtSignal ?? "Unknown provider"} · {plan.providerHealthStateAtSignal ?? "unknown"}
                                  {plan.providerFallbackUsedAtSignal ? " · fallback" : ""}
                                </p>
                              )}
                              {plan.qualityGateReason && (
                                <p className="text-[9px] text-zinc-500 mt-1">
                                  Quality gate: {qualityGateLabel(plan.qualityGateReason)}
                                </p>
                              )}
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
