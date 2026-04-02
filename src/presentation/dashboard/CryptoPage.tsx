"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import type { RecoveryMode } from "@/src/interfaces/contracts";
import { BTCDominanceWidget } from "@/src/presentation/dashboard/components/crypto/BTCDominanceWidget";
import { CryptoChartDrawer } from "@/src/presentation/dashboard/components/crypto/CryptoChartDrawer";
import { CryptoGrid } from "@/src/presentation/dashboard/components/crypto/CryptoGrid";
import { FearGreedWidget } from "@/src/presentation/dashboard/components/crypto/FearGreedWidget";
import { MarketOverviewBar } from "@/src/presentation/dashboard/components/crypto/MarketOverviewBar";
import { PriceTicker } from "@/src/presentation/dashboard/components/crypto/PriceTicker";

type CryptoAsset = {
  symbol: string;
  label: string;
  short: string;
  tv: string;
};

type CryptoPriceRow = {
  symbol: string;
  label: string;
  short: string;
  price: number | null;
  change24h: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  marketCap?: number | null;
  direction: "up" | "down" | "flat";
  provider: "binance" | "coingecko";
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type CryptoPricesPayload = {
  generatedAt: number;
  assets: CryptoPriceRow[];
};

type CryptoSignalRow = {
  symbol: string;
  grade: string | null;
  status: "active" | "watchlist" | "blocked" | "pending" | "invalidated" | "expired";
  direction: "buy" | "sell" | "neutral" | null;
  confidence: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  reasoning: string | null;
  generatedAt: number | null;
};

type CryptoSignalsPayload = {
  generatedAt: number;
  assets: CryptoSignalRow[];
};

type MarketOverview = {
  totalMarketCap: number | null;
  totalVolume24h: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  marketCapChange24h: number | null;
  activeCryptos: number | null;
};

type FearGreedPayload = {
  value: number | null;
  label: string | null;
  timestamp: string | null;
};

type SystemStatusPayload = {
  mode?: RecoveryMode;
};

type BinanceStreamMessage = {
  data?: {
    s?: string;
    c?: string;
    p?: string;
    P?: string;
    h?: string;
    l?: string;
    q?: string;
  };
};

const CRYPTO_ASSETS: CryptoAsset[] = [
  { symbol: "BTCUSDT", label: "Bitcoin", short: "BTC", tv: "BINANCE:BTCUSDT" },
  { symbol: "ETHUSDT", label: "Ethereum", short: "ETH", tv: "BINANCE:ETHUSDT" },
  { symbol: "SOLUSDT", label: "Solana", short: "SOL", tv: "BINANCE:SOLUSDT" },
  { symbol: "BNBUSDT", label: "BNB", short: "BNB", tv: "BINANCE:BNBUSDT" },
  { symbol: "XRPUSDT", label: "XRP", short: "XRP", tv: "BINANCE:XRPUSDT" },
  { symbol: "DOGEUSDT", label: "Dogecoin", short: "DOGE", tv: "BINANCE:DOGEUSDT" },
  { symbol: "ADAUSDT", label: "Cardano", short: "ADA", tv: "BINANCE:ADAUSDT" },
  { symbol: "AVAXUSDT", label: "Avalanche", short: "AVAX", tv: "BINANCE:AVAXUSDT" },
];

const EMPTY_SIGNALS: CryptoSignalsPayload = {
  generatedAt: 0,
  assets: CRYPTO_ASSETS.map(asset => ({
    symbol: asset.symbol,
    grade: null,
    status: "pending",
    direction: null,
    confidence: null,
    entry: null,
    stopLoss: null,
    takeProfit: null,
    takeProfit2: null,
    takeProfit3: null,
    reasoning: null,
    generatedAt: null,
  })),
};

function relativeAge(now: number, timestamp: number | null): string {
  if (!timestamp) {
    return "Never";
  }
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  return `${Math.floor(diffMinutes / 60)}h ago`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function deriveDirection(change: number | null): "up" | "down" | "flat" {
  if (change == null || change === 0) {
    return "flat";
  }
  return change > 0 ? "up" : "down";
}

function buildBinanceStreamUrl(): string {
  const streams = CRYPTO_ASSETS.map(asset => `${asset.symbol.toLowerCase()}@ticker`).join("/");
  return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}

export function CryptoPage() {
  const [mode, setMode] = useState<RecoveryMode>("normal");
  const [now, setNow] = useState(() => Date.now());
  const [prices, setPrices] = useState<CryptoPricesPayload | null>(null);
  const [signals, setSignals] = useState<CryptoSignalsPayload>(EMPTY_SIGNALS);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [fearGreed, setFearGreed] = useState<FearGreedPayload | null>(null);
  const [previousBtcDominance, setPreviousBtcDominance] = useState<number | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [fearGreedError, setFearGreedError] = useState<string | null>(null);
  const [consecutivePriceFailures, setConsecutivePriceFailures] = useState(0);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [feedMode, setFeedMode] = useState<"ws" | "rest" | "degraded">("rest");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const fetchSystemStatus = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/system/status", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json() as SystemStatusPayload;
      if (payload.mode) {
        setMode(payload.mode);
      }
    } catch {
      // Keep default mode.
    }
  });

  const fetchPrices = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/crypto/live-prices", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as CryptoPricesPayload;
      setPrices(payload);
      setConsecutivePriceFailures(0);
      setFeedMode(current => current === "ws" ? current : "rest");
    } catch {
      setConsecutivePriceFailures(current => current + 1);
      setFeedMode(current => current === "ws" ? current : "degraded");
    }
  });

  const fetchSignals = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/crypto/signals", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as CryptoSignalsPayload;
      setSignals(payload);
    } catch {
      // Keep the last good signal payload on polling failures.
    }
  });

  const fetchOverview = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/crypto/market-overview", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as MarketOverview;
      setOverview(current => {
        if (current?.btcDominance != null && payload.btcDominance != null) {
          setPreviousBtcDominance(current.btcDominance);
        }
        return payload;
      });
      setOverviewError(null);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Crypto market overview unavailable");
    }
  });

  const fetchFearGreed = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/crypto/fear-greed", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json() as FearGreedPayload;
      setFearGreed(payload);
      setFearGreedError(null);
    } catch (error) {
      setFearGreedError(error instanceof Error ? error.message : "Fear & greed unavailable");
    }
  });

  const connectWebSocket = useEffectEvent(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(buildBinanceStreamUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setFeedMode("ws");
    };

    ws.onmessage = event => {
      try {
        const payload = JSON.parse(event.data) as BinanceStreamMessage;
        const ticker = payload.data;
        if (!ticker?.s) {
          return;
        }

        const symbol = ticker.s;
        const price = parseNumber(ticker.c);
        const change24h = parseNumber(ticker.p);
        const changePct24h = parseNumber(ticker.P);
        const high24h = parseNumber(ticker.h);
        const low24h = parseNumber(ticker.l);
        const volume24h = parseNumber(ticker.q);

        setPrices(current => {
          if (!current) {
            return current;
          }
          const nextAssets = current.assets.map(asset => {
            if (asset.symbol !== symbol) {
              return asset;
            }
            const nextAsset: CryptoPriceRow = {
              ...asset,
              price: price ?? asset.price,
              change24h: change24h ?? asset.change24h,
              changePct24h: changePct24h ?? asset.changePct24h,
              high24h: high24h ?? asset.high24h,
              low24h: low24h ?? asset.low24h,
              volume24h: volume24h ?? asset.volume24h,
              direction: deriveDirection(change24h ?? asset.change24h),
              provider: "binance",
              freshAt: Date.now(),
              stale: false,
              reason: null,
            };
            return nextAsset;
          });
          return {
            generatedAt: Date.now(),
            assets: nextAssets,
          };
        });
      } catch {
        // Ignore malformed frames.
      }
    };

    ws.onerror = () => {
      setFeedMode("rest");
    };

    ws.onclose = () => {
      wsRef.current = null;
      setFeedMode(current => current === "degraded" ? current : "rest");
      if (reconnectTimerRef.current == null) {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          connectWebSocket();
        }, 5_000);
      }
    };
  });

  useEffect(() => {
    void fetchSystemStatus();
    void fetchPrices();
    void fetchSignals();
    void fetchOverview();
    void fetchFearGreed();
    connectWebSocket();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (feedMode === "ws") {
      return;
    }
    const interval = window.setInterval(() => {
      void fetchPrices();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [feedMode]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchOverview();
    }, 2 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchFearGreed();
    }, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchSignals();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (consecutivePriceFailures >= 3 || feedMode === "degraded") {
      console.log("[APEX PRICES] Crypto page is serving cached/fallback data.");
    }
  }, [consecutivePriceFailures, feedMode]);

  const lastPriceGeneratedAt = prices?.generatedAt ?? null;
  const priceMap = new Map((prices?.assets ?? []).map(asset => [asset.symbol, asset]));
  const signalMap = new Map(signals.assets.map(asset => [asset.symbol, asset]));
  const selectedPrice = selectedSymbol ? priceMap.get(selectedSymbol) ?? null : null;
  const selectedSignal = selectedSymbol ? signalMap.get(selectedSymbol) ?? null : null;

  return (
    <ApexShell
      title="Crypto"
      subtitle="Live crypto intelligence across majors with Binance websocket pricing, macro sentiment, and APEX signal overlays."
      mode={mode}
    >
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-[var(--apex-font-body)] text-[22px] italic text-[var(--apex-text-primary)]">
                CRYPTO MARKETS
              </h2>
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] ${
                  feedMode === "ws"
                    ? "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]"
                    : feedMode === "rest"
                      ? "border-[rgba(96,165,250,0.28)] bg-[rgba(96,165,250,0.10)] text-[#93C5FD]"
                      : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${
                  feedMode === "ws"
                    ? "animate-pulse bg-[var(--apex-status-active-text)]"
                    : feedMode === "rest"
                      ? "animate-pulse bg-[#93C5FD]"
                      : "bg-[rgba(148,163,184,0.55)]"
                }`} />
                {feedMode === "ws" ? "LIVE ● WS" : "LIVE ● REST"}
              </span>
            </div>
            <p className="mt-3 text-[13px] text-[var(--apex-text-secondary)]">
              8 assets · Powered by Binance · Last update: {feedMode === "ws" ? "live" : relativeAge(now, lastPriceGeneratedAt)}
            </p>
          </div>
        </div>
      </section>

      <MarketOverviewBar overview={overviewError ? null : overview} />
      <div className="grid gap-4 lg:grid-cols-2">
        <BTCDominanceWidget overview={overviewError ? null : overview} previousBtcDominance={previousBtcDominance} />
        <FearGreedWidget sentiment={fearGreedError ? null : fearGreed} error={fearGreedError} />
      </div>
      <PriceTicker assets={CRYPTO_ASSETS} prices={prices?.assets ?? []} />
      <CryptoGrid
        prices={prices?.assets ?? []}
        signals={signals.assets}
        loading={prices == null}
        now={now}
        onSelectAsset={setSelectedSymbol}
      />
      <CryptoChartDrawer
        open={selectedSymbol != null}
        symbol={selectedSymbol}
        assets={CRYPTO_ASSETS}
        price={selectedPrice}
        signal={selectedSignal}
        onClose={() => setSelectedSymbol(null)}
      />
    </ApexShell>
  );
}
