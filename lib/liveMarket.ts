import { SUPPORTED_ASSETS } from "@/lib/assets";
import { fetchCommodityData, fetchCryptoData, fetchForexData } from "@/lib/marketData";

const STALE_THRESHOLD_MS = 90 * 1000;

export type LiveMarketPrice = {
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
  freshnessClass: "fresh" | "stale" | "expired" | null;
  sourceType: "fresh" | "cache" | "stale-cache" | "fallback" | null;
  providerHealthScore: number | null;
  degraded: boolean;
  circuitState: string | null;
  candleProviders?: Record<string, {
    selectedProvider: string | null;
    fallbackUsed: boolean;
    freshnessMs: number | null;
    circuitState: string | null;
    marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
    reason: string | null;
    sourceType?: "fresh" | "cache" | "stale-cache" | "fallback";
    freshnessClass?: "fresh" | "stale" | "expired";
    degraded?: boolean;
    providerHealthScore?: number | null;
  }> | null;
  styleReadiness: Record<"SCALP" | "INTRADAY" | "SWING", { ready: boolean; missing: string[]; stale: string[] }> | null;
};

export async function fetchLiveMarketPrices(): Promise<LiveMarketPrice[]> {
  const settled = await Promise.allSettled(
    SUPPORTED_ASSETS.map(async asset => {
      if (asset.assetClass === "CRYPTO" && asset.binanceSymbol) {
        const quote = await fetchCryptoData(asset.binanceSymbol, { consumer: "dashboard", priority: "warm" });
        const currentPrice = quote.price != null && quote.price > 0 ? quote.price : null;
        return {
          symbol: asset.symbol,
          assetClass: asset.assetClass,
          currentPrice,
          change24h: quote.change24h ?? null,
          changePct: quote.change24h ?? null,
          high: quote.high14d ?? null,
          low: quote.low14d ?? null,
          volume: quote.volume ?? null,
          provider: quote.provider ?? asset.provider,
          updatedAt: quote.updatedAt ?? new Date().toISOString(),
          stale: quote.stale,
          marketStatus: quote.marketStatus,
          reason: quote.reason,
          selectedProvider: quote.provider ?? asset.provider,
          fallbackUsed: quote.fallbackUsed ?? false,
          freshnessMs: quote.freshnessMs ?? null,
          freshnessClass: quote.freshnessClass ?? null,
          sourceType: quote.sourceType ?? null,
          providerHealthScore: quote.providerHealthScore ?? null,
          degraded: quote.degraded ?? quote.marketStatus !== "LIVE",
          circuitState: quote.circuitState ?? null,
          candleProviders: quote.candleProviders ?? null,
          styleReadiness: quote.readiness ?? null,
        } satisfies LiveMarketPrice;
      }

      const from = asset.symbol.slice(0, 3);
      const to = asset.symbol.slice(3, 6);
      const quote = asset.assetClass === "COMMODITY"
        ? await fetchCommodityData(from, { consumer: "dashboard", priority: "warm" })
        : await fetchForexData(from, to, { consumer: "dashboard", priority: "warm" });
      const currentPrice = quote?.price != null && quote.price > 0 ? quote.price : null;
      const updatedAt = quote?.updatedAt ?? new Date().toISOString();
      const marketStatus = quote?.marketStatus ?? (currentPrice != null ? "LIVE" : "UNAVAILABLE");
      const reason = currentPrice != null ? quote?.reason ?? null : quote?.reason ?? "Market quote unavailable.";

      return {
        symbol: asset.symbol,
        assetClass: asset.assetClass,
        currentPrice,
        change24h: quote?.change24h ?? null,
        changePct: quote?.change24h ?? null,
        high: quote?.high14d ?? null,
        low: quote?.low14d ?? null,
        volume: null,
        provider: quote?.provider ?? asset.provider,
        updatedAt,
        stale: marketStatus !== "LIVE" || currentPrice == null || currentPrice <= 0 || (Date.now() - new Date(updatedAt).getTime()) > STALE_THRESHOLD_MS,
        marketStatus,
        reason,
        selectedProvider: quote?.provider ?? asset.provider,
        fallbackUsed: quote?.fallbackUsed ?? false,
        freshnessMs: quote?.freshnessMs ?? null,
        freshnessClass: quote?.freshnessClass ?? null,
        sourceType: quote?.sourceType ?? null,
        providerHealthScore: quote?.providerHealthScore ?? null,
        degraded: quote?.degraded ?? marketStatus !== "LIVE",
        circuitState: quote?.circuitState ?? null,
        candleProviders: quote?.candleProviders ?? null,
        styleReadiness: quote?.readiness ?? null,
      } satisfies LiveMarketPrice;
    })
  );

  return settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const asset = SUPPORTED_ASSETS[index];
    return {
      symbol: asset.symbol,
      assetClass: asset.assetClass,
      currentPrice: null,
      change24h: null,
      changePct: null,
      high: null,
      low: null,
      volume: null,
      provider: asset.provider,
      updatedAt: new Date().toISOString(),
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: "Quote pipeline failed.",
      selectedProvider: asset.provider,
      fallbackUsed: false,
      freshnessMs: null,
      freshnessClass: null,
      sourceType: null,
      providerHealthScore: null,
      degraded: true,
      circuitState: null,
      candleProviders: null,
      styleReadiness: null,
    } satisfies LiveMarketPrice;
  });
}
