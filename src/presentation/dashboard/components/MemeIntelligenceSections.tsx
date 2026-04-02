"use client";

import { useCallback, useEffect, useState } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import { SectionHeader } from "@/src/components/apex-ui/SectionHeader";
import type {
  MemeScannerChain,
  MemeScannerPayload,
  MemeTrendRadarItem,
  MemeTrendRadarPayload,
  ScoredMemeScannerCoin,
} from "@/src/assets/memecoins/types";

type SortOption = "apexScore" | "marketCap" | "volume" | "age";
type ScannerState = {
  payload: MemeScannerPayload | null;
  error: string | null;
  loading: boolean;
};
type TrendsState = {
  payload: MemeTrendRadarPayload | null;
  error: string | null;
  loading: boolean;
};

const CHAIN_FILTERS: Array<{ label: string; value: "all" | MemeScannerChain }> = [
  { label: "ALL", value: "all" },
  { label: "SOL", value: "solana" },
  { label: "ETH", value: "ethereum" },
  { label: "BASE", value: "base" },
  { label: "BSC", value: "bsc" },
];

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatRelativeUpdate(timestamp: number | null, now: number): string {
  if (!timestamp) {
    return "Not updated yet";
  }
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 60) {
    return `Last updated ${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `Last updated ${diffMinutes}m ago`;
  }
  return `Last updated ${Math.floor(diffMinutes / 60)}h ago`;
}

function chainBadgeStyle(chain: MemeScannerChain) {
  if (chain === "solana") {
    return { background: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.35)", color: "#C084FC" };
  }
  if (chain === "ethereum") {
    return { background: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.30)", color: "#60A5FA" };
  }
  if (chain === "base") {
    return { background: "rgba(99,102,241,0.12)", border: "rgba(99,102,241,0.30)", color: "#818CF8" };
  }
  return { background: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.32)", color: "#FACC15" };
}

function signalPillStyle(signal: ScoredMemeScannerCoin["signal"]) {
  if (signal === "STRONG_BUY") {
    return { background: "rgba(80,160,100,0.14)", border: "rgba(80,160,100,0.35)", color: "var(--apex-status-active-text)" };
  }
  if (signal === "WATCH") {
    return { background: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.28)", color: "#FACC15" };
  }
  if (signal === "AVOID") {
    return { background: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.30)", color: "#F87171" };
  }
  return { background: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.24)", color: "var(--apex-text-secondary)" };
}

function sourceBadgeVariant(source: MemeTrendRadarItem["source"]): "active" | "watchlist" | "developing" {
  if (source === "reddit") return "active";
  if (source === "twitter") return "developing";
  return "watchlist";
}

function getFilteredCoins(
  payload: MemeScannerPayload | null,
  sortBy: SortOption,
  chainFilter: "all" | MemeScannerChain,
  minScore: number,
) {
  const filtered = (payload?.coins ?? []).filter(coin =>
    (chainFilter === "all" || coin.chain === chainFilter) && coin.apexScore >= minScore,
  );

  if (sortBy === "marketCap") {
    return filtered.sort((left, right) => left.marketCap - right.marketCap);
  }
  if (sortBy === "volume") {
    return filtered.sort((left, right) => right.volume1h - left.volume1h);
  }
  if (sortBy === "age") {
    return filtered.sort((left, right) => right.launchedAt - left.launchedAt);
  }
  return filtered.sort((left, right) => right.apexScore - left.apexScore);
}

function ScoreRing({ score }: { score: number }) {
  const normalized = Math.max(0, Math.min(100, score));
  return (
    <div
      className="grid h-16 w-16 place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--apex-status-active-text) ${normalized * 3.6}deg, rgba(255,255,255,0.06) 0deg)`,
      }}
    >
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--apex-bg-base)] font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">
        {normalized}
      </div>
    </div>
  );
}

function ScannerSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`scanner-skeleton-${index}`}
          className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5"
        >
          <div className="h-4 w-32 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
          <div className="mt-4 h-14 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="h-12 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
            <div className="h-12 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
            <div className="h-12 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`trends-skeleton-${index}`}
          className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="h-4 w-40 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
            <div className="h-16 w-16 animate-pulse rounded-full bg-[rgba(255,255,255,0.06)]" />
          </div>
          <div className="mt-4 h-10 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
          <div className="mt-4 flex gap-2">
            <div className="h-6 w-16 animate-pulse rounded-full bg-[rgba(255,255,255,0.06)]" />
            <div className="h-6 w-20 animate-pulse rounded-full bg-[rgba(255,255,255,0.06)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-[var(--apex-radius-lg)] border border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.08)] px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-[#FCA5A5]">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center justify-center rounded-[var(--apex-radius-md)] border border-[rgba(239,68,68,0.28)] px-4 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#FCA5A5]"
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
}

function ScannerCard({ coin }: { coin: ScoredMemeScannerCoin }) {
  const chainStyle = chainBadgeStyle(coin.chain);
  const pillStyle = signalPillStyle(coin.signal);

  return (
    <article className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border px-2.5 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em]"
              style={{
                background: chainStyle.background,
                borderColor: chainStyle.border,
                color: chainStyle.color,
              }}
            >
              {coin.chain.toUpperCase()}
            </span>
            <span className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
              {coin.age}
            </span>
          </div>
          <h3 className="font-[var(--apex-font-body)] text-[20px] italic text-[var(--apex-text-primary)]">
            {coin.name}
            <span className="ml-2 font-[var(--apex-font-mono)] text-[12px] not-italic uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
              {coin.symbol}
            </span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <GradeTag grade={coin.grade as never} />
          <span className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-primary)]">
            {coin.apexScore}/100
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className="rounded-full border px-2.5 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em]"
          style={{
            background: pillStyle.background,
            borderColor: pillStyle.border,
            color: pillStyle.color,
          }}
        >
          {coin.signal.replaceAll("_", " ")}
        </span>
        {coin.flags.map(flag => (
          <span
            key={`${coin.id}-${flag}`}
            className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]"
          >
            {flag.replaceAll("_", " ")}
          </span>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
          <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Market Cap</p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[15px] text-[var(--apex-text-primary)]">{formatCompactNumber(coin.marketCap)}</p>
        </div>
        <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
          <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Liquidity</p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[15px] text-[var(--apex-text-primary)]">{formatCompactNumber(coin.liquidity)}</p>
        </div>
        <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
          <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">1H Volume</p>
          <p className="mt-2 font-[var(--apex-font-mono)] text-[15px] text-[var(--apex-text-primary)]">{formatCompactNumber(coin.volume1h)}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
          Holders {coin.holders.toLocaleString("en-US")}
        </p>
        {coin.dexUrl ? (
          <a
            href={coin.dexUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] px-4 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]"
          >
            View
          </a>
        ) : null}
      </div>

      <p className="mt-4 text-[13px] italic text-[var(--apex-text-secondary)]">{coin.reasoning}</p>
    </article>
  );
}

function TrendCard({ trend }: { trend: MemeTrendRadarItem }) {
  return (
    <article className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Chip label={trend.source.toUpperCase()} variant={sourceBadgeVariant(trend.source)} />
          <h3 className="font-[var(--apex-font-body)] text-[19px] italic text-[var(--apex-text-primary)]">{trend.title}</h3>
        </div>
        <div className="flex items-center gap-3">
          <ScoreRing score={trend.coinPotentialScore} />
          <GradeTag grade={trend.grade as never} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.03)] px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]">
          {trend.suggestedCoinName}
        </span>
        <span className="rounded-full border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.08)] px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#93C5FD]">
          ${trend.suggestedSymbol}
        </span>
      </div>

      <p className="mt-4 text-[13px] text-[var(--apex-text-secondary)]">{trend.reasoning}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {trend.tags.map(tag => (
          <span
            key={`${trend.id}-${tag}`}
            className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]"
          >
            {tag.replaceAll("_", " ")}
          </span>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
          Engagement {trend.engagementScore}/100
        </p>
        {trend.sourceUrl ? (
          <a
            href={trend.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-accent)]"
          >
            Source
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function MemeIntelligenceSections() {
  const [sortBy, setSortBy] = useState<SortOption>("apexScore");
  const [chainFilter, setChainFilter] = useState<"all" | MemeScannerChain>("all");
  const [minScore, setMinScore] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [scanner, setScanner] = useState<ScannerState>({ payload: null, error: null, loading: true });
  const [trends, setTrends] = useState<TrendsState>({ payload: null, error: null, loading: true });

  const loadScanner = useCallback(async () => {
    setScanner(current => ({ ...current, loading: current.payload == null, error: null }));
    try {
      const response = await fetch("/api/meme-scanner", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as MemeScannerPayload;
      setScanner({ payload, error: null, loading: false });
    } catch (error) {
      setScanner(current => ({
        payload: current.payload,
        error: "Scanner temporarily offline — retrying in 30s",
        loading: false,
      }));
      console.error("[memecoins] Meme scanner fetch failed:", error);
    }
  }, []);

  const loadTrends = useCallback(async () => {
    setTrends(current => ({ ...current, loading: current.payload == null, error: null }));
    try {
      const response = await fetch("/api/meme-trends", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as MemeTrendRadarPayload;
      setTrends({ payload, error: null, loading: false });
    } catch (error) {
      setTrends(current => ({
        payload: current.payload,
        error: "Trend radar temporarily offline — retrying in 30s",
        loading: false,
      }));
      console.error("[memecoins] Meme trends fetch failed:", error);
    }
  }, []);

  useEffect(() => {
    void loadScanner();
    void loadTrends();
  }, [loadScanner, loadTrends]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadScanner();
    }, scanner.error ? 30_000 : 60_000);
    return () => window.clearInterval(timer);
  }, [loadScanner, scanner.error]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTrends();
    }, trends.error ? 30_000 : 300_000);
    return () => window.clearInterval(timer);
  }, [loadTrends, trends.error]);

  const filteredCoins = getFilteredCoins(scanner.payload, sortBy, chainFilter, minScore);

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <SectionHeader
          title="Live Coin Scanner"
          count={filteredCoins.length}
          subtitle="New Solana, Ethereum, Base, and BSC launches scored for early momentum and memetic edge."
        />

        <div className="apex-surface px-6 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                  Sort by
                </span>
                {([
                  ["apexScore", "APEX Score"],
                  ["marketCap", "Market Cap"],
                  ["volume", "Volume"],
                  ["age", "Age"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSortBy(value)}
                    className={`rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${
                      sortBy === value
                        ? "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.12)] text-[var(--apex-status-active-text)]"
                        : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                  Chain
                </span>
                {CHAIN_FILTERS.map(filter => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setChainFilter(filter.value)}
                    className={`rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${
                      chainFilter === filter.value
                        ? "border-[rgba(59,130,246,0.30)] bg-[rgba(59,130,246,0.10)] text-[#93C5FD]"
                        : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-[220px] space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                  Min Score
                </span>
                <span className="font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">{minScore}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={minScore}
                onChange={event => setMinScore(Number(event.target.value))}
                className="w-full accent-[var(--apex-status-active-text)]"
              />
              <p className="text-[12px] text-[var(--apex-text-secondary)]">
                {formatRelativeUpdate(scanner.payload?.generatedAt ?? null, now)}
              </p>
            </div>
          </div>
        </div>

        {scanner.error && !scanner.payload ? (
          <SectionError message={scanner.error} retryLabel="Retry scanner" onRetry={() => void loadScanner()} />
        ) : null}

        {scanner.loading && !scanner.payload ? <ScannerSkeleton /> : null}

        {!scanner.loading && filteredCoins.length === 0 ? (
          <div className="apex-empty-state">Scanner is live, but no coins match the current filter stack.</div>
        ) : null}

        {filteredCoins.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {filteredCoins.map(coin => (
              <ScannerCard key={coin.id} coin={coin} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Meme Trend Radar"
          count={trends.payload?.trends.length ?? 0}
          subtitle="Cultural momentum from Reddit, trend surfaces, and crypto media scored for coin creation potential."
        />

        <div className="apex-surface px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-3 w-3 animate-pulse rounded-full bg-[var(--apex-status-active-text)]" />
              <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
                Multi-source trend pulse
              </span>
            </div>
            <p className="text-[12px] text-[var(--apex-text-secondary)]">
              {formatRelativeUpdate(trends.payload?.generatedAt ?? null, now)}
            </p>
          </div>
        </div>

        {trends.error && !trends.payload ? (
          <SectionError message={trends.error} retryLabel="Retry trends" onRetry={() => void loadTrends()} />
        ) : null}

        {trends.loading && !trends.payload ? <TrendsSkeleton /> : null}

        {!trends.loading && (trends.payload?.trends.length ?? 0) === 0 ? (
          <div className="apex-empty-state">Trend radar is online, but no high-signal themes were extracted yet.</div>
        ) : null}

        {(trends.payload?.trends.length ?? 0) > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {trends.payload?.trends.map(trend => (
              <TrendCard key={trend.id} trend={trend} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
