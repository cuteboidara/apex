"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

type SessionStatus = "OPEN" | "CLOSED" | "OVERLAP";

type SessionDefinition = {
  key: string;
  name: string;
  flag: string;
  openHourUtc: number;
  closeHourUtc: number;
  activePairs: string[];
};

const SESSIONS: SessionDefinition[] = [
  { key: "asia", name: "Tokyo/Asia", flag: "🇯🇵", openHourUtc: 0, closeHourUtc: 9, activePairs: ["USDJPY", "EURJPY"] },
  { key: "london", name: "London", flag: "🇬🇧", openHourUtc: 7, closeHourUtc: 16, activePairs: ["EURUSD", "GBPUSD"] },
  { key: "new-york", name: "New York", flag: "🇺🇸", openHourUtc: 12, closeHourUtc: 21, activePairs: ["EURUSD", "USDCAD"] },
];

function buildSessionWindow(now: Date, session: SessionDefinition) {
  const start = new Date(now);
  start.setUTCHours(session.openHourUtc, 0, 0, 0);
  const end = new Date(now);
  end.setUTCHours(session.closeHourUtc, 0, 0, 0);

  if (now < start) {
    return { start, end, isOpen: false };
  }

  if (now >= end) {
    start.setUTCDate(start.getUTCDate() + 1);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end, isOpen: false };
  }

  return { start, end, isOpen: true };
}

function formatCountdown(targetTime: Date, now: Date): string {
  const diffMs = Math.max(0, targetTime.getTime() - now.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusTone(status: SessionStatus) {
  if (status === "OVERLAP") {
    return "border-[rgba(249,115,22,0.32)] bg-[rgba(249,115,22,0.10)] text-[#FDBA74]";
  }
  if (status === "OPEN") {
    return "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]";
  }
  return "border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] text-[var(--apex-text-secondary)]";
}

export function SessionBar() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const windows = SESSIONS.map(session => ({
    session,
    ...buildSessionWindow(now, session),
  }));
  const openCount = windows.filter(window => window.isOpen).length;

  return (
    <section className="apex-surface px-6 py-5">
      <div className="flex flex-col gap-3 border-b border-[var(--apex-border-subtle)] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Session Bar
          </p>
          <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
            {formatInTimeZone(now, "UTC", "HH:mm:ss")} UTC
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {windows.map(window => {
          const status: SessionStatus = window.isOpen
            ? openCount > 1
              ? "OVERLAP"
              : "OPEN"
            : "CLOSED";
          const target = window.isOpen ? window.end : window.start;
          const statusLabel = window.isOpen ? `Closes in ${formatCountdown(target, now)}` : `Opens in ${formatCountdown(target, now)}`;

          return (
            <article
              key={window.session.key}
              className={`rounded-[var(--apex-radius-lg)] border px-4 py-4 ${statusTone(status)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em]">
                    {window.session.flag} {window.session.name}
                  </p>
                  <p className="mt-2 text-[15px] font-medium">{status}</p>
                </div>
                <span className={`mt-1 h-3 w-3 rounded-full ${status === "CLOSED" ? "bg-[rgba(255,255,255,0.14)]" : status === "OVERLAP" ? "animate-pulse bg-[#FDBA74]" : "animate-pulse bg-[var(--apex-status-active-text)]"}`} />
              </div>

              <p className="mt-4 font-[var(--apex-font-mono)] text-[12px]">{statusLabel}</p>
              <p className="mt-3 text-[12px] opacity-80">
                Active pairs: {window.session.activePairs.join(", ")}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
