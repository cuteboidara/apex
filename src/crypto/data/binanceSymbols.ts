import type { CryptoSymbol } from "@/src/crypto/config/cryptoScope";

function normalize(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function toBinanceSymbol(symbol: CryptoSymbol): string {
  return normalize(symbol);
}

export function fromBinanceSymbol(binanceSymbol: string): CryptoSymbol | null {
  const normalized = normalize(binanceSymbol);
  if (!normalized.endsWith("USDT")) {
    return null;
  }
  return normalized;
}

export const BINANCE_KLINE_INTERVAL = "15m";
export const BINANCE_KLINE_LIMIT = 100;
