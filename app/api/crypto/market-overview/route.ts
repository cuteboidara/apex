import { NextResponse } from "next/server";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type MarketOverviewPayload = {
  totalMarketCap: number | null;
  totalVolume24h: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  marketCapChange24h: number | null;
  activeCryptos: number | null;
};

const CACHE_KEY = "crypto:market:global";
const CACHE_TTL_SECONDS = 120;

export async function GET() {
  const cached = await getCachedJson<MarketOverviewPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const response = await fetch("https://api.coingecko.com/api/v3/global", {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko global failed with ${response.status}`);
    }

    const payload = await response.json() as {
      data?: {
        total_market_cap?: Record<string, number>;
        total_volume?: Record<string, number>;
        market_cap_percentage?: Record<string, number>;
        market_cap_change_percentage_24h_usd?: number;
        active_cryptocurrencies?: number;
      };
    };

    const output: MarketOverviewPayload = {
      totalMarketCap: payload.data?.total_market_cap?.usd ?? null,
      totalVolume24h: payload.data?.total_volume?.usd ?? null,
      btcDominance: payload.data?.market_cap_percentage?.btc ?? null,
      ethDominance: payload.data?.market_cap_percentage?.eth ?? null,
      marketCapChange24h: payload.data?.market_cap_change_percentage_24h_usd ?? null,
      activeCryptos: payload.data?.active_cryptocurrencies ?? null,
    };

    await setCachedJson(CACHE_KEY, output, CACHE_TTL_SECONDS);
    return NextResponse.json(output);
  } catch (error) {
    console.error("[api/crypto/market-overview] Failed:", error);
    return NextResponse.json({
      totalMarketCap: null,
      totalVolume24h: null,
      btcDominance: null,
      ethDominance: null,
      marketCapChange24h: null,
      activeCryptos: null,
    } satisfies MarketOverviewPayload);
  }
}
