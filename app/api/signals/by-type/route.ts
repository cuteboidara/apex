import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { SignalViewModelBuilder } from "@/src/domain/services/viewModelBuilder";
import { prisma } from "@/src/infrastructure/db/prisma";
import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SignalType = "scalp" | "intraday" | "swing";

type TradeTypeCard = {
  id: string;
  symbol: string;
  assetClass: string;
  direction: "buy" | "sell" | "neutral";
  grade: string;
  confidence: number;
  apexScore: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  reasoning: string;
  generatedAt: number;
  setupType: string;
  timeframe: string | null;
  weeklyBias: string | null;
  expectedDuration: string | null;
};

type TradeTypePayload = {
  type: SignalType;
  generatedAt: number;
  nextScanInMinutes: number;
  signals: TradeTypeCard[];
  source?: "typed" | "latest_fallback";
};

const CACHE_TTL_SECONDS = 60;
const MAX_ROWS = 400;

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseType(input: string | null): SignalType {
  if (input === "intraday" || input === "swing") {
    return input;
  }
  return "scalp";
}

function inferTimeframe(model: ReturnType<typeof SignalViewModelBuilder.hydratePersistedViewModel>): string | null {
  const sections = model.ui_sections;
  const legacy = sections.legacy && typeof sections.legacy === "object" && !Array.isArray(sections.legacy)
    ? sections.legacy as Record<string, unknown>
    : {};
  const diagnostics = legacy.diagnostics && typeof legacy.diagnostics === "object" && !Array.isArray(legacy.diagnostics)
    ? legacy.diagnostics as Record<string, unknown>
    : {};
  const marketData = diagnostics.marketData && typeof diagnostics.marketData === "object" && !Array.isArray(diagnostics.marketData)
    ? diagnostics.marketData as Record<string, unknown>
    : {};
  const interval = marketData.interval;
  if (typeof interval === "string" && interval.trim().length > 0) {
    return interval.trim().toLowerCase();
  }
  return null;
}

function computeRiskReward(entry: number | null, stopLoss: number | null, takeProfit: number | null): number | null {
  if (entry == null || stopLoss == null || takeProfit == null) {
    return null;
  }
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }
  const reward = Math.abs(takeProfit - entry);
  if (!Number.isFinite(reward) || reward <= 0) {
    return null;
  }
  return reward / risk;
}

function normalizeTimeframe(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "15min") return "15m";
  if (normalized === "60min") return "1h";
  if (normalized === "240min") return "4h";
  return normalized;
}

function inferTradeType(input: {
  typeHints: string[];
  timeframe: string | null;
  riskReward: number | null;
}): SignalType {
  const setup = input.typeHints.join(" ").toLowerCase();
  const timeframe = normalizeTimeframe(input.timeframe);

  const isScalp = setup.includes("scalp")
    || ["1m", "5m", "15m", "m1", "m5", "m15"].includes(timeframe ?? "")
    || (input.riskReward != null && input.riskReward < 1.5);
  if (isScalp) {
    return "scalp";
  }

  const isSwing = setup.includes("swing")
    || ["1d", "1w", "d1", "w1"].includes(timeframe ?? "")
    || (input.riskReward != null && input.riskReward >= 3);
  if (isSwing) {
    return "swing";
  }

  return "intraday";
}

function nextScanInMinutes(): number {
  const now = new Date();
  const remainder = now.getUTCMinutes() % 15;
  return remainder === 0 ? 15 : 15 - remainder;
}

function expectedDurationForType(type: SignalType): string | null {
  if (type === "scalp") return "< 1 hour";
  if (type === "intraday") return "Same day";
  return "2–5 days";
}

function buildTradeCard(row: Awaited<ReturnType<typeof prisma.signalViewModel.findMany>>[number], type: SignalType): TradeTypeCard | null {
  const model = SignalViewModelBuilder.hydratePersistedViewModel({
    viewId: row.view_id,
    entityRef: row.entity_ref,
    displayType: row.display_type as "executable" | "monitored" | "rejected",
    headline: row.headline,
    summary: row.summary,
    reasonLabels: [...row.reason_labels],
    confidenceLabel: row.confidence_label,
    uiSections: asRecord(row.ui_sections),
    commentary: asRecord(row.commentary),
    uiVersion: row.ui_version,
    generatedAt: row.generated_at.getTime(),
  });

  if (model.status === "blocked" || model.status === "invalidated" || model.status === "expired") {
    return null;
  }

  const timeframe = inferTimeframe(model);
  const riskReward = computeRiskReward(model.entry, model.sl, model.tp1);

  return {
    id: model.view_id,
    symbol: model.symbol,
    assetClass: model.assetClass ?? "fx",
    direction: model.direction,
    grade: model.grade,
    confidence: Math.round(model.confidence * 100),
    apexScore: Math.round(model.qualityScores?.composite ?? model.gradeScore ?? model.confidence * 100),
    entry: model.entry,
    stopLoss: model.sl,
    takeProfit: model.tp1,
    riskReward,
    reasoning: model.shortReasoning || model.summary || model.detailedReasoning || "Monitoring active setup.",
    generatedAt: model.generatedAt,
    setupType: model.setupType,
    timeframe,
    weeklyBias: model.bias ?? null,
    expectedDuration: expectedDurationForType(type),
  };
}

export async function GET(request: NextRequest) {
  const type = parseType(request.nextUrl.searchParams.get("type"));
  const cacheKey = `signals:by-type:${type}`;
  const cached = await getCachedJson<TradeTypePayload>(cacheKey);
  if (cached) {
    console.log("[APEX BY-TYPE] type:", type, "results:", cached.signals.length);
    return NextResponse.json(cached);
  }

  const rows = await prisma.signalViewModel.findMany({
    orderBy: {
      generated_at: "desc",
    },
    take: MAX_ROWS,
  });

  const seen = new Set<string>();
  const cards: TradeTypeCard[] = [];

  for (const row of rows) {
    const card = buildTradeCard(row, type);
    if (!card || seen.has(card.symbol)) {
      continue;
    }
    const inferredType = inferTradeType({
      typeHints: [card.setupType, ...row.reason_labels],
      timeframe: card.timeframe,
      riskReward: card.riskReward,
    });
    if (inferredType !== type) {
      continue;
    }

    seen.add(card.symbol);
    cards.push(card);
  }

  cards.sort((left, right) => right.apexScore - left.apexScore);
  const typedSignals = cards.slice(0, 10);
  let signals = typedSignals;
  let source: TradeTypePayload["source"] = "typed";

  if (signals.length === 0) {
    const latestSignals: TradeTypeCard[] = [];
    const fallbackSeen = new Set<string>();

    for (const row of rows) {
      const card = buildTradeCard(row, type);
      if (!card || fallbackSeen.has(card.symbol)) {
        continue;
      }
      fallbackSeen.add(card.symbol);
      latestSignals.push(card);
      if (latestSignals.length === 6) {
        break;
      }
    }

    signals = latestSignals;
    source = "latest_fallback";
  }

  console.log("[APEX BY-TYPE] type:", type, "results:", signals.length);

  const payload: TradeTypePayload = {
    type,
    generatedAt: Date.now(),
    nextScanInMinutes: nextScanInMinutes(),
    signals,
    source,
  };

  await setCachedJson(cacheKey, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
