import { evaluateSymbolScope } from "@/src/config/marketScope";
import { generateMarketCommentary } from "@/src/lib/apex-llm";
import { fetchLivePrices, type TraderLivePriceMap } from "@/src/lib/livePrices";
import { logger } from "@/src/lib/logger";
import { getTelegramConfig } from "@/src/lib/operatorSettings";
import { applyTraderLivePrices, buildTraderSignalsPayload, buildTraderSignalsPayloadFromStates, enrichTraderSignalsPayload } from "@/src/lib/trader";
import type { TraderSignalsPayload } from "@/src/lib/traderContracts";

let reconstructionUsageCount = 0;

export function getReconstructionUsageCount(): number {
  return reconstructionUsageCount;
}

type SignalsRuntimeLike = {
  config: {
    activeSymbols: string[];
    marketScope: unknown;
    showBlockedSignalsOnMainDashboard: boolean;
    showAdvancedInternals: boolean;
    pairProfiles: Record<string, unknown>;
  };
  repository: {
    getLatestTraderPairRuntimeStates?: (symbols?: string[]) => Promise<unknown[]>;
    getLatestFeatureSnapshots: (symbols?: string[]) => unknown[];
    getLatestSignalCandidates: (limit?: number) => unknown[];
    getRecentRiskDecisions: (limit?: number) => unknown[];
    getSignalLifecycles: (input?: { limit?: number }) => unknown[];
  };
};

export function createEmptySignalsPayload(): TraderSignalsPayload {
  return {
    generatedAt: Date.now(),
    cards: [],
    liveMarketBoard: [],
    activeSignals: [],
    developingSetups: [],
    blockedSignals: [],
    watchlistSignals: [],
    marketReasoning: [],
    keyAreas: [],
    diagnostics: [],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "B",
      includeBTelegramSignals: true,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
    },
    marketCommentary: null,
  };
}

export async function reconstructSignalsPayloadForRuntime(
  runtime: SignalsRuntimeLike,
  options?: {
    debugMode?: boolean;
    reconstructionReason?: string;
    fetchLivePrices?: (symbols: readonly string[]) => Promise<TraderLivePriceMap>;
  },
): Promise<TraderSignalsPayload> {
  if (!options?.debugMode) {
    logger.error({
      module: "reconstruction-service",
      message: "Reconstruction attempt blocked outside debug mode",
      reconstruction_reason: options?.reconstructionReason ?? "unspecified",
      reconstruction_usage_count: reconstructionUsageCount,
    });
    throw new Error("RECONSTRUCTION_NOT_ALLOWED");
  }

  reconstructionUsageCount += 1;
  logger.warn({
    module: "reconstruction-service",
    message: "Reconstruction path invoked",
    reconstruction_reason: options.reconstructionReason ?? "debug_request",
    reconstruction_usage_count: reconstructionUsageCount,
  });

  const activeSymbols = runtime.config.activeSymbols.filter(symbol =>
    evaluateSymbolScope(symbol, runtime.config.activeSymbols, runtime.config.marketScope as never).allowed,
  );
  const telegramConfig = await getTelegramConfig();
  const preferences = {
    meaningfulSignalFloor: "B" as const,
    minimumTelegramGrade: telegramConfig.minGrade,
    includeBTelegramSignals: telegramConfig.includeBGrade,
    showBlockedSignalsOnMainDashboard: runtime.config.showBlockedSignalsOnMainDashboard,
    showAdvancedInternals: runtime.config.showAdvancedInternals,
  };
  const persistedStates = typeof runtime.repository.getLatestTraderPairRuntimeStates === "function"
    ? await runtime.repository.getLatestTraderPairRuntimeStates(activeSymbols)
    : [];
  const resolveLivePrices = options.fetchLivePrices ?? fetchLivePrices;
  const livePrices = await resolveLivePrices(activeSymbols);

  if (persistedStates.length > 0) {
    const payload = applyTraderLivePrices(buildTraderSignalsPayloadFromStates({
      activeSymbols,
      states: persistedStates as Parameters<typeof buildTraderSignalsPayloadFromStates>[0]["states"],
      preferences,
    }), livePrices);
    await enrichTraderSignalsPayload({ payload });
    const marketStates = Object.fromEntries(payload.liveMarketBoard.map(row => [
      row.symbol,
      {
        bias: row.bias ?? "neutral",
        phase: payload.cards.find(card => card.symbol === row.symbol)?.marketPhase ?? "neutral",
        session: row.session ?? "unknown",
        labels: row.marketStateLabels ?? [],
      },
    ]));
    payload.marketCommentary = await generateMarketCommentary(activeSymbols, marketStates);
    return payload;
  }

  const snapshots = runtime.repository.getLatestFeatureSnapshots(activeSymbols) as Parameters<typeof buildTraderSignalsPayload>[0]["snapshots"];
  const candidates = runtime.repository.getLatestSignalCandidates(100) as Parameters<typeof buildTraderSignalsPayload>[0]["candidates"];
  const riskDecisions = runtime.repository.getRecentRiskDecisions(100) as Parameters<typeof buildTraderSignalsPayload>[0]["riskDecisions"];
  const payload = applyTraderLivePrices(buildTraderSignalsPayload({
    activeSymbols,
    candidates,
    snapshots,
    riskDecisions,
    lifecycles: runtime.repository.getSignalLifecycles({ limit: 100 }) as Parameters<typeof buildTraderSignalsPayload>[0]["lifecycles"],
    preferences,
    config: {
      pairProfiles: runtime.config.pairProfiles as Parameters<typeof buildTraderSignalsPayload>[0]["config"]["pairProfiles"],
    },
  }), livePrices);

  const snapshotsBySymbol = new Map(snapshots.map(snapshot => [snapshot.symbol_canonical, snapshot]));
  const candidatesBySymbol = new Map(candidates.map(candidate => [candidate.symbol_canonical, candidate]));
  const riskDecisionsBySymbol = new Map(riskDecisions.map(decision => [decision.scope, decision]));
  await enrichTraderSignalsPayload({
    payload,
    sourcesBySymbol: new Map(activeSymbols.map(symbol => [
      symbol,
      {
        snapshot: snapshotsBySymbol.get(symbol) ?? null,
        candidate: candidatesBySymbol.get(symbol) ?? null,
        riskDecision: riskDecisionsBySymbol.get(symbol) ?? null,
      },
    ])),
  });
  const marketStates = Object.fromEntries(payload.liveMarketBoard.map(row => [
    row.symbol,
    {
      bias: row.bias ?? "neutral",
      phase: payload.cards.find(card => card.symbol === row.symbol)?.marketPhase ?? "neutral",
      session: row.session ?? "unknown",
      labels: row.marketStateLabels ?? [],
    },
  ]));
  payload.marketCommentary = await generateMarketCommentary(activeSymbols, marketStates);
  return payload;
}
