import { triggerCryptoCycle, getCryptoSignalsPayload } from "@/src/crypto/engine/cryptoRuntime";
import { triggerStocksCycle, getStocksSignalsPayload } from "@/src/assets/stocks/engine/stocksRuntime";
import { triggerCommoditiesCycle, getCommoditiesSignalsPayload } from "@/src/assets/commodities/engine/commoditiesRuntime";
import { triggerIndicesCycle, getIndicesSignalsPayload } from "@/src/assets/indices/engine/indicesRuntime";
import { triggerMemeCycle, getMemeSignalsPayload } from "@/src/assets/memecoins/engine/memeRuntime";
import { runFocusedRuntimeCycle } from "@/src/application/cycle/runCycle";
import { getApexRuntime } from "@/src/lib/runtime";
import { createId } from "@/src/lib/ids";
import { prisma } from "@/src/infrastructure/db/prisma";
import type {
  LiveRuntimeSmokeDashboard,
  LiveRuntimeSmokeReport,
  RuntimeHealthTransition,
  RuntimeHealthState,
  RuntimeSmokeDashboardRow,
  RuntimeSmokeHistoryPoint,
  RuntimeSmokeReportRow,
  RuntimeSmokeStageCounts,
} from "@/src/application/analytics/alphaTypes";
import type { SignalAssetClass } from "@/src/domain/models/signalHealth";
import { getSignalsPayload } from "@/src/presentation/api/signals";

const DEFAULT_SMOKE_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.APEX_SMOKE_TIMEOUT_MS ?? "120000", 10) || 120_000,
);
const FX_SMOKE_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "EURJPY"] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string | null | undefined): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function runSmokeOperation(
  label: string,
  operation: () => Promise<unknown>,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
): Promise<{ label: string; ok: boolean; timedOut: boolean; error: string | null }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return {
      label,
      ok: true,
      timedOut: false,
      error: null,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    return {
      label,
      ok: false,
      timedOut: /timed out/i.test(message),
      error: message,
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isForexMarketClosed(timestamp: number): boolean {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const minutes = (date.getUTCHours() * 60) + date.getUTCMinutes();

  if (day === 6) {
    return true;
  }
  if (day === 5 && minutes >= (21 * 60)) {
    return true;
  }
  if (day === 0 && minutes < (21 * 60)) {
    return true;
  }

  return false;
}

function normalizeProviderName(value: unknown): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("polygon")) return "Polygon";
  if (normalized.includes("stooq")) return "Stooq";
  if (normalized.includes("yahoo")) return "Yahoo";
  if (normalized.includes("binance")) return "Binance";
  if (normalized.includes("coingecko")) return "CoinGecko";
  return String(value);
}

function toObservedProviders(values: readonly unknown[]): string[] {
  const providers = new Set<string>();
  for (const value of values) {
    const normalized = normalizeProviderName(value);
    if (normalized) {
      providers.add(normalized);
    }
  }
  return [...providers];
}

function getFxSmokeSymbols(activeSymbols: readonly string[]): string[] {
  const scoped = FX_SMOKE_SYMBOLS.filter(symbol => activeSymbols.includes(symbol));
  if (scoped.length > 0) {
    return scoped.slice(0, 10);
  }
  return [...activeSymbols].slice(0, Math.min(10, activeSymbols.length));
}

function extractFxStageCounts(payload: Awaited<ReturnType<typeof getSignalsPayload>>): RuntimeSmokeStageCounts {
  const diagnostics = asRecord(payload.pipelineDiagnostics);
  const stageCounts = asRecord(diagnostics.stageCounts);
  return {
    symbolsAttempted: payload.liveMarketBoard.length,
    marketSnapshotCount: asNumber(stageCounts.marketSnapshotCount),
    tradeCandidateCount: asNumber(stageCounts.tradeCandidateCount),
    riskEvaluatedCandidateCount: asNumber(stageCounts.riskEvaluatedCandidateCount),
    executableSignalCount: asNumber(stageCounts.executableSignalCount),
    publishedCount: asNumber(stageCounts.publishedCount),
    blockedCount: payload.rejected.length,
  };
}

function buildModuleStageCounts(input: {
  attempted: number;
  cards: Array<{ publicationStatus?: string | null }>;
  executableCount: number;
  rejectedCount: number;
}): RuntimeSmokeStageCounts {
  return {
    symbolsAttempted: input.attempted,
    marketSnapshotCount: input.attempted,
    tradeCandidateCount: input.cards.length,
    riskEvaluatedCandidateCount: input.cards.length,
    executableSignalCount: input.executableCount,
    publishedCount: input.cards.filter(card => card.publicationStatus === "publishable").length,
    blockedCount: input.rejectedCount,
  };
}

export function computeRuntimeHealthState(input: {
  assetClass: SignalAssetClass;
  providerStatus: string | null;
  nullPriceCount: number;
  staleCount: number;
  stageCounts: RuntimeSmokeStageCounts;
  notes: string[];
}): RuntimeHealthState {
  const providerStatus = String(input.providerStatus ?? "").toLowerCase();
  const marketClosedOnly = input.notes.some(note => note.toLowerCase().includes("market closed"))
    && input.stageCounts.executableSignalCount === 0
    && input.nullPriceCount === 0;

  if (marketClosedOnly) {
    return "no_market_context";
  }
  if (
    providerStatus.includes("broken")
    || providerStatus === "no_data"
    || input.nullPriceCount >= Math.max(1, input.stageCounts.symbolsAttempted)
  ) {
    return "broken";
  }
  if (
    providerStatus.includes("degraded")
    || providerStatus.includes("fallback")
    || providerStatus.includes("stale")
    || input.staleCount > 0
    || (input.stageCounts.tradeCandidateCount === 0 && input.stageCounts.symbolsAttempted > 0)
  ) {
    return "degraded";
  }
  return "healthy";
}

function buildFxSmokeRow(
  payload: Awaited<ReturnType<typeof getSignalsPayload>>,
  extraNotes: string[] = [],
  forcedProviderStatus?: string | null,
): RuntimeSmokeReportRow {
  const stageCounts = extractFxStageCounts(payload);
  const diagnostics = payload.diagnostics ?? [];
  const rejectionReasons = countBy(payload.cards, card =>
    card.blockedReasons.length > 0 ? card.blockedReasons[0] : card.noTradeReason,
  );
  const notes = [
    isForexMarketClosed(payload.generatedAt) ? "market closed" : null,
    payload.marketCommentary?.overallContext,
    ...payload.cards.flatMap(card => card.marketStateLabels),
    ...extraNotes,
  ].filter((value): value is string => Boolean(value)).slice(0, 8);
  const providerStatus = forcedProviderStatus ?? (
    diagnostics.some(row => row.providerStatus && row.providerStatus !== "healthy")
      ? "degraded"
      : "healthy"
  );

  return {
    assetClass: "fx",
    timestamp: payload.generatedAt,
    runtimeHealth: computeRuntimeHealthState({
      assetClass: "fx",
      providerStatus,
      nullPriceCount: payload.liveMarketBoard.filter(row => row.livePrice == null).length,
      staleCount: diagnostics.filter(row => row.providerStatus === "stale").length,
      stageCounts,
      notes,
    }),
    providerChain: [getApexRuntime().config.defaultVenue],
    providersObserved: toObservedProviders(payload.diagnostics.map(row => row.marketData.provider)),
    providerStatus,
    stageCounts,
    nullPriceCount: payload.liveMarketBoard.filter(row => row.livePrice == null).length,
    staleCount: diagnostics.filter(row => row.providerStatus === "stale").length,
    averageFreshnessMs: average(payload.diagnostics
      .map(row => row.marketData.lastCandleTimestamp == null ? null : Math.max(0, payload.generatedAt - row.marketData.lastCandleTimestamp))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))),
    worstFreshnessMs: (() => {
      const values = payload.diagnostics
        .map(row => row.marketData.lastCandleTimestamp == null ? null : Math.max(0, payload.generatedAt - row.marketData.lastCandleTimestamp))
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return values.length > 0 ? Math.max(...values) : null;
    })(),
    publicationDistribution: {
      publishable: payload.diagnostics.filter(row => row.publicationStatus === "publishable").length,
      watchlist_only: payload.diagnostics.filter(row => row.publicationStatus === "watchlist_only").length,
      shadow_only: payload.diagnostics.filter(row => row.publicationStatus === "shadow_only").length,
      blocked: payload.diagnostics.filter(row => row.publicationStatus === "blocked").length,
    },
    rejectionReasons,
    notes,
  };
}

function buildModuleSmokeRow<TCard extends {
  publicationStatus?: string | null;
  providerStatus?: string | null;
  publicationReasons?: string[] | null;
  healthFlags?: string[] | null;
  noTradeReason?: string | null;
  priceSource?: string | null;
  candleSource?: string | null;
  dataFreshnessMs?: number | null;
}>(input: {
  assetClass: SignalAssetClass;
  generatedAt: number;
  attempted: number;
  providerChain: string[];
  providerStatus: string | null | undefined;
  cards: TCard[];
  executableCount: number;
  rejectedCount: number;
  liveMarketBoard: Array<{ livePrice: number | null; noTradeReason?: string | null }>;
  notes?: Array<string | null | undefined>;
}): RuntimeSmokeReportRow {
  const stageCounts = buildModuleStageCounts({
    attempted: input.attempted,
    cards: input.cards,
    executableCount: input.executableCount,
    rejectedCount: input.rejectedCount,
  });
  const nullPriceCount = input.liveMarketBoard.filter(row => row.livePrice == null).length;
  const staleCount = input.cards.filter(card => card.healthFlags?.some(flag => /stale/i.test(flag))).length;
  const notes = input.notes?.filter((value): value is string => Boolean(value)).slice(0, 8) ?? [];
  const brokenCardCount = input.cards.filter(card => String(card.providerStatus ?? "").toLowerCase().includes("broken")).length;
  const inferredProviderStatus = brokenCardCount > 0 && brokenCardCount >= input.cards.length
    ? "broken"
    : input.cards.some(card => {
      const status = String(card.providerStatus ?? "").toLowerCase();
      return status.includes("degraded") || status.includes("fallback") || status.includes("stale");
    })
      || brokenCardCount > 0
      ? "degraded"
      : input.cards.length > 0
        ? "healthy"
        : input.providerStatus ?? null;
  const providerStatus = input.providerStatus === "broken" ? "broken" : inferredProviderStatus;

  return {
    assetClass: input.assetClass,
    timestamp: input.generatedAt,
    runtimeHealth: computeRuntimeHealthState({
      assetClass: input.assetClass,
      providerStatus,
      nullPriceCount,
      staleCount,
      stageCounts,
      notes,
    }),
    providerChain: input.providerChain,
    providersObserved: toObservedProviders(input.cards.flatMap(card => [card.priceSource, card.candleSource])),
    providerStatus,
    stageCounts,
    nullPriceCount,
    staleCount,
    averageFreshnessMs: average(input.cards
      .map(card => card.dataFreshnessMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))),
    worstFreshnessMs: (() => {
      const values = input.cards
        .map(card => card.dataFreshnessMs)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return values.length > 0 ? Math.max(...values) : null;
    })(),
    publicationDistribution: {
      publishable: input.cards.filter(card => card.publicationStatus === "publishable").length,
      watchlist_only: input.cards.filter(card => card.publicationStatus === "watchlist_only").length,
      shadow_only: input.cards.filter(card => card.publicationStatus === "shadow_only").length,
      blocked: input.cards.filter(card => card.publicationStatus === "blocked").length,
    },
    rejectionReasons: countBy(input.cards, card => card.publicationReasons?.[0] ?? card.noTradeReason ?? null),
    notes,
  };
}

function buildNullPriceRate(row: RuntimeSmokeReportRow): number {
  return row.stageCounts.symbolsAttempted <= 0
    ? 0
    : Math.round((row.nullPriceCount / row.stageCounts.symbolsAttempted) * 1000) / 1000;
}

function buildRuntimeTransition(
  assetClass: SignalAssetClass,
  previous: RuntimeSmokeReportRow | null,
  current: RuntimeSmokeReportRow,
): RuntimeHealthTransition | null {
  if (!previous || previous.runtimeHealth === current.runtimeHealth) {
    return null;
  }

  return {
    assetClass,
    from: previous.runtimeHealth,
    to: current.runtimeHealth,
    changedAt: current.timestamp,
  };
}

export async function runLiveRuntimeSmokeVerification(): Promise<LiveRuntimeSmokeReport> {
  const runtime = getApexRuntime();
  const fxOperation = await runSmokeOperation("fx", async () => {
    await runFocusedRuntimeCycle(runtime, {
      smokeMode: true,
      activeSymbolsOverride: getFxSmokeSymbols(runtime.config.activeSymbols),
      maxCycleDurationMs: Math.min(DEFAULT_SMOKE_TIMEOUT_MS, 45_000),
      fetchRetryAttempts: 2,
      fetchRetryBaseDelayMs: 500,
      nullPriceCircuitBreakerThreshold: 0.3,
      nullPriceCircuitBreakerMinAttempts: 4,
    });
  });
  const fxPayload = await getSignalsPayload();

  const [
    cryptoOperation,
    stocksOperation,
    commoditiesOperation,
    indicesOperation,
    memeOperation,
  ] = await Promise.all([
    runSmokeOperation("crypto", async () => {
      await triggerCryptoCycle();
    }),
    runSmokeOperation("stocks", async () => {
      await triggerStocksCycle();
    }),
    runSmokeOperation("commodities", async () => {
      await triggerCommoditiesCycle();
    }),
    runSmokeOperation("indices", async () => {
      await triggerIndicesCycle();
    }),
    runSmokeOperation("memecoins", async () => {
      await triggerMemeCycle();
    }),
  ]);

  const cryptoPayload = getCryptoSignalsPayload();
  const stocksPayload = getStocksSignalsPayload();
  const commoditiesPayload = getCommoditiesSignalsPayload();
  const indicesPayload = getIndicesSignalsPayload();
  const memePayload = getMemeSignalsPayload();

  const report: LiveRuntimeSmokeReport = {
    generatedAt: Date.now(),
    rows: [
      buildFxSmokeRow(
        fxPayload,
        fxOperation.error ? [`${fxOperation.label}: ${fxOperation.error}`] : [],
        fxOperation.ok ? undefined : "broken",
      ),
      buildModuleSmokeRow({
        assetClass: "crypto",
        generatedAt: cryptoPayload.generatedAt,
        attempted: cryptoPayload.liveMarketBoard.length,
        providerChain: ["Binance"],
        providerStatus: cryptoOperation.ok ? undefined : "broken",
        cards: cryptoPayload.cards,
        executableCount: cryptoPayload.executable.length,
        rejectedCount: cryptoPayload.rejected.length,
        liveMarketBoard: cryptoPayload.liveMarketBoard,
        notes: [
          cryptoPayload.wsConnected ? "Binance WS connected" : "Binance WS disconnected",
          cryptoOperation.error ? `${cryptoOperation.label}: ${cryptoOperation.error}` : null,
        ],
      }),
      buildModuleSmokeRow({
        assetClass: "stock",
        generatedAt: stocksPayload.generatedAt,
        attempted: stocksPayload.liveMarketBoard.length,
        providerChain: ["Yahoo"],
        providerStatus: stocksOperation.ok ? stocksPayload.providerStatus : "broken",
        cards: stocksPayload.cards,
        executableCount: stocksPayload.executable.length,
        rejectedCount: stocksPayload.rejected.length,
        liveMarketBoard: stocksPayload.liveMarketBoard,
        notes: [
          stocksPayload.providerNotice,
          stocksOperation.error ? `${stocksOperation.label}: ${stocksOperation.error}` : null,
        ],
      }),
      buildModuleSmokeRow({
        assetClass: "commodity",
        generatedAt: commoditiesPayload.generatedAt,
        attempted: commoditiesPayload.liveMarketBoard.length,
        providerChain: ["Yahoo"],
        providerStatus: commoditiesOperation.ok ? commoditiesPayload.providerStatus : "broken",
        cards: commoditiesPayload.cards,
        executableCount: commoditiesPayload.executable.length,
        rejectedCount: commoditiesPayload.rejected.length,
        liveMarketBoard: commoditiesPayload.liveMarketBoard,
        notes: [
          commoditiesPayload.providerNotice,
          commoditiesOperation.error ? `${commoditiesOperation.label}: ${commoditiesOperation.error}` : null,
        ],
      }),
      buildModuleSmokeRow({
        assetClass: "index",
        generatedAt: indicesPayload.generatedAt,
        attempted: indicesPayload.liveMarketBoard.length,
        providerChain: ["Stooq", "Yahoo"],
        providerStatus: indicesOperation.ok ? indicesPayload.providerStatus : "broken",
        cards: indicesPayload.cards,
        executableCount: indicesPayload.executable.length,
        rejectedCount: indicesPayload.rejected.length,
        liveMarketBoard: indicesPayload.liveMarketBoard,
        notes: [
          indicesPayload.providerNotice,
          indicesOperation.error ? `${indicesOperation.label}: ${indicesOperation.error}` : null,
        ],
      }),
      buildModuleSmokeRow({
        assetClass: "memecoin",
        generatedAt: memePayload.generatedAt,
        attempted: memePayload.universeSize,
        providerChain: ["Binance", "CoinGecko"],
        providerStatus: memeOperation.ok ? undefined : "broken",
        cards: memePayload.cards,
        executableCount: memePayload.executable.length,
        rejectedCount: memePayload.rejected.length,
        liveMarketBoard: memePayload.liveMarketBoard,
        notes: [
          memePayload.wsConnected ? "Binance meme stream connected" : "Binance meme stream disconnected",
          `Universe ${memePayload.universeSize}`,
          memeOperation.error ? `${memeOperation.label}: ${memeOperation.error}` : null,
        ],
      }),
    ],
  };

  await runtime.repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: report.generatedAt,
    module: "live-smoke",
    type: "runtime_smoke_verification_completed",
    reason: "operator verification",
    payload: report as unknown as Record<string, unknown>,
  });

  return report;
}

export async function getLatestLiveRuntimeSmokeReport(): Promise<LiveRuntimeSmokeReport | null> {
  const runtime = getApexRuntime();
  const events = runtime.repository.getSystemEvents()
    .filter(event => event.type === "runtime_smoke_verification_completed")
    .sort((left, right) => right.ts - left.ts);
  const latestInMemory = events[0];
  if (latestInMemory) {
    return latestInMemory.payload as unknown as LiveRuntimeSmokeReport;
  }

  try {
    const latestPersisted = await prisma.systemEvent.findFirst({
      where: {
        type: "runtime_smoke_verification_completed",
      },
      orderBy: {
        ts: "desc",
      },
      select: {
        payload: true,
      },
    });
    return latestPersisted?.payload as LiveRuntimeSmokeReport | null;
  } catch {
    return null;
  }
}

export async function getLiveRuntimeSmokeHistory(limit = 10): Promise<LiveRuntimeSmokeReport[]> {
  try {
    const rows = await prisma.systemEvent.findMany({
      where: {
        type: "runtime_smoke_verification_completed",
      },
      orderBy: {
        ts: "desc",
      },
      take: Math.max(2, limit),
      select: {
        payload: true,
      },
    });

    return rows
      .map(row => row.payload as LiveRuntimeSmokeReport)
      .filter(report => Array.isArray(report?.rows));
  } catch {
    return [];
  }
}

export async function getLiveRuntimeSmokeDashboard(
  currentReport?: LiveRuntimeSmokeReport | null,
): Promise<LiveRuntimeSmokeDashboard | null> {
  const latest = currentReport ?? await getLatestLiveRuntimeSmokeReport();
  if (!latest) {
    return null;
  }

  const history = await getLiveRuntimeSmokeHistory(10);
  const alerts: RuntimeHealthTransition[] = [];
  const rows: RuntimeSmokeDashboardRow[] = latest.rows.map(currentRow => {
    const rowHistory = history
      .flatMap(report => report.rows.filter(row => row.assetClass === currentRow.assetClass))
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 10);
    const previous = rowHistory.find(row => row.timestamp < currentRow.timestamp) ?? null;
    const transition = buildRuntimeTransition(currentRow.assetClass, previous, currentRow);
    if (transition) {
      alerts.push(transition);
    }
    const lastSuccessfulCycleAt = rowHistory.find(row => row.runtimeHealth === "healthy")?.timestamp ?? null;
    const nullPriceTrend: RuntimeSmokeHistoryPoint[] = rowHistory
      .slice()
      .reverse()
      .map(row => ({
        generatedAt: row.timestamp,
        runtimeHealth: row.runtimeHealth,
        nullPriceCount: row.nullPriceCount,
        nullPriceRate: buildNullPriceRate(row),
        symbolsAttempted: row.stageCounts.symbolsAttempted,
      }));

    return {
      ...currentRow,
      lastSuccessfulCycleAt,
      nullPriceTrend,
      transition,
    };
  });

  return {
    generatedAt: latest.generatedAt,
    rows,
    alerts,
  };
}
