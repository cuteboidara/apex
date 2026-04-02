"use client";

import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";
import { APEX_SYMBOLS } from "@/src/config/marketScope";

const MODULES = [
  { key: "forex", label: "Forex", description: "Focused FX runtime and canonical cycle" },
  { key: "crypto", label: "Crypto", description: "24/7 Binance-backed crypto runtime" },
  { key: "stocks", label: "Stocks", description: "Equities scanner and shadow capture" },
  { key: "commodities", label: "Commodities", description: "Macro-sensitive commodities engine" },
  { key: "indices", label: "Indices", description: "Benchmark index regime scanner" },
  { key: "memecoins", label: "Memecoins", description: "Dynamic meme universe discovery and cycle" },
] as const;

type AssetModuleId = typeof MODULES[number]["key"];
type AssetActivationPayload = {
  modules: Record<AssetModuleId, boolean>;
  forexSymbols: Record<string, boolean>;
};

const ALL_ASSETS = APEX_SYMBOLS.map(symbol => ({ symbol, class: "FOREX" as const }));

export default function AdminAssetsPage() {
  const [config, setConfig] = useState<AssetActivationPayload>({
    modules: Object.fromEntries(MODULES.map(module => [module.key, true])) as Record<AssetModuleId, boolean>,
    forexSymbols: Object.fromEntries(APEX_SYMBOLS.map(symbol => [symbol, true])) as Record<string, boolean>,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      const result = await fetchJsonResponse<AssetActivationPayload>("/api/admin/assets/toggle");
      if (result.ok && result.data && typeof result.data === "object") {
        setConfig(result.data);
      } else {
        setError(formatApiError(result, "Failed to load asset controls."));
      }
      setLoading(false);
    };

    void load();
  }, []);

  async function updateConfig(body: Record<string, unknown>, toggleKey: string) {
    setToggling(toggleKey);
    const response = await fetch("/api/admin/assets/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as { config?: AssetActivationPayload; error?: string } | null;
    if (response.ok && payload?.config) {
      setConfig(payload.config);
      setError(null);
    } else {
      setError(payload?.error ?? "Failed to update asset controls.");
    }
    setToggling(null);
  }

  async function toggleModule(moduleId: AssetModuleId, active: boolean) {
    await updateConfig({ module: moduleId, active }, `module:${moduleId}`);
  }

  async function toggleSymbol(symbol: string, active: boolean) {
    await updateConfig({ symbol, active }, `symbol:${symbol}`);
  }

  async function unblockAllAssets() {
    await updateConfig({ action: "enable_all" }, "enable_all");
  }

  const activeModuleCount = MODULES.filter(module => config.modules[module.key] !== false).length;
  const activeCount = ALL_ASSETS.filter(asset => config.forexSymbols[asset.symbol] !== false).length;

  return (
    <div className="space-y-6">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Market Scope Controls</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Asset activation and unblock controls
        </h2>
        <p className="mt-3 text-[14px] leading-7 text-[var(--apex-text-secondary)]">
          {activeModuleCount} of {MODULES.length} modules and {activeCount} of {ALL_ASSETS.length} focused FX symbols are live for the next cycle.
        </p>
        <div className="mt-5">
          <button
            type="button"
            onClick={() => void unblockAllAssets()}
            disabled={toggling === "enable_all"}
            className="apex-button apex-button-amber disabled:opacity-60"
          >
            {toggling === "enable_all" ? "Unblocking" : "Unblock All Assets"}
          </button>
        </div>
      </section>

      {loading ? (
        <div className="apex-empty-state">Loading asset controls…</div>
      ) : error ? (
        <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
          {error}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {MODULES.map(module => {
              const active = config.modules[module.key] !== false;
              const toggleKey = `module:${module.key}`;
              return (
                <div key={module.key} className={`apex-surface px-5 py-5 ${active ? "" : "opacity-70"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-[15px] font-medium text-[var(--apex-text-primary)]">{module.label}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">MODULE</p>
                    </div>

                    <button
                      onClick={() => void toggleModule(module.key, !active)}
                      disabled={toggling === toggleKey}
                      aria-label={`Toggle ${module.label}`}
                      className={`relative h-7 w-14 rounded-full border transition-all ${active ? "border-[var(--apex-border-accent)] bg-[linear-gradient(135deg,rgba(141,244,206,0.8),rgba(125,211,252,0.72))]" : "border-[var(--apex-border-default)] bg-[rgba(255,255,255,0.05)]"} ${toggling === toggleKey ? "cursor-wait opacity-50" : "cursor-pointer"}`}
                    >
                      <span
                        className={`absolute top-[3px] h-5 w-5 rounded-full bg-white/90 shadow transition-transform ${active ? "translate-x-8" : "translate-x-1"}`}
                      />
                    </button>
                  </div>

                  <p className="mt-4 text-[13px] text-[var(--apex-text-secondary)]">{module.description}</p>
                  <div className="mt-6 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-3">
                    <p className="apex-admin-kpi-label">Runtime state</p>
                    <p className={`mt-3 text-[13px] font-medium ${active ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-text-tertiary)]"}`}>
                      {active ? "Enabled for scans and cycle triggers" : "Blocked until re-enabled"}
                    </p>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="space-y-4">
            <div>
              <p className="apex-eyebrow">Focused FX Symbols</p>
              <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
                These symbols feed the focused forex runtime. Module-level unblock leaves them unchanged unless you enable all.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {ALL_ASSETS.map(asset => {
                const active = config.forexSymbols[asset.symbol] !== false;
                const toggleKey = `symbol:${asset.symbol}`;
                return (
                  <div key={asset.symbol} className={`apex-surface px-5 py-5 ${active ? "" : "opacity-70"}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-[var(--apex-font-mono)] text-[15px] font-medium text-[var(--apex-text-primary)]">{asset.symbol}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--apex-status-developing-text)]">
                          {asset.class}
                        </p>
                      </div>

                      <button
                        onClick={() => void toggleSymbol(asset.symbol, !active)}
                        disabled={toggling === toggleKey}
                        aria-label={`Toggle ${asset.symbol}`}
                        className={`relative h-7 w-14 rounded-full border transition-all ${active ? "border-[var(--apex-border-accent)] bg-[linear-gradient(135deg,rgba(141,244,206,0.8),rgba(125,211,252,0.72))]" : "border-[var(--apex-border-default)] bg-[rgba(255,255,255,0.05)]"} ${toggling === toggleKey ? "cursor-wait opacity-50" : "cursor-pointer"}`}
                      >
                        <span
                          className={`absolute top-[3px] h-5 w-5 rounded-full bg-white/90 shadow transition-transform ${active ? "translate-x-8" : "translate-x-1"}`}
                        />
                      </button>
                    </div>

                    <div className="mt-6 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-3">
                      <p className="apex-admin-kpi-label">Next cycle</p>
                      <p className={`mt-3 text-[13px] font-medium ${active ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-text-tertiary)]"}`}>
                        {active ? "Included in runtime evaluation" : "Excluded until re-enabled"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      <div className="apex-stack-card text-[12px] text-[var(--apex-text-tertiary)]">
        Asset activation is now persisted as a shared runtime control. Unblocking modules applies to cycle triggers immediately, and forex symbol changes apply on the next focused FX cycle.
      </div>
    </div>
  );
}
