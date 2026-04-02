import type { DecisionJournalEntry } from "@/src/interfaces/contracts";
import { getApexRuntime } from "@/src/lib/runtime";

export async function getJournalPayload(filters: {
  symbol?: string;
  action?: DecisionJournalEntry["final_action"];
  from?: number;
  to?: number;
  limit?: number;
}) {
  const runtime = getApexRuntime();
  const rows = runtime.auditJournal
    .queryDecisions({
      symbol: filters.symbol,
      final_action: filters.action,
      date_range: {
        from: filters.from,
        to: filters.to,
      },
    })
    .sort((left, right) => right.ts - left.ts);

  if (!filters.limit || filters.limit <= 0) {
    return rows;
  }

  return rows.slice(0, filters.limit);
}
