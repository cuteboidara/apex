import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchRssNewsBundle,
  getAffectedAssets,
  parseRssFeed,
} from "@/lib/providers/newsRss";

async function withNewsEnabled<T>(callback: () => Promise<T> | T) {
  const originalDisableNews = process.env.APEX_DISABLE_NEWS;
  const originalCoreMode = process.env.APEX_CORE_SIGNAL_MODE;

  process.env.APEX_DISABLE_NEWS = "false";
  process.env.APEX_CORE_SIGNAL_MODE = "hybrid";

  try {
    return await callback();
  } finally {
    if (originalDisableNews == null) delete process.env.APEX_DISABLE_NEWS;
    else process.env.APEX_DISABLE_NEWS = originalDisableNews;

    if (originalCoreMode == null) delete process.env.APEX_CORE_SIGNAL_MODE;
    else process.env.APEX_CORE_SIGNAL_MODE = originalCoreMode;
  }
}

const REUTERS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title><![CDATA[Bitcoin rally extends after ETF inflows]]></title>
      <link>https://example.com/reuters-bitcoin</link>
      <description><![CDATA[Bitcoin and crypto markets rallied as institutional demand improved.]]></description>
      <pubDate>Mon, 23 Mar 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Gold slips ahead of Fed rate decision</title>
      <link>https://example.com/reuters-gold</link>
      <description>Precious metals eased before the Federal Reserve update.</description>
      <pubDate>Mon, 23 Mar 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const FXSTREET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Bitcoin rally extends after ETF inflows</title>
      <link>https://example.com/fxstreet-bitcoin</link>
      <description>Duplicate title from another source.</description>
      <pubDate>Mon, 23 Mar 2026 10:05:00 GMT</pubDate>
    </item>
    <item>
      <title>EUR edges higher after ECB comments</title>
      <link>https://example.com/fxstreet-eur</link>
      <description>Forex traders reassess eurozone guidance.</description>
      <pubDate>Mon, 23 Mar 2026 08:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const MALFORMED_XML = `<rss><channel><item><title>Broken item</title></item></channel></rss>`;

test("parseRssFeed extracts normalized RSS items", () => {
  const articles = parseRssFeed(REUTERS_XML, "Reuters");
  const bitcoinArticle = articles.find(article => /Bitcoin rally/i.test(article.title));

  assert.ok(articles.length >= 1, JSON.stringify(articles));
  assert.ok(
    articles.some(article => article.title === "Gold slips ahead of Fed rate decision"),
    JSON.stringify(articles)
  );
  assert.equal(bitcoinArticle?.source, "Reuters");
  assert.equal(bitcoinArticle?.sentiment, "bullish");
  assert.deepEqual(bitcoinArticle?.affectedAssets, ["BTCUSDT", "ETHUSDT"]);
});

test("fetchRssNewsBundle deduplicates titles and tolerates feed failures", async () => {
  await withNewsEnabled(async () => {
    const seenUserAgents: string[] = [];
    const responses = new Map<string, string>([
      ["https://feeds.reuters.com/reuters/businessNews", REUTERS_XML],
      ["https://www.fxstreet.com/rss/news", FXSTREET_XML],
      ["https://www.investing.com/rss/news.rss", MALFORMED_XML],
    ]);

    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      seenUserAgents.push(String((init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? ""));
      if (url.includes("investing.com")) {
        throw new Error("feed unavailable");
      }

      return new Response(responses.get(url) ?? "", {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
      });
    };

    const bundle = await fetchRssNewsBundle({
      limit: 10,
      fetchImpl: fetchImpl as typeof fetch,
    });

    assert.equal(bundle.status, "DEGRADED");
    assert.equal(bundle.failedFeeds.length, 1);
    assert.equal(bundle.articles.length, 3);
    assert.equal(bundle.articles[0]?.title, "Bitcoin rally extends after ETF inflows");
    assert.equal(bundle.articles[0]?.source, "FXStreet");
    assert.ok(seenUserAgents.every(value => value.includes("APEX/1.0")));
  });
});

test("fetchRssNewsBundle filters by asset query and ignores malformed entries", async () => {
  await withNewsEnabled(async () => {
    const fetchImpl = async (input: string | URL) => {
      const url = String(input);
      const body = url.includes("investing.com") ? MALFORMED_XML : url.includes("fxstreet.com") ? FXSTREET_XML : REUTERS_XML;
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
      });
    };

    const btcBundle = await fetchRssNewsBundle({
      query: "BTCUSDT",
      limit: 10,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const eurBundle = await fetchRssNewsBundle({
      query: "EURUSD",
      limit: 10,
      fetchImpl: fetchImpl as typeof fetch,
    });

    assert.equal(btcBundle.articles.length, 2);
    assert.match(btcBundle.articles[0]?.title ?? "", /Bitcoin rally/i);
    assert.equal(eurBundle.articles.length, 2);
    assert.ok(eurBundle.articles.some(article => /EUR edges higher/i.test(article.title)));
  });
});

test("getAffectedAssets keeps macro headlines broad", () => {
  assert.deepEqual(
    getAffectedAssets("Fed officials signal another rate hike after inflation surprise"),
    ["EURUSD", "GBPUSD", "USDJPY", "XAGUSD", "BTCUSDT", "ETHUSDT"]
  );
});

test("fetchRssNewsBundle returns empty articles and unavailable metadata when all feeds fail", async () => {
  await withNewsEnabled(async () => {
    const fetchImpl = async () => {
      throw new Error("network timeout");
    };

    const bundle = await fetchRssNewsBundle({
      limit: 10,
      fetchImpl: fetchImpl as typeof fetch,
    });

    assert.equal(bundle.status, "UNAVAILABLE");
    assert.equal(bundle.articles.length, 0);
    assert.equal(bundle.failedFeeds.length, 3);
    assert.equal(bundle.reason, "rss_unavailable");
  });
});
