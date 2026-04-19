import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import type { MTFCandles } from "@/src/assets/shared/mtfAnalysis";
import { diagnoseTopDownSweep, runTopDownAnalysis } from "@/src/assets/shared/mtfAnalysis";
import { fetchMTFCandles } from "@/src/assets/shared/mtfDataFetcher";
import { fetchMemeBinanceLivePrice, fetchMemeBinanceMtfcandles } from "@/src/assets/memecoins/data/BinanceMemeMarketData";
import { fetchCryptoTickerPrice } from "@/src/crypto/data/CryptoDataPlant";
import { validateApexSecretRequest } from "@/src/infrastructure/security/apexSecret";
import { fetchLivePrices } from "@/src/lib/livePrices";

export const dynamic = "force-dynamic";

async function authorizeRequest(request: NextRequest): Promise<
  | { ok: true; authMode: "secret" | "admin_session" }
  | { ok: false; response: NextResponse }
> {
  const providedSecret = request.headers.get("authorization")?.trim() || request.headers.get("x-apex-secret")?.trim();
  const webhookSecretHeader = request.headers.get("x-apex-webhook-secret")?.trim() ?? "";
  const webhookSecretCookie = request.cookies.get("apex_webhook_secret")?.value?.trim() ?? "";
  const webhookSecretQuery = request.nextUrl.searchParams.get("apex_webhook_secret")?.trim() ?? "";
  const vercelBypassHeader = request.headers.get("x-vercel-protection-bypass")?.trim() ?? "";

  if (providedSecret) {
    const validation = validateApexSecretRequest(
      request,
      process.env.APEX_SECRET?.trim() || process.env.APEX_WEBHOOK_SECRET?.trim(),
    );
    if (!validation.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: validation.error }, { status: validation.status }),
      };
    }

    return {
      ok: true,
      authMode: "secret",
    };
  }

  if (webhookSecretHeader) {
    const validation = validateApexSecretRequest(
      new Request(request.url, {
        method: request.method,
        headers: {
          "x-apex-secret": webhookSecretHeader,
        },
      }),
      process.env.APEX_WEBHOOK_SECRET?.trim(),
    );
    if (!validation.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: validation.error }, { status: validation.status }),
      };
    }

    return {
      ok: true,
      authMode: "secret",
    };
  }

  if (webhookSecretCookie) {
    const validation = validateApexSecretRequest(
      new Request(request.url, {
        method: request.method,
        headers: {
          "x-apex-secret": webhookSecretCookie,
        },
      }),
      process.env.APEX_WEBHOOK_SECRET?.trim(),
    );
    if (!validation.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: validation.error }, { status: validation.status }),
      };
    }

    return {
      ok: true,
      authMode: "secret",
    };
  }

  if (webhookSecretQuery && vercelBypassHeader) {
    const validation = validateApexSecretRequest(
      new Request(request.url, {
        method: request.method,
        headers: {
          "x-apex-secret": webhookSecretQuery,
        },
      }),
      process.env.APEX_WEBHOOK_SECRET?.trim(),
    );
    if (!validation.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: validation.error }, { status: validation.status }),
      };
    }

    return {
      ok: true,
      authMode: "secret",
    };
  }

  const admin = await requireAdmin();
  if (!admin.ok) {
    return {
      ok: false,
      response: admin.response,
    };
  }

  return {
    ok: true,
    authMode: "admin_session",
  };
}

async function buildDiagnostic(input: {
  symbol: string;
  assetClass: "crypto" | "commodity" | "memecoin";
  priceSource: "binance" | "livePrices";
  candleSource: "yahoo" | "binance";
  getLivePrice: () => Promise<number | null>;
  getCandles: () => Promise<MTFCandles & Partial<{ sourceProvider: string; providerPath: string[]; providerErrors: string[] }>>;
}) {
  const [livePrice, mtf] = await Promise.all([
    input.getLivePrice(),
    input.getCandles(),
  ]);
  const sweepDiagnostic = diagnoseTopDownSweep(input.symbol, mtf, livePrice ?? Number.NaN);
  const topDownResult = livePrice == null ? null : runTopDownAnalysis(input.symbol, mtf, livePrice);
  const resolvedCandleSource = "sourceProvider" in mtf && mtf.sourceProvider ? mtf.sourceProvider : input.candleSource;

  return {
    symbol: input.symbol,
    assetClass: input.assetClass,
    priceSource: input.priceSource,
    candleSource: resolvedCandleSource,
    providerPath: "providerPath" in mtf ? mtf.providerPath ?? [] : [],
    providerErrors: "providerErrors" in mtf ? mtf.providerErrors ?? [] : [],
    livePrice,
    topDownResult: topDownResult == null
      ? null
      : {
        direction: topDownResult.direction,
        grade: topDownResult.grade,
        confidence: topDownResult.confidence,
        entryTrigger: topDownResult.entryTrigger,
        entryTimeframe: topDownResult.entryTimeframe ?? null,
        riskReward: topDownResult.riskReward,
        riskReward2: topDownResult.riskReward2 ?? null,
        promotionStatus: topDownResult.promotionStatus ?? null,
        promotionBlockers: topDownResult.promotionBlockers ?? [],
        reasoning: topDownResult.reasoning,
        liquiditySweepDescription: topDownResult.liquiditySweepDescription ?? null,
      },
    sweepDiagnostic,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request);
  if (!auth.ok) return auth.response;

  const commodityPrices = await fetchLivePrices(["XAUUSD"]);

  const diagnostics = await Promise.all([
    buildDiagnostic({
      symbol: "BTCUSDT",
      assetClass: "crypto",
      priceSource: "binance",
      candleSource: "binance",
      getLivePrice: () => fetchCryptoTickerPrice("BTCUSDT"),
      getCandles: () => fetchMTFCandles("BTCUSDT"),
    }),
    buildDiagnostic({
      symbol: "ETHUSDT",
      assetClass: "crypto",
      priceSource: "binance",
      candleSource: "binance",
      getLivePrice: () => fetchCryptoTickerPrice("ETHUSDT"),
      getCandles: () => fetchMTFCandles("ETHUSDT"),
    }),
    buildDiagnostic({
      symbol: "XAUUSD",
      assetClass: "commodity",
      priceSource: "livePrices",
      candleSource: "yahoo",
      getLivePrice: async () => commodityPrices.XAUUSD ?? null,
      getCandles: () => fetchMTFCandles("XAUUSD"),
    }),
    buildDiagnostic({
      symbol: "DOGEUSDT",
      assetClass: "memecoin",
      priceSource: "binance",
      candleSource: "binance",
      getLivePrice: () => fetchMemeBinanceLivePrice("DOGEUSDT"),
      getCandles: () => fetchMemeBinanceMtfcandles("DOGEUSDT"),
    }),
  ]);

  return NextResponse.json({
    ok: true,
    authMode: auth.authMode,
    generatedAt: new Date().toISOString(),
    diagnostics,
  });
}
