import axios from "axios";
import * as cheerio from "cheerio";
import Parser from "rss-parser";

import { APEX_LLM_MODEL, getAnthropicClient } from "@/src/lib/apex-llm/client";
import { logger } from "@/src/lib/logger";
import { getCachedJson, setCachedJson } from "@/src/lib/redis";
import type { MemeScannerGrade, MemeTrendRadarItem, MemeTrendRadarPayload, MemeTrendSource } from "@/src/assets/memecoins/types";

const MEME_TRENDS_CACHE_KEY = "meme:trends:latest";
const MEME_TRENDS_CACHE_TTL_SECONDS = 600;
const REDDIT_URLS = [
  "https://www.reddit.com/r/memes/hot.json?limit=25",
  "https://www.reddit.com/r/dankmemes/hot.json?limit=25",
  "https://www.reddit.com/r/CryptoMoonShots/hot.json?limit=25",
  "https://www.reddit.com/r/SatoshiStreetBets/hot.json?limit=25",
];
const RSS_FEEDS = [
  "https://cointelegraph.com/rss/tag/altcoin",
  "https://decrypt.co/feed",
];
const parser = new Parser();

type RawTrend = {
  id: string;
  title: string;
  source: MemeTrendSource;
  sourceUrl: string;
  engagementScore: number;
};

type TrendScoreResult = MemeTrendRadarItem;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toGrade(score: number): MemeScannerGrade {
  if (score >= 85) return "S";
  if (score >= 75) return "A";
  if (score >= 62) return "B";
  if (score >= 48) return "C";
  return "F";
}

function makeCoinName(title: string): string {
  const compact = title.replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).slice(0, 2).join(" ");
  return compact.length > 0 ? compact.toUpperCase() : "MEME PRIME";
}

function makeSymbol(title: string): string {
  const token = title.replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).slice(0, 2).join("");
  return (token.toUpperCase().slice(0, 6) || "MEME");
}

function inferTags(title: string, source: MemeTrendSource): string[] {
  const text = title.toLowerCase();
  const tags = new Set<string>();
  if (/cat|dog|frog|ape|hamster|penguin|animal/.test(text)) tags.add("animal");
  if (/game|gaming|xbox|playstation|steam|minecraft|fortnite/.test(text)) tags.add("gaming");
  if (/celeb|elon|trump|biden|kanye|musk/.test(text)) tags.add("celebrity");
  if (/vote|election|politic|president|senate|war/.test(text)) tags.add("political");
  if (/bitcoin|crypto|solana|ethereum|meme coin|altcoin|moon/.test(text)) tags.add("crypto_crossover");
  if (source === "reddit" || source === "twitter") tags.add("viral");
  return [...tags];
}

function scoreTrendHeuristically(trend: RawTrend): TrendScoreResult {
  const tags = inferTags(trend.title, trend.source);
  const viralityBoost = tags.includes("viral") ? 12 : 0;
  const cryptoBoost = tags.includes("crypto_crossover") ? 18 : 0;
  const engagementWeight = clampNumber(Math.log10(Math.max(trend.engagementScore, 1)) * 20, 0, 45);
  const noveltyBoost = clampNumber(makeSymbol(trend.title).length * 3, 0, 18);
  const coinPotentialScore = Math.round(clampNumber(viralityBoost + cryptoBoost + engagementWeight + noveltyBoost, 0, 100));
  const grade = toGrade(coinPotentialScore);

  return {
    id: trend.id,
    title: trend.title,
    source: trend.source,
    sourceUrl: trend.sourceUrl,
    engagementScore: Math.round(clampNumber(trend.engagementScore, 0, 100)),
    coinPotentialScore,
    grade,
    suggestedCoinName: makeCoinName(trend.title),
    suggestedSymbol: makeSymbol(trend.title),
    reasoning: coinPotentialScore >= 75
      ? "The meme already has crowd energy and crossover potential."
      : coinPotentialScore >= 55
        ? "The theme has some traction, but the viral edge is still mid."
        : "The idea exists, but the meme velocity is not convincing.",
    tags,
  };
}

async function fetchRedditTrends(): Promise<RawTrend[]> {
  const responses = await Promise.all(REDDIT_URLS.map(url => axios.get(url, {
    timeout: 10_000,
    headers: {
      "User-Agent": "APEX/1.0",
    },
  })));

  return responses.flatMap(response => {
    const children = ((response.data as { data?: { children?: Array<{ data?: Record<string, unknown> }> } })?.data?.children ?? []);
    return children.map(child => {
      const item = child.data ?? {};
      const title = typeof item.title === "string" ? item.title : "";
      const upvotes = typeof item.ups === "number" ? item.ups : 0;
      const upvoteRatio = typeof item.upvote_ratio === "number" ? item.upvote_ratio : 0;
      const comments = typeof item.num_comments === "number" ? item.num_comments : 0;
      return {
        id: `reddit:${String(item.id ?? title)}`,
        title,
        source: "reddit" as const,
        sourceUrl: `https://www.reddit.com${String(item.permalink ?? "")}`,
        engagementScore: clampNumber((upvotes / 500) * 55 + upvoteRatio * 20 + (comments / 50) * 25, 0, 100),
      };
    }).filter(item => item.title.length > 0);
  });
}

async function fetchTwitterLikeTrends(): Promise<RawTrend[]> {
  if (process.env.TWITTER_API_KEY?.trim()) {
    try {
      const response = await axios.get("https://api.twitterapi.io/twitter/trends", {
        timeout: 10_000,
        headers: {
          "X-API-Key": process.env.TWITTER_API_KEY,
          Accept: "application/json",
        },
      });

      const trends = ((response.data as { trends?: Array<Record<string, unknown>> }).trends ?? []);
      if (trends.length > 0) {
        return trends.map((trend, index) => ({
          id: `twitter:${String(trend.name ?? index)}`,
          title: String(trend.name ?? `Trend ${index + 1}`),
          source: "twitter" as const,
          sourceUrl: String(trend.url ?? ""),
          engagementScore: clampNumber(Number(trend.tweet_volume ?? 0) / 2_000, 0, 100),
        }));
      }
    } catch (error) {
      logger.warn({
        module: "meme-trends",
        message: "twitterapi.io trends fetch failed, falling back to Trends24",
        error: String(error),
      });
    }
  }

  const response = await axios.get("https://trends24.in/worldwide/", {
    timeout: 10_000,
    headers: {
      "User-Agent": "APEX/1.0",
    },
  });
  const $ = cheerio.load(response.data as string);
  return $(".trend-card__list li a").slice(0, 25).map((index, element) => {
    const title = $(element).text().trim();
    const href = $(element).attr("href") ?? "";
    return {
      id: `twitter:${title || index}`,
      title,
      source: "twitter" as const,
      sourceUrl: href.startsWith("http") ? href : `https://trends24.in${href}`,
      engagementScore: clampNumber(72 - index * 2, 8, 100),
    };
  }).get().filter(item => item.title.length > 0);
}

async function fetchNewsTrends(): Promise<RawTrend[]> {
  const feeds = await Promise.all(RSS_FEEDS.map(url => parser.parseURL(url)));
  return feeds.flatMap(feed => (feed.items ?? []).slice(0, 25).map((item, index) => ({
    id: `news:${item.guid ?? item.link ?? `${feed.title}-${index}`}`,
    title: item.title ?? "Untitled trend",
    source: "news" as const,
    sourceUrl: item.link ?? "",
    engagementScore: clampNumber(item.title?.toLowerCase().includes("meme") ? 70 : 45, 0, 100),
  })));
}

function extractAnthropicText(response: { content: Array<{ type: string; text?: string }> }): string {
  const textBlock = response.content.find(block => block.type === "text" && typeof block.text === "string");
  if (!textBlock?.text) {
    throw new Error("No text block in Anthropic response");
  }
  return textBlock.text.replace(/```json|```/g, "").trim();
}

async function scoreTrendsWithClaude(trends: RawTrend[]): Promise<TrendScoreResult[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return trends.map(scoreTrendHeuristically);
  }

  try {
    const response = await getAnthropicClient().messages.create({
      model: APEX_LLM_MODEL,
      max_tokens: 1_200,
      system: "You are APEX's meme trend intelligence engine. You identify memes, topics, and cultural moments that have potential to become successful memecoins. Analyze each trend for: virality velocity, emotional resonance, community size, crypto community crossover potential, and whether a coin with this theme could go viral. Score each 0-100 for coin potential. Return JSON only.",
      messages: [{
        role: "user",
        content: JSON.stringify(trends),
      }],
    });

    const parsed = JSON.parse(extractAnthropicText(response)) as { trends?: TrendScoreResult[] };
    const scored = parsed.trends ?? [];
    if (scored.length === 0) {
      return trends.map(scoreTrendHeuristically);
    }
    return scored;
  } catch (error) {
    logger.warn({
      module: "meme-trends",
      message: "Claude trend scoring failed, falling back to heuristic scoring",
      error: String(error),
    });
    return trends.map(scoreTrendHeuristically);
  }
}

export async function getMemeTrendRadarPayload(options?: { force?: boolean }): Promise<MemeTrendRadarPayload> {
  if (!options?.force) {
    const cached = await getCachedJson<MemeTrendRadarPayload>(MEME_TRENDS_CACHE_KEY);
    if (cached) {
      return cached;
    }
  }

  const [reddit, twitter, news] = await Promise.allSettled([
    fetchRedditTrends(),
    fetchTwitterLikeTrends(),
    fetchNewsTrends(),
  ]);

  const merged = [
    ...(reddit.status === "fulfilled" ? reddit.value : []),
    ...(twitter.status === "fulfilled" ? twitter.value : []),
    ...(news.status === "fulfilled" ? news.value : []),
  ];

  const unique = [...new Map(merged.map(item => [item.id, item])).values()].slice(0, 30);
  const scored = await scoreTrendsWithClaude(unique);
  const payload: MemeTrendRadarPayload = {
    generatedAt: Date.now(),
    trends: scored.sort((left, right) => right.coinPotentialScore - left.coinPotentialScore),
  };

  await setCachedJson(MEME_TRENDS_CACHE_KEY, payload, MEME_TRENDS_CACHE_TTL_SECONDS);
  return payload;
}
