import type { AssetClass } from "@/lib/marketData/types";

const SYMBOL_TOKENS: Record<AssetClass, string[]> = {
  CRYPTO: ["BTCUSDT", "ETHUSDT", "BTCUSD", "ETHUSD"],
  FOREX: ["EURUSD", "GBPUSD", "USDJPY", "USDCAD", "AUDUSD", "NZDUSD", "USDCHF", "EURJPY", "GBPJPY"],
  COMMODITY: ["XAGUSD"],
};

export function symbolMatchesAssetClass(requestSymbol: string | null | undefined, assetClass: AssetClass): boolean {
  if (!requestSymbol) {
    return false;
  }

  const normalized = requestSymbol.toUpperCase().replace(/[^A-Z]/g, "");
  return SYMBOL_TOKENS[assetClass].some(token => normalized.includes(token.replace(/[^A-Z]/g, "")));
}
