"use client";

import { useEffect, useState } from "react";
import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

const ALL_ASSETS = [
  { symbol: "EURUSD",  class: "FOREX" },
  { symbol: "GBPUSD",  class: "FOREX" },
  { symbol: "USDJPY",  class: "FOREX" },
  { symbol: "USDCAD",  class: "FOREX" },
  { symbol: "AUDUSD",  class: "FOREX" },
  { symbol: "NZDUSD",  class: "FOREX" },
  { symbol: "USDCHF",  class: "FOREX" },
  { symbol: "EURJPY",  class: "FOREX" },
  { symbol: "GBPJPY",  class: "FOREX" },
  { symbol: "XAUUSD",  class: "COMMODITY" },
  { symbol: "XAGUSD",  class: "COMMODITY" },
  { symbol: "BTCUSDT", class: "CRYPTO" },
  { symbol: "ETHUSDT", class: "CRYPTO" },
];

const CLASS_COLOR: Record<string, string> = {
  FOREX:     "text-blue-400",
  COMMODITY: "text-yellow-400",
  CRYPTO:    "text-purple-400",
};

export default function AdminAssetsPage() {
  const [config, setConfig] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const result = await fetchJsonResponse<Record<string, boolean>>("/api/admin/assets/toggle");
      if (result.ok && result.data && typeof result.data === "object") {
        setConfig(result.data);
      } else {
        setConfig({});
        setError(formatApiError(result, "Failed to load asset controls."));
      }
      setLoading(false);
    };

    void load();
  }, []);

  async function toggle(symbol: string, active: boolean) {
    setToggling(symbol);
    await fetch("/api/admin/assets/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, active }),
    });
    setConfig(prev => ({ ...prev, [symbol]: active }));
    setToggling(null);
  }

  const activeCount = Object.values(config).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">Asset Control</h1>
        <p className="text-xs text-zinc-500">
          Enable or disable assets from the signal engine.{" "}
          <span style={{ color: "#00ff88" }}>{activeCount}</span> / {ALL_ASSETS.length} active
        </p>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading...</div>
      ) : error ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ALL_ASSETS.map(a => {
            const active = config[a.symbol] !== false;
            return (
              <div
                key={a.symbol}
                className={`bg-zinc-950 border rounded-lg p-4 flex items-center justify-between transition-colors ${
                  active ? "border-zinc-700" : "border-zinc-800 opacity-60"
                }`}
              >
                <div>
                  <p className="text-zinc-100 font-mono font-semibold">{a.symbol}</p>
                  <p className={`text-xs mt-0.5 ${CLASS_COLOR[a.class] ?? "text-zinc-500"}`}>{a.class}</p>
                </div>
                <button
                  onClick={() => toggle(a.symbol, !active)}
                  disabled={toggling === a.symbol}
                  className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                    active ? "" : "bg-zinc-700"
                  } ${toggling === a.symbol ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
                  style={active ? { backgroundColor: "#00ff88" } : {}}
                  aria-label={`Toggle ${a.symbol}`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      active ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Changes take effect on the next signal cycle. Toggled state is persisted in{" "}
        <code className="font-mono">lib/config/activeAssets.json</code>.
      </p>
    </div>
  );
}
