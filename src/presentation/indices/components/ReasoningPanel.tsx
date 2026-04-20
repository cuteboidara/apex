'use client';

import { useEffect, useState } from 'react';

type AgentDecision = {
  action: 'EXECUTE' | 'WATCH' | 'SKIP';
  scoreDelta: number;
  finalScore: number;
  confidence: number;
  primaryReasoning: string;
  keyFactors?: {
    supporting?: string[];
    opposing?: string[];
  };
  tradeQualityGrade?: string;
};

type AgentListCard = {
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  warnings?: string[];
  criticalConcerns?: string[];
  supportingFactors?: string[];
  conflictingFactors?: string[];
  conviction?: number;
  riskScore?: number;
  alignmentScore?: number;
};

type ReasoningPayload = {
  analyst: AgentListCard;
  risk: AgentListCard & { shouldBlock?: boolean };
  macro: AgentListCard;
  decision: AgentDecision;
  metrics: {
    latencyMs: number;
    tokensUsed: number;
    costUsd: number;
  };
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string') as string[];
}

function AgentSection({
  title,
  scoreLabel,
  scoreValue,
  summary,
  primaryItems,
  secondaryItems,
}: {
  title: string;
  scoreLabel: string;
  scoreValue: string;
  summary: string;
  primaryItems: string[];
  secondaryItems: string[];
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{title}</p>
        <p className="font-mono text-[10px] text-slate-400">{scoreLabel}: {scoreValue}</p>
      </div>
      <p className="text-xs text-slate-300">{summary}</p>

      {primaryItems.length > 0 ? (
        <div className="mt-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">Primary</p>
          <ul className="mt-1 space-y-1 text-[11px] text-slate-400">
            {primaryItems.slice(0, 3).map(item => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {secondaryItems.length > 0 ? (
        <div className="mt-3">
          <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">Secondary</p>
          <ul className="mt-1 space-y-1 text-[11px] text-slate-500">
            {secondaryItems.slice(0, 3).map(item => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ReasoningPanel({ signalId }: { signalId: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ReasoningPayload | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    void fetch(`/api/indices/amt/reasoning/${signalId}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) return null;
        return response.json() as Promise<ReasoningPayload>;
      })
      .then(payload => {
        setData(payload);
      })
      .catch(() => {
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [signalId]);

  if (loading) {
    return <div className="text-xs font-mono text-slate-500">Loading agent reasoning...</div>;
  }

  if (!data) {
    return <div className="text-xs font-mono text-slate-500">No agent reasoning available for this signal.</div>;
  }

  const decisionTone = data.decision.action === 'EXECUTE'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : data.decision.action === 'SKIP'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-300';

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${decisionTone}`}>
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest opacity-80">Agent Decision</p>
          <p className="font-mono text-[10px] opacity-80">
            Grade {data.decision.tradeQualityGrade ?? 'N/A'} | Confidence {data.decision.confidence}%
          </p>
        </div>
        <div className="mt-2 font-mono text-2xl font-bold">
          {data.decision.action}
          {data.decision.scoreDelta !== 0 ? (
            <span className="ml-3 text-sm opacity-80">
              {data.decision.scoreDelta > 0 ? '+' : ''}{data.decision.scoreDelta} pts
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-xs leading-relaxed opacity-95">{data.decision.primaryReasoning}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <AgentSection
          title="Analyst"
          scoreLabel="Conviction"
          scoreValue={String(data.analyst.conviction ?? 0)}
          summary={data.analyst.summary ?? 'No analyst summary'}
          primaryItems={asStringArray(data.analyst.strengths)}
          secondaryItems={asStringArray(data.analyst.weaknesses)}
        />
        <AgentSection
          title="Risk"
          scoreLabel="Risk Score"
          scoreValue={String(data.risk.riskScore ?? 0)}
          summary={data.risk.summary ?? 'No risk summary'}
          primaryItems={asStringArray(data.risk.criticalConcerns ?? data.risk.warnings)}
          secondaryItems={asStringArray(data.risk.warnings)}
        />
        <AgentSection
          title="Macro"
          scoreLabel="Alignment"
          scoreValue={String(data.macro.alignmentScore ?? 0)}
          summary={data.macro.summary ?? 'No macro summary'}
          primaryItems={asStringArray(data.macro.supportingFactors)}
          secondaryItems={asStringArray(data.macro.conflictingFactors)}
        />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2 font-mono text-[10px] text-slate-500">
        <span>Latency {data.metrics.latencyMs}ms</span>
        <span>Tokens {data.metrics.tokensUsed.toLocaleString()}</span>
        <span>Cost ${data.metrics.costUsd.toFixed(4)}</span>
      </div>
    </div>
  );
}
