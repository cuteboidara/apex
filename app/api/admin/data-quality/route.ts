import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getProviderReliabilitySummaries } from "@/src/application/analytics/providerDiagnostics";
import { getLatestLiveRuntimeSmokeReport } from "@/src/application/analytics/liveRuntimeVerification";
import { prisma } from "@/src/infrastructure/db/prisma";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [snapshots, cycleOutputs, providerHealth, signalViewModels, providerReliability, liveSmoke] = await Promise.all([
    prisma.marketSnapshot.findMany({
      where: {
        created_at: {
          gte: since,
        },
      },
      orderBy: {
        created_at: "desc",
      },
    }),
    prisma.cycleOutput.findMany({
      take: 50,
      orderBy: {
        completed_at: "desc",
      },
    }),
    prisma.providerHealth.findMany({
      take: 50,
      orderBy: {
        recordedAt: "desc",
      },
    }),
    prisma.signalViewModel.findMany({
      take: 200,
      orderBy: {
        generated_at: "desc",
      },
    }),
    getProviderReliabilitySummaries({ lookbackHours: 72 }),
    getLatestLiveRuntimeSmokeReport(),
  ]);

  const pairMap = new Map<string, {
    symbol: string;
    totalSnapshots: number;
    successfulFetches: number;
    degradedSnapshots: number;
    livePriceNulls: number;
    livePriceSamples: number;
  }>();

  for (const snapshot of snapshots) {
    const marketData = asRecord(asRecord(snapshot.raw_inputs_metadata).market_data);
    const pair = pairMap.get(snapshot.symbol) ?? {
      symbol: snapshot.symbol,
      totalSnapshots: 0,
      successfulFetches: 0,
      degradedSnapshots: 0,
      livePriceNulls: 0,
      livePriceSamples: 0,
    };
    pair.totalSnapshots += 1;
    if (typeof marketData.candlesFetched === "number" && marketData.candlesFetched > 0) {
      pair.successfulFetches += 1;
    }
    if (snapshot.data_quality_tier !== "high") {
      pair.degradedSnapshots += 1;
    }
    pairMap.set(snapshot.symbol, pair);
  }

  for (const row of signalViewModels) {
    const model = asRecord(asRecord(row.ui_sections).model);
    const symbol = typeof model.symbol === "string" ? model.symbol : null;
    if (!symbol) continue;
    const pair = pairMap.get(symbol) ?? {
      symbol,
      totalSnapshots: 0,
      successfulFetches: 0,
      degradedSnapshots: 0,
      livePriceNulls: 0,
      livePriceSamples: 0,
    };
    pair.livePriceSamples += 1;
    if (model.livePrice == null) {
      pair.livePriceNulls += 1;
    }
    pairMap.set(symbol, pair);
  }

  const twelveDataHealth = providerHealth.find(item => item.provider.toLowerCase().includes("twelve"));
  const cotHealth = providerHealth.find(item => item.provider.toLowerCase().includes("cot"));
  const cycleLatencies = cycleOutputs.map(output => output.completed_at.getTime() - output.started_at.getTime());
  const avgLatencyMs = cycleLatencies.length > 0
    ? Math.round(cycleLatencies.reduce((sum, value) => sum + value, 0) / cycleLatencies.length)
    : 0;

  return NextResponse.json({
    pairs: [...pairMap.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)).map(pair => ({
      symbol: pair.symbol,
      candleFetchSuccessRate: pair.totalSnapshots > 0 ? Math.round((pair.successfulFetches / pair.totalSnapshots) * 100) : 0,
      degradedRate: pair.totalSnapshots > 0 ? Math.round((pair.degradedSnapshots / pair.totalSnapshots) * 100) : 0,
      livePriceNullRate: pair.livePriceSamples > 0 ? Math.round((pair.livePriceNulls / pair.livePriceSamples) * 100) : 0,
      totalSnapshots: pair.totalSnapshots,
    })),
    twelveData: twelveDataHealth
      ? {
        status: twelveDataHealth.status,
        lastSuccessAt: twelveDataHealth.recordedAt,
        latencyMs: twelveDataHealth.latencyMs,
        detail: twelveDataHealth.detail,
      }
      : null,
    cotData: cotHealth
      ? {
        status: cotHealth.status,
        lastReportAt: cotHealth.recordedAt,
        daysOld: Math.max(0, Math.floor((Date.now() - cotHealth.recordedAt.getTime()) / (24 * 60 * 60 * 1000))),
      }
      : null,
    cycleLatency: {
      averageMs: avgLatencyMs,
      samples: cycleLatencies.length,
    },
    providerReliability,
    liveSmoke,
  });
}
