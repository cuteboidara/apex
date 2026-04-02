import { recordProviderHealth } from "@/lib/providerHealth";
import { getCoreSignalRuntime } from "@/lib/runtime/featureFlags";

export type NewsSentiment = "bullish" | "bearish" | "neutral";

export type RssNewsArticle = {
  title: string;
  source: string;
  publishedAt: string;
  sentiment: NewsSentiment;
  url: string;
  summary: string;
  affectedAssets: string[];
};

type FetchLike = typeof fetch;

type FeedDefinition = {
  source: string;
  url: string;
};

const REQUEST_TIMEOUT_MS = 8_000;
const RSS_USER_AGENT = "APEX/1.0 (+https://apex1-wine.vercel.app; rss-monitor)";
const ALL_ASSETS = ["EURUSD", "GBPUSD", "USDJPY", "XAGUSD", "BTCUSDT", "ETHUSDT"];

const RSS_FEEDS: FeedDefinition[] = [
  { source: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
  { source: "FXStreet", url: "https://www.fxstreet.com/rss/news" },
  { source: "Investing.com", url: "https://www.investing.com/rss/news.rss" },
];

const BULLISH_WORDS = [
  "rally",
  "surge",
  "rise",
  "gain",
  "high",
  "bullish",
  "up",
  "boost",
  "climb",
  "record",
  "strong",
  "buy",
  "breakout",
  "beat",
];

const BEARISH_WORDS = [
  "fall",
  "drop",
  "crash",
  "decline",
  "low",
  "weak",
  "bearish",
  "down",
  "plunge",
  "sell",
  "slump",
  "loss",
  "warning",
  "miss",
];

const FILTER_KEYWORDS = [
  "gold",
  "silver",
  "bitcoin",
  "ethereum",
  "eur",
  "gbp",
  "jpy",
  "fed",
  "federal reserve",
  "ecb",
  "boe",
  "boj",
  "inflation",
  "rate",
  "gdp",
  "recession",
  "rally",
  "crash",
  "surge",
  "drop",
  "forex",
  "currency",
  "commodity",
  "crypto",
];

const QUERY_ALIASES: Record<string, string[]> = {
  BTC: ["btc", "bitcoin", "crypto", "cryptocurrency", "digital asset"],
  BTCUSDT: ["btc", "bitcoin", "crypto", "cryptocurrency", "digital asset"],
  ETH: ["eth", "ethereum", "crypto", "cryptocurrency", "digital asset"],
  ETHUSDT: ["eth", "ethereum", "crypto", "cryptocurrency", "digital asset"],
  GOLD: ["gold", "xau", "bullion", "precious metal", "commodity"],
  SILVER: ["silver", "xag", "precious metal", "commodity"],
  XAGUSD: ["silver", "xag", "precious metal", "commodity"],
  EURUSD: ["eur", "euro", "ecb", "eurozone", "forex", "currency"],
  GBPUSD: ["gbp", "pound", "sterling", "boe", "bank of england", "forex", "currency"],
  USDJPY: ["jpy", "yen", "boj", "bank of japan", "forex", "currency"],
  USDCAD: ["cad", "canadian dollar", "bank of canada", "forex", "currency"],
  AUDUSD: ["aud", "australian dollar", "rba", "reserve bank of australia", "forex", "currency"],
  NZDUSD: ["nzd", "new zealand dollar", "rbnz", "forex", "currency"],
  USDCHF: ["chf", "swiss franc", "snb", "forex", "currency"],
  EURJPY: ["eur", "euro", "jpy", "yen", "ecb", "boj", "forex", "currency"],
  GBPJPY: ["gbp", "pound", "sterling", "jpy", "yen", "boe", "boj", "forex", "currency"],
};

function decodeXmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

function cleanText(value: string | null | undefined) {
  return stripTags(decodeXmlEntities(value ?? "")).replace(/\s+/g, " ").trim();
}

function formatFeedError(error: unknown) {
  return String(error).replace(/\s+/g, " ").trim().slice(0, 180);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return cleanText(match?.[1] ?? "");
}

function toIsoDate(value: string | null | undefined) {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function normalizeTitle(title: string) {
  return cleanText(title)
    .toLowerCase()
    .replace(/\s+-\s+(reuters|fxstreet|investing\.com)$/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQueryTerms(query: string | null | undefined) {
  const normalized = String(query ?? "").trim();
  if (!normalized) {
    return [];
  }

  const compact = normalized.toUpperCase().replace(/[^A-Z]/g, "");
  const aliased = QUERY_ALIASES[compact];
  if (aliased) {
    return aliased;
  }

  return normalized
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 3);
}

export function classifyNewsSentiment(text: string): NewsSentiment {
  const normalized = text.toLowerCase();
  const bullish = BULLISH_WORDS.filter(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(normalized)).length;
  const bearish = BEARISH_WORDS.filter(word => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(normalized)).length;
  if (bullish > bearish) return "bullish";
  if (bearish > bullish) return "bearish";
  return "neutral";
}

export function getAffectedAssets(text: string): string[] {
  const normalized = text.toLowerCase();
  const assets = new Set<string>();

  if (/\bbtc\b|bitcoin/.test(normalized)) assets.add("BTCUSDT");
  if (/\beth\b|ethereum/.test(normalized)) assets.add("ETHUSDT");
  if (/\bcrypto\b|cryptocurrency|digital asset/.test(normalized)) {
    assets.add("BTCUSDT");
    assets.add("ETHUSDT");
  }
  if (/\beur\b|euro\b|\becb\b|eurozone/.test(normalized)) assets.add("EURUSD");
  if (/\bgbp\b|pound|sterling|\bboe\b|bank of england/.test(normalized)) assets.add("GBPUSD");
  if (/\bjpy\b|\byen\b|\bboj\b|bank of japan/.test(normalized)) assets.add("USDJPY");
  if (/\bgold\b|\bxau\b|bullion|precious metal/.test(normalized)) {
    assets.add("XAGUSD");
  }
  if (/\bsilver\b|\bxag\b/.test(normalized)) assets.add("XAGUSD");

  if (/\bfed\b|federal reserve|\bfomc\b|\bcpi\b|\bgdp\b|inflation|rate hike|interest rate|recession/.test(normalized)) {
    return [...ALL_ASSETS];
  }

  return assets.size > 0 ? Array.from(assets) : ALL_ASSETS;
}

export function matchesMarketNewsFilter(text: string) {
  const normalized = text.toLowerCase();
  return FILTER_KEYWORDS.some(keyword => normalized.includes(keyword));
}

function matchesQuery(article: Pick<RssNewsArticle, "title" | "summary" | "affectedAssets">, query?: string | null) {
  if (!query?.trim()) {
    return true;
  }

  const compact = query.toUpperCase().replace(/[^A-Z]/g, "");
  if (compact && article.affectedAssets.includes(compact)) {
    return true;
  }

  const text = `${article.title} ${article.summary}`.toLowerCase();
  return buildQueryTerms(query).some(term => text.includes(term));
}

export function parseRssFeed(xml: string, source: string): RssNewsArticle[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];

  return items
    .map(item => {
      try {
        const title = extractTag(item, "title");
        const summary = extractTag(item, "description");
        const url = extractTag(item, "link");
        const publishedAt = toIsoDate(extractTag(item, "pubDate"));
        const itemSource = extractTag(item, "source") || source;

        if (!title || !url) {
          return null;
        }

        const combinedText = `${title} ${summary}`.trim();
        return {
          title,
          source: itemSource,
          publishedAt: publishedAt ?? new Date(0).toISOString(),
          sentiment: classifyNewsSentiment(combinedText),
          url,
          summary,
          affectedAssets: getAffectedAssets(combinedText),
        } satisfies RssNewsArticle;
      } catch {
        return null;
      }
    })
    .filter((article): article is RssNewsArticle => article != null);
}

async function fetchFeed(feed: FeedDefinition, fetchImpl: FetchLike): Promise<RssNewsArticle[]> {
  try {
    const response = await fetchImpl(feed.url, {
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": RSS_USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    const xml = await response.text();
    if (!xml.trim()) {
      return [];
    }

    return parseRssFeed(xml, feed.source);
  } catch (error) {
    throw new Error(`${feed.source}: ${formatFeedError(error)}`);
  }
}

export async function fetchRssNewsBundle(input?: {
  query?: string | null;
  limit?: number;
  fetchImpl?: FetchLike;
  sources?: string[];
}) {
  if (getCoreSignalRuntime().newsDisabled) {
    await recordProviderHealth({
      provider: "RSS",
      status: "DEGRADED",
      errorRate: 0,
      detail: "news_disabled",
    }).catch(() => undefined);

    return {
      provider: "RSS" as const,
      articles: [] as RssNewsArticle[],
      status: "DEGRADED" as const,
      reason: "news_disabled",
      degraded: true,
      loadedFeeds: 0,
      failedFeeds: [] as string[],
      failureDetails: [] as Array<{ source: string; reason: string }>,
    };
  }

  const fetchImpl = input?.fetchImpl ?? fetch;
  const limit = input?.limit ?? 20;
  const allowedSources = input?.sources?.length
    ? new Set(input.sources.map(source => source.toLowerCase()))
    : null;
  const feeds = allowedSources
    ? RSS_FEEDS.filter(feed => allowedSources.has(feed.source.toLowerCase()))
    : RSS_FEEDS;

  const settled = await Promise.allSettled(feeds.map(feed => fetchFeed(feed, fetchImpl)));
  const failures: string[] = [];
  const failureDetails: Array<{ source: string; reason: string }> = [];
  const deduped = new Map<string, RssNewsArticle>();

  settled.forEach((result, index) => {
    const feed = feeds[index];
    if (!feed) return;

    if (result.status !== "fulfilled") {
      failures.push(feed.source);
      failureDetails.push({
        source: feed.source,
        reason: formatFeedError(result.reason),
      });
      return;
    }

    for (const article of result.value) {
      const key = normalizeTitle(article.title);
      if (!key) {
        continue;
      }

      const previous = deduped.get(key);
      if (!previous || Date.parse(article.publishedAt) > Date.parse(previous.publishedAt)) {
        deduped.set(key, article);
      }
    }
  });

  const filtered = Array.from(deduped.values())
    .filter(article => matchesMarketNewsFilter(`${article.title} ${article.summary}`))
    .filter(article => matchesQuery(article, input?.query))
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, limit);

  const status = settled.every(result => result.status === "rejected")
    ? "UNAVAILABLE" as const
    : failures.length > 0
      ? "DEGRADED" as const
      : "LIVE" as const;

  const reason = status === "UNAVAILABLE"
    ? "rss_unavailable"
    : failures.length > 0
      ? `feed_failures:${failures.join(",")}`
      : filtered.length === 0
        ? "no_matching_articles"
        : null;

  await recordProviderHealth({
    provider: "RSS",
    status: status === "LIVE" ? "OK" : status === "DEGRADED" ? "DEGRADED" : "ERROR",
    errorRate: status === "LIVE" ? 0 : failures.length / Math.max(1, feeds.length),
    detail: reason,
  });

  return {
    provider: "RSS" as const,
    articles: filtered,
    status,
    reason,
    degraded: status !== "LIVE",
    loadedFeeds: feeds.length - failures.length,
    failedFeeds: failures,
    failureDetails,
  };
}

export async function fetchRssNews(query?: string | null, input?: {
  limit?: number;
  fetchImpl?: FetchLike;
  sources?: string[];
}) {
  const bundle = await fetchRssNewsBundle({
    query,
    limit: input?.limit,
    fetchImpl: input?.fetchImpl,
    sources: input?.sources,
  });
  return bundle.articles;
}
