import type { SessionLabel } from "@/src/interfaces/contracts";

export const APEX_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"] as const;
export type ApexSymbol = typeof APEX_SYMBOLS[number];

export const ENTRY_STYLES = ["trend_pullback", "session_breakout", "range_reversal"] as const;
export type EntryStyle = typeof ENTRY_STYLES[number];

export const TRADING_SESSIONS = ["asia", "london", "new_york"] as const;
export type TradingSession = typeof TRADING_SESSIONS[number];

export type SymbolScopeSkipReason = "SYMBOL_NOT_ACTIVE" | "SYMBOL_NOT_SUPPORTED";
export type EntryStyleSkipReason = "ENTRY_STYLE_DISABLED";
export type PairProfileSkipReason =
  | "PAIR_CONFIDENCE_BELOW_MIN"
  | "PAIR_RR_BELOW_MIN"
  | "PAIR_SESSION_NOT_ALLOWED"
  | "PAIR_SIGNAL_LIMIT_REACHED";
export type PodScopeSkipReason = EntryStyleSkipReason | "POD_NOT_IN_SCOPE";

export interface PairTradingProfile {
  minConfidence: number;
  minRiskReward: number;
  allowedSessions: TradingSession[];
  preferredSessions: TradingSession[];
  avoidSessions: SessionLabel[];
  maxSignalsPerDay: number;
  cooldownMinutes: number;
  atrToleranceMultiplier: number;
}

export interface MarketScopeConfig {
  supportedSymbols: ApexSymbol[];
  defaultActiveSymbols: ApexSymbol[];
  primaryEntryStyle: EntryStyle;
  enabledEntryStyles: EntryStyle[];
  disabledEntryStyles: EntryStyle[];
  pairProfiles: Partial<Record<ApexSymbol, PairTradingProfile>>;
}

export interface SymbolScopeSkip {
  symbol: string;
  reason: SymbolScopeSkipReason;
}

export interface PodScopeSkip {
  podId: string;
  reason: PodScopeSkipReason;
  entryStyle?: EntryStyle;
}

export const ENTRY_STYLE_POD_MAP: Record<EntryStyle, string[]> = {
  trend_pullback: ["trend"],
  session_breakout: ["breakout"],
  range_reversal: ["mean-reversion"],
};

export const SUPPORT_POD_IDS = ["volatility-regime", "execution-advisory"] as const;

// Live APEX scope stays constrained to liquid FX majors while all three entry styles remain available.
export const defaultMarketScopeConfig: MarketScopeConfig = {
  supportedSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
  defaultActiveSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
  primaryEntryStyle: "trend_pullback",
  enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
  disabledEntryStyles: [],
  pairProfiles: {
    EURUSD: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["london", "new_york"],
      preferredSessions: ["london", "new_york"],
      avoidSessions: ["asia", "off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 45,
      atrToleranceMultiplier: 1,
    },
    GBPUSD: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["london", "new_york"],
      preferredSessions: ["london", "new_york"],
      avoidSessions: ["asia", "off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 45,
      atrToleranceMultiplier: 1.05,
    },
    USDJPY: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["asia", "london", "new_york"],
      preferredSessions: ["asia", "london"],
      avoidSessions: ["off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 40,
      atrToleranceMultiplier: 1,
    },
    EURJPY: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["asia", "london", "new_york"],
      preferredSessions: ["london"],
      avoidSessions: ["off_hours"],
      maxSignalsPerDay: 3,
      cooldownMinutes: 50,
      atrToleranceMultiplier: 1.1,
    },
    AUDUSD: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["asia", "london", "new_york"],
      preferredSessions: ["asia", "london"],
      avoidSessions: ["off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 40,
      atrToleranceMultiplier: 1.05,
    },
    NZDUSD: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["asia", "london", "new_york"],
      preferredSessions: ["asia"],
      avoidSessions: ["off_hours"],
      maxSignalsPerDay: 3,
      cooldownMinutes: 45,
      atrToleranceMultiplier: 1.05,
    },
    USDCHF: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["london", "new_york"],
      preferredSessions: ["london", "new_york"],
      avoidSessions: ["asia", "off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 45,
      atrToleranceMultiplier: 1,
    },
    USDCAD: {
      minConfidence: 0.52,
      minRiskReward: 1.5,
      allowedSessions: ["london", "new_york"],
      preferredSessions: ["new_york"],
      avoidSessions: ["asia", "off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 45,
      atrToleranceMultiplier: 1.05,
    },
  },
};

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function getKnownSymbols(config: MarketScopeConfig = defaultMarketScopeConfig): ApexSymbol[] {
  return dedupe(config.supportedSymbols) as ApexSymbol[];
}

export function isKnownSymbol(symbol: string, config: MarketScopeConfig = defaultMarketScopeConfig): symbol is ApexSymbol {
  return getKnownSymbols(config).includes(symbol as ApexSymbol);
}

export function isSupportedSymbol(symbol: string, config: MarketScopeConfig = defaultMarketScopeConfig): symbol is ApexSymbol {
  return config.supportedSymbols.includes(symbol as ApexSymbol);
}

export function isSymbolActive(symbol: string, activeSymbols: readonly string[]): symbol is ApexSymbol {
  return activeSymbols.includes(symbol);
}

export function evaluateSymbolScope(
  symbol: string,
  activeSymbols: readonly string[],
  config: MarketScopeConfig = defaultMarketScopeConfig,
): { allowed: boolean; reason?: SymbolScopeSkipReason } {
  if (!isKnownSymbol(symbol, config)) {
    return {
      allowed: false,
      reason: "SYMBOL_NOT_SUPPORTED",
    };
  }

  if (!isSupportedSymbol(symbol, config) || !isSymbolActive(symbol, activeSymbols)) {
    return {
      allowed: false,
      reason: "SYMBOL_NOT_ACTIVE",
    };
  }

  return { allowed: true };
}

export function resolveActiveSymbols(
  requestedSymbols: readonly string[] | undefined,
  config: MarketScopeConfig = defaultMarketScopeConfig,
): {
  activeSymbols: ApexSymbol[];
  skippedSymbols: SymbolScopeSkip[];
} {
  const candidates = requestedSymbols != null && requestedSymbols.length > 0
    ? requestedSymbols
    : config.defaultActiveSymbols;
  const activeSymbols: ApexSymbol[] = [];
  const skippedSymbols: SymbolScopeSkip[] = [];

  for (const symbol of dedupe(candidates)) {
    if (!isKnownSymbol(symbol, config)) {
      skippedSymbols.push({
        symbol,
        reason: "SYMBOL_NOT_SUPPORTED",
      });
      continue;
    }

    if (!isSupportedSymbol(symbol, config)) {
      skippedSymbols.push({
        symbol,
        reason: "SYMBOL_NOT_ACTIVE",
      });
      continue;
    }

    activeSymbols.push(symbol);
  }

  return {
    activeSymbols: activeSymbols.length > 0 ? activeSymbols : [...config.defaultActiveSymbols],
    skippedSymbols,
  };
}

export function getEnabledEntryPods(config: MarketScopeConfig = defaultMarketScopeConfig): string[] {
  return dedupe(config.enabledEntryStyles.flatMap(style => ENTRY_STYLE_POD_MAP[style] ?? []));
}

export function getDefaultScopedPodIds(config: MarketScopeConfig = defaultMarketScopeConfig): string[] {
  return dedupe([...getEnabledEntryPods(config), ...SUPPORT_POD_IDS]);
}

export function getEntryStyleForPod(podId: string): EntryStyle | null {
  for (const style of ENTRY_STYLES) {
    if ((ENTRY_STYLE_POD_MAP[style] ?? []).includes(podId)) {
      return style;
    }
  }

  return null;
}

export function resolveScopedPodIds(
  requestedPodIds: readonly string[] | undefined,
  config: MarketScopeConfig = defaultMarketScopeConfig,
): {
  activePods: string[];
  skippedPods: PodScopeSkip[];
} {
  // Future strategy expansion should extend the style-to-pod map here instead of scattering pod gates.
  const candidates = requestedPodIds != null && requestedPodIds.length > 0
    ? requestedPodIds
    : getDefaultScopedPodIds(config);
  const activePods: string[] = [];
  const skippedPods: PodScopeSkip[] = [];

  for (const podId of dedupe(candidates)) {
    if ((SUPPORT_POD_IDS as readonly string[]).includes(podId)) {
      activePods.push(podId);
      continue;
    }

    const entryStyle = getEntryStyleForPod(podId);
    if (!entryStyle) {
      skippedPods.push({
        podId,
        reason: "POD_NOT_IN_SCOPE",
      });
      continue;
    }

    if (!config.enabledEntryStyles.includes(entryStyle)) {
      skippedPods.push({
        podId,
        reason: "ENTRY_STYLE_DISABLED",
        entryStyle,
      });
      continue;
    }

    activePods.push(podId);
  }

  return { activePods, skippedPods };
}

export function isEntryStyleEnabled(
  style: EntryStyle,
  config: MarketScopeConfig = defaultMarketScopeConfig,
): boolean {
  return config.enabledEntryStyles.includes(style);
}

export function getCurrentTradingSession(ts: number): TradingSession {
  const hourUtc = new Date(ts).getUTCHours();
  if (hourUtc < 7) {
    return "asia";
  }
  if (hourUtc < 13) {
    return "london";
  }
  return "new_york";
}

export function getPairTradingProfile(
  symbol: string,
  config: MarketScopeConfig = defaultMarketScopeConfig,
): PairTradingProfile | null {
  if (!isKnownSymbol(symbol, config)) {
    return null;
  }

  return config.pairProfiles[symbol] ?? null;
}
