"use client";

import { formatInTimeZone } from "date-fns-tz";

type MarketStatus = "open" | "pre" | "after" | "closed";

function getEasternParts(now: number): { day: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(now));
  const weekday = parts.find(part => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[weekday] ?? 1,
    minutes: hour * 60 + minute,
  };
}

function getStockMarketStatus(now: number): { status: MarketStatus; nextLabel: string } {
  const eastern = getEasternParts(now);
  const isWeekend = eastern.day === 0 || eastern.day === 6;
  const preOpen = 4 * 60;
  const regularOpen = 9 * 60 + 30;
  const regularClose = 16 * 60;
  const afterClose = 20 * 60;

  if (isWeekend) {
    return { status: "closed", nextLabel: "Weekend closed" };
  }

  const minutes = eastern.minutes;
  if (minutes >= regularOpen && minutes < regularClose) {
    const remaining = regularClose - minutes;
    return { status: "open", nextLabel: `Closes in ${Math.floor(remaining / 60)}h ${remaining % 60}m` };
  }
  if (minutes >= preOpen && minutes < regularOpen) {
    const remaining = regularOpen - minutes;
    return { status: "pre", nextLabel: `Open in ${Math.floor(remaining / 60)}h ${remaining % 60}m` };
  }
  if (minutes >= regularClose && minutes < afterClose) {
    const remaining = afterClose - minutes;
    return { status: "after", nextLabel: `After-hours ends in ${Math.floor(remaining / 60)}h ${remaining % 60}m` };
  }

  const nextOpen = minutes < preOpen
    ? preOpen - minutes
    : (24 * 60 - minutes) + preOpen;
  return { status: "closed", nextLabel: `Pre-market in ${Math.floor(nextOpen / 60)}h ${nextOpen % 60}m` };
}

function tone(status: MarketStatus) {
  if (status === "open") {
    return "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]";
  }
  if (status === "pre") {
    return "border-[rgba(245,158,11,0.30)] bg-[rgba(245,158,11,0.10)] text-[#FCD34D]";
  }
  if (status === "after") {
    return "border-[rgba(96,165,250,0.30)] bg-[rgba(96,165,250,0.10)] text-[#93C5FD]";
  }
  return "border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[var(--apex-text-secondary)]";
}

function label(status: MarketStatus): string {
  if (status === "open") return "OPEN";
  if (status === "pre") return "PRE-MARKET";
  if (status === "after") return "AFTER-HOURS";
  return "CLOSED";
}

export function MarketStatusBanner({ now }: { now: number }) {
  const market = getStockMarketStatus(now);

  return (
    <section className={`apex-surface border px-6 py-5 ${tone(market.status)}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em]">
            US Market Status
          </p>
          <p className="mt-2 text-[15px] font-medium">{label(market.status)}</p>
        </div>
        <div className="text-right">
          <p className="font-[var(--apex-font-mono)] text-[12px]">
            {formatInTimeZone(now, "America/New_York", "HH:mm:ss")} EST
          </p>
          <p className="mt-1 text-[12px] opacity-80">
            {formatInTimeZone(now, "America/New_York", "EEE, MMM d")} · {market.nextLabel}
          </p>
        </div>
      </div>
    </section>
  );
}
