"use client";

import { Chip } from "@/src/components/apex-ui/Chip";
import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import {
  getAssetClassLabel,
  getSignalCategoryLabel,
  getSignalDisplayName,
  getSignalHealthBadges,
} from "@/src/presentation/dashboard/components/signalPresentation";

export function RejectedSignalCard({ signal }: { signal: SignalViewModel }) {
  const displayName = getSignalDisplayName(signal);
  const assetClassLabel = getAssetClassLabel(signal);
  const categoryLabel = getSignalCategoryLabel(signal);
  const healthBadges = getSignalHealthBadges(signal);

  return (
    <article className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] border-l-2 border-l-[var(--apex-status-blocked-border)] bg-[var(--apex-bg-raised)] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">
            {signal.symbol} · {signal.grade} · {signal.direction.toUpperCase()}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip label={assetClassLabel} variant="neutral" />
            {displayName ? <Chip label={displayName} variant="neutral" /> : null}
            {categoryLabel ? <Chip label={categoryLabel} variant="neutral" /> : null}
            {healthBadges.slice(0, 2).map(badge => <Chip key={`${signal.id}-${badge}`} label={badge} variant="watchlist" />)}
          </div>
          <p className="mt-1 text-[12px] text-[var(--apex-text-secondary)]">
            {signal.riskExplainability.join(" · ") || signal.noTradeExplanation || "Blocked by governance rules."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {signal.riskRuleCodes.map(rule => (
            <span
              key={`${signal.id}-${rule}`}
              className="rounded-full border border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-2.5 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-status-blocked-text)]"
            >
              {rule}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
