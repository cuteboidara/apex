import axios from "axios";

import { APEX_LLM_MODEL, getAnthropicClient } from "@/src/lib/apex-llm/client";
import { logger } from "@/src/lib/logger";
import { getCachedJson, setCachedJson } from "@/src/lib/redis";
import type { MemeScannerCoin, MemeScannerGrade, MemeScannerPayload, MemeScannerSignal, ScoredMemeScannerCoin } from "@/src/assets/memecoins/types";
import { checkAndSendMemeAlerts } from "@/src/lib/memeAlerts";

const MEME_SCANNER_CACHE_KEY = "meme:scanner:latest";
const MEME_SCANNER_CACHE_TTL_SECONDS = 180;
const PUMP_FUN_URL = "https://frontend-api.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false";
const DEXSCREENER_PROFILES_URL = "https://api.dexscreener.com/token-profiles/latest/v1";
const DEXSCREENER_TOKENS_BASE_URL = "https://api.dexscreener.com/latest/dex/tokens";
const DESIRED_CHAINS = new Set(["ethereum", "base", "bsc"]);
const DEXSCREENER_BATCH_SIZE = 25;

type PumpFunCoin = Record<string, unknown>;
type DexProfile = Record<string, unknown>;
type DexPair = Record<string, unknown>;

type ScannerScoreResult = {
  id: string;
  apexScore: number;
  grade: MemeScannerGrade;
  signal: MemeScannerSignal;
  reasoning: string;
  flags: string[];
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function toOptionalStringValue(value: unknown): string | undefined {
  const next = toStringValue(value, "");
  return next.length > 0 ? next : undefined;
}

function formatRelativeAge(launchedAt: number): string {
  const diffMs = Math.max(0, Date.now() - launchedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function toScannerGrade(score: number): MemeScannerGrade {
  if (score >= 85) return "S";
  if (score >= 75) return "A";
  if (score >= 62) return "B";
  if (score >= 48) return "C";
  return "F";
}

function toScannerSignal(score: number): MemeScannerSignal {
  if (score >= 80) return "STRONG_BUY";
  if (score >= 65) return "WATCH";
  if (score >= 45) return "NEUTRAL";
  return "AVOID";
}

function inferViralityScore(name: string, symbol: string): number {
  const text = `${name} ${symbol}`.toLowerCase();
  const indicators = ["dog", "cat", "pepe", "frog", "bonk", "wif", "moon", "chad", "wojak", "elon", "pump"];
  return clampNumber(indicators.reduce((score, indicator) => score + (text.includes(indicator) ? 8 : 0), 12), 0, 35);
}

function buildHeuristicFlags(coin: MemeScannerCoin): string[] {
  const flags = new Set<string>();
  if (coin.marketCap > 0 && coin.marketCap < 500_000) flags.add("early_gem");
  if (coin.volume24h > 0 && coin.volume1h > coin.volume24h * 0.3) flags.add("volume_spike");
  if (inferViralityScore(coin.name, coin.symbol) >= 20) flags.add("viral_name");
  if (coin.liquidity < 10_000) flags.add("low_liquidity_risk");
  if (coin.liquidity > 0 && coin.marketCap > 0 && coin.liquidity / Math.max(coin.marketCap, 1) < 0.03) flags.add("honeypot_risk");
  return [...flags];
}

function scoreCoinHeuristically(coin: MemeScannerCoin): ScannerScoreResult {
  const marketCapScore = coin.marketCap <= 0
    ? 5
    : clampNumber(35 - Math.log10(Math.max(coin.marketCap, 1)) * 5, 2, 35);
  const volumeVelocity = coin.volume1h > 0
    ? coin.volume1h / Math.max(coin.liquidity, 1)
    : 0;
  const volumeScore = clampNumber(Math.log10(Math.max(coin.volume1h, 1)) * 8 + volumeVelocity * 14, 0, 30);
  const liquidityScore = clampNumber(Math.log10(Math.max(coin.liquidity, 1)) * 6, 0, 18);
  const holdersScore = clampNumber(Math.log10(Math.max(coin.holders, 1)) * 5, 0, 12);
  const viralityScore = inferViralityScore(coin.name, coin.symbol);
  const apexScore = Math.round(clampNumber(marketCapScore + volumeScore + liquidityScore + holdersScore + viralityScore, 0, 100));
  const grade = toScannerGrade(apexScore);
  const signal = toScannerSignal(apexScore);
  const flags = buildHeuristicFlags(coin);

  return {
    id: coin.id,
    apexScore,
    grade,
    signal,
    reasoning: signal === "STRONG_BUY"
      ? "Fast early flow with enough liquidity to matter."
      : signal === "WATCH"
        ? "Momentum is forming, but it still needs cleaner follow-through."
        : signal === "NEUTRAL"
          ? "Interesting launch, but the edge is not strong enough yet."
          : "Thin structure or weak traction makes this low-trust.",
    flags,
  };
}

function normalizePumpFunCoin(raw: PumpFunCoin): MemeScannerCoin | null {
  const contractAddress = toStringValue(raw.mint ?? raw.ca ?? raw.address);
  if (!contractAddress) {
    return null;
  }

  const launchedAtRaw = toNumber(raw.created_timestamp ?? raw.createdAt ?? raw.launchTime, 0);
  const launchedAt = launchedAtRaw > 10_000_000_000 ? launchedAtRaw : launchedAtRaw * 1000;
  return {
    id: `pump:${contractAddress}`,
    name: toStringValue(raw.name, "Unknown"),
    symbol: toStringValue(raw.symbol, "PUMP"),
    chain: "solana",
    marketCap: toNumber(raw.usd_market_cap ?? raw.market_cap ?? raw.marketCap),
    volume1h: toNumber(raw.volume_1h ?? raw.volume1h ?? raw.volume_last_1h),
    volume24h: toNumber(raw.volume_24h ?? raw.volume24h ?? raw.volume_last_24h),
    liquidity: toNumber(raw.liquidity ?? raw.liquidity_usd ?? raw.raydium_pool_liquidity),
    holders: toNumber(raw.holder_count ?? raw.holders),
    priceUsd: toNumber(raw.usd_price ?? raw.price_usd ?? raw.priceUsd),
    priceChange1h: toNumber(raw.price_change_1h ?? raw.priceChange1h),
    priceChange24h: toNumber(raw.price_change_24h ?? raw.priceChange24h),
    age: launchedAt > 0 ? formatRelativeAge(launchedAt) : "unknown",
    contractAddress,
    imageUrl: toOptionalStringValue(raw.image_uri ?? raw.imageUrl ?? raw.image),
    dexUrl: toOptionalStringValue(raw.raydium_url ?? raw.dexUrl ?? raw.website),
    launchedAt,
  };
}

function normalizeDexCoin(profile: DexProfile, pair: DexPair | undefined): MemeScannerCoin | null {
  const chainId = toStringValue(pair?.chainId ?? profile.chainId).toLowerCase();
  if (!DESIRED_CHAINS.has(chainId)) {
    return null;
  }

  const baseToken = ((pair?.baseToken ?? profile.baseToken ?? {}) as Record<string, unknown>);
  const contractAddress = toStringValue(baseToken.address ?? profile.tokenAddress ?? pair?.baseTokenAddress);
  if (!contractAddress) {
    return null;
  }

  const volume = (pair?.volume ?? {}) as Record<string, unknown>;
  const liquidity = (pair?.liquidity ?? {}) as Record<string, unknown>;
  const priceChange = (pair?.priceChange ?? {}) as Record<string, unknown>;
  const info = (pair?.info ?? {}) as Record<string, unknown>;
  const launchedAtRaw = toNumber(pair?.pairCreatedAt ?? profile.createdAt ?? pair?.createdAt, 0);
  const launchedAt = launchedAtRaw > 10_000_000_000 ? launchedAtRaw : launchedAtRaw * 1000;

  return {
    id: `${chainId}:${contractAddress}`,
    name: toStringValue(baseToken.name ?? profile.name, "Unknown"),
    symbol: toStringValue(baseToken.symbol ?? profile.symbol, "MEME"),
    chain: chainId as MemeScannerCoin["chain"],
    marketCap: toNumber(pair?.marketCap ?? pair?.fdv ?? profile.marketCap ?? profile.fdv),
    volume1h: toNumber(volume.h1),
    volume24h: toNumber(volume.h24),
    liquidity: toNumber(liquidity.usd),
    holders: toNumber(info.holders ?? profile.holders),
    priceUsd: toNumber(pair?.priceUsd ?? profile.priceUsd),
    priceChange1h: toNumber(priceChange.h1),
    priceChange24h: toNumber(priceChange.h24),
    age: launchedAt > 0 ? formatRelativeAge(launchedAt) : "unknown",
    contractAddress,
    imageUrl: toOptionalStringValue(info.imageUrl ?? profile.icon),
    dexUrl: toOptionalStringValue(pair?.url ?? profile.url),
    launchedAt,
  };
}

async function fetchPumpFunCoins(): Promise<MemeScannerCoin[]> {
  const response = await axios.get<PumpFunCoin[]>(PUMP_FUN_URL, {
    timeout: 10_000,
    headers: {
      Accept: "application/json",
    },
  });

  return (response.data ?? [])
    .map(normalizePumpFunCoin)
    .filter((coin): coin is MemeScannerCoin => coin != null);
}

async function fetchDexCoins(): Promise<MemeScannerCoin[]> {
  const profilesResponse = await axios.get<DexProfile[]>(DEXSCREENER_PROFILES_URL, {
    timeout: 10_000,
    headers: {
      Accept: "application/json",
    },
  });

  const profiles = (profilesResponse.data ?? []).filter(profile =>
    DESIRED_CHAINS.has(toStringValue(profile.chainId).toLowerCase()),
  );
  const addresses = [...new Set(profiles.map(profile => toStringValue(profile.tokenAddress)).filter(Boolean))];
  const pairs: DexPair[] = [];

  for (let index = 0; index < addresses.length; index += DEXSCREENER_BATCH_SIZE) {
    const batch = addresses.slice(index, index + DEXSCREENER_BATCH_SIZE);
    if (batch.length === 0) {
      continue;
    }

    const response = await axios.get<{ pairs?: DexPair[] }>(`${DEXSCREENER_TOKENS_BASE_URL}/${batch.join(",")}`, {
      timeout: 10_000,
      headers: {
        Accept: "application/json",
      },
    });
    pairs.push(...(response.data?.pairs ?? []));
  }

  const pairByAddress = new Map<string, DexPair>();
  for (const pair of pairs) {
    const address = toStringValue(((pair.baseToken ?? {}) as Record<string, unknown>).address);
    if (!address) {
      continue;
    }

    const existing = pairByAddress.get(address);
    const nextVolume = toNumber(((pair.volume ?? {}) as Record<string, unknown>).h1);
    const existingVolume = toNumber((((existing?.volume) ?? {}) as Record<string, unknown>).h1);
    if (!existing || nextVolume > existingVolume) {
      pairByAddress.set(address, pair);
    }
  }

  return profiles
    .map(profile => normalizeDexCoin(profile, pairByAddress.get(toStringValue(profile.tokenAddress))))
    .filter((coin): coin is MemeScannerCoin => coin != null);
}

function extractAnthropicText(response: { content: Array<{ type: string; text?: string }> }): string {
  const textBlock = response.content.find(block => block.type === "text" && typeof block.text === "string");
  if (!textBlock?.text) {
    throw new Error("No text block in Anthropic response");
  }
  return textBlock.text.replace(/```json|```/g, "").trim();
}

async function scoreCoinsWithClaude(coins: MemeScannerCoin[]): Promise<ScannerScoreResult[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return coins.map(scoreCoinHeuristically);
  }

  try {
    const response = await getAnthropicClient().messages.create({
      model: APEX_LLM_MODEL,
      max_tokens: 1_200,
      system: "You are APEX's memecoin intelligence engine. You analyze newly launched memecoins and score their potential based on momentum signals. Be ruthless and direct. Score each coin 0-100 based on: early market cap (lower = more upside), volume velocity, liquidity depth, holder growth rate, and name/symbol virality potential. Return JSON only.",
      messages: [{
        role: "user",
        content: JSON.stringify(coins),
      }],
    });

    const parsed = JSON.parse(extractAnthropicText(response)) as { scores?: ScannerScoreResult[] };
    const scores = parsed.scores ?? [];
    if (scores.length === 0) {
      return coins.map(scoreCoinHeuristically);
    }
    return scores;
  } catch (error) {
    logger.warn({
      module: "meme-scanner",
      message: "Claude scoring failed, falling back to heuristic scoring",
      error: String(error),
    });
    return coins.map(scoreCoinHeuristically);
  }
}

function mergeScores(coins: MemeScannerCoin[], scores: ScannerScoreResult[]): ScoredMemeScannerCoin[] {
  const scoreMap = new Map(scores.map(score => [score.id, score]));
  return coins.map(coin => {
    const score = scoreMap.get(coin.id) ?? scoreCoinHeuristically(coin);
    return {
      ...coin,
      apexScore: clampNumber(Math.round(score.apexScore), 0, 100),
      grade: score.grade,
      signal: score.signal,
      reasoning: score.reasoning,
      flags: score.flags,
    };
  });
}

export async function getMemeScannerPayload(options?: { force?: boolean; sendAlerts?: boolean }): Promise<MemeScannerPayload> {
  if (!options?.force) {
    const cached = await getCachedJson<MemeScannerPayload>(MEME_SCANNER_CACHE_KEY);
    if (cached) {
      return cached;
    }
  }

  const [pumpCoins, dexCoins] = await Promise.allSettled([
    fetchPumpFunCoins(),
    fetchDexCoins(),
  ]);

  const mergedCoins = [
    ...(pumpCoins.status === "fulfilled" ? pumpCoins.value : []),
    ...(dexCoins.status === "fulfilled" ? dexCoins.value : []),
  ];

  const uniqueCoins = [...new Map(mergedCoins.map(coin => [coin.contractAddress, coin])).values()];
  const topCoins = uniqueCoins
    .sort((left, right) => right.volume1h - left.volume1h)
    .slice(0, 20);
  const scores = await scoreCoinsWithClaude(topCoins);
  const coins = mergeScores(topCoins, scores)
    .sort((left, right) => right.volume1h - left.volume1h);

  const alertsSent = options?.sendAlerts === false ? 0 : await checkAndSendMemeAlerts(coins);
  const payload: MemeScannerPayload = {
    generatedAt: Date.now(),
    alertsSent,
    coins,
  };

  await setCachedJson(MEME_SCANNER_CACHE_KEY, payload, MEME_SCANNER_CACHE_TTL_SECONDS);
  return payload;
}
