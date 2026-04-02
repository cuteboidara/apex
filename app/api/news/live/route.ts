import { NextResponse } from "next/server";
import Parser from "rss-parser";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type NewsCategory = "markets" | "crypto" | "macro" | "general";

type LiveNewsArticle = {
  id: string;
  title: string;
  source: string;
  url: string;
  pubDate: string;
  summary?: string;
  category: NewsCategory;
};

type LiveNewsPayload = {
  generatedAt: number;
  articles: LiveNewsArticle[];
};

const CACHE_KEY = "news:live:merged";
const CACHE_TTL_SECONDS = 300;
const NEWS_FEEDS = [
  "https://feeds.reuters.com/reuters/businessNews",
  "https://feeds.bloomberg.com/markets/news.rss",
  "https://www.investing.com/rss/news.rss",
  "https://cointelegraph.com/rss",
  "https://decrypt.co/feed",
  "https://feeds.marketwatch.com/marketwatch/topstories",
] as const;

const parser = new Parser({
  timeout: 8_000,
  headers: {
    "User-Agent": "Mozilla/5.0",
  },
});

function sourceFromUrl(url: string): string {
  if (url.includes("reuters")) return "Reuters";
  if (url.includes("bloomberg")) return "Bloomberg";
  if (url.includes("investing")) return "Investing";
  if (url.includes("cointelegraph")) return "Cointelegraph";
  if (url.includes("decrypt")) return "Decrypt";
  if (url.includes("marketwatch")) return "MarketWatch";
  return "Feed";
}

function summarize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.slice(0, 120);
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join(" ");
}

function detectCategory(title: string, source: string): NewsCategory {
  const value = `${title} ${source}`.toLowerCase();
  if (/\bcrypto|bitcoin|ethereum|solana|altcoin|token|binance|coin\b/.test(value)) {
    return "crypto";
  }
  if (/\bfed|ecb|boj|cpi|inflation|nfp|payrolls|rates|yield|central bank|dollar\b/.test(value)) {
    return "macro";
  }
  if (/\bmarkets|stocks|equities|futures|wall street|oil|gold|commodities\b/.test(value)) {
    return "markets";
  }
  return "general";
}

export async function GET() {
  const cached = await getCachedJson<LiveNewsPayload>(CACHE_KEY);
  if (cached) {
    return NextResponse.json(cached);
  }

  const results = await Promise.allSettled(
    NEWS_FEEDS.map(async feedUrl => {
      const feed = await parser.parseURL(feedUrl);
      return (feed.items ?? []).map(item => {
        const source = sourceFromUrl(feedUrl);
        const title = item.title?.trim() ?? "";
        const link = item.link?.trim() ?? "";
        return {
          id: `${source}-${normalizeTitle(title)}`,
          title,
          source,
          url: link,
          pubDate: item.pubDate ?? item.isoDate ?? new Date().toUTCString(),
          summary: summarize(item.contentSnippet ?? item.content),
          category: detectCategory(title, source),
        } satisfies LiveNewsArticle;
      }).filter(item => item.title && item.url);
    }),
  );

  const seen = new Set<string>();
  const articles = results
    .flatMap(result => result.status === "fulfilled" ? result.value : [])
    .filter(article => {
      const key = normalizeTitle(article.title);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.pubDate);
      const rightTime = Date.parse(right.pubDate);
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, 30);

  const payload: LiveNewsPayload = {
    generatedAt: Date.now(),
    articles,
  };

  await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
