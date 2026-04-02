import type { EconomicEventContext, HighImpactEventType } from "@/src/interfaces/contracts";
import { logger } from "@/src/lib/logger";

const HIGH_IMPACT_WINDOW_MINUTES = 30;
const ECONOMIC_CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
const ECONOMIC_EVENTS_TIMEOUT_MS = 8_000;

export interface HighImpactEconomicEvent {
  ts: number;
  eventType: HighImpactEventType;
  currencies: string[];
  impact: "high";
}

export interface EconomicEventProvider {
  readonly providerName: string;
  getContext(symbol: string, ts: number): Promise<EconomicEventContext>;
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").trim() ?? "";
}

function normalizeCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(normalized)) {
    return normalized;
  }

  const map: Record<string, string> = {
    "UNITED STATES": "USD",
    "US": "USD",
    "EURO": "EUR",
    "EUROZONE": "EUR",
    "UNITED KINGDOM": "GBP",
    "UK": "GBP",
    "JAPAN": "JPY",
    "CANADA": "CAD",
    "SWITZERLAND": "CHF",
    "AUSTRALIA": "AUD",
    "NEW ZEALAND": "NZD",
  };

  return map[normalized] ?? null;
}

function inferEventType(title: string): HighImpactEventType {
  const normalized = title.toLowerCase();
  if (normalized.includes("non-farm") || normalized.includes("nfp")) return "NFP";
  if (normalized.includes("consumer price") || normalized.includes("cpi") || normalized.includes("inflation")) return "CPI";
  if (normalized.includes("fomc") || normalized.includes("federal reserve")) return "FOMC";
  if (normalized.includes("rate decision") || normalized.includes("interest rate")) return "RATE_DECISION";
  if (normalized.includes("pmi")) return "PMI";
  return "OTHER";
}

function parseEventTimestamp(dateValue: string, timeValue: string, nowTs: number): number | null {
  const candidateStrings = [
    `${dateValue} ${timeValue} UTC`,
    `${dateValue} ${timeValue}`,
    `${new Date(nowTs).getUTCFullYear()} ${dateValue} ${timeValue} UTC`,
  ];

  for (const candidate of candidateStrings) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isSameUtcDay(leftTs: number, rightTs: number): boolean {
  return new Date(leftTs).toISOString().slice(0, 10) === new Date(rightTs).toISOString().slice(0, 10);
}

export function parseForexFactoryCalendar(xml: string, nowTs = Date.now()): HighImpactEconomicEvent[] {
  const eventBlocks = xml.match(/<event\b[\s\S]*?<\/event>/gi) ?? [];

  return eventBlocks.flatMap(block => {
    const title = extractTag(block, "title") || extractTag(block, "event");
    const impact = extractTag(block, "impact").toLowerCase();
    const currency = normalizeCurrency(extractTag(block, "currency") || extractTag(block, "country"));
    const dateValue = extractTag(block, "date");
    const timeValue = extractTag(block, "time");
    const ts = parseEventTimestamp(dateValue, timeValue, nowTs);

    if (!title || !currency || !impact.includes("high") || ts == null || !isSameUtcDay(ts, nowTs)) {
      return [];
    }

    return [{
      ts,
      eventType: inferEventType(title),
      currencies: [currency],
      impact: "high" as const,
    }];
  });
}

export async function fetchTodaysHighImpactEconomicEvents(fetchImpl: typeof fetch = fetch): Promise<HighImpactEconomicEvent[]> {
  try {
    const response = await fetchImpl(ECONOMIC_CALENDAR_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/xml, text/xml",
        "User-Agent": "APEX/1.0 (+economic-calendar)",
      },
      signal: AbortSignal.timeout(ECONOMIC_EVENTS_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    const xml = await response.text();
    if (!xml.trim()) {
      throw new Error("empty_body");
    }

    return parseForexFactoryCalendar(xml);
  } catch (error) {
    logger.warn({
      module: "data-plant",
      message: "[APEX EVENTS] Economic calendar unavailable, running without news gating",
      error: String(error),
    });
    return [];
  }
}

function symbolCurrencies(symbol: string): string[] {
  if (!/^[A-Z]{6}$/.test(symbol)) {
    return [];
  }

  return [symbol.slice(0, 3), symbol.slice(3)];
}

export function emptyEconomicEventContext(): EconomicEventContext {
  return {
    majorNewsFlag: false,
    minutesToNextHighImpactEvent: null,
    minutesSinceLastHighImpactEvent: null,
    eventType: null,
  };
}

export class StaticEconomicEventProvider implements EconomicEventProvider {
  readonly providerName = "static-economic-events";

  constructor(private events: HighImpactEconomicEvent[] = []) {}

  replaceEvents(events: HighImpactEconomicEvent[]): void {
    this.events = [...events].sort((left, right) => left.ts - right.ts);
  }

  async getContext(symbol: string, ts: number): Promise<EconomicEventContext> {
    const currencies = symbolCurrencies(symbol);
    if (currencies.length === 0 || this.events.length === 0) {
      return emptyEconomicEventContext();
    }

    const relevant = this.events.filter(event =>
      event.impact === "high" && event.currencies.some(currency => currencies.includes(currency)),
    );
    if (relevant.length === 0) {
      return emptyEconomicEventContext();
    }

    const previous = [...relevant].reverse().find(event => event.ts <= ts) ?? null;
    const next = relevant.find(event => event.ts >= ts) ?? null;
    const minutesSinceLast = previous ? Math.max(0, Math.round((ts - previous.ts) / 60_000)) : null;
    const minutesToNext = next ? Math.max(0, Math.round((next.ts - ts) / 60_000)) : null;
    const previousInWindow = minutesSinceLast != null && minutesSinceLast <= HIGH_IMPACT_WINDOW_MINUTES;
    const nextInWindow = minutesToNext != null && minutesToNext <= HIGH_IMPACT_WINDOW_MINUTES;
    const activeEvent = nextInWindow
      ? next
      : previousInWindow
        ? previous
        : null;

    return {
      majorNewsFlag: previousInWindow || nextInWindow,
      minutesToNextHighImpactEvent: minutesToNext,
      minutesSinceLastHighImpactEvent: minutesSinceLast,
      eventType: activeEvent?.eventType ?? null,
    };
  }
}
