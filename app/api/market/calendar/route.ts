import { NextResponse } from "next/server";
import { fetchEconomicCalendar } from "@/lib/finnhub";

const COUNTRY_FLAG: Record<string, string> = {
  US: "🇺🇸", EU: "🇪🇺", GB: "🇬🇧", JP: "🇯🇵",
  CA: "🇨🇦", AU: "🇦🇺", NZ: "🇳🇿", CH: "🇨🇭",
  CN: "🇨🇳", DE: "🇩🇪", FR: "🇫🇷",
};

const ALL_ASSETS = ["EURUSD","GBPUSD","USDJPY","XAUUSD","XAGUSD","BTCUSDT","ETHUSDT"];

function getAffectedByEvent(event: string, country: string): string[] {
  const e = (event + " " + country).toLowerCase();

  if (/fomc|fed|federal reserve|us cpi|us gdp|nfp|non-farm|payroll/.test(e)) return ALL_ASSETS;
  if (/ecb|eurozone|euro area|german|france/.test(e) || country === "EU" || country === "DE" || country === "FR") return ["EURUSD"];
  if (/boe|bank of england|uk cpi|uk gdp|uk inflation/.test(e) || country === "GB") return ["GBPUSD"];
  if (/boj|bank of japan|japan cpi|japan gdp/.test(e) || country === "JP") return ["USDJPY"];
  if (/gold|silver|commodity|precious/.test(e)) return ["XAUUSD", "XAGUSD"];
  if (/bitcoin|crypto|digital asset/.test(e)) return ["BTCUSDT", "ETHUSDT"];
  if (/cpi|gdp|inflation|ppi|pce|interest rate/.test(e)) return ALL_ASSETS;
  if (country === "US") return ALL_ASSETS;

  return ALL_ASSETS;
}

export async function GET() {
  const events = await fetchEconomicCalendar();

  const now   = Date.now();
  const seven = now + 7 * 24 * 60 * 60 * 1000;

  const filtered = events
    .filter((ev: CalendarEvent) => {
      if (!ev.time) return false;
      const impact = (ev.impact ?? "").toLowerCase();
      if (impact !== "high") return false;
      const ts = new Date(ev.time).getTime();
      return ts >= now && ts <= seven;
    })
    .sort((a: CalendarEvent, b: CalendarEvent) => new Date(a.time).getTime() - new Date(b.time).getTime())
    .slice(0, 30)
    .map((ev: CalendarEvent) => {
      const ts      = new Date(ev.time).getTime();
      const evDate  = ev.time.split(" ")[0];
      const evTime  = ev.time.split(" ")[1] ?? "";
      const today   = new Date().toISOString().split("T")[0];
      const minutes = Math.floor((ts - now) / 60000);

      return {
        event:          ev.event,
        country:        ev.country,
        flag:           COUNTRY_FLAG[ev.country] ?? "🌐",
        date:           evDate,
        time:           evTime,
        impact:         ev.impact,
        actual:         ev.actual,
        forecast:       ev.estimate,
        previous:       ev.prev,
        unit:           ev.unit,
        isToday:        evDate === today,
        minutesUntil:   minutes,
        imminent:       minutes >= 0 && minutes <= 120,
        affectedAssets: getAffectedByEvent(ev.event, ev.country),
      };
    });

  return NextResponse.json(filtered);
}
type CalendarEvent = {
  event: string;
  country: string;
  time: string;
  impact: string | null;
  actual: number | null;
  estimate: number | null;
  prev: number | null;
  unit: string | null;
};
