import type { StrategyDiagnostic } from "@/lib/strategy/types";

const DIAGNOSTIC_LABELS: Record<StrategyDiagnostic, string> = {
  style_disabled: "style is intentionally disabled",
  degraded_data: "required candle data is degraded or stale",
  unclear_regime: "regime clarity is insufficient",
  weak_location: "location quality is weak or mid-range",
  no_confirmation: "price did not confirm with a publishable trigger",
  conflicting_htf_bias: "higher-timeframe bias conflicts with the setup",
  stop_invalid: "structure-based invalidation makes the stop invalid",
  tp1_not_viable: "TP1 is not a realistic 2R objective",
  overextended_move: "the move is already extended and not worth chasing",
};

function joinPhrases(items: Array<string | null | undefined>) {
  return items.filter((item): item is string => Boolean(item && item.trim())).join(" ");
}

function humanizeDiagnostics(diagnostics: string[]) {
  return diagnostics
    .map(item => DIAGNOSTIC_LABELS[item as StrategyDiagnostic] ?? item.replaceAll("_", " "))
    .join(", ");
}

export type SignalNarrativeTemplateInput = {
  symbol: string;
  assetClass: string;
  direction: "LONG" | "SHORT";
  rank: string;
  style: string | null;
  setupFamily: string | null;
  regimeTag: string | null;
  status: "ACTIVE" | "NO_SETUP" | "STALE";
  diagnostics: string[];
  provider: string | null;
  providerHealthState: string | null;
  marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  fallbackUsed: boolean;
  freshnessClass: "fresh" | "stale" | "expired" | null;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  reason: string;
};

export type ReasoningTemplateInput = {
  asset: string;
  direction: string;
  rank: string;
  total: number;
  macro: number;
  structure: number;
  zones: number;
  technical: number;
  timing: number;
};

export type InsightsTemplateTrade = {
  asset: string;
  direction: string;
  rank: string;
  total: number;
  outcome: string;
  pnl: number | null;
};

export type LifecycleTemplateInput = {
  symbol: string;
  style: string;
  bias: string;
  outcome: string | null;
  realizedRR: number | null;
  entryHitAt: string | null;
  tp1HitAt: string | null;
  tp2HitAt: string | null;
  tp3HitAt: string | null;
  stopHitAt: string | null;
  invalidatedAt: string | null;
  expiredAt: string | null;
};

function formatLevel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 100) return value.toFixed(3);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export function buildSignalNarrativeTemplate(input: SignalNarrativeTemplateInput): string {
  const dataState = input.marketStatus !== "LIVE" || input.fallbackUsed || input.freshnessClass === "stale"
    ? `Data is ${input.marketStatus.toLowerCase()}${input.fallbackUsed ? " on fallback" : ""}${input.provider ? ` via ${input.provider}` : ""}, so the brief stays conservative.`
    : `${input.provider ?? "Primary provider"} is live and the publish gate remained intact.`;

  if (input.status !== "ACTIVE") {
    return joinPhrases([
      `${input.symbol} stays out of play for now.`,
      input.reason || "The setup does not meet publication standards.",
      input.diagnostics.length > 0 ? `Key rejection drivers: ${humanizeDiagnostics(input.diagnostics)}.` : null,
      dataState,
    ]);
  }

  return joinPhrases([
    `${input.symbol} remains a ${input.rank} ${input.direction} ${input.style?.toLowerCase() ?? "trade"} idea${input.setupFamily ? ` built around ${input.setupFamily.toLowerCase()}` : ""}.`,
    input.regimeTag ? `Regime: ${input.regimeTag}.` : null,
    `Execution stays valid only around ${formatLevel(input.entry)} with invalidation at ${formatLevel(input.stopLoss)} and TP1 at ${formatLevel(input.tp1)}.`,
    input.tp2 != null || input.tp3 != null
      ? `Extended targets are only shown where structure supports them: TP2 ${formatLevel(input.tp2)}${input.tp3 != null ? `, TP3 ${formatLevel(input.tp3)}` : ""}.`
      : "Extended targets were intentionally omitted because structure does not justify fantasy extensions.",
    dataState,
  ]);
}

export function buildReasoningTemplate(input: ReasoningTemplateInput): string {
  const dimensions = [
    ["macro", input.macro],
    ["structure", input.structure],
    ["zones", input.zones],
    ["technical", input.technical],
    ["timing", input.timing],
  ].sort((left, right) => (right[1] as number) - (left[1] as number));
  const strongest = dimensions[0];
  const weakest = dimensions[dimensions.length - 1];

  return `${input.asset} is currently a ${input.rank} ${input.direction} idea at ${input.total}/100. The strongest driver is ${strongest[0]} (${strongest[1]}/20), which is doing most of the work for conviction. The weakest link is ${weakest[0]} (${weakest[1]}/20), so that is the first thing that can break the trade. Size it like the score, not the story, and only execute if the weak dimension does not deteriorate further.`;
}

export function buildInsightsTemplate(trades: InsightsTemplateTrade[]): string {
  const resolved = trades.filter(trade => trade.pnl != null && Number.isFinite(trade.pnl));
  const winners = resolved.filter(trade => (trade.pnl ?? 0) > 0);
  const losers = resolved.filter(trade => (trade.pnl ?? 0) <= 0);
  const averageWinnerScore = winners.length > 0 ? winners.reduce((sum, trade) => sum + trade.total, 0) / winners.length : null;
  const averageLoserScore = losers.length > 0 ? losers.reduce((sum, trade) => sum + trade.total, 0) / losers.length : null;
  const longWins = winners.filter(trade => trade.direction === "LONG").length;
  const shortWins = winners.filter(trade => trade.direction === "SHORT").length;

  return [
    `1. Resolved trades: ${resolved.length}, with ${winners.length} winners and ${losers.length} losers.`,
    `2. Average winner score is ${averageWinnerScore != null ? averageWinnerScore.toFixed(1) : "n/a"} versus ${averageLoserScore != null ? averageLoserScore.toFixed(1) : "n/a"} for losers, so score discipline still matters.`,
    `3. Long wins: ${longWins}, short wins: ${shortWins}. Keep pressing the side that is actually converting, not the side that merely looks active.`,
  ].join(" ");
}

export function buildLifecycleOutcomeTemplate(input: LifecycleTemplateInput): string {
  const outcome = input.outcome ?? "PENDING_ENTRY";
  const rr = input.realizedRR != null && Number.isFinite(input.realizedRR)
    ? `${input.realizedRR >= 0 ? "+" : ""}${input.realizedRR.toFixed(2)}R`
    : "n/a";

  return joinPhrases([
    `${input.symbol} ${input.style.toLowerCase()} ${input.bias} plan is now ${outcome.replaceAll("_", " ").toLowerCase()}.`,
    input.entryHitAt ? "Entry was triggered." : "Entry has not triggered yet.",
    input.tp3HitAt ? "TP3 printed." : input.tp2HitAt ? "TP2 printed." : input.tp1HitAt ? "TP1 printed." : null,
    input.stopHitAt ? "Stop was hit." : null,
    input.invalidatedAt ? "The plan invalidated before completion." : null,
    input.expiredAt ? "The plan expired without a clean finish." : null,
    `Realized result: ${rr}.`,
  ]);
}
