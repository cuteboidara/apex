"use client";

import { Chip } from "@/src/components/apex-ui/Chip";
import { DirectionBadge } from "@/src/components/apex-ui/DirectionBadge";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import {
  getAssetClassLabel,
  getSignalCategoryLabel,
  getSignalDisplayName,
  getSignalHealthBadges,
} from "@/src/presentation/dashboard/components/signalPresentation";

function signalDirection(direction: SignalViewModel["direction"]) {
  if (direction === "buy") return "long" as const;
  if (direction === "sell") return "short" as const;
  return "neutral" as const;
}

export function MonitoredSignalCard({ signal }: { signal: SignalViewModel }) {
  const confidencePct = Math.max(0, Math.min(100, Math.round(signal.confidence * 100)));
  const displayName = getSignalDisplayName(signal);
  const assetClassLabel = getAssetClassLabel(signal);
  const categoryLabel = getSignalCategoryLabel(signal);
  const badges = getSignalHealthBadges(signal);

  return (
    <article className="apex-surface border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-[var(--apex-font-mono)] text-[14px] text-[var(--apex-text-primary)]">{signal.symbol}</p>
            {displayName ? (
              <p className="font-[var(--apex-font-body)] text-[12px] text-[var(--apex-text-secondary)]">{displayName}</p>
            ) : null}
            <Chip label={assetClassLabel} variant="neutral" />
            {categoryLabel ? <Chip label={categoryLabel} variant="neutral" /> : null}
            <GradeTag grade={signal.grade as never} />
            <DirectionBadge direction={signalDirection(signal.direction)} />
          </div>
          <p className="mt-2 text-[12px] text-[var(--apex-text-tertiary)]">{signal.session} · {signal.marketStateLabels.join(" · ") || "Monitoring structure"}</p>
        </div>
        <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">{signal.setupType}</p>
      </div>

      <p className="mt-4 text-[13px] leading-7 text-[var(--apex-text-secondary)]">
        {signal.noTradeExplanation || signal.shortReasoning}
      </p>

      {signal.noTradeReason ? (
        <p className="mt-3 text-[12px] text-[var(--apex-status-watchlist-text)]">No-trade reason: {signal.noTradeReason}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {badges.slice(0, 3).map(badge => (
          <Chip key={`${signal.id}-${badge}`} label={badge} variant="neutral" />
        ))}
        {signal.smcAnalysis ? (
          <>
            <span className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
              {signal.smcAnalysis.killzone}
            </span>
            <span className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
              {signal.smcAnalysis.pdLocation}
            </span>
            {signal.smcAnalysis.inOTE ? (
              <span className="rounded-full border border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--apex-status-active-text)]">
                OTE
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Confidence</p>
          <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{confidencePct}%</p>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[var(--apex-bg-elevated)]">
          <div
            className="h-1.5 rounded-full bg-[var(--apex-status-watchlist-text)]"
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>
    </article>
  );
}
