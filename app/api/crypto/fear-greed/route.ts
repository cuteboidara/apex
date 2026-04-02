import { NextResponse } from "next/server";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type FearGreedPayload = {
  value: number | null;
  label: string | null;
  timestamp: string | null;
};

const CACHE_KEY = "crypto:feargreed:latest";
const CACHE_TTL_SECONDS = 60 * 60;

export async function GET() {
  const cached = await getCachedJson<FearGreedPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const response = await fetch("https://api.alternative.me/fng/?limit=1", {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Fear & Greed feed failed with ${response.status}`);
    }

    const payload = await response.json() as {
      data?: Array<{
        value?: string;
        value_classification?: string;
        timestamp?: string;
      }>;
    };

    const item = payload.data?.[0];
    const output: FearGreedPayload = {
      value: item?.value ? Number(item.value) : null,
      label: item?.value_classification ?? null,
      timestamp: item?.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : null,
    };

    await setCachedJson(CACHE_KEY, output, CACHE_TTL_SECONDS);
    return NextResponse.json(output);
  } catch (error) {
    console.error("[api/crypto/fear-greed] Failed:", error);
    return NextResponse.json({
      value: null,
      label: null,
      timestamp: null,
    } satisfies FearGreedPayload);
  }
}
