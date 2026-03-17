import { NextResponse } from "next/server";

const NEWS_KEY   = process.env.NEWS_API_KEY ?? "";
const NEWSAPI    = "https://newsapi.org/v2/everything";

const ALL_ASSETS = ["EURUSD","GBPUSD","USDJPY","XAUUSD","XAGUSD","BTCUSDT","ETHUSDT"];

const TIER1_SOURCES = new Set(["reuters","bloomberg","cnbc","the-wall-street-journal","financial-times"]);
const TIER1_BANKS   = ["JPMorgan","Goldman Sachs","Morgan Stanley","BlackRock","Citigroup","Bank of America"];

function getAffectedAssets(text: string): string[] {
  const t      = text.toLowerCase();
  const assets = new Set<string>();
  if (/\bbtc\b|bitcoin/.test(t))                               assets.add("BTCUSDT");
  if (/\beth\b|ethereum/.test(t))                              assets.add("ETHUSDT");
  if (/\bcrypto\b|cryptocurrency/.test(t))                     { assets.add("BTCUSDT"); assets.add("ETHUSDT"); }
  if (/\beur\b|euro|\becb\b|eurozone/.test(t))                 assets.add("EURUSD");
  if (/\bgbp\b|pound|sterling|\bboe\b/.test(t))                assets.add("GBPUSD");
  if (/\bjpy\b|\byen\b|\bboj\b/.test(t))                       assets.add("USDJPY");
  if (/\bgold\b|\bxau\b|precious/.test(t))                     { assets.add("XAUUSD"); assets.add("XAGUSD"); }
  if (/\bsilver\b|\bxag\b/.test(t))                            assets.add("XAGUSD");
  if (/\bfed\b|federal reserve|\bfomc\b|\bcpi\b|\bgdp\b|inflation|rate/.test(t)) return [...ALL_ASSETS];
  return assets.size > 0 ? Array.from(assets) : ALL_ASSETS;
}

const BULLISH = ["rally","surge","rise","gain","bullish","up","boost","climb","record","buy"];
const BEARISH  = ["fall","drop","crash","decline","weak","bearish","down","plunge","sell","slump"];

function sentiment(text: string): "bullish" | "bearish" | "neutral" {
  const t = text.toLowerCase();
  const b = BULLISH.filter(w => t.includes(w)).length;
  const r = BEARISH.filter(w => t.includes(w)).length;
  if (b > r) return "bullish";
  if (r > b) return "bearish";
  return "neutral";
}

async function safeFetch(url: string) {
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function isTier1Bank(title: string): boolean {
  return TIER1_BANKS.some(bank => title.includes(bank));
}

export async function GET() {
  const [instRes, bankRes] = await Promise.allSettled([
    safeFetch(
      `${NEWSAPI}?q=gold+OR+bitcoin+OR+forex+OR+"federal+reserve"+OR+ECB` +
      `&sources=reuters,cnbc,the-wall-street-journal` +
      `&sortBy=publishedAt&pageSize=15&apiKey=${NEWS_KEY}`
    ),
    safeFetch(
      `${NEWSAPI}?q=JPMorgan+OR+"Goldman+Sachs"+OR+"Morgan+Stanley"+gold+OR+bitcoin+OR+forex` +
      `&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_KEY}`
    ),
  ]);

  type Article = { title: string; url: string; publishedAt: string; source: { name: string; id?: string } };

  const inst  = (instRes.status  === "fulfilled" ? instRes.value?.articles  : []) as Article[] ?? [];
  const banks = (bankRes.status  === "fulfilled" ? bankRes.value?.articles  : []) as Article[] ?? [];

  // Merge + deduplicate by title
  const seen    = new Set<string>();
  const merged: Article[] = [];
  for (const a of [...inst, ...banks]) {
    if (!a?.title || seen.has(a.title)) continue;
    seen.add(a.title);
    merged.push(a);
  }

  merged.sort((a, b) =>
    new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  const sourceId = (name: string) =>
    name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const output = merged.slice(0, 15).map(a => ({
    title:          a.title,
    url:            a.url,
    publishedAt:    a.publishedAt,
    source:         a.source?.name ?? "Unknown",
    isTier1:        TIER1_SOURCES.has(a.source?.id ?? sourceId(a.source?.name ?? "")),
    isTier1Bank:    isTier1Bank(a.title),
    sentiment:      sentiment(a.title),
    affectedAssets: getAffectedAssets(a.title),
  }));

  return NextResponse.json(output);
}
