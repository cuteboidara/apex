import { NextResponse } from "next/server";
import { fetchRssNews } from "@/lib/providers/newsRss";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const articles = await fetchRssNews(null, { limit: 20 });

    return NextResponse.json(
      articles.map((article, index) => ({
        id: index + 1,
        headline: article.title,
        source: article.source,
        url: article.url,
        publishedAt: article.publishedAt,
        sentiment: article.sentiment,
        affectedAssets: article.affectedAssets,
      }))
    );
  } catch {
    return NextResponse.json([]);
  }
}
