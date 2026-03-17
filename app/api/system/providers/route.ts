import { NextResponse } from "next/server";
import { getProviderSummaries } from "@/lib/marketData/providerStatus";

export async function GET() {
  const providers = await getProviderSummaries();
  return NextResponse.json({
    providers,
    timestamp: new Date().toISOString(),
  });
}
