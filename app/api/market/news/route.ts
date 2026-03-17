import { NextResponse } from "next/server";
import { fetchMarketNews } from "@/lib/finnhub";

// ── Asset keyword mapping ────────────────────────────────────────────────────

const ALL_ASSETS = ["EURUSD","GBPUSD","USDJPY","XAUUSD","XAGUSD","BTCUSDT","ETHUSDT"];

function getAffectedAssets(text: string): string[] {
  const t      = text.toLowerCase();
  const assets = new Set<string>();

  if (/\bbtc\b|bitcoin/.test(t))                              assets.add("BTCUSDT");
  if (/\beth\b|ethereum/.test(t))                             assets.add("ETHUSDT");
  if (/\bcrypto\b|cryptocurrency|digital asset/.test(t))      { assets.add("BTCUSDT"); assets.add("ETHUSDT"); }
  if (/\beur\b|euro\b|\becb\b|eurozone/.test(t))              assets.add("EURUSD");
  if (/\bgbp\b|pound|sterling|\bboe\b|bank of england/.test(t)) assets.add("GBPUSD");
  if (/\bjpy\b|\byen\b|\bboj\b|bank of japan/.test(t))        assets.add("USDJPY");
  if (/\bgold\b|\bxau\b|precious metal/.test(t))              { assets.add("XAUUSD"); assets.add("XAGUSD"); }
  if (/\bsilver\b|\bxag\b/.test(t))                           assets.add("XAGUSD");

  // Macro events affect everything
  if (/\bfed\b|federal reserve|\bfomc\b|\bcpi\b|\bgdp\b|inflation|rate hike|interest rate|recession/.test(t)) {
    return [...ALL_ASSETS];
  }

  return assets.size > 0 ? Array.from(assets) : ALL_ASSETS;
}

// ── Filter keywords ──────────────────────────────────────────────────────────

const FILTER_KEYWORDS = [
  "gold","silver","bitcoin","ethereum","eur","gbp","jpy",
  "fed","federal reserve","ecb","boe","boj",
  "inflation","rate","gdp","recession","rally","crash","surge","drop",
  "forex","currency","commodity","crypto",
];

function matchesFilter(headline: string): boolean {
  const t = headline.toLowerCase();
  return FILTER_KEYWORDS.some(k => t.includes(k));
}

// ── Sentiment ────────────────────────────────────────────────────────────────

const BULLISH = ["rally","surge","rise","gain","high","bullish","up","boost","climb","record","strong","buy","breakout","all-time"];
const BEARISH  = ["fall","drop","crash","decline","low","weak","bearish","down","plunge","sell","slump","loss","broke","warning","risk"];

function sentiment(text: string): "bullish" | "bearish" | "neutral" {
  const t = text.toLowerCase();
  const b = BULLISH.filter(w => t.includes(w)).length;
  const r = BEARISH.filter(w => t.includes(w)).length;
  if (b > r) return "bullish";
  if (r > b) return "bearish";
  return "neutral";
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET() {
  const [forexNews, cryptoNews] = await Promise.allSettled([
    fetchMarketNews("forex"),
    fetchMarketNews("crypto"),
  ]);

  const forex  = forexNews.status  === "fulfilled" ? forexNews.value  : [];
  const crypto = cryptoNews.status === "fulfilled" ? cryptoNews.value : [];

  // Merge + deduplicate by id
  const seen = new Set<number>();
  const merged = [...forex, ...crypto].filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return matchesFilter(item.headline);
  });

  // Sort by datetime descending
  merged.sort((a, b) => b.datetime - a.datetime);

  const output = merged.slice(0, 20).map(item => ({
    id:             item.id,
    headline:       item.headline,
    source:         item.source,
    url:            item.url,
    publishedAt:    new Date(item.datetime * 1000).toISOString(),
    sentiment:      sentiment(item.headline + " " + item.summary),
    affectedAssets: getAffectedAssets(item.headline + " " + item.summary),
  }));

  return NextResponse.json(output);
}
