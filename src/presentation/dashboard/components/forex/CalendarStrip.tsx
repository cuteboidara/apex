type EconomicCalendarEvent = {
  time: string;
  currency: string;
  event: string;
  impact: "high" | "medium" | "low";
  forecast: string;
  previous: string;
  actual?: string;
  timestamp?: number | null;
};

function currencyFlag(currency: string): string {
  if (currency === "USD") return "🇺🇸";
  if (currency === "EUR") return "🇪🇺";
  if (currency === "GBP") return "🇬🇧";
  if (currency === "JPY") return "🇯🇵";
  if (currency === "AUD") return "🇦🇺";
  if (currency === "NZD") return "🇳🇿";
  if (currency === "CAD") return "🇨🇦";
  if (currency === "CHF") return "🇨🇭";
  return "🌐";
}

function impactTone(impact: EconomicCalendarEvent["impact"]) {
  if (impact === "high") return "bg-[#F87171]";
  if (impact === "medium") return "bg-[#FB923C]";
  return "bg-[rgba(255,255,255,0.18)]";
}

export function CalendarStrip({
  events,
  generatedAt,
  now,
  error,
  filterCurrencies,
}: {
  events: EconomicCalendarEvent[];
  generatedAt: number | null;
  now: number;
  error: string | null;
  filterCurrencies?: string[];
}) {
  const filteredEvents = filterCurrencies?.length
    ? events.filter(event => filterCurrencies.includes(event.currency))
    : events;

  return (
    <section className="apex-surface px-6 py-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--apex-border-subtle)] pb-4">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Economic Calendar
          </p>
          <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
            High-impact releases that can invalidate otherwise clean FX structure.
          </p>
        </div>
        <p className="text-[12px] text-[var(--apex-text-secondary)]">
          {generatedAt ? `Updated ${Math.max(0, Math.floor((now - generatedAt) / 60000))}m ago` : "Calendar pending"}
        </p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {filteredEvents.length === 0 ? (
          <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] px-4 py-4 text-[13px] text-[var(--apex-text-secondary)]">
            {error ?? "No high-impact events loaded for today."}
          </div>
        ) : (
          filteredEvents.map(event => {
            const timestamp = event.timestamp ?? null;
            const isUpcoming = timestamp != null && timestamp >= now && timestamp - now <= 30 * 60 * 1000;
            const isPast = timestamp != null && timestamp < now;
            return (
              <article
                key={`${event.currency}-${event.event}-${event.time}`}
                className={`min-w-[240px] rounded-[var(--apex-radius-lg)] border px-4 py-4 ${
                  isUpcoming
                    ? "border-[rgba(239,68,68,0.34)] bg-[rgba(239,68,68,0.10)] shadow-[0_0_24px_rgba(239,68,68,0.14)]"
                    : isPast
                      ? "border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.02)] opacity-60"
                      : "border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span>{currencyFlag(event.currency)}</span>
                    <span className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]">
                      {event.time}
                    </span>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${impactTone(event.impact)}`} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
                    {event.currency}
                  </span>
                  {isUpcoming ? (
                    <span className="rounded-full border border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.10)] px-2 py-0.5 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[#FCA5A5]">
                      Upcoming
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-[14px] text-[var(--apex-text-primary)]">{event.event.slice(0, 20)}</p>
                <p className="mt-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]">
                  Forecast {event.forecast || "—"} · Previous {event.previous || "—"}
                </p>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
