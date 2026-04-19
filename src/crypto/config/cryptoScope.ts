import type { SessionLabel } from "@/src/interfaces/contracts";

export const CRYPTO_ACTIVE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"] as const;
export const DEFAULT_CRYPTO_PAGE_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
] as const;

export type CryptoSymbol = string;

type CryptoNameDefinition = {
  label: string;
  displayName: string;
  coingeckoId?: string | null;
};

const CRYPTO_NAME_OVERRIDES: Record<string, CryptoNameDefinition> = {
  BTCUSDT: { label: "Bitcoin", displayName: "BTC/USD", coingeckoId: "bitcoin" },
  ETHUSDT: { label: "Ethereum", displayName: "ETH/USD", coingeckoId: "ethereum" },
  SOLUSDT: { label: "Solana", displayName: "SOL/USD", coingeckoId: "solana" },
  BNBUSDT: { label: "BNB", displayName: "BNB/USD", coingeckoId: "binancecoin" },
  XRPUSDT: { label: "XRP", displayName: "XRP/USD", coingeckoId: "ripple" },
  DOGEUSDT: { label: "Dogecoin", displayName: "DOGE/USD", coingeckoId: "dogecoin" },
  ADAUSDT: { label: "Cardano", displayName: "ADA/USD", coingeckoId: "cardano" },
  AVAXUSDT: { label: "Avalanche", displayName: "AVAX/USD", coingeckoId: "avalanche-2" },
  LINKUSDT: { label: "Chainlink", displayName: "LINK/USD", coingeckoId: "chainlink" },
  SUIUSDT: { label: "Sui", displayName: "SUI/USD", coingeckoId: "sui" },
  TONUSDT: { label: "Toncoin", displayName: "TON/USD", coingeckoId: "the-open-network" },
  TRXUSDT: { label: "TRON", displayName: "TRX/USD", coingeckoId: "tron" },
  LTCUSDT: { label: "Litecoin", displayName: "LTC/USD", coingeckoId: "litecoin" },
  SHIBUSDT: { label: "Shiba Inu", displayName: "SHIB/USD", coingeckoId: "shiba-inu" },
  PEPEUSDT: { label: "Pepe", displayName: "PEPE/USD", coingeckoId: "pepe" },
  HBARUSDT: { label: "Hedera", displayName: "HBAR/USD", coingeckoId: "hedera-hashgraph" },
  DOTUSDT: { label: "Polkadot", displayName: "DOT/USD", coingeckoId: "polkadot" },
  NEARUSDT: { label: "Near", displayName: "NEAR/USD", coingeckoId: "near" },
  APTUSDT: { label: "Aptos", displayName: "APT/USD", coingeckoId: "aptos" },
  UNIUSDT: { label: "Uniswap", displayName: "UNI/USD", coingeckoId: "uniswap" },
  BCHUSDT: { label: "Bitcoin Cash", displayName: "BCH/USD", coingeckoId: "bitcoin-cash" },
  ETCUSDT: { label: "Ethereum Classic", displayName: "ETC/USD", coingeckoId: "ethereum-classic" },
  XLMUSDT: { label: "Stellar", displayName: "XLM/USD", coingeckoId: "stellar" },
  ATOMUSDT: { label: "Cosmos", displayName: "ATOM/USD", coingeckoId: "cosmos" },
  OPUSDT: { label: "Optimism", displayName: "OP/USD", coingeckoId: "optimism" },
  ARBUSDT: { label: "Arbitrum", displayName: "ARB/USD", coingeckoId: "arbitrum" },
  FILUSDT: { label: "Filecoin", displayName: "FIL/USD", coingeckoId: "filecoin" },
  INJUSDT: { label: "Injective", displayName: "INJ/USD", coingeckoId: "injective-protocol" },
  RENDERUSDT: { label: "Render", displayName: "RENDER/USD", coingeckoId: "render-token" },
  WIFUSDT: { label: "dogwifhat", displayName: "WIF/USD", coingeckoId: "dogwifcoin" },
  BONKUSDT: { label: "Bonk", displayName: "BONK/USD", coingeckoId: "bonk" },
};

export const CRYPTO_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CRYPTO_NAME_OVERRIDES).map(([symbol, definition]) => [symbol, definition.displayName]),
);

export interface CryptoPairProfile {
  symbol: CryptoSymbol;
  displayName: string;
  minConfidence: number;
  minRR: number;
  allowedSessions: SessionLabel[];
  highVolatilityHoursUTC: number[];
  maxSignalsPerDay: number;
  cooldownMinutes: number;
  pipSize: number;
}

const ALWAYS_ON_CRYPTO_SESSIONS: SessionLabel[] = ["asia", "london", "new_york", "off_hours"];

export const CRYPTO_PAIR_PROFILES: Record<string, CryptoPairProfile> = {
  BTCUSDT: {
    symbol: "BTCUSDT",
    displayName: "BTC/USD",
    minConfidence: 0.60,
    minRR: 1.8,
    allowedSessions: [...ALWAYS_ON_CRYPTO_SESSIONS],
    highVolatilityHoursUTC: [0, 1, 2, 8, 9, 13, 14, 15, 16],
    maxSignalsPerDay: 4,
    cooldownMinutes: 60,
    pipSize: 1,
  },
  ETHUSDT: {
    symbol: "ETHUSDT",
    displayName: "ETH/USD",
    minConfidence: 0.60,
    minRR: 1.8,
    allowedSessions: [...ALWAYS_ON_CRYPTO_SESSIONS],
    highVolatilityHoursUTC: [0, 1, 2, 8, 9, 13, 14, 15, 16],
    maxSignalsPerDay: 4,
    cooldownMinutes: 60,
    pipSize: 0.1,
  },
  SOLUSDT: {
    symbol: "SOLUSDT",
    displayName: "SOL/USD",
    minConfidence: 0.62,
    minRR: 1.9,
    allowedSessions: [...ALWAYS_ON_CRYPTO_SESSIONS],
    highVolatilityHoursUTC: [0, 1, 8, 13, 14, 15],
    maxSignalsPerDay: 3,
    cooldownMinutes: 75,
    pipSize: 0.01,
  },
  BNBUSDT: {
    symbol: "BNBUSDT",
    displayName: "BNB/USD",
    minConfidence: 0.62,
    minRR: 1.9,
    allowedSessions: [...ALWAYS_ON_CRYPTO_SESSIONS],
    highVolatilityHoursUTC: [0, 1, 8, 13, 14, 15],
    maxSignalsPerDay: 3,
    cooldownMinutes: 75,
    pipSize: 0.01,
  },
  XRPUSDT: {
    symbol: "XRPUSDT",
    displayName: "XRP/USD",
    minConfidence: 0.61,
    minRR: 1.85,
    allowedSessions: [...ALWAYS_ON_CRYPTO_SESSIONS],
    highVolatilityHoursUTC: [0, 1, 8, 13, 14, 15, 20, 21],
    maxSignalsPerDay: 3,
    cooldownMinutes: 75,
    pipSize: 0.0001,
  },
  DOGEUSDT: {
    symbol: "DOGEUSDT",
    displayName: "DOGE/USD",
    minConfidence: 0.61,
    minRR: 1.85,
    allowedSessions: [...ALWAYS_ON_CRYPTO_SESSIONS],
    highVolatilityHoursUTC: [0, 1, 8, 13, 14, 15, 20, 21],
    maxSignalsPerDay: 3,
    cooldownMinutes: 75,
    pipSize: 0.00001,
  },
};

export type CryptoVolatilityWindow =
  | "asian_open"
  | "london_cross"
  | "ny_open"
  | "late_us"
  | "low_volume";

export const CRYPTO_CYCLE_INTERVAL_MS = 15 * 60_000;

function normalizeCryptoSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function getCryptoShortSymbol(symbol: string): string {
  const normalized = normalizeCryptoSymbol(symbol);
  const base = normalized.endsWith("USDT")
    ? normalized.slice(0, -4)
    : normalized.endsWith("USD")
      ? normalized.slice(0, -3)
      : normalized;
  return base || normalized;
}

export function getCryptoDisplayName(symbol: string): string {
  const normalized = normalizeCryptoSymbol(symbol);
  return CRYPTO_NAME_OVERRIDES[normalized]?.displayName ?? `${getCryptoShortSymbol(normalized)}/USD`;
}

export function getCryptoLabel(symbol: string): string {
  const normalized = normalizeCryptoSymbol(symbol);
  return CRYPTO_NAME_OVERRIDES[normalized]?.label ?? getCryptoShortSymbol(normalized);
}

export function getCoinGeckoIdForSymbol(symbol: string): string | null {
  const normalized = normalizeCryptoSymbol(symbol);
  return CRYPTO_NAME_OVERRIDES[normalized]?.coingeckoId ?? null;
}

export function getTradingViewCryptoSymbol(symbol: string): string {
  return `BINANCE:${normalizeCryptoSymbol(symbol)}`;
}

export function resolveCryptoPairProfile(symbol: string): CryptoPairProfile {
  const normalized = normalizeCryptoSymbol(symbol);
  const existing = CRYPTO_PAIR_PROFILES[normalized];
  if (existing) {
    return existing;
  }

  const short = getCryptoShortSymbol(normalized);
  const isLargeCap = ["BTC", "ETH"].includes(short);
  const isMajorAlt = ["SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "TRX", "TON", "SUI"].includes(short);

  return {
    symbol: normalized,
    displayName: getCryptoDisplayName(normalized),
    minConfidence: isLargeCap ? 0.60 : isMajorAlt ? 0.61 : 0.62,
    minRR: isLargeCap ? 1.8 : isMajorAlt ? 1.85 : 1.9,
    allowedSessions: [...ALWAYS_ON_CRYPTO_SESSIONS],
    highVolatilityHoursUTC: isLargeCap
      ? [0, 1, 2, 8, 9, 13, 14, 15, 16]
      : [0, 1, 8, 13, 14, 15, 20, 21],
    maxSignalsPerDay: isLargeCap ? 4 : 3,
    cooldownMinutes: isLargeCap ? 60 : 75,
    pipSize: normalized.includes("SHIB") || normalized.includes("PEPE") || normalized.includes("BONK")
      ? 0.00000001
      : normalized.includes("DOGE")
        ? 0.00001
        : normalized.includes("XRP")
          ? 0.0001
          : 0.01,
  };
}

export function getCryptoVolatilityWindow(utcHour: number): CryptoVolatilityWindow {
  if (utcHour >= 0 && utcHour < 4) return "asian_open";
  if (utcHour >= 7 && utcHour < 10) return "london_cross";
  if (utcHour >= 13 && utcHour < 16) return "ny_open";
  if (utcHour >= 20 && utcHour < 24) return "late_us";
  return "low_volume";
}

export function isCryptoWeekend(date = new Date()): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}
