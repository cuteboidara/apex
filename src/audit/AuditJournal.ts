import { createId } from "@/src/lib/ids";
import type { ApexRepository } from "@/src/lib/repository";
import type { DecisionJournalEntry, LearningFeedbackRecord } from "@/src/interfaces/contracts";

export class AuditJournal {
  constructor(private readonly repository: ApexRepository) {}

  async logDecision(entry: DecisionJournalEntry): Promise<void> {
    await this.repository.appendDecisionJournal(entry);
  }

  async logFeedback(record: LearningFeedbackRecord): Promise<void> {
    await this.repository.appendLearningFeedback(record);
  }

  queryDecisions(filters: { symbol?: string; pod_id?: string; date_range?: { from?: number; to?: number }; final_action?: DecisionJournalEntry["final_action"] }) {
    const entries = this.repository.queryDecisionJournal({
      symbol: filters.symbol,
      final_action: filters.final_action,
      from_ts: filters.date_range?.from,
      to_ts: filters.date_range?.to,
    });

    if (!filters.pod_id) {
      return entries;
    }

    return entries.filter(entry => entry.pod_output_refs.some(ref => ref.includes(filters.pod_id!)));
  }

  generateHumanSummary(entry: DecisionJournalEntry): string {
    const outcome = entry.outcome ? ` Outcome ${entry.outcome}.` : "";
    const vetoReasons = entry.veto_reasons ?? [];
    const vetoes = vetoReasons.length ? ` Vetoes: ${vetoReasons.join(", ")}.` : "";
    return `APEX ${entry.final_action} ${entry.symbol_canonical} ${entry.direction} during ${entry.session} ${entry.regime} at ${new Date(entry.ts).toISOString()}. Confidence ${Math.round(entry.confidence * 100)}%.${outcome}${vetoes}`;
  }

  createDecisionEntry(input: Omit<DecisionJournalEntry, "decision_id" | "human_summary">): DecisionJournalEntry {
    const entry: DecisionJournalEntry = {
      ...input,
      decision_id: createId("journal"),
      human_summary: "",
      pair: input.pair ?? input.symbol_canonical,
      session: input.session ?? "off_hours",
      regime: input.regime ?? "normal",
      entry_style: input.entry_style ?? "support",
      direction: input.direction ?? "none",
      confidence: input.confidence ?? 0,
      entry: input.entry ?? null,
      sl: input.sl ?? null,
      tp1: input.tp1 ?? null,
      tp2: input.tp2 ?? null,
      tp3: input.tp3 ?? null,
      pod_votes: input.pod_votes ?? { directional: [], gating: [] },
      veto_reasons: input.veto_reasons ?? [],
      reasoning: input.reasoning ?? [],
    };
    entry.human_summary = this.generateHumanSummary(entry);
    return entry;
  }
}
