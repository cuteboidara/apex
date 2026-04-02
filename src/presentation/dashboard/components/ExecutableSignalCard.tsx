"use client";

import { useState } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";
import { DirectionBadge } from "@/src/components/apex-ui/DirectionBadge";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import {
  formatSignalPrice,
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

export function ExecutableSignalCard({ signal }: { signal: SignalViewModel }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = getSignalDisplayName(signal);
  const assetClassLabel = getAssetClassLabel(signal);
  const categoryLabel = getSignalCategoryLabel(signal);
  const badges = getSignalHealthBadges(signal);

  return (
    <article className="apex-surface px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-[var(--apex-font-mono)] text-[15px] text-[var(--apex-text-primary)]">{signal.symbol}</p>
            {displayName ? (
              <p className="font-[var(--apex-font-body)] text-[13px] text-[var(--apex-text-secondary)]">{displayName}</p>
            ) : null}
            <Chip label={assetClassLabel} variant="neutral" />
            {categoryLabel ? <Chip label={categoryLabel} variant="neutral" /> : null}
            <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--apex-text-secondary)]">
              {signal.setupType} · {signal.session}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <GradeTag grade={signal.grade as never} className="text-[28px]" />
          <DirectionBadge direction={signalDirection(signal.direction)} />
          <Chip label="ACTIVE" variant="active" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-4 md:grid-cols-6">
        {[
          ["LIVE", formatSignalPrice(signal, signal.livePrice)],
          ["ENTRY", formatSignalPrice(signal, signal.entry)],
          ["STOP LOSS", formatSignalPrice(signal, signal.sl)],
          ["TP1", formatSignalPrice(signal, signal.tp1)],
          ["TP2", formatSignalPrice(signal, signal.tp2)],
          ["TP3", formatSignalPrice(signal, signal.tp3)],
        ].map(([label, value]) => (
          <div key={`${signal.id}-${label}`}>
            <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">{label}</p>
            <p className="mt-2 font-[var(--apex-font-mono)] text-[14px] text-[var(--apex-text-primary)]">{value}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[14px] leading-7 text-[var(--apex-text-secondary)]">{signal.shortReasoning}</p>

      {badges.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {badges.slice(0, 4).map(badge => (
            <Chip key={`${signal.id}-${badge}`} label={badge} variant="neutral" />
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-6">
        {[
          ["BIAS", signal.bias],
          ["STRUCTURE", signal.structure],
          ["LIQUIDITY", signal.liquidityState],
          ["LOCATION", signal.location],
          ["ZONE", signal.zoneType],
          ["PHASE", signal.marketPhase],
        ].map(([label, value]) => (
          <div key={`${signal.id}-${label}`} className="space-y-1">
            <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">{label}</p>
            <p className="font-[var(--apex-font-mono)] text-[12px] uppercase tracking-[0.06em] text-[var(--apex-text-primary)]">{value}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setExpanded(current => !current)}
        className="mt-5 font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-tertiary)]"
      >
        {expanded ? "Hide analysis ↑" : "Show analysis ↓"}
      </button>

      {expanded ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[
              ["WHY THIS SETUP", signal.whyThisSetup],
              ["WHY NOW", signal.whyNow],
              ["WHY THIS LEVEL", signal.whyThisLevel],
              ["INVALIDATION", signal.invalidation],
              ["WHY THIS GRADE", signal.whyThisGrade],
            ].map(([label, value]) => (
              <div key={`${signal.id}-${label}`} className="apex-stack-card">
                <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">{label}</p>
                <p className="mt-3 text-[13px] leading-7 text-[var(--apex-text-secondary)]">{value}</p>
              </div>
            ))}
          </div>

          {signal.riskRuleCodes.length > 0 ? (
            <div className="apex-stack-card">
              <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Risk Rules Applied</p>
              <div className="mt-4 space-y-2">
                {signal.riskRuleCodes.map((rule, index) => (
                  <div key={`${signal.id}-${rule}`} className="border-l border-[var(--apex-status-watchlist-border)] pl-3">
                    <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-primary)]">{rule}</p>
                    <p className="mt-1 text-[12px] text-[var(--apex-text-secondary)]">{signal.riskExplainability[index] ?? rule}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {signal.podVotes.length > 0 ? (
            <div className="apex-stack-card">
              <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Pod Votes</p>
              <div className="mt-4 space-y-3">
                {signal.podVotes.map(vote => (
                  <div key={`${signal.id}-${vote.podName}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-primary)]">
                        {vote.podName} · {vote.signal.toUpperCase()}
                      </p>
                      <p className="text-[12px] text-[var(--apex-text-secondary)]">{vote.score}/100</p>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-[var(--apex-bg-elevated)]">
                      <div
                        className="h-1.5 rounded-full bg-[var(--apex-text-accent)]"
                        style={{ width: `${Math.max(0, Math.min(100, Math.round(vote.confidence * 100)))}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[12px] text-[var(--apex-text-secondary)]">{vote.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {signal.smcAnalysis ? (
            <div className="apex-stack-card">
              <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">SMC / ICT</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div>
                  <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Killzone</p>
                  <p className="mt-2 text-[13px] text-[var(--apex-text-primary)]">{signal.smcAnalysis.killzone}</p>
                </div>
                <div>
                  <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">PD Location</p>
                  <p className="mt-2 text-[13px] text-[var(--apex-text-primary)]">{signal.smcAnalysis.pdLocation}</p>
                </div>
                <div>
                  <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">SMC Score</p>
                  <p className="mt-2 text-[13px] text-[var(--apex-text-primary)]">{signal.smcAnalysis.smcScore} · {signal.smcAnalysis.smcVerdict}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
