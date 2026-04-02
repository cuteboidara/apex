import type { SessionLabel } from "@/src/interfaces/contracts";

export const CRYPTO_ACTIVE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"] as const;

export type CryptoSymbol = typeof CRYPTO_ACTIVE_SYMBOLS[number];

export const CRYPTO_DISPLAY_NAMES: Record<CryptoSymbol, string> = {
  BTCUSDT: "BTC/USD",
  ETHUSDT: "ETH/USD",
  SOLUSDT: "SOL/USD",
  BNBUSDT: "BNB/USD",
};

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

export const CRYPTO_PAIR_PROFILES: Record<CryptoSymbol, CryptoPairProfile> = {
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
};

export type CryptoVolatilityWindow =
  | "asian_open"
  | "london_cross"
  | "ny_open"
  | "late_us"
  | "low_volume";

export const CRYPTO_CYCLE_INTERVAL_MS = 15 * 60_000;

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
