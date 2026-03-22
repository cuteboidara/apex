import { NextResponse } from "next/server";
import { fetchLiveMarketPrices } from "@/lib/liveMarket";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await fetchLiveMarketPrices());
}
