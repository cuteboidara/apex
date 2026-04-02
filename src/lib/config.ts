import { z } from "zod";

import {
  defaultMarketScopeConfig,
  getDefaultScopedPodIds,
  resolveActiveSymbols,
  resolveScopedPodIds,
  type ApexSymbol,
  type EntryStyle,
  type MarketScopeConfig,
  type PairTradingProfile,
  type PodScopeSkip,
  type SymbolScopeSkip,
} from "@/src/config/marketScope";
import { getEnabledForexSymbols, readAssetActivationState } from "@/src/config/assetActivation";
import type { RecoveryMode } from "@/src/interfaces/contracts";
import { TRADER_SIGNAL_GRADES, type TraderSignalGrade } from "@/src/lib/traderContracts";

const configSchema = z.object({
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  OANDA_API_TOKEN: z.string().optional(),
  OANDA_ENV: z.enum(["practice", "live"]).default("practice"),
  OANDA_API_BASE_URL: z.string().optional(),
  APEX_MODE: z.enum(["paper", "live"]).default("paper"),
  CYCLE_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  MAX_GROSS_EXPOSURE: z.coerce.number().positive().default(1),
  MAX_NET_EXPOSURE: z.coerce.number().positive().default(0.5),
  DRAWDOWN_WARNING_PCT: z.coerce.number().positive().default(3),
  DRAWDOWN_HARD_LIMIT_PCT: z.coerce.number().positive().default(5),
  MAX_SLIPPAGE_BPS: z.coerce.number().positive().default(15),
  ACTIVE_SYMBOLS: z.string().default(defaultMarketScopeConfig.defaultActiveSymbols.join(",")),
  ACTIVE_PODS: z.string().default(getDefaultScopedPodIds(defaultMarketScopeConfig).join(",")),
  DEFAULT_VENUE: z
    .string()
    .default("oanda")
    .transform(value => value === "fx-primary" ? "oanda" : value)
    .pipe(z.enum(["oanda", "yahoo-finance"])),
  APEX_REQUIRE_LIVE_DATA: z
    .string()
    .default("true")
    .transform(value => value !== "false"),
  BLOCK_HIGH_VOL_CHAOTIC: z
    .string()
    .default("true")
    .transform(value => value !== "false"),
  MAX_ACTIVE_SYMBOLS: z.coerce.number().int().positive().default(6),
  MAX_SYMBOL_POSITION: z.coerce.number().positive().default(0.2),
  MAX_NOTIONAL_USD: z.coerce.number().positive().default(100000),
  VOLATILITY_TARGET: z.coerce.number().positive().default(0.3),
  DEFAULT_RECOVERY_MODE: z
    .enum([
      "normal",
      "reduced_confidence",
      "reduced_size",
      "pod_quarantine",
      "execution_only",
      "flat_and_observe",
      "full_stop",
    ] satisfies RecoveryMode[])
    .default("normal"),
  APEX_TELEGRAM_MIN_GRADE: z.enum(TRADER_SIGNAL_GRADES).default("B"),
  APEX_TELEGRAM_INCLUDE_B_SIGNALS: z
    .string()
    .default("true")
    .transform(value => value === "true"),
  APEX_DASHBOARD_SHOW_BLOCKED_SIGNALS: z
    .string()
    .default("false")
    .transform(value => value === "true"),
  APEX_SHOW_ADVANCED_INTERNALS: z
    .string()
    .default("false")
    .transform(value => value === "true"),
});

export type ApexConfig = {
  databaseUrl?: string;
  redisUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  oandaApiToken?: string;
  oandaEnvironment?: "practice" | "live";
  oandaApiBaseUrl?: string;
  mode: "paper" | "live";
  cycleIntervalMinutes: number;
  maxGrossExposure: number;
  maxNetExposure: number;
  drawdownWarningPct: number;
  drawdownHardLimitPct: number;
  maxSlippageBps: number;
  marketScope: MarketScopeConfig;
  activeSymbols: ApexSymbol[];
  primaryEntryStyle: EntryStyle;
  enabledEntryStyles: EntryStyle[];
  disabledEntryStyles: EntryStyle[];
  pairProfiles: Partial<Record<ApexSymbol, PairTradingProfile>>;
  scopeSkips: {
    symbols: SymbolScopeSkip[];
    pods: PodScopeSkip[];
  };
  activePods: string[];
  defaultVenue: "oanda" | "yahoo-finance";
  requireLiveData: boolean;
  blockHighVolChaotic: boolean;
  maxActiveSymbols: number;
  maxSymbolPosition: number;
  maxNotionalUsd: number;
  volatilityTarget: number;
  defaultRecoveryMode: RecoveryMode;
  minimumTelegramGrade: TraderSignalGrade;
  includeBTelegramSignals: boolean;
  showBlockedSignalsOnMainDashboard: boolean;
  showAdvancedInternals: boolean;
};

let cachedConfig: ApexConfig | null = null;

function parseList(value: string): string[] {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

function clonePairProfile(profile: PairTradingProfile): PairTradingProfile {
  return {
    ...profile,
    allowedSessions: [...profile.allowedSessions],
    preferredSessions: [...profile.preferredSessions],
    avoidSessions: [...profile.avoidSessions],
  };
}

function cloneMarketScopeConfig(config: MarketScopeConfig): MarketScopeConfig {
  return {
    supportedSymbols: [...config.supportedSymbols],
    defaultActiveSymbols: [...config.defaultActiveSymbols],
    primaryEntryStyle: config.primaryEntryStyle,
    enabledEntryStyles: [...config.enabledEntryStyles],
    disabledEntryStyles: [...config.disabledEntryStyles],
    pairProfiles: Object.fromEntries(
      Object.entries(config.pairProfiles).map(([pair, profile]) => [pair, profile ? clonePairProfile(profile) : profile]),
    ) as Partial<Record<ApexSymbol, PairTradingProfile>>,
  };
}

export function loadApexConfig(env: NodeJS.ProcessEnv = process.env): ApexConfig {
  const parsed = configSchema.parse(env);
  const assetActivation = readAssetActivationState();
  const marketScope = cloneMarketScopeConfig(defaultMarketScopeConfig);
  const requestedSymbols = parseList(parsed.ACTIVE_SYMBOLS);
  const requestedPods = parseList(parsed.ACTIVE_PODS);
  const { activeSymbols: resolvedActiveSymbols, skippedSymbols } = resolveActiveSymbols(
    requestedSymbols.length > 0 ? requestedSymbols : undefined,
    marketScope,
  );
  const activeSymbols = getEnabledForexSymbols(resolvedActiveSymbols, assetActivation);
  const disabledByAssetControls = resolvedActiveSymbols
    .filter(symbol => !activeSymbols.includes(symbol))
    .map(symbol => ({
      symbol,
      reason: "SYMBOL_NOT_ACTIVE" as const,
    }));
  const { activePods, skippedPods } = resolveScopedPodIds(
    requestedPods.length > 0 ? requestedPods : undefined,
    marketScope,
  );

  return {
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,
    oandaApiToken: parsed.OANDA_API_TOKEN,
    oandaEnvironment: parsed.OANDA_ENV,
    oandaApiBaseUrl: parsed.OANDA_API_BASE_URL,
    mode: parsed.APEX_MODE,
    cycleIntervalMinutes: parsed.CYCLE_INTERVAL_MINUTES,
    maxGrossExposure: parsed.MAX_GROSS_EXPOSURE,
    maxNetExposure: parsed.MAX_NET_EXPOSURE,
    drawdownWarningPct: parsed.DRAWDOWN_WARNING_PCT,
    drawdownHardLimitPct: parsed.DRAWDOWN_HARD_LIMIT_PCT,
    maxSlippageBps: parsed.MAX_SLIPPAGE_BPS,
    marketScope,
    activeSymbols,
    primaryEntryStyle: marketScope.primaryEntryStyle,
    enabledEntryStyles: [...marketScope.enabledEntryStyles],
    disabledEntryStyles: [...marketScope.disabledEntryStyles],
    pairProfiles: Object.fromEntries(
      Object.entries(marketScope.pairProfiles).map(([pair, profile]) => [pair, profile ? clonePairProfile(profile) : profile]),
    ) as Partial<Record<ApexSymbol, PairTradingProfile>>,
    scopeSkips: {
      symbols: [...skippedSymbols, ...disabledByAssetControls],
      pods: skippedPods,
    },
    activePods,
    defaultVenue: parsed.DEFAULT_VENUE,
    requireLiveData: parsed.APEX_REQUIRE_LIVE_DATA,
    blockHighVolChaotic: parsed.BLOCK_HIGH_VOL_CHAOTIC,
    maxActiveSymbols: parsed.MAX_ACTIVE_SYMBOLS,
    maxSymbolPosition: parsed.MAX_SYMBOL_POSITION,
    maxNotionalUsd: parsed.MAX_NOTIONAL_USD,
    volatilityTarget: parsed.VOLATILITY_TARGET,
    defaultRecoveryMode: parsed.DEFAULT_RECOVERY_MODE,
    minimumTelegramGrade: parsed.APEX_TELEGRAM_MIN_GRADE,
    includeBTelegramSignals: parsed.APEX_TELEGRAM_INCLUDE_B_SIGNALS,
    showBlockedSignalsOnMainDashboard: parsed.APEX_DASHBOARD_SHOW_BLOCKED_SIGNALS,
    showAdvancedInternals: parsed.APEX_SHOW_ADVANCED_INTERNALS,
  };
}

export function getApexConfig(): ApexConfig {
  cachedConfig ??= loadApexConfig();
  return cachedConfig;
}

export function resetApexConfigForTests(): void {
  cachedConfig = null;
}
