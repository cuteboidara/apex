import { NextResponse } from "next/server";
import Parser from "rss-parser";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

type EconomicCalendarPayload = {
  generatedAt: number;
  events: EconomicCalendarEvent[];
};

const CACHE_KEY = "forex:calendar:today";
const CACHE_TTL_SECONDS = 30 * 60;
const FOREX_FACTORY_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
const parser = new Parser();

function normalizeImpact(value: string): "high" | "medium" | "low" {
  const lower = value.toLowerCase();
  if (lower.includes("high")) return "high";
  if (lower.includes("medium")) return "medium";
  return "low";
}

function parseTimeString(value: string): { hours: number; minutes: number } | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(am|pm)?$/i);
  if (!match) {
    return null;
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase() ?? null;
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  return { hours, minutes };
}

function parseDateString(value: string, fallbackNow: Date): Date | null {
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) {
    return new Date(direct);
  }

  const monthDay = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (monthDay) {
    const withYear = `${monthDay[1]} ${monthDay[2]} ${fallbackNow.getUTCFullYear()}`;
    const parsed = Date.parse(`${withYear} UTC`);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }

  const mmddyyyy = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (mmddyyyy) {
    return new Date(Date.UTC(Number(mmddyyyy[3]), Number(mmddyyyy[1]) - 1, Number(mmddyyyy[2])));
  }

  return null;
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ?? "";
}

function parseForexFactoryXml(xml: string): EconomicCalendarEvent[] {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const events: EconomicCalendarEvent[] = [];
  const matches = xml.match(/<event>([\s\S]*?)<\/event>/gi) ?? [];

  for (const rawEvent of matches) {
    const title = extractTag(rawEvent, "title");
    const dateText = extractTag(rawEvent, "date");
    const timeText = extractTag(rawEvent, "time");
    const currency = extractTag(rawEvent, "currency") || extractTag(rawEvent, "country");
    const impact = normalizeImpact(extractTag(rawEvent, "impact"));
    const forecast = extractTag(rawEvent, "forecast");
    const previous = extractTag(rawEvent, "previous");
    const actual = extractTag(rawEvent, "actual");

    const date = parseDateString(dateText, now);
    if (!date || impact !== "high") {
      continue;
    }
    const timeParts = parseTimeString(timeText);
    if (timeParts) {
      date.setUTCHours(timeParts.hours, timeParts.minutes, 0, 0);
    }
    const dateKey = date.toISOString().slice(0, 10);
    if (dateKey !== todayKey) {
      continue;
    }

    events.push({
      time: timeParts ? `${String(timeParts.hours).padStart(2, "0")}:${String(timeParts.minutes).padStart(2, "0")} UTC` : "All Day",
      currency: currency || "N/A",
      event: title || "Economic Event",
      impact,
      forecast,
      previous,
      actual: actual || undefined,
      timestamp: timeParts ? date.getTime() : null,
    });
  }

  return events.sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
}

async function fetchEconomicEvents(): Promise<EconomicCalendarEvent[]> {
  const response = await fetch(FOREX_FACTORY_FEED, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "User-Agent": "APEX/1.0",
      Accept: "application/xml,text/xml,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(`ForexFactory feed failed with ${response.status}`);
  }

  const xml = await response.text();

  try {
    await parser.parseString(xml);
  } catch {
    // The feed is XML-first rather than classic RSS. Continue with manual parsing.
  }

  return parseForexFactoryXml(xml);
}

export async function GET() {
  const cached = await getCachedJson<EconomicCalendarPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const payload: EconomicCalendarPayload = {
      generatedAt: Date.now(),
      events: await fetchEconomicEvents(),
    };
    await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
    return NextResponse.json(payload);
  } catch (error) {
    console.warn("[APEX CALENDAR] Feed unavailable", error);
    const payload: EconomicCalendarPayload = {
      generatedAt: Date.now(),
      events: [],
    };
    await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
    return NextResponse.json(payload);
  }
}
