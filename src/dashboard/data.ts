import { cookies, headers } from "next/headers";

import type { CommoditiesSignalsPayload } from "@/src/assets/commodities/types";
import type { IndicesSignalsPayload } from "@/src/assets/indices/types";
import type { MemeSignalsPayload } from "@/src/assets/memecoins/types";
import type { StocksSignalsPayload } from "@/src/assets/stocks/types";
import type { AllocationIntent, DecisionJournalEntry } from "@/src/interfaces/contracts";
import type { CryptoSignalsPayload } from "@/src/crypto/types";
import type {
  DriftDashboardPayload,
  OverviewDashboardPayload,
  PodDashboardRow,
  RecommendationDetailPayload,
  RecommendationQueuePayload,
  RiskDashboardPayload,
  SignalQualityDashboardPayload,
  SystemStatusPayload,
  TraderSignalDashboardPayload,
  ValidationDetailPayload,
  ValidationQueuePayload,
} from "@/src/dashboard/types";

const EMPTY_SYSTEM_STATUS: SystemStatusPayload = {
  mode: "normal",
  kill_switch_active: false,
  last_cycle_ts: null,
  active_symbols: [],
  modules: [],
  feed_health: [],
  execution_health: [],
  provider: "synthetic",
  cycle_interval_minutes: 15,
  active_pods: [],
  active_entry_style: "trend_pullback",
};

const EMPTY_RISK_PAYLOAD: RiskDashboardPayload = {
  risk_state: {
    current_drawdown_pct: 0,
    portfolio_vol_estimate: 0,
  },
  exposure: {
    gross: 0,
    net: 0,
    active_symbols: 0,
  },
  limits: {
    max_gross_exposure: 0,
    max_net_exposure: 0,
    max_symbol_position: 0,
    max_notional_usd: 0,
    drawdown_warning_pct: 0,
    drawdown_hard_limit_pct: 0,
    volatility_target: 0,
  },
  positions: [],
  decisions: [],
  allocations: [],
};

const EMPTY_SIGNAL_QUALITY_PAYLOAD: SignalQualityDashboardPayload = {
  generated_at: 0,
  active_symbols: [],
  primary_entry_style: "trend_pullback",
  enabled_entry_styles: ["trend_pullback", "session_breakout", "range_reversal"],
  totals: {
    signals_issued: 0,
    signals_activated: 0,
    veto_count: 0,
    veto_reason_distribution: [],
    tp1_hit_count: 0,
    tp2_hit_count: 0,
    tp3_hit_count: 0,
    stop_out_count: 0,
    expiry_count: 0,
    cancellation_count: 0,
    tp1_hit_rate: 0,
    tp2_hit_rate: 0,
    tp3_hit_rate: 0,
    stop_out_rate: 0,
    expiry_rate: 0,
    cancellation_rate: 0,
    average_mfe: null,
    average_mae: null,
    average_time_to_activation_ms: null,
    average_time_to_tp1_ms: null,
    average_time_to_stop_ms: null,
  },
  by_pair: [],
  by_session: [],
  by_regime: [],
  by_confidence_bucket: [],
  by_weekday: [],
  by_slice: [],
  confidence_calibration: [],
  pair_tuning_recommendations: [],
  signal_timing_diagnostics: [],
  veto_effectiveness: [],
};

const EMPTY_RECOMMENDATION_QUEUE_PAYLOAD: RecommendationQueuePayload = {
  active_symbols: [],
  current_profiles: [],
  latest_snapshot: null,
  snapshots: [],
  applied_history: [],
};

const EMPTY_RECOMMENDATION_DETAIL_PAYLOAD: RecommendationDetailPayload = {
  snapshot: null,
  current_profiles: [],
  live_diffs: {},
  applied_history: [],
};

const EMPTY_VALIDATION_QUEUE_PAYLOAD: ValidationQueuePayload = {
  active_symbols: [],
  latest_run: null,
  runs: [],
  recommendation_effectiveness: [],
  pair_stability: [],
  applied_history: [],
  alpha_analytics: null,
};

const EMPTY_VALIDATION_DETAIL_PAYLOAD: ValidationDetailPayload = {
  run: null,
};

const EMPTY_CRYPTO_PAYLOAD: CryptoSignalsPayload = {
  generatedAt: 0,
  wsConnected: false,
  cycleRunning: false,
  lastCycleAt: null,
  cards: [],
  executable: [],
  monitored: [],
  rejected: [],
  liveMarketBoard: [],
};

const EMPTY_STOCKS_PAYLOAD: StocksSignalsPayload = {
  enabled: false,
  generatedAt: 0,
  lastCycleAt: null,
  cycleRunning: false,
  providerName: "Yahoo",
  providerStatus: "no_data",
  providerNotice: null,
  cards: [],
  executable: [],
  monitored: [],
  rejected: [],
  liveMarketBoard: [],
};

const EMPTY_COMMODITIES_PAYLOAD: CommoditiesSignalsPayload = {
  enabled: false,
  generatedAt: 0,
  lastCycleAt: null,
  cycleRunning: false,
  providerName: "Yahoo",
  providerStatus: "no_data",
  providerNotice: null,
  cards: [],
  executable: [],
  monitored: [],
  rejected: [],
  liveMarketBoard: [],
};

const EMPTY_INDICES_PAYLOAD: IndicesSignalsPayload = {
  enabled: false,
  generatedAt: 0,
  lastCycleAt: null,
  cycleRunning: false,
  providerName: "Stooq / Yahoo",
  providerStatus: "not_configured",
  providerNotice: null,
  cards: [],
  executable: [],
  monitored: [],
  rejected: [],
  liveMarketBoard: [],
};

const EMPTY_MEME_PAYLOAD: MemeSignalsPayload = {
  generatedAt: 0,
  lastCycleAt: null,
  lastDiscoveryAt: null,
  cardCount: 0,
  cycleRunning: false,
  discoveryRunning: false,
  wsConnected: false,
  universeSize: 0,
  universe: [],
  cards: [],
  executable: [],
  monitored: [],
  rejected: [],
  liveMarketBoard: [],
};

const DASHBOARD_ROUTE_TIMEOUT_MS = 2_000;
const SIGNALS_ROUTE_TIMEOUT_MS = 5_000;

function isPrivateIpv4Host(hostname: string): boolean {
  if (hostname.startsWith("10.")) {
    return true;
  }
  if (hostname.startsWith("192.168.")) {
    return true;
  }
  const match = /^172\.(\d{1,2})\./.exec(hostname);
  if (!match) {
    return false;
  }
  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function resolveApiOrigin(headerList: Headers): string {
  const host = headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    process.env.VERCEL_URL ??
    "127.0.0.1:3000";
  const forwardedProtocol = headerList.get("x-forwarded-proto");
  if (forwardedProtocol) {
    return `${forwardedProtocol}://${host}`;
  }

  const hostname = host.split(":")[0]?.trim().toLowerCase() ?? host;
  const protocol = host.endsWith(":443")
    ? "https"
    : hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname === "0.0.0.0"
      || isPrivateIpv4Host(hostname)
        ? "http"
        : "https";
  return `${protocol}://${host}`;
}

async function fetchDashboardRoute<T>(path: string, fallback: T): Promise<T> {
  try {
    const headerList = await headers();
    const cookieStore = await cookies();
    const requestHeaders = new Headers({
      accept: "application/json",
    });
    const cookieHeader = cookieStore.toString();

    if (cookieHeader) {
      requestHeaders.set("cookie", cookieHeader);
    }

    const controller = new AbortController();
    const timeoutMs = path.startsWith("/api/signals")
      ? SIGNALS_ROUTE_TIMEOUT_MS
      : DASHBOARD_ROUTE_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(new URL(path, resolveApiOrigin(headerList)), {
      cache: "no-store",
      headers: requestHeaders,
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      return fallback;
    }

    return await response.json() as T;
  } catch {
    return fallback;
  }
}

export async function getOverviewData(): Promise<OverviewDashboardPayload> {
  const [status, signals, crypto, allocations, risk, journal, quality] = await Promise.all([
    getSystemStatusData(),
    fetchDashboardRoute<TraderSignalDashboardPayload>("/api/signals", {
      generatedAt: 0,
      executable: [],
      monitored: [],
      rejected: [],
      cards: [],
      liveMarketBoard: [],
      activeSignals: [],
      developingSetups: [],
      blockedSignals: [],
      watchlistSignals: [],
      marketReasoning: [],
      keyAreas: [],
      diagnostics: [],
      preferences: {
        meaningfulSignalFloor: "B",
        minimumTelegramGrade: "B",
        includeBTelegramSignals: true,
        showBlockedSignalsOnMainDashboard: false,
        showAdvancedInternals: false,
      },
      marketCommentary: null,
    }),
    fetchDashboardRoute<CryptoSignalsPayload>("/api/crypto-signals", EMPTY_CRYPTO_PAYLOAD),
    fetchDashboardRoute<AllocationIntent[]>("/api/allocations", []),
    fetchDashboardRoute<RiskDashboardPayload>("/api/risk/decisions", EMPTY_RISK_PAYLOAD),
    fetchDashboardRoute<DecisionJournalEntry[]>("/api/journal?limit=6", []),
    fetchDashboardRoute<SignalQualityDashboardPayload>("/api/quality", EMPTY_SIGNAL_QUALITY_PAYLOAD),
  ]);

  return {
    status,
    signals,
    crypto,
    allocations,
    risk,
    journal,
    quality,
  };
}

export async function getSignalsPageData() {
  return fetchDashboardRoute<TraderSignalDashboardPayload>("/api/signals", {
    generatedAt: 0,
    executable: [],
    monitored: [],
    rejected: [],
    cards: [],
    liveMarketBoard: [],
    activeSignals: [],
    developingSetups: [],
    blockedSignals: [],
    watchlistSignals: [],
    marketReasoning: [],
    keyAreas: [],
    diagnostics: [],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "B",
      includeBTelegramSignals: true,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
    },
    marketCommentary: null,
  });
}

export async function getSystemStatusData() {
  return fetchDashboardRoute<SystemStatusPayload>("/api/system/status", EMPTY_SYSTEM_STATUS);
}

export async function getCryptoPageData() {
  return fetchDashboardRoute<CryptoSignalsPayload>("/api/crypto-signals", EMPTY_CRYPTO_PAYLOAD);
}

export async function getStocksPageData() {
  return fetchDashboardRoute<StocksSignalsPayload>("/api/stocks-signals", EMPTY_STOCKS_PAYLOAD);
}

export async function getCommoditiesPageData() {
  return fetchDashboardRoute<CommoditiesSignalsPayload>("/api/commodities-signals", EMPTY_COMMODITIES_PAYLOAD);
}

export async function getIndicesPageData() {
  return fetchDashboardRoute<IndicesSignalsPayload>("/api/indices-signals", EMPTY_INDICES_PAYLOAD);
}

export async function getMemePageData() {
  return fetchDashboardRoute<MemeSignalsPayload>("/api/meme-signals", EMPTY_MEME_PAYLOAD);
}

export async function getRiskPageData() {
  return fetchDashboardRoute<RiskDashboardPayload>("/api/risk/decisions", EMPTY_RISK_PAYLOAD);
}

export async function getPodsPageData() {
  return fetchDashboardRoute<PodDashboardRow[]>("/api/pods", []);
}

export async function getJournalPageData(filters?: {
  symbol?: string;
  action?: DecisionJournalEntry["final_action"];
  from?: number;
  to?: number;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (filters?.symbol) {
    searchParams.set("symbol", filters.symbol);
  }
  if (filters?.action) {
    searchParams.set("action", filters.action);
  }
  if (filters?.from != null) {
    searchParams.set("from", String(filters.from));
  }
  if (filters?.to != null) {
    searchParams.set("to", String(filters.to));
  }
  if (filters?.limit != null) {
    searchParams.set("limit", String(filters.limit));
  }

  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
  return fetchDashboardRoute<DecisionJournalEntry[]>(`/api/journal${suffix}`, []);
}

export async function getDriftPageData(): Promise<DriftDashboardPayload> {
  const [drift, models, status] = await Promise.all([
    fetchDashboardRoute<DriftDashboardPayload["drift"]>("/api/drift", []),
    fetchDashboardRoute<DriftDashboardPayload["models"]>("/api/models", []),
    getSystemStatusData(),
  ]);

  return {
    mode: status.mode,
    drift,
    models,
  };
}

export async function getQualityPageData(): Promise<SignalQualityDashboardPayload> {
  return fetchDashboardRoute<SignalQualityDashboardPayload>("/api/quality", EMPTY_SIGNAL_QUALITY_PAYLOAD);
}

export async function getRecommendationsPageData(): Promise<RecommendationQueuePayload> {
  return fetchDashboardRoute<RecommendationQueuePayload>("/api/recommendations", EMPTY_RECOMMENDATION_QUEUE_PAYLOAD);
}

export async function getRecommendationDetailData(snapshotId: string): Promise<RecommendationDetailPayload> {
  return fetchDashboardRoute<RecommendationDetailPayload>(
    `/api/recommendations/${snapshotId}`,
    EMPTY_RECOMMENDATION_DETAIL_PAYLOAD,
  );
}

export async function getValidationPageData(): Promise<ValidationQueuePayload> {
  return fetchDashboardRoute<ValidationQueuePayload>("/api/validation", EMPTY_VALIDATION_QUEUE_PAYLOAD);
}

export async function getValidationDetailData(runId: string): Promise<ValidationDetailPayload> {
  return fetchDashboardRoute<ValidationDetailPayload>(
    `/api/validation/${runId}`,
    EMPTY_VALIDATION_DETAIL_PAYLOAD,
  );
}
