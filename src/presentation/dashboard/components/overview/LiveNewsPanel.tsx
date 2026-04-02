"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";

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

const LIVE_CHANNELS = [
  { name: "Bloomberg", videoId: "dp8PhLsUcFE", fallbackUrl: "https://www.bloomberg.com/live" },
  { name: "CNBC", videoId: "M68a_FMkTZA", fallbackUrl: "https://www.cnbc.com/live-tv" },
  { name: "Reuters", videoId: "9Auq9mYxFEE", fallbackUrl: "https://www.reuters.com/video" },
  { name: "Al Jazeera", videoId: "h3MuIUNCCLI", fallbackUrl: "https://www.aljazeera.com/live" },
] as const;

type LiveChannel = (typeof LIVE_CHANNELS)[number];

function sourceTone(source: string): string {
  if (source === "Reuters") return "border-amber-400/30 text-amber-200";
  if (source === "Bloomberg") return "border-orange-400/30 text-orange-200";
  if (source === "Investing") return "border-sky-400/30 text-sky-200";
  if (source === "Cointelegraph" || source === "Decrypt") return "border-emerald-400/30 text-emerald-200";
  return "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]";
}

function categoryTone(category: NewsCategory): string {
  if (category === "crypto") return "text-emerald-200";
  if (category === "macro") return "text-sky-200";
  if (category === "markets") return "text-amber-200";
  return "text-[var(--apex-text-secondary)]";
}

function timeAgo(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Now";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return diffSeconds < 5 ? "Now" : `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  return `${Math.floor(diffMinutes / 60)}h ago`;
}

export function LiveNewsPanel() {
  const [payload, setPayload] = useState<LiveNewsPayload | null>(null);
  const [activeChannel, setActiveChannel] = useState<LiveChannel>(LIVE_CHANNELS[0]);
  const [unmuted, setUnmuted] = useState(false);
  const [videoError, setVideoError] = useState(false);

  const fetchNews = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/news/live", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const nextPayload = await response.json() as LiveNewsPayload;
      setPayload(nextPayload);
    } catch (error) {
      console.log("[APEX NEWS] Live feed refresh failed:", error);
    }
  });

  useEffect(() => {
    void fetchNews();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchNews();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setVideoError(false);
  }, [activeChannel.videoId]);

  const articles = payload?.articles ?? [];
  const embedUrl = useMemo(
    () => `https://www.youtube.com/embed/${activeChannel.videoId}?autoplay=1&mute=${unmuted ? 0 : 1}&playsinline=1`,
    [activeChannel.videoId, unmuted],
  );

  return (
    <section className="apex-surface px-6 py-5">
      <div className="mb-5 flex flex-col gap-3 border-b border-[var(--apex-border-subtle)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Live News
          </p>
          <h2 className="mt-2 text-[16px] font-semibold text-[var(--apex-text-primary)]">Merged market headlines and live TV</h2>
        </div>
        <p className="text-[12px] text-[var(--apex-text-secondary)]">
          {payload?.generatedAt ? `Updated ${timeAgo(new Date(payload.generatedAt).toISOString())}` : "Loading feed"}
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
        <div className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-[var(--apex-text-primary)]">RSS News Feed</h3>
            <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">
              {articles.length} stories
            </span>
          </div>

          <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
            {articles.length === 0 ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={`news-skeleton-${index}`}
                  className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] px-3 py-3"
                >
                  <div className="h-3 w-20 animate-pulse rounded bg-[rgba(255,255,255,0.08)]" />
                  <div className="mt-3 h-10 animate-pulse rounded bg-[rgba(255,255,255,0.06)]" />
                </div>
              ))
            ) : articles.map(article => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] px-3 py-3 transition-all duration-300 hover:border-[rgba(255,255,255,0.18)] hover:bg-[rgba(255,255,255,0.03)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] ${sourceTone(article.source)}`}>
                    {article.source}
                  </span>
                  <span className={`font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${categoryTone(article.category)}`}>
                    {article.category}
                  </span>
                  <span className="ml-auto font-[var(--apex-font-mono)] text-[10px] text-[var(--apex-text-tertiary)]">
                    {timeAgo(article.pubDate)}
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-[14px] text-[var(--apex-text-primary)]">{article.title}</p>
                {article.summary ? (
                  <p className="mt-2 text-[12px] text-[var(--apex-text-secondary)]">{article.summary}</p>
                ) : null}
              </a>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
          <div className="mb-4 flex flex-wrap gap-2">
            {LIVE_CHANNELS.map(channel => (
              <button
                key={channel.name}
                type="button"
                onClick={() => setActiveChannel(channel)}
                className={`rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] ${
                  activeChannel.name === channel.name
                    ? "border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)] text-[var(--apex-text-primary)]"
                    : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
                }`}
              >
                {channel.name}
              </button>
            ))}
          </div>

          <div className="relative">
            {videoError ? (
              <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-gray-900">
                <p className="text-sm text-gray-400">Live stream unavailable in embed</p>
                <a
                  href={activeChannel.fallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500"
                >
                  Watch on {activeChannel.name} →
                </a>
              </div>
            ) : (
              <>
                <iframe
                  key={activeChannel.videoId}
                  src={embedUrl}
                  className="aspect-video w-full rounded-lg"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={`${activeChannel.name} live stream`}
                  onError={() => setVideoError(true)}
                />
                <button
                  type="button"
                  onClick={() => setUnmuted(current => !current)}
                  className="absolute right-3 top-3 rounded-full border border-[rgba(255,255,255,0.16)] bg-[rgba(0,0,0,0.55)] px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-white"
                >
                  {unmuted ? "Mute" : "Unmute"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
