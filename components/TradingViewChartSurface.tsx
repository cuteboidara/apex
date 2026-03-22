"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createTradingViewDatafeed } from "@/lib/charting/tradingViewDatafeed";
import { mapTimeframeToResolution } from "@/lib/charting/resolutionMap";
import { LightweightChart } from "@/components/LightweightChart";
import type { Timeframe } from "@/lib/marketData/types";

type Props = {
  symbol: string;
  timeframe: Timeframe;
  loading: boolean;
  hasUsableCandles: boolean;
  fallback: ReactNode;
  overlay: {
    style: string;
    bias: string;
    setupFamily: string | null;
    levels: Array<{
      key: string;
      label: string;
      price: number;
      color: string;
      dashed?: boolean;
    }>;
  } | null;
};

type ChartMode = "loading" | "widget" | "fallback";

type WidgetEntityId = string | number;

type WidgetChartApi = {
  createShape?: (
    point: { time: number; price: number },
    options: {
      shape: string;
      text?: string;
      lock?: boolean;
      disableSelection?: boolean;
      disableSave?: boolean;
      overrides?: Record<string, string | number | boolean>;
    }
  ) => WidgetEntityId | Promise<WidgetEntityId>;
  removeEntity?: (id: WidgetEntityId) => void;
};

type WidgetHandle = {
  remove?: () => void;
  chart?: () => WidgetChartApi;
  activeChart?: () => WidgetChartApi;
  onChartReady?: (callback: () => void) => void;
};

const SCRIPT_CANDIDATES = [
  "/charting_library/charting_library.standalone.js",
  "/charting_library/charting_library.js",
] as const;

let tradingViewLoader: Promise<boolean> | null = null;

function isWidgetAvailable() {
  return typeof window !== "undefined" && typeof window.TradingView?.widget === "function";
}

function loadScript(src: string) {
  return new Promise<boolean>(resolve => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-tradingview-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve(true);
        return;
      }

      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    script.dataset.tradingviewSrc = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve(true);
    }, { once: true });
    script.addEventListener("error", () => resolve(false), { once: true });
    document.head.appendChild(script);
  });
}

async function ensureTradingViewLibrary() {
  if (isWidgetAvailable()) {
    return true;
  }

  if (!tradingViewLoader) {
    tradingViewLoader = (async () => {
      for (const src of SCRIPT_CANDIDATES) {
        const loaded = await loadScript(src);
        if (loaded && isWidgetAvailable()) {
          return true;
        }
      }

      return false;
    })();
  }

  return tradingViewLoader;
}

export function TradingViewChartSurface({ symbol, timeframe, loading, hasUsableCandles, fallback, overlay }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<WidgetHandle | null>(null);
  const overlayShapeIdsRef = useRef<WidgetEntityId[]>([]);
  const widgetReadyRef = useRef(false);
  const containerId = useId().replace(/:/g, "_");
  const [mode, setMode] = useState<ChartMode>("loading");
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  const clearOverlayShapes = useCallback(async () => {
    const widget = widgetRef.current;
    const chart = widget?.activeChart?.() ?? widget?.chart?.();
    if (!chart?.removeEntity) {
      overlayShapeIdsRef.current = [];
      return;
    }

    for (const entityId of overlayShapeIdsRef.current) {
      try {
        chart.removeEntity(entityId);
      } catch {
        // overlay cleanup must not break chart rendering
      }
    }

    overlayShapeIdsRef.current = [];
  }, []);

  const applyOverlayShapes = useCallback(async () => {
    const widget = widgetRef.current;
    const chart = widget?.activeChart?.() ?? widget?.chart?.();
    await clearOverlayShapes();

    if (!overlay || !widgetReadyRef.current || !chart?.createShape) {
      return;
    }

    const anchorTime = Math.floor(Date.now() / 1000);

    for (const level of overlay.levels) {
      try {
        const entityId = await Promise.resolve(chart.createShape(
          {
            time: anchorTime,
            price: level.price,
          },
          {
            shape: "horizontal_line",
            text: level.label,
            lock: true,
            disableSelection: true,
            disableSave: true,
            overrides: {
              linecolor: level.color,
              linewidth: 1,
              linestyle: level.dashed ? 2 : 0,
              showLabel: true,
              textcolor: level.color,
            },
          }
        ));

        overlayShapeIdsRef.current.push(entityId);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[tradingview-chart-surface] overlay shape failed", {
            symbol,
            timeframe,
            level: level.label,
            error,
          });
        }
      }
    }
  }, [clearOverlayShapes, overlay, symbol, timeframe]);

  useEffect(() => {
    if (!hasUsableCandles) {
      widgetReadyRef.current = false;
      void clearOverlayShapes();
      return;
    }

    let cancelled = false;

    async function mountWidget() {
      setMode("loading");
      setFallbackReason(null);

      const available = await ensureTradingViewLibrary();
      if (cancelled) {
        return;
      }

      if (!available || !window.TradingView?.widget || !containerRef.current) {
        setMode("fallback");
        setFallbackReason("TradingView charting library is not installed locally. Showing the internal fallback chart.");
        return;
      }

      containerRef.current.innerHTML = "";

      try {
        const widget = new window.TradingView.widget({
          autosize: true,
          symbol,
          interval: mapTimeframeToResolution(timeframe),
          container: containerId,
          datafeed: createTradingViewDatafeed(),
          library_path: "/charting_library/",
          locale: "en",
          timezone: "Etc/UTC",
          theme: "Dark",
          disabled_features: [
            "header_compare",
            "header_saveload",
            "header_screenshot",
            "symbol_info",
            "timeframes_toolbar",
            "use_localstorage_for_settings",
            "volume_force_overlay",
          ],
          enabled_features: [
            "hide_left_toolbar_by_default",
          ],
        });

        widgetRef.current = widget;
        const onReady = () => {
          if (cancelled) {
            return;
          }

          widgetReadyRef.current = true;
          setMode("widget");
          void applyOverlayShapes();
        };

        if (typeof widget.onChartReady === "function") {
          widget.onChartReady(onReady);
        } else {
          onReady();
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[tradingview-chart-surface] widget initialization failed", error);
        }

        setMode("fallback");
        setFallbackReason("TradingView widget initialization failed. Showing the internal fallback chart.");
      }
    }

    void mountWidget();

    return () => {
      cancelled = true;
      widgetReadyRef.current = false;
      void clearOverlayShapes();
      widgetRef.current?.remove?.();
      widgetRef.current = null;
    };
  }, [applyOverlayShapes, clearOverlayShapes, containerId, hasUsableCandles, loading, symbol, timeframe]);

  useEffect(() => {
    if (!hasUsableCandles || mode !== "widget") {
      return;
    }

    void applyOverlayShapes();
  }, [applyOverlayShapes, hasUsableCandles, mode]);

  const showFallback = (mode !== "widget" && hasUsableCandles) || !hasUsableCandles;
  const showWidget = mode === "widget" && hasUsableCandles;
  const fallbackNotice = mode === "fallback" && hasUsableCandles ? fallbackReason : null;
  const overlayTone = overlay?.bias === "LONG"
    ? "border-green-500/30 bg-green-500/10 text-green-300"
    : "border-zinc-800 bg-zinc-950 text-zinc-300";

  return (
    <div className="relative min-h-[420px] rounded-xl border border-zinc-900 bg-[#0b0b0b] overflow-hidden">
      <div
        id={containerId}
        ref={containerRef}
        className={showWidget ? "h-[420px] w-full" : "hidden"}
      />

      {showFallback && (
        <div className="h-[420px] w-full">
          {fallback}
        </div>
      )}

      {fallbackNotice && showFallback && (
        <div className="absolute left-3 top-3 right-3 z-20 max-w-[360px] rounded-xl border border-zinc-800 bg-zinc-950/90 px-3 py-2">
          <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-zinc-400">Fallback Chart</p>
          <p className="mt-1 text-[9px] text-zinc-500">{fallbackNotice}</p>
        </div>
      )}

      {overlay && (
        <div className="absolute right-3 top-3 z-20 flex flex-wrap justify-end gap-2 max-w-[70%]">
          <span className="rounded-full border border-zinc-800 bg-zinc-950/90 px-3 py-1 text-[8px] font-bold uppercase tracking-[0.18em] text-zinc-300">
            {overlay.style}
          </span>
          <span className={`rounded-full border px-3 py-1 text-[8px] font-bold uppercase tracking-[0.18em] ${overlayTone}`}>
            {overlay.bias}
          </span>
          {overlay.setupFamily && (
            <span className="rounded-full border border-zinc-800 bg-zinc-950/90 px-3 py-1 text-[8px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              {overlay.setupFamily}
            </span>
          )}
        </div>
      )}

      {loading && !showWidget && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0b0b0d]/80 z-10">
          <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-400">Loading candles</p>
        </div>
      )}
    </div>
  );
}
