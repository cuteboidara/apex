import type { Prisma } from "@prisma/client";

import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import { prisma } from "@/src/infrastructure/db/prisma";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

type PersistableSignalViewModel = Omit<SignalViewModel, "ui_sections">;

function canonicalizeGoldSymbol(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  switch (value.toUpperCase()) {
    case "XAUUSD":
    case "GC=F":
    case "GOLD":
    case "XAU/USD":
      return "XAUUSD";
    default:
      return value;
  }
}

export function readPersistedSignalModel(uiSections: unknown): Record<string, unknown> {
  return asRecord(asRecord(uiSections).model);
}

export function readPersistedMarketSymbol(uiSections: unknown): string | null {
  const sections = asRecord(uiSections);
  const model = readPersistedSignalModel(sections);
  const topLevel = canonicalizeGoldSymbol(sections.marketSymbol);
  const persistedMarketSymbol = canonicalizeGoldSymbol(model.marketSymbol);
  const persistedSymbol = canonicalizeGoldSymbol(model.symbol);
  return persistedMarketSymbol ?? topLevel ?? persistedSymbol;
}

export function prepareSignalViewModelForPersistence<T extends SignalViewModel>(model: T): T {
  const uiSections = asRecord(model.ui_sections);
  const refs = asRecord(uiSections.refs);
  const health = asRecord(uiSections.health);
  const { ui_sections: _ignoredUiSections, ...persistedModel } = model;
  const persistedSymbol = canonicalizeGoldSymbol(persistedModel.symbol) ?? persistedModel.symbol;
  const marketSymbol = canonicalizeGoldSymbol(uiSections.marketSymbol) ?? persistedSymbol;

  return {
    ...model,
    symbol: persistedSymbol,
    ui_sections: {
      ...uiSections,
      marketSymbol,
      refs: {
        ...refs,
        signal_id: refs.signal_id ?? model.signal_id ?? null,
      },
      health: {
        ...health,
        assetClass: model.assetClass ?? health.assetClass ?? uiSections.assetClass ?? null,
        providerStatus: model.providerStatus ?? health.providerStatus ?? null,
        priceSource: model.priceSource ?? health.priceSource ?? null,
        candleSource: model.candleSource ?? health.candleSource ?? null,
        fallbackDepth: model.fallbackDepth ?? health.fallbackDepth ?? 0,
        dataFreshnessMs: model.dataFreshnessMs ?? health.dataFreshnessMs ?? null,
        missingBarCount: model.missingBarCount ?? health.missingBarCount ?? 0,
        dataTrustScore: model.dataTrustScore ?? health.dataTrustScore ?? null,
        publicationStatus: model.publicationStatus ?? health.publicationStatus ?? null,
        publicationReasons: model.publicationReasons ?? health.publicationReasons ?? [],
        moduleHealth: model.moduleHealth ?? health.moduleHealth ?? null,
        qualityScores: model.qualityScores ?? health.qualityScores ?? null,
        healthFlags: model.healthFlags ?? health.healthFlags ?? [],
      },
      model: {
        ...(persistedModel satisfies PersistableSignalViewModel),
        symbol: persistedSymbol,
      },
    },
  };
}

export function prepareSignalViewModelsForPersistence<T extends SignalViewModel>(models: T[]): T[] {
  return models.map(model => prepareSignalViewModelForPersistence(model));
}

export async function persistSignalViewModels(
  models: SignalViewModel[],
  options?: {
    logPrefix?: string;
  },
): Promise<void> {
  if (models.length === 0) {
    console.log(`[${options?.logPrefix ?? "signal-persistence"}] No SignalViewModel rows to persist`);
    return;
  }

  const prepared = prepareSignalViewModelsForPersistence(models);
  for (const model of prepared) {
    const marketSymbol = readPersistedMarketSymbol(model.ui_sections) ?? model.symbol;
    console.log(
      `[${options?.logPrefix ?? "signal-persistence"}] Signal prepared: ${marketSymbol} ${model.grade} ${model.direction} (${model.display_type})`,
    );
  }

  await prisma.signalViewModel.createMany({
    data: prepared.map(model => ({
      view_id: model.view_id,
      entity_ref: model.entity_ref,
      display_type: model.display_type,
      headline: model.headline,
      summary: model.summary,
      reason_labels: model.reason_labels,
      confidence_label: model.confidence_label,
      ui_sections: model.ui_sections as Prisma.InputJsonValue,
      commentary: model.commentary as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      ui_version: model.ui_version,
      generated_at: new Date(model.generated_at),
    })),
  });

  console.log(
    `[${options?.logPrefix ?? "signal-persistence"}] Persisted ${prepared.length} SignalViewModel rows`,
  );
}
