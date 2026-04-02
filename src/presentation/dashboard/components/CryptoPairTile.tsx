"use client";

import { Chip } from "@/src/components/apex-ui/Chip";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import type { CryptoLiveMarketBoardRow } from "@/src/crypto/types";

function formatCryptoPrice(symbol: string, price: number | null): string {
  if (price == null) {
    return "—";
  }

  const formatted = symbol === "BTCUSDT"
    ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toFixed(2);
  return `$${formatted}`;
}

function formatWindow(window: string): string {
  return window.replaceAll("_", " ");
}

function statusVariant(status: CryptoLiveMarketBoardRow["status"]) {
  if (status === "active") return "active" as const;
  if (status === "blocked" || status === "invalidated" || status === "expired") return "blocked" as const;
  if (status === "watchlist") return "watchlist" as const;
  return "neutral" as const;
}

function directionVariant(direction: CryptoLiveMarketBoardRow["direction"]) {
  if (direction === "buy") return "active" as const;
  if (direction === "sell") return "blocked" as const;
  return "neutral" as const;
}

export function CryptoPairTile({ row }: { row: CryptoLiveMarketBoardRow }) {
  return (
    <article className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[13px] font-medium text-[var(--apex-text-primary)]">{row.displayName}</p>
          <p className="mt-1 text-[11px] text-[var(--apex-text-tertiary)]">{formatWindow(row.volatilityWindow)} · 24/7</p>
        </div>
        <div className="text-right">
          {row.grade ? <GradeTag grade={row.grade} /> : <span className="font-[var(--apex-font-mono)] text-[16px] text-[var(--apex-text-tertiary)]">—</span>}
          <p className="mt-2 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
            SMC {row.smcScore}/100
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="font-[var(--apex-font-mono)] text-[22px] text-[var(--apex-text-primary)]">{formatCryptoPrice(row.symbol, row.livePrice)}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Chip label={row.status} variant={statusVariant(row.status)} />
        <Chip label={row.direction} variant={directionVariant(row.direction)} />
        <Chip label={row.pdLocation} variant="neutral" />
        {row.inOTE ? <Chip label="OTE" variant="developing" /> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {row.marketStateLabels.map(label => (
          <span
            key={`${row.symbol}-${label}`}
            className="rounded-full border border-[var(--apex-border-subtle)] px-2.5 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]"
          >
            {label}
          </span>
        ))}
      </div>

      {row.noTradeReason ? (
        <p className="mt-4 text-[12px] text-[var(--apex-text-tertiary)]">Status: {row.noTradeReason}</p>
      ) : null}
    </article>
  );
}
