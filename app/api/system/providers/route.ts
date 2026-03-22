import { NextResponse } from "next/server";
import { getProviderSummaries } from "@/lib/marketData/providerStatus";
import { classifyProviderStatus } from "@/lib/providerStatusClassifier";

export const dynamic = "force-dynamic";

export async function GET() {
  const envFlags = {
    fcs: Boolean(process.env.FCS_API_KEY && process.env.FCS_API_KEY !== "PASTE_YOUR_KEY_HERE"),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY && process.env.ALPHA_VANTAGE_API_KEY !== "PASTE_YOUR_KEY_HERE"),
  };
  const marketProviderConfig: Record<string, { enabled: boolean; detail: string }> = {
    "Binance": { enabled: true, detail: "Primary crypto quotes and candles" },
    "FCS API": { enabled: envFlags.fcs, detail: "Primary FX and metals quotes/candles, optional crypto fallback" },
    "Alpha Vantage": { enabled: envFlags.alphaVantage, detail: "Fallback FX and metals quotes plus indicator enrichment" },
  };
  const providers = (await getProviderSummaries()).map(provider => {
    const config = marketProviderConfig[provider.provider];
    const status = config && !config.enabled ? "missing" : provider.status;
    const detail = config && !config.enabled
      ? `missing_api_key · ${config.detail}`
      : provider.detail;
    const classified = classifyProviderStatus(status, detail);

    return {
      ...provider,
      status,
      detail,
      score: config && !config.enabled ? null : provider.score,
      healthState: config && !config.enabled ? null : provider.healthState,
      circuitState: config && !config.enabled ? null : provider.circuitState,
      availability: classified.availability,
      blockedReason: classified.blockedReason,
    };
  });
  return NextResponse.json({
    providers,
    timestamp: new Date().toISOString(),
  });
}
