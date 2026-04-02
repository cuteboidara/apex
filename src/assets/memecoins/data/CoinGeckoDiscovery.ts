import type { MemeCoinProfile } from "@/src/assets/memecoins/config/memeScope";
import {
  DEFAULT_MEME_PROFILE,
  updateMemeUniverse,
} from "@/src/assets/memecoins/config/memeScope";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_BASE = "https://pro-api.coingecko.com/api/v3";
const DISCOVERY_INTERVAL_MS = 6 * 60 * 60 * 1000;

type CoinGeckoTrendingCoin = {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
};

type CoinGeckoNewCoin = {
  id: string;
  name: string;
  symbol: string;
  activated_at: number;
};

type DiscoveryState = {
  binanceListingCache: Map<string, boolean>;
  lastDiscoveryAt: number | null;
};

const globalForMemeDiscovery = globalThis as typeof globalThis & {
  __apexMemeDiscoveryState?: DiscoveryState;
};

const state = globalForMemeDiscovery.__apexMemeDiscoveryState ??= {
  binanceListingCache: new Map<string, boolean>(),
  lastDiscoveryAt: null,
};

function getCoinGeckoBase(): string {
  return process.env.COINGECKO_API_KEY ? COINGECKO_PRO_BASE : COINGECKO_BASE;
}

function buildCoinGeckoHeaders(): HeadersInit {
  const headers: HeadersInit = { Accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
  }
  return headers;
}

export async function fetchTrendingCoins(): Promise<CoinGeckoTrendingCoin[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`${getCoinGeckoBase()}/search/trending`, {
      headers: buildCoinGeckoHeaders(),
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      console.error(`[coingecko] Trending fetch failed: ${response.status}`);
      return [];
    }

    const data = await response.json() as {
      coins?: Array<{ item: CoinGeckoTrendingCoin }>;
    };
    return data.coins?.map(entry => entry.item) ?? [];
  } catch (error) {
    console.error("[coingecko] Trending fetch error:", error);
    return [];
  }
}

export async function fetchNewListings(): Promise<CoinGeckoNewCoin[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`${getCoinGeckoBase()}/coins/list/new`, {
      headers: buildCoinGeckoHeaders(),
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as CoinGeckoNewCoin[];
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 3600);
    return data.filter(coin => coin.activated_at > sevenDaysAgo).slice(0, 10);
  } catch (error) {
    console.error("[coingecko] New listings fetch error:", error);
    return [];
  }
}

export async function isCoinOnBinance(symbol: string): Promise<boolean> {
  const binanceSymbol = `${symbol.toUpperCase()}USDT`;
  if (state.binanceListingCache.has(binanceSymbol)) {
    return state.binanceListingCache.get(binanceSymbol) ?? false;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`, {
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    const listed = response.ok;
    state.binanceListingCache.set(binanceSymbol, listed);
    return listed;
  } catch {
    state.binanceListingCache.set(binanceSymbol, false);
    return false;
  }
}

function isMemeCandidate(coin: { id: string; name: string; symbol: string }): boolean {
  const name = coin.name.toLowerCase();
  const symbol = coin.symbol.toLowerCase();
  const excludePatterns = [
    "usd", "usdt", "usdc", "dai", "frax", "busd",
    "wrapped", "wbtc", "weth",
    "lp ", "-lp", "vault",
    "bitcoin", "ethereum", "solana", "bnb",
    "chainlink", "cardano", "polkadot",
  ];

  if (excludePatterns.some(pattern => name.includes(pattern) || symbol.includes(pattern))) {
    return false;
  }

  const memeIndicators = [
    "dog", "cat", "inu", "pepe", "frog", "moon", "elon",
    "baby", "safe", "floki", "shib", "doge",
    "wif", "bonk", "meme", "wojak", "chad",
  ];

  return memeIndicators.some(indicator => name.includes(indicator) || symbol.includes(indicator));
}

export async function runCoinDiscovery(options?: { force?: boolean }): Promise<void> {
  if (!options?.force && state.lastDiscoveryAt && Date.now() - state.lastDiscoveryAt < DISCOVERY_INTERVAL_MS) {
    console.log("[coingecko] Discovery skipped - ran recently");
    return;
  }

  console.log("[coingecko] Starting coin discovery...");
  state.lastDiscoveryAt = Date.now();

  try {
    const [trendingResult, newListingsResult] = await Promise.allSettled([
      fetchTrendingCoins(),
      fetchNewListings(),
    ]);

    const candidates = [
      ...(trendingResult.status === "fulfilled"
        ? trendingResult.value.map(coin => ({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          rank: coin.market_cap_rank,
          isNew: false,
        }))
        : []),
      ...(newListingsResult.status === "fulfilled"
        ? newListingsResult.value.map(coin => ({
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol,
          rank: null,
          isNew: true,
        }))
        : []),
    ].filter(isMemeCandidate);

    const seenIds = new Set<string>();
    const uniqueCandidates = candidates.filter(candidate => {
      if (seenIds.has(candidate.id)) {
        return false;
      }
      seenIds.add(candidate.id);
      return true;
    });

    const dynamicProfiles: MemeCoinProfile[] = [];
    for (const candidate of uniqueCandidates.slice(0, 10)) {
      const binanceListed = await isCoinOnBinance(candidate.symbol);
      dynamicProfiles.push({
        symbol: `${candidate.symbol.toUpperCase()}USDT`,
        displayName: candidate.symbol.toUpperCase(),
        coingeckoId: candidate.id,
        binanceListed,
        isBase: false,
        addedAt: Date.now(),
        marketCapRank: candidate.rank,
        minConfidence: candidate.isNew ? 0.48 : DEFAULT_MEME_PROFILE.minConfidence,
        minRR: DEFAULT_MEME_PROFILE.minRR,
        volumeSpikeThreshold: candidate.isNew ? 5 : DEFAULT_MEME_PROFILE.volumeSpikeThreshold,
      });
    }

    updateMemeUniverse(dynamicProfiles);
    console.log(`[coingecko] Discovery complete - found ${dynamicProfiles.length} meme coin candidates`);
  } catch (error) {
    console.error("[coingecko] Discovery failed:", error);
  }
}

export function getLastCoinDiscoveryAt(): number | null {
  return state.lastDiscoveryAt;
}
