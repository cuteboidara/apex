import type { ApexConfig } from "@/src/lib/config";
import { createId } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import type { ApexRepository } from "@/src/lib/repository";
import { getCachedJson, setCachedJson } from "@/src/lib/redis";
import { evaluateSymbolScope, type SymbolScopeSkipReason } from "@/src/config/marketScope";
import {
  type CandleQualityFlag,
  type CanonicalMarketEvent,
  type FeedHealthMetrics,
  type NormalizedCandle,
  type PairMarketDataDiagnostics,
  type ProviderHealthMetadata,
} from "@/src/interfaces/contracts";
import {
  type MarketDataFetchResult,
  type MarketDataProviderAdapter,
  OandaAdapter,
  YahooAdapter,
} from "@/src/data-plant/adapters";
import {
  fetchTodaysHighImpactEconomicEvents,
  StaticEconomicEventProvider,
  type EconomicEventProvider,
  type HighImpactEconomicEvent,
} from "@/src/data-plant/economicEvents";
import { classifyFxSession } from "@/src/data-plant/session";

type SyntheticBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestampOpen: number;
};

function inferAssetClass(symbol: string): CanonicalMarketEvent["asset_class"] {
  if (symbol.includes("BTC") || symbol.includes("ETH")) {
    return "crypto";
  }
  if (symbol.startsWith("XAU") || symbol.startsWith("XAG") || symbol.includes("OIL")) {
    return "commodity";
  }
  if (/^[A-Z]{6}$/.test(symbol)) {
    return "forex";
  }
  return "equity";
}

function normalizeTimeframe(interval: string): NormalizedCandle["timeframe"] {
  const normalized = interval.trim().toLowerCase();
  if (normalized === "1m" || normalized === "1min") return "1m";
  if (normalized === "5m" || normalized === "5min") return "5m";
  if (normalized === "15m" || normalized === "15min") return "15m";
  if (normalized === "1h" || normalized === "60m" || normalized === "60min") return "1h";
  if (normalized === "4h" || normalized === "240m" || normalized === "240min") return "4h";
  return "1D";
}

function timeframeToMs(timeframe: NormalizedCandle["timeframe"]): number {
  switch (timeframe) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1D":
      return 24 * 60 * 60_000;
  }
}

function selectQualityFlag(input: {
  duplicateBars: number;
  outOfOrderBars: number;
  missingBars: number;
  staleLastCandle: boolean;
  abnormalGapDetected: boolean;
  synthetic?: boolean;
}): CandleQualityFlag {
  if (input.synthetic) return "synthetic";
  if (input.outOfOrderBars > 0) return "out_of_order";
  if (input.duplicateBars > 0) return "duplicate_bars";
  if (input.abnormalGapDetected) return "abnormal_gap";
  if (input.missingBars > 0) return "missing_bars";
  if (input.staleLastCandle) return "stale_last_candle";
  return "clean";
}

function sortAndValidateCandles(
  candles: NormalizedCandle[],
  health: ProviderHealthMetadata,
): { candles: NormalizedCandle[]; health: ProviderHealthMetadata } {
  if (candles.length === 0) {
    return { candles, health };
  }

  let outOfOrderBars = 0;
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index]!.timestampOpen < candles[index - 1]!.timestampOpen) {
      outOfOrderBars += 1;
    }
  }

  const ordered = [...candles].sort((left, right) => left.timestampOpen - right.timestampOpen);
  const deduped: NormalizedCandle[] = [];
  let duplicateBars = 0;
  for (const candle of ordered) {
    if (deduped.at(-1)?.timestampOpen === candle.timestampOpen) {
      duplicateBars += 1;
      continue;
    }
    deduped.push(candle);
  }

  const stepMs = timeframeToMs(deduped[0]!.timeframe);
  let missingBars = 0;
  let abnormalGapDetected = false;
  for (let index = 1; index < deduped.length; index += 1) {
    const gap = deduped[index]!.timestampOpen - deduped[index - 1]!.timestampOpen;
    if (gap > stepMs) {
      missingBars += Math.max(0, Math.round(gap / stepMs) - 1);
    }
    if (gap > stepMs * 3) {
      abnormalGapDetected = true;
    }
  }

  const staleLastCandle = Date.now() - deduped.at(-1)!.timestampClose > stepMs * 2;
  const qualityFlag = selectQualityFlag({
    duplicateBars,
    outOfOrderBars,
    missingBars,
    staleLastCandle,
    abnormalGapDetected,
    synthetic: deduped[0]!.qualityFlag === "synthetic",
  });
  const hydrated = deduped.map(candle => ({
    ...candle,
    qualityFlag,
  }));

  return {
    candles: hydrated,
    health: {
      ...health,
      missingBars,
      duplicateBars,
      outOfOrderBars,
      staleLastCandle,
      abnormalGapDetected,
    },
  };
}

export class DataPlant {
  private readonly venueConnections = new Set<string>();
  private readonly sequenceBySymbol = new Map<string, number>();
  private readonly healthBySymbol = new Map<string, FeedHealthMetrics>();
  private readonly latestFetchDiagnostics = new Map<string, PairMarketDataDiagnostics>();
  private readonly adapters: MarketDataProviderAdapter[];
  private readonly economicEventProvider: EconomicEventProvider;

  constructor(
    private readonly repository: ApexRepository,
    private readonly config: ApexConfig,
    dependencies?: {
      adapters?: MarketDataProviderAdapter[];
      economicEventProvider?: EconomicEventProvider;
    },
  ) {
    this.adapters = dependencies?.adapters ?? [
      new OandaAdapter({
        apiToken: config.oandaApiToken,
        environment: config.oandaEnvironment,
        baseUrl: config.oandaApiBaseUrl,
      }),
      new YahooAdapter(),
    ];
    this.economicEventProvider = dependencies?.economicEventProvider ?? new StaticEconomicEventProvider();
  }

  async connect(venue: string): Promise<void> {
    this.venueConnections.add(venue);
    logger.info({
      module: "data-plant",
      message: "Market data venue connected",
      venue,
    });
  }

  replaceEconomicEvents(events: HighImpactEconomicEvent[]): void {
    if (this.economicEventProvider instanceof StaticEconomicEventProvider) {
      this.economicEventProvider.replaceEvents(events);
    }
  }

  async refreshEconomicEvents(): Promise<void> {
    const events = await fetchTodaysHighImpactEconomicEvents();
    this.replaceEconomicEvents(events);
  }

  private async recordScopeSkip(symbol: string, reason: SymbolScopeSkipReason, interval: string): Promise<void> {
    logger.warn({
      module: "data-plant",
      message: "Symbol skipped outside active market scope",
      symbol,
      interval,
      reason,
    });
    const current = this.healthBySymbol.get(symbol) ?? {
      symbol_canonical: symbol,
      latency_ms: 0,
      last_received_ts: null,
      gap_count: 0,
      quarantined: false,
    };
    const next = {
      ...current,
      last_reason: reason,
    };
    this.healthBySymbol.set(symbol, next);
    this.latestFetchDiagnostics.set(symbol, {
      symbol,
      interval,
      provider: null,
      candlesFetched: 0,
      lastCandleTimestamp: null,
      latencyMs: 0,
      sourceMode: "unavailable",
      usedFallback: false,
      qualityFlag: null,
      unavailableReason: reason,
    });
    this.repository.setFeedHealth(next);
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "data-plant",
      type: "symbol_scope_skipped",
      reason,
      payload: {
        symbol,
        interval,
      },
    });
  }

  private buildSyntheticBars(symbol: string, timeframe: NormalizedCandle["timeframe"]): SyntheticBar[] {
    const latestEvent = this.repository.getMarketEvents(symbol).slice(-1)[0];
    const anchor = latestEvent?.price ?? this.seedPrice(symbol);
    const bars: SyntheticBar[] = [];
    const stepMs = timeframeToMs(timeframe);
    let previousClose = anchor;
    for (let offset = 63; offset >= 0; offset -= 1) {
      const drift = (Math.random() - 0.5) * previousClose * 0.004;
      const close = Math.max(0.0001, previousClose + drift);
      const spread = close * 0.0015;
      bars.push({
        timestampOpen: Date.now() - (offset + 1) * stepMs,
        open: previousClose,
        high: close + spread,
        low: Math.max(0.0001, close - spread),
        close,
        volume: Math.max(1, Math.round(1_000 + Math.random() * 9_000)),
      });
      previousClose = close;
    }

    return bars;
  }

  private async hydrateSyntheticCandles(symbol: string, interval: string): Promise<MarketDataFetchResult> {
    const timeframe = normalizeTimeframe(interval);
    const stepMs = timeframeToMs(timeframe);
    const candles = await Promise.all(this.buildSyntheticBars(symbol, timeframe).map(async bar => {
      const session = classifyFxSession(bar.timestampOpen);
      const eventContext = await this.economicEventProvider.getContext(symbol, bar.timestampOpen + stepMs);
      return {
        symbol,
        timeframe,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        timestampOpen: bar.timestampOpen,
        timestampClose: bar.timestampOpen + stepMs,
        source: "synthetic",
        qualityFlag: "synthetic",
        ...session,
        ...eventContext,
      } satisfies NormalizedCandle;
    }));

    return {
      provider: "synthetic",
      candles,
      health: {
        provider: "synthetic",
        latencyMs: 0,
        missingBars: 0,
        duplicateBars: 0,
        outOfOrderBars: 0,
        staleLastCandle: false,
        abnormalGapDetected: false,
      },
    };
  }

  private async fetchCandles(symbol: string, interval: string): Promise<MarketDataFetchResult | null> {
    const timeframe = normalizeTimeframe(interval);
    for (const adapter of this.adapters) {
      const result = await adapter.fetchCandles(symbol, interval);
      if (!result || result.candles.length === 0) {
        continue;
      }

      if (adapter.providerName !== this.config.defaultVenue) {
        logger.warn({
          module: "data-plant",
          message: "Primary FX provider unavailable; using fallback provider",
          symbol,
          timeframe,
          primary_provider: this.config.defaultVenue,
          fallback_provider: adapter.providerName,
        });
        await this.repository.appendSystemEvent({
          event_id: createId("sysevt"),
          ts: Date.now(),
          module: "data-plant",
          type: "market_data_fallback",
          reason: "primary_provider_unavailable",
          payload: {
            symbol,
            timeframe,
            primary_provider: this.config.defaultVenue,
            fallback_provider: adapter.providerName,
          },
        });
      }

      const enrichedCandles = await Promise.all(result.candles.map(async candle => ({
        ...candle,
        timeframe,
        ...classifyFxSession(candle.timestampOpen),
        ...(await this.economicEventProvider.getContext(symbol, candle.timestampClose)),
      })));
      const validated = sortAndValidateCandles(enrichedCandles, result.health);
      const cacheKey = `apex:data-plant:${adapter.providerName}:${symbol}:${timeframe}`;
      await setCachedJson(cacheKey, validated.candles, 60);
      return {
        provider: adapter.providerName,
        candles: validated.candles,
        health: validated.health,
      };
    }

    if (this.config.requireLiveData) {
      logger.warn({
        module: "data-plant",
        message: "Live market data unavailable for symbol",
        symbol,
        interval: timeframe,
      });
      return null;
    }

    for (const adapter of this.adapters) {
      const cacheKey = `apex:data-plant:${adapter.providerName}:${symbol}:${timeframe}`;
      const cached = await getCachedJson<NormalizedCandle[]>(cacheKey);
      if (cached && cached.length > 0) {
        const validated = sortAndValidateCandles(cached, {
          provider: `${adapter.providerName}-cache`,
          latencyMs: 0,
          missingBars: 0,
          duplicateBars: 0,
          outOfOrderBars: 0,
          staleLastCandle: false,
          abnormalGapDetected: false,
        });
        return {
          provider: `${adapter.providerName}-cache`,
          candles: validated.candles,
          health: validated.health,
        };
      }
    }

    return this.hydrateSyntheticCandles(symbol, interval);
  }

  private seedPrice(symbol: string): number {
    if (symbol === "EURUSD") return 1.085;
    if (symbol === "GBPUSD") return 1.27;
    if (symbol === "USDJPY") return 149.5;
    if (symbol === "EURJPY") return 161.8;
    if (symbol.includes("BTC")) return 67000;
    if (symbol.includes("ETH")) return 3600;
    return 100;
  }

  async ingestOHLCV(symbol: string, interval: string): Promise<NormalizedCandle | null> {
    const scope = evaluateSymbolScope(symbol, this.config.activeSymbols, this.config.marketScope);
    if (!scope.allowed) {
      await this.recordScopeSkip(symbol, scope.reason!, interval);
      return null;
    }

    const response = await this.fetchCandles(symbol, interval);
    if (!response || response.candles.length === 0) {
      const current = this.healthBySymbol.get(symbol) ?? {
        symbol_canonical: symbol,
        latency_ms: 0,
        last_received_ts: null,
        gap_count: 0,
        quarantined: false,
      };
      const next = {
        ...current,
        last_reason: this.config.requireLiveData
          ? "live_market_data_unavailable"
          : "market_data_unavailable",
      };
      this.healthBySymbol.set(symbol, next);
      this.latestFetchDiagnostics.set(symbol, {
        symbol,
        interval,
        provider: null,
        candlesFetched: 0,
        lastCandleTimestamp: null,
        latencyMs: 0,
        sourceMode: "unavailable",
        usedFallback: false,
        qualityFlag: null,
        unavailableReason: next.last_reason ?? "market_data_unavailable",
      });
      this.repository.setFeedHealth(next);
      return null;
    }
    if (!this.venueConnections.has(response.provider)) {
      await this.connect(response.provider);
    }

    const existingEvents = this.repository.getMarketEvents(symbol);
    const latestPersistedTs = existingEvents.at(-1)?.timestamp_close ?? null;
    const candlesToPersist = latestPersistedTs == null
      ? response.candles.slice(-64)
      : response.candles.filter(candle => candle.timestampClose > latestPersistedTs);

    const latestCandle: NormalizedCandle | null = response.candles.at(-1) ?? null;
    let nextSequence = this.sequenceBySymbol.get(symbol) ?? 0;
    await Promise.all(candlesToPersist.map(async candle => {
      nextSequence += 1;
      const event: CanonicalMarketEvent = {
        event_id: createId("evt"),
        ts_exchange: candle.timestampClose,
        ts_received: Date.now(),
        venue: response.provider,
        asset_class: inferAssetClass(symbol),
        symbol_raw: symbol,
        symbol_canonical: symbol,
        event_type: "ohlcv",
        sequence_number: nextSequence,
        integrity_flags: candle.qualityFlag === "clean" ? [] : [candle.qualityFlag],
        price: candle.close,
        size: candle.volume ?? undefined,
        bid: candle.close - Math.max(0.0001, candle.close * 0.0001),
        ask: candle.close + Math.max(0.0001, candle.close * 0.0001),
        spread: candle.close === 0 ? 0 : ((candle.high - candle.low) / Math.max(candle.close, 0.0001)) * 10_000,
        timeframe: candle.timeframe,
        timestamp_open: candle.timestampOpen,
        timestamp_close: candle.timestampClose,
        source: candle.source,
        quality_flag: candle.qualityFlag,
        session: candle.session,
        trading_day: candle.tradingDay,
        hour_bucket: candle.hourBucket,
        minutes_since_session_open: candle.minutesSinceSessionOpen,
        major_news_flag: candle.majorNewsFlag,
        minutes_to_next_high_impact_event: candle.minutesToNextHighImpactEvent,
        minutes_since_last_high_impact_event: candle.minutesSinceLastHighImpactEvent,
        event_type_label: candle.eventType,
      };

      await this.repository.appendMarketEvent(event, {
        timeframe: candle.timeframe,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        source: candle.source,
        qualityFlag: candle.qualityFlag,
        session: candle.session,
        tradingDay: candle.tradingDay,
        hourBucket: candle.hourBucket,
        minutesSinceSessionOpen: candle.minutesSinceSessionOpen,
        majorNewsFlag: candle.majorNewsFlag,
        minutesToNextHighImpactEvent: candle.minutesToNextHighImpactEvent,
        minutesSinceLastHighImpactEvent: candle.minutesSinceLastHighImpactEvent,
        eventType: candle.eventType,
      });
    }));
    this.sequenceBySymbol.set(symbol, nextSequence);

    if (!latestCandle) {
      return null;
    }

    this.latestFetchDiagnostics.set(symbol, {
      symbol,
      interval,
      provider: response.provider,
      candlesFetched: response.candles.length,
      lastCandleTimestamp: latestCandle.timestampClose,
      latencyMs: response.health.latencyMs,
      sourceMode: response.provider === "synthetic"
        ? "synthetic"
        : response.provider.endsWith("-cache")
          ? "cache"
          : "live",
      usedFallback: response.provider !== this.config.defaultVenue
        && response.provider !== `${this.config.defaultVenue}-cache`
        && response.provider !== "synthetic",
      qualityFlag: latestCandle.qualityFlag,
      unavailableReason: null,
    });

    const gapCount = this.detectFeedGap(symbol) ? 1 : 0;
    const health: FeedHealthMetrics = {
      symbol_canonical: symbol,
      latency_ms: response.health.latencyMs,
      last_received_ts: latestCandle.timestampClose,
      gap_count: gapCount,
      quarantined: Boolean(this.repository.getQuarantinedSymbols()[symbol]),
      last_reason: this.repository.getQuarantinedSymbols()[symbol],
      provider: response.health.provider,
      quality_flag: latestCandle.qualityFlag,
      missing_bars: response.health.missingBars,
      duplicate_bars: response.health.duplicateBars,
      out_of_order_bars: response.health.outOfOrderBars,
      stale_last_candle: response.health.staleLastCandle,
      abnormal_gap_detected: response.health.abnormalGapDetected,
    };

    this.healthBySymbol.set(symbol, health);
    this.repository.setFeedHealth(health);
    return latestCandle;
  }

  detectFeedGap(symbol: string): boolean {
    const events = this.repository.getMarketEvents(symbol);
    if (events.length < 2) {
      return false;
    }

    const last = events[events.length - 1];
    const previous = events[events.length - 2];
    return last.sequence_number - previous.sequence_number > 1;
  }

  async quarantineStream(symbol: string, reason: string): Promise<void> {
    this.repository.quarantineSymbol(symbol, reason);
    const current = this.healthBySymbol.get(symbol) ?? {
      symbol_canonical: symbol,
      latency_ms: 0,
      last_received_ts: null,
      gap_count: 0,
      quarantined: false,
    };
    const next = {
      ...current,
      quarantined: true,
      last_reason: reason,
    };
    this.healthBySymbol.set(symbol, next);
    this.repository.setFeedHealth(next);
    await this.repository.appendSystemEvent({
      event_id: createId("sysevt"),
      ts: Date.now(),
      module: "data-plant",
      type: "stream_quarantined",
      reason,
      payload: { symbol },
    });
  }

  getHealthMetrics(): FeedHealthMetrics[] {
    return [...this.healthBySymbol.values()].sort((left, right) => left.symbol_canonical.localeCompare(right.symbol_canonical));
  }

  getLatestFetchDiagnostics(symbol: string): PairMarketDataDiagnostics | null {
    return this.latestFetchDiagnostics.get(symbol) ?? null;
  }
}
