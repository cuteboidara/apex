import { NextResponse } from "next/server";
import { fetchRssNews } from "@/lib/providers/newsRss";

export const dynamic = "force-dynamic";

const TIER1_SOURCES = new Set(["Reuters"]);
const TIER1_BANKS = ["JPMorgan", "Goldman Sachs", "Morgan Stanley", "BlackRock", "Citigroup", "Bank of America"];

function isTier1Bank(text: string) {
  const normalized = text.toLowerCase();
  return TIER1_BANKS.some(bank => normalized.includes(bank.toLowerCase()));
}

function isInstitutionalContext(text: string) {
  return /fed|federal reserve|ecb|boe|boj|central bank|jpmorgan|goldman sachs|morgan stanley|blackrock|citigroup|bank of america|institutional|hedge fund/i.test(text);
}

export async function GET() {
  const articles = await fetchRssNews(null, { limit: 40 });

  const output = articles
    .filter(article => {
      const combined = `${article.title} ${article.summary}`;
      return TIER1_SOURCES.has(article.source) || isTier1Bank(combined) || isInstitutionalContext(combined);
    })
    .slice(0, 15)
    .map(article => {
      const combined = `${article.title} ${article.summary}`;
      return {
        title: article.title,
        url: article.url,
        publishedAt: article.publishedAt,
        source: article.source,
        isTier1: TIER1_SOURCES.has(article.source),
        isTier1Bank: isTier1Bank(combined),
        sentiment: article.sentiment,
        affectedAssets: article.affectedAssets,
      };
    });

  return NextResponse.json(output);
}
