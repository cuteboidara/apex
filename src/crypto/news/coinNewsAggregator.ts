import { classifyNewsSentiment, parseRssFeed } from "@/lib/providers/newsRss";
import {
  getCryptoLabel,
  getCryptoShortSymbol,
} from "@/src/crypto/config/cryptoScope";
import type { CryptoNewsItem, CryptoNewsSentiment } from "@/src/crypto/types";
import { logger } from "@/src/lib/logger";
import { getCachedJson, setCachedJson } from "@/src/lib/redis";

const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_SECONDS = 300;
const RSS_FEEDS = [
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "CoinDesk", url: "https://coindesk.com/arc/outboundfeeds/rss/" },
] as const;

function buildTimeoutController(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const { controller, clear } = buildTimeoutController();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    return await response.json() as T;
  } finally {
    clear();
  }
}

async function fetchTextWithTimeout(url: string): Promise<string> {
  const { controller, clear } = buildTimeoutController();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    return await response.text();
  } finally {
    clear();
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function buildQueryTerms(symbol: string, label?: string): string[] {
  const short = getCryptoShortSymbol(symbol).toLowerCase();
  const base = normalizeText(label ?? getCryptoLabel(symbol));
  const terms = new Set<string>([short, base]);

  if (short === "btc") {
    terms.add("bitcoin");
  }
  if (short === "eth") {
    terms.add("ethereum");
  }
  if (short === "doge") {
    terms.add("dogecoin");
  }
  if (short === "bnb") {
    terms.add("binance coin");
    terms.add("bnb");
  }

  return [...terms].filter(term => term.length >= 2);
}

function matchesCoinText(text: string, symbol: string, label?: string): boolean {
  const normalized = normalizeText(text);
  const terms = buildQueryTerms(symbol, label);
  return terms.some(term => normalized.includes(term));
}

function parsePublishedAt(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
}

function dedupeNews(items: CryptoNewsItem[]): CryptoNewsItem[] {
  const deduped = new Map<string, CryptoNewsItem>();
  for (const item of items) {
    const key = `${normalizeText(item.headline)}|${item.url}`;
    const existing = deduped.get(key);
    if (!existing || Date.parse(item.publishedAt) > Date.parse(existing.publishedAt)) {
      deduped.set(key, item);
    }
  }
  return [...deduped.values()].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
}

async function fetchCryptoPanicNews(symbol: string, label?: string): Promise<CryptoNewsItem[]> {
  const currency = getCryptoShortSymbol(symbol);
  const authToken = process.env.CRYPTO_PANIC_AUTH_TOKEN?.trim() || "FREE_TIER";
  const payload = await fetchJsonWithTimeout<{
    results?: Array<{
      title?: string;
      url?: string;
      published_at?: string;
      source?: { title?: string };
      kind?: string;
      currencies?: Array<{ code?: string; title?: string }>;
    }>;
  }>(
    `https://cryptopanic.com/api/v1/posts/?auth_token=${encodeURIComponent(authToken)}&currencies=${encodeURIComponent(currency)}&filter=important`,
  );

  return (payload.results ?? [])
    .filter(item => matchesCoinText(`${item.title ?? ""} ${item.currencies?.map(currencyItem => currencyItem.title ?? currencyItem.code ?? "").join(" ")}`, symbol, label))
    .map(item => ({
      headline: item.title ?? `${currency} news`,
      source: item.source?.title ?? "CryptoPanic",
      url: item.url ?? "https://cryptopanic.com",
      sentiment: classifyNewsSentiment(item.title ?? ""),
      publishedAt: parsePublishedAt(item.published_at) ?? new Date().toISOString(),
    }))
    .slice(0, 5);
}

type BinanceAnnouncementCandidate = {
  title: string;
  url: string;
  publishedAt: string;
  summary: string;
};

function collectBinanceAnnouncements(value: unknown, results: BinanceAnnouncementCandidate[] = []): BinanceAnnouncementCandidate[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBinanceAnnouncements(item, results);
    }
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string"
    ? record.title
    : typeof record.name === "string"
      ? record.name
      : null;
  const rawUrl = typeof record.url === "string"
    ? record.url
    : typeof record.link === "string"
      ? record.link
      : typeof record.code === "string" || typeof record.code === "number"
        ? `https://www.binance.com/en/support/announcement/${String(record.code)}`
        : null;
  const publishedAt = parsePublishedAt(
    record.releaseDate
      ?? record.publishDate
      ?? record.releaseTime
      ?? record.createdTime
      ?? record.createTime
      ?? record.publishTime,
  );
  const summary = typeof record.summary === "string"
    ? record.summary
    : typeof record.description === "string"
      ? record.description
      : "";

  if (title && rawUrl && publishedAt) {
    results.push({
      title,
      url: rawUrl.startsWith("http") ? rawUrl : `https://www.binance.com${rawUrl}`,
      publishedAt,
      summary,
    });
  }

  for (const nested of Object.values(record)) {
    collectBinanceAnnouncements(nested, results);
  }

  return results;
}

async function fetchBinanceAnnouncementNews(symbol: string, label?: string): Promise<CryptoNewsItem[]> {
  const payload = await fetchJsonWithTimeout<unknown>(
    "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20",
  );

  return dedupeNews(
    collectBinanceAnnouncements(payload)
      .filter(item => matchesCoinText(`${item.title} ${item.summary}`, symbol, label))
      .map(item => ({
        headline: item.title,
        source: "Binance",
        url: item.url,
        sentiment: classifyNewsSentiment(`${item.title} ${item.summary}`),
        publishedAt: item.publishedAt,
      })),
  ).slice(0, 5);
}

async function fetchRssFallbackNews(symbol: string, label?: string): Promise<CryptoNewsItem[]> {
  const feeds = await Promise.allSettled(
    RSS_FEEDS.map(async feed => ({
      source: feed.source,
      articles: parseRssFeed(await fetchTextWithTimeout(feed.url), feed.source),
    })),
  );

  const articles: CryptoNewsItem[] = [];
  for (const result of feeds) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const article of result.value.articles) {
      if (!matchesCoinText(`${article.title} ${article.summary}`, symbol, label)) {
        continue;
      }

      articles.push({
        headline: article.title,
        source: article.source || result.value.source,
        url: article.url,
        sentiment: article.sentiment,
        publishedAt: article.publishedAt,
      });
    }
  }

  return dedupeNews(articles).slice(0, 5);
}

export function computeCoinNewsSentimentModifier(news: CryptoNewsItem[]): number {
  const weights = [4, 3, 3];
  const total = news
    .slice(0, 3)
    .reduce((sum, item, index) => {
      const weight = weights[index] ?? 0;
      if (item.sentiment === "bullish") return sum + weight;
      if (item.sentiment === "bearish") return sum - weight;
      return sum;
    }, 0);

  return Math.max(-10, Math.min(10, total));
}

export async function getCoinNews(symbol: string, label?: string): Promise<CryptoNewsItem[]> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const cacheKey = `crypto:news:${normalizedSymbol}`;
  const cached = await getCachedJson<CryptoNewsItem[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const collected: CryptoNewsItem[] = [];
  const providerStatus: Array<{ provider: string; count: number; error?: string }> = [];

  const providers = [
    { name: "cryptopanic", fn: () => fetchCryptoPanicNews(normalizedSymbol, label) },
    { name: "binance", fn: () => fetchBinanceAnnouncementNews(normalizedSymbol, label) },
    { name: "rss", fn: () => fetchRssFallbackNews(normalizedSymbol, label) },
  ] as const;

  for (const provider of providers) {
    try {
      const items = await provider.fn();
      providerStatus.push({ provider: provider.name, count: items.length });
      collected.push(...items);
      if (dedupeNews(collected).length >= 5) {
        break;
      }
    } catch (error) {
      providerStatus.push({
        provider: provider.name,
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const news = dedupeNews(collected).slice(0, 5);
  await setCachedJson(cacheKey, news, CACHE_TTL_SECONDS);
  logger.info({
    module: "crypto-news",
    message: `News aggregated for ${normalizedSymbol}`,
    summary: providerStatus.map(item => `${item.provider}:${item.count}${item.error ? `:${item.error}` : ""}`).join(" | "),
  });
  return news;
}

export function summarizeCoinNewsSentiment(news: CryptoNewsItem[]): CryptoNewsSentiment {
  const modifier = computeCoinNewsSentimentModifier(news);
  if (modifier >= 4) return "bullish";
  if (modifier <= -4) return "bearish";
  return "neutral";
}
