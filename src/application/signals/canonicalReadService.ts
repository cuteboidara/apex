import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  CycleOutput,
  ExecutableSignal,
  MarketSnapshot,
  RiskEvaluatedCandidate,
  SignalLifecycle,
  SignalViewModel,
  TradeCandidate,
} from "@/src/domain/models/signalPipeline";
import { SignalViewModelBuilder } from "@/src/domain/services/viewModelBuilder";
import { logger } from "@/src/lib/logger";

type CanonicalPrisma = PrismaClient;
type CycleOutputRow = Awaited<ReturnType<CanonicalPrisma["cycleOutput"]["findUnique"]>>;
type ExecutableSignalRow = Awaited<ReturnType<CanonicalPrisma["executableSignal"]["findFirst"]>>;
type SignalLifecycleRow = Awaited<ReturnType<CanonicalPrisma["signalLifecycle"]["findFirst"]>>;
type SignalViewModelRow = Awaited<ReturnType<CanonicalPrisma["signalViewModel"]["findFirst"]>>;

let prismaPromise: Promise<CanonicalPrisma> | null = null;

async function getPrismaClient(): Promise<CanonicalPrisma> {
  prismaPromise ??= import("@/src/infrastructure/db/prisma").then(mod => mod.prisma);
  return prismaPromise;
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray<T>(value: Prisma.JsonValue | null | undefined): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function mapCycleOutputRow(row: NonNullable<CycleOutputRow>): CycleOutput {
  return {
    cycle_id: row.cycle_id,
    started_at: row.started_at.getTime(),
    completed_at: row.completed_at.getTime(),
    symbols_processed: [...row.symbols_processed],
    snapshots: asArray<MarketSnapshot>(row.snapshots),
    candidates: asArray<TradeCandidate>(row.candidates),
    risk_results: asArray<RiskEvaluatedCandidate>(row.risk_results),
    signals: asArray<ExecutableSignal>(row.signals),
    metadata: asRecord(row.metadata),
    versions: asRecord(row.versions) as CycleOutput["versions"],
    pipeline_status: row.pipeline_status as CycleOutput["pipeline_status"],
    payload_source: row.payload_source as CycleOutput["payload_source"],
  };
}

function mapExecutableSignalRow(row: NonNullable<ExecutableSignalRow>): ExecutableSignal {
  const takeProfit = asRecord(row.take_profit) as ExecutableSignal["take_profit"];
  return {
    signal_id: row.signal_id,
    cycle_id: row.cycle_id,
    candidate_id: row.candidate_id,
    symbol: row.symbol,
    direction: row.direction as ExecutableSignal["direction"],
    size: row.size,
    entry: row.entry,
    stop_loss: row.stop_loss,
    take_profit: {
      tp1: Number(takeProfit.tp1 ?? row.entry),
      tp2: takeProfit.tp2 == null ? null : Number(takeProfit.tp2),
      tp3: takeProfit.tp3 == null ? null : Number(takeProfit.tp3),
    },
    status: row.status as ExecutableSignal["status"],
    created_at: row.created_at.getTime(),
    version: row.version,
  };
}

function mapSignalLifecycleRow(row: NonNullable<SignalLifecycleRow>): SignalLifecycle {
  return {
    signal_id: row.signal_id,
    current_state: row.current_state,
    fill_status: row.fill_status as SignalLifecycle["fill_status"],
    opened_at: row.opened_at?.getTime() ?? null,
    updated_at: row.updated_at.getTime(),
    closed_at: row.closed_at?.getTime() ?? null,
    pnl: row.pnl,
    execution_events: asArray<SignalLifecycle["execution_events"][number]>(row.execution_events),
  };
}

function throwCanonicalTruthMissing(message: string): never {
  logger.error({
    module: "canonical-read-service",
    message,
    error_code: "CANONICAL_TRUTH_MISSING",
  });
  throw new Error("CANONICAL_TRUTH_MISSING");
}

export async function getCycleOutput(cycleId: string): Promise<CycleOutput> {
  const prisma = await getPrismaClient();
  const row = await prisma.cycleOutput.findUnique({
    where: { cycle_id: cycleId },
  });
  if (!row) {
    throwCanonicalTruthMissing(`Canonical cycle output missing for ${cycleId}`);
  }
  return mapCycleOutputRow(row);
}

export async function getLatestCycleOutput(): Promise<CycleOutput> {
  const prisma = await getPrismaClient();
  const row = await prisma.cycleOutput.findFirst({
    orderBy: {
      completed_at: "desc",
    },
  });
  if (!row) {
    throwCanonicalTruthMissing("Canonical cycle output missing");
  }
  return mapCycleOutputRow(row);
}

export async function getSignalsBySymbol(symbol: string): Promise<ExecutableSignal[]> {
  const prisma = await getPrismaClient();
  const rows = await prisma.executableSignal.findMany({
    where: { symbol },
    orderBy: {
      created_at: "desc",
    },
  });

  return rows.map(row => mapExecutableSignalRow(row));
}

export async function getSignalLifecycle(signalId: string): Promise<SignalLifecycle> {
  const prisma = await getPrismaClient();
  const row = await prisma.signalLifecycle.findFirst({
    where: { signal_id: signalId },
    orderBy: {
      updated_at: "desc",
    },
  });
  if (!row) {
    throwCanonicalTruthMissing(`Canonical signal lifecycle missing for ${signalId}`);
  }
  return mapSignalLifecycleRow(row);
}

async function buildSignalViewModelsForCycleOutput(cycleOutput: CycleOutput): Promise<SignalViewModel[]> {
  const prisma = await getPrismaClient();
  const refs = [
    ...cycleOutput.snapshots.map(snapshot => snapshot.snapshot_id),
    ...cycleOutput.candidates.map(candidate => candidate.candidate_id),
    ...cycleOutput.signals.map(signal => signal.signal_id),
  ];
  const rows = refs.length === 0
    ? []
    : await prisma.signalViewModel.findMany({
      where: {
        entity_ref: {
          in: refs,
        },
      },
      orderBy: {
        generated_at: "desc",
      },
    });

  const dedupedRows = new Map<string, NonNullable<SignalViewModelRow>>();
  for (const row of rows) {
    if (row && !dedupedRows.has(row.entity_ref)) {
      dedupedRows.set(row.entity_ref, row);
    }
  }

  const models = [...dedupedRows.values()].map(row => SignalViewModelBuilder.hydratePersistedViewModel({
    viewId: row.view_id,
    entityRef: row.entity_ref,
    displayType: row.display_type as SignalViewModel["display_type"],
    headline: row.headline,
    summary: row.summary,
    reasonLabels: [...row.reason_labels],
    confidenceLabel: row.confidence_label,
    uiSections: asRecord(row.ui_sections),
    commentary: asRecord(row.commentary),
    uiVersion: row.ui_version,
    generatedAt: row.generated_at.getTime(),
  }));

  if (models.length === 0) {
    throwCanonicalTruthMissing("Canonical signal view models missing");
  }

  return models.sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export async function getSignalViewModels(): Promise<SignalViewModel[]> {
  const cycleOutput = await getLatestCycleOutput();
  return buildSignalViewModelsForCycleOutput(cycleOutput);
}

export async function getLatestCanonicalSignalBundle(): Promise<{
  cycleOutput: CycleOutput;
  viewModels: SignalViewModel[];
  lifecycles: Map<string, SignalLifecycle>;
}> {
  const cycleOutput = await getLatestCycleOutput();
  const viewModels = await buildSignalViewModelsForCycleOutput(cycleOutput);
  const lifecycles = new Map<string, SignalLifecycle>();
  for (const signal of cycleOutput.signals) {
    try {
      lifecycles.set(signal.signal_id, await getSignalLifecycle(signal.signal_id));
    } catch (error) {
      logger.warn({
        module: "canonical-read-service",
        message: "Canonical lifecycle missing for signal during bundle build",
        signal_id: signal.signal_id,
        error: String(error),
      });
    }
  }
  return {
    cycleOutput,
    viewModels,
    lifecycles,
  };
}
