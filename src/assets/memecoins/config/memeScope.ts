export const MEME_BASE_SYMBOLS = ["DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "WIFUSDT"] as const;

export type MemeBaseSymbol = typeof MEME_BASE_SYMBOLS[number];

export const MEME_MAX_UNIVERSE = 20;

export const BASE_COINGECKO_IDS: Record<MemeBaseSymbol, string> = {
  DOGEUSDT: "dogecoin",
  SHIBUSDT: "shiba-inu",
  PEPEUSDT: "pepe",
  WIFUSDT: "dogwifcoin",
};

export interface MemeCoinProfile {
  symbol: string;
  displayName: string;
  coingeckoId: string;
  binanceListed: boolean;
  isBase: boolean;
  addedAt: number;
  marketCapRank: number | null;
  minConfidence: number;
  minRR: number;
  volumeSpikeThreshold: number;
}

export const DEFAULT_MEME_PROFILE: Omit<
  MemeCoinProfile,
  "symbol" | "displayName" | "coingeckoId" | "binanceListed" | "isBase" | "addedAt" | "marketCapRank"
> = {
  minConfidence: 0.52,
  minRR: 1.6,
  volumeSpikeThreshold: 3,
};

export const BASE_MEME_PROFILES: Record<
  MemeBaseSymbol,
  Omit<MemeCoinProfile, "coingeckoId" | "binanceListed" | "isBase" | "addedAt" | "marketCapRank">
> = {
  DOGEUSDT: { symbol: "DOGEUSDT", displayName: "DOGE", minConfidence: 0.55, minRR: 1.7, volumeSpikeThreshold: 2.5 },
  SHIBUSDT: { symbol: "SHIBUSDT", displayName: "SHIB", minConfidence: 0.55, minRR: 1.7, volumeSpikeThreshold: 2.5 },
  PEPEUSDT: { symbol: "PEPEUSDT", displayName: "PEPE", minConfidence: 0.53, minRR: 1.6, volumeSpikeThreshold: 3 },
  WIFUSDT: { symbol: "WIFUSDT", displayName: "WIF", minConfidence: 0.53, minRR: 1.6, volumeSpikeThreshold: 3 },
};

type MemeScopeState = {
  dynamicUniverse: MemeCoinProfile[];
};

const globalForMemeScope = globalThis as typeof globalThis & {
  __apexMemeScopeState?: MemeScopeState;
};

function buildBaseUniverse(): MemeCoinProfile[] {
  const addedAt = Date.now();
  return MEME_BASE_SYMBOLS.map(symbol => {
    const baseProfile = BASE_MEME_PROFILES[symbol];
    return {
      symbol,
      displayName: baseProfile.displayName,
      coingeckoId: BASE_COINGECKO_IDS[symbol],
      binanceListed: true,
      isBase: true,
      addedAt,
      marketCapRank: null,
      minConfidence: baseProfile.minConfidence,
      minRR: baseProfile.minRR,
      volumeSpikeThreshold: baseProfile.volumeSpikeThreshold,
    };
  });
}

const state = globalForMemeScope.__apexMemeScopeState ??= {
  dynamicUniverse: buildBaseUniverse(),
};

export function getMemeUniverse(): MemeCoinProfile[] {
  return [...state.dynamicUniverse];
}

export function updateMemeUniverse(profiles: MemeCoinProfile[]): void {
  const baseProfiles = buildBaseUniverse();
  const seenSymbols = new Set(baseProfiles.map(profile => profile.symbol));
  const dynamicProfiles: MemeCoinProfile[] = [];

  for (const profile of profiles) {
    if (profile.isBase || seenSymbols.has(profile.symbol)) {
      continue;
    }

    seenSymbols.add(profile.symbol);
    dynamicProfiles.push(profile);
  }

  state.dynamicUniverse = [...baseProfiles, ...dynamicProfiles].slice(0, MEME_MAX_UNIVERSE);
  console.log(
    `[meme-scope] Universe updated: ${state.dynamicUniverse.length} coins (${baseProfiles.length} base + ${dynamicProfiles.length} dynamic)`,
  );
}

export function getMemeCoinBySymbol(symbol: string): MemeCoinProfile | undefined {
  return state.dynamicUniverse.find(profile => profile.symbol === symbol);
}

export function resetMemeUniverseForTests(): void {
  state.dynamicUniverse = buildBaseUniverse();
}
