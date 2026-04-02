import type { CryptoSymbol } from "@/src/crypto/config/cryptoScope";

const VALID_BINANCE_SYMBOLS = new Set<CryptoSymbol>(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);

export function toBinanceSymbol(symbol: CryptoSymbol): string {
  return symbol;
}

export function fromBinanceSymbol(binanceSymbol: string): CryptoSymbol | null {
  return VALID_BINANCE_SYMBOLS.has(binanceSymbol as CryptoSymbol)
    ? binanceSymbol as CryptoSymbol
    : null;
}

export const BINANCE_KLINE_INTERVAL = "15m";
export const BINANCE_KLINE_LIMIT = 100;
