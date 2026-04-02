"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ALL_COMMODITY_SYMBOLS, COMMODITY_DISPLAY_NAMES } from "@/src/assets/commodities/config/commoditiesScope";
import { INDEX_DISPLAY_NAMES, INDICES_SYMBOLS } from "@/src/assets/indices/config/indicesScope";
import { ALL_STOCK_SYMBOLS } from "@/src/assets/stocks/config/stocksScope";
import { APEX_SYMBOLS } from "@/src/config/marketScope";
import { CRYPTO_ACTIVE_SYMBOLS, CRYPTO_DISPLAY_NAMES } from "@/src/crypto/config/cryptoScope";

type AssetClassKey = "forex" | "crypto" | "stocks" | "commodities" | "indices" | "memecoins";
type RunAction = "all" | "selected" | "schedule" | null;
type RunRequestBody = {
  all?: boolean;
  classes?: AssetClassKey[];
  assets?: string[];
};

type RunResult = {
  class: AssetClassKey;
  route: string;
  status: "queued" | "completed" | "failed";
  duration: number;
  error?: string;
  cycleId?: string | null;
  jobId?: string | null;
  cardCount?: number | null;
  universeSize?: number | null;
  selectionApplied: "class" | "symbol_override" | "class_fallback";
  requestedAssets: string[];
};

type RunResponse = {
  success: boolean;
  partial: boolean;
  authMode: "secret" | "admin_session";
  headerName: string;
  selection: {
    all: boolean;
    classes: AssetClassKey[];
    assets: string[];
  };
  startedAt: number;
  completedAt: number;
  results: RunResult[];
};

type ClassStatus = {
  state: "idle" | "running" | "queued" | "completed" | "failed";
  detail: string;
};

type RunLogEntry = {
  id: string;
  label: string;
  startedAt: number;
  duration: number;
  successCount: number;
  totalCount: number;
  status: "success" | "partial" | "failed";
  error?: string;
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type AssetOption = {
  symbol: string;
  label: string;
};

type ClassConfig = {
  key: AssetClassKey;
  label: string;
  helper: string;
  assets: AssetOption[];
  autoOnly?: boolean;
};

const CLASS_CONFIG: ClassConfig[] = [
  {
    key: "forex",
    label: "Forex",
    helper: "Focused FX scope",
    assets: APEX_SYMBOLS.map(symbol => ({ symbol, label: symbol })),
  },
  {
    key: "crypto",
    label: "Crypto",
    helper: "Current live runtime scope",
    assets: CRYPTO_ACTIVE_SYMBOLS.map(symbol => ({
      symbol,
      label: CRYPTO_DISPLAY_NAMES[symbol].replace("/USD", ""),
    })),
  },
  {
    key: "stocks",
    label: "Stocks",
    helper: "Current live runtime scope",
    assets: ALL_STOCK_SYMBOLS.map(symbol => ({ symbol, label: symbol })),
  },
  {
    key: "commodities",
    label: "Commodities",
    helper: "Current live runtime scope",
    assets: ALL_COMMODITY_SYMBOLS.map(symbol => ({
      symbol,
      label: COMMODITY_DISPLAY_NAMES[symbol],
    })),
  },
  {
    key: "indices",
    label: "Indices",
    helper: "Current live runtime scope",
    assets: INDICES_SYMBOLS.map(symbol => ({
      symbol,
      label: INDEX_DISPLAY_NAMES[symbol],
    })),
  },
  {
    key: "memecoins",
    label: "Memecoins",
    helper: "Auto-scan only",
    assets: [],
    autoOnly: true,
  },
];

const ALL_CLASS_KEYS = CLASS_CONFIG.map(item => item.key);
const ALL_SELECTABLE_ASSETS = CLASS_CONFIG.flatMap(item => item.assets.map(asset => asset.symbol));
const ASSET_TO_CLASS = Object.fromEntries(
  CLASS_CONFIG.flatMap(item => item.assets.map(asset => [asset.symbol, item.key] as const)),
) as Record<string, AssetClassKey>;

const SCHEDULE_OPTIONS = {
  "5min": 5 * 60_000,
  "10min": 10 * 60_000,
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "1hr": 60 * 60_000,
  "4hr": 4 * 60 * 60_000,
} as const;

function buildInitialExpandedState(): Record<AssetClassKey, boolean> {
  return CLASS_CONFIG.reduce((accumulator, item) => {
    accumulator[item.key] = true;
    return accumulator;
  }, {} as Record<AssetClassKey, boolean>);
}

function buildInitialClassStatus(): Record<AssetClassKey, ClassStatus> {
  return CLASS_CONFIG.reduce((accumulator, item) => {
    accumulator[item.key] = {
      state: "idle",
      detail: item.autoOnly ? "Auto-scan ready" : "Idle",
    };
    return accumulator;
  }, {} as Record<AssetClassKey, ClassStatus>);
}

function dedupeClasses(values: AssetClassKey[]): AssetClassKey[] {
  return [...new Set(values)];
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${durationMs}ms`;
}

function formatTimeAgo(timestamp: number, now: number): string {
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatCountdown(targetTimestamp: number | null, now: number): string {
  if (!targetTimestamp) {
    return "Not scheduled";
  }

  const remaining = Math.max(0, targetTimestamp - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

function statusTone(status: ClassStatus["state"]): string {
  if (status === "completed" || status === "queued") {
    return "text-[var(--apex-status-active-text)] border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)]";
  }
  if (status === "failed") {
    return "text-[var(--apex-status-blocked-text)] border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)]";
  }
  if (status === "running") {
    return "text-[#F59E0B] border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)]";
  }
  return "text-[var(--apex-text-tertiary)] border-[var(--apex-border-subtle)] bg-transparent";
}

function statusIcon(status: ClassStatus["state"]): string {
  if (status === "completed" || status === "queued") {
    return "✓";
  }
  if (status === "failed") {
    return "✗";
  }
  if (status === "running") {
    return "⟳";
  }
  return "•";
}

function logStatusIcon(status: RunLogEntry["status"]): string {
  return status === "failed" ? "✗" : "✓";
}

function logStatusTone(status: RunLogEntry["status"]): string {
  if (status === "failed") {
    return "text-[var(--apex-status-blocked-text)]";
  }
  if (status === "partial") {
    return "text-[#F59E0B]";
  }
  return "text-[var(--apex-status-active-text)]";
}

function selectionLabel(payload: RunRequestBody, classes: AssetClassKey[]): string {
  if (payload.all) {
    return "ALL ASSETS";
  }

  return classes.map(assetClass => {
    const item = CLASS_CONFIG.find(config => config.key === assetClass);
    return item?.label.toUpperCase() ?? assetClass.toUpperCase();
  }).join(", ");
}

export function RunControlPanel({ adminMode = false }: { adminMode?: boolean }) {
  const router = useRouter();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(() => [...ALL_SELECTABLE_ASSETS]);
  const [memecoinsSelected, setMemecoinsSelected] = useState(true);
  const [expanded, setExpanded] = useState<Record<AssetClassKey, boolean>>(() => buildInitialExpandedState());
  const [running, setRunning] = useState(false);
  const [activeAction, setActiveAction] = useState<RunAction>(null);
  const [classStatuses, setClassStatuses] = useState<Record<AssetClassKey, ClassStatus>>(() => buildInitialClassStatus());
  const [runHistory, setRunHistory] = useState<RunLogEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [lastAuthMode, setLastAuthMode] = useState<"secret" | "admin_session" | null>(null);
  const [headerName, setHeaderName] = useState("x-apex-secret");
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduleIntervalKey, setScheduleIntervalKey] = useState<keyof typeof SCHEDULE_OPTIONS>("15min");
  const [scheduleStartMode, setScheduleStartMode] = useState<"now" | "next">("now");
  const [scheduleActive, setScheduleActive] = useState(false);
  const [nextScheduledRunAt, setNextScheduledRunAt] = useState<number | null>(null);
  const [currentRunClasses, setCurrentRunClasses] = useState<AssetClassKey[]>([]);
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());
  const scheduleRef = useRef<number | null>(null);
  const toastRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const selectionRef = useRef<RunRequestBody | null>(null);
  const selectedAssetSet = new Set(selectedAssets);
  const selectedAssetSignature = [...selectedAssets].sort().join("|");

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    selectionRef.current = buildSelectionPayload();
  }, [selectedAssetSignature, memecoinsSelected]);

  useEffect(() => {
    const ticker = window.setInterval(() => {
      setNowTimestamp(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(ticker);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scheduleRef.current != null) {
        window.clearInterval(scheduleRef.current);
      }
      if (toastRef.current != null) {
        window.clearTimeout(toastRef.current);
      }
    };
  }, []);

  function showToast(nextToast: ToastState) {
    setToast(nextToast);
    if (toastRef.current != null) {
      window.clearTimeout(toastRef.current);
    }
    toastRef.current = window.setTimeout(() => {
      setToast(null);
      toastRef.current = null;
    }, 4500);
  }

  function isClassFullySelected(assetClass: AssetClassKey): boolean {
    if (assetClass === "memecoins") {
      return memecoinsSelected;
    }

    const config = CLASS_CONFIG.find(item => item.key === assetClass);
    if (!config || config.assets.length === 0) {
      return false;
    }

    return config.assets.every(asset => selectedAssetSet.has(asset.symbol));
  }

  function isClassPartiallySelected(assetClass: AssetClassKey): boolean {
    if (assetClass === "memecoins") {
      return false;
    }

    const config = CLASS_CONFIG.find(item => item.key === assetClass);
    if (!config || config.assets.length === 0) {
      return false;
    }

    const selectedCount = config.assets.filter(asset => selectedAssetSet.has(asset.symbol)).length;
    return selectedCount > 0 && selectedCount < config.assets.length;
  }

  function buildSelectionPayload(): RunRequestBody | null {
    const allSelected = CLASS_CONFIG.every(item => {
      if (item.autoOnly) {
        return memecoinsSelected;
      }
      return item.assets.every(asset => selectedAssetSet.has(asset.symbol));
    });

    if (allSelected) {
      return { all: true };
    }

    const classes = CLASS_CONFIG.flatMap(item => {
      if (item.autoOnly) {
        return memecoinsSelected ? [item.key] : [];
      }

      return isClassFullySelected(item.key) ? [item.key] : [];
    });

    const assets = CLASS_CONFIG.flatMap(item => {
      if (item.autoOnly || isClassFullySelected(item.key)) {
        return [];
      }

      return item.assets
        .filter(asset => selectedAssetSet.has(asset.symbol))
        .map(asset => asset.symbol);
    });

    if (classes.length === 0 && assets.length === 0) {
      return null;
    }

    return {
      classes,
      assets,
    };
  }

  function deriveClasses(payload: RunRequestBody): AssetClassKey[] {
    if (payload.all) {
      return [...ALL_CLASS_KEYS];
    }

    const assetClasses = (payload.assets ?? [])
      .map(asset => ASSET_TO_CLASS[asset])
      .filter((value): value is AssetClassKey => value != null);

    return dedupeClasses([...(payload.classes ?? []), ...assetClasses]);
  }

  function resetStatuses(nextClasses: AssetClassKey[]) {
    setClassStatuses(previous => {
      const updated = { ...previous };
      for (const config of CLASS_CONFIG) {
        if (nextClasses.includes(config.key)) {
          updated[config.key] = {
            state: "running",
            detail: "Running...",
          };
        } else {
          updated[config.key] = previous[config.key] ?? {
            state: "idle",
            detail: config.autoOnly ? "Auto-scan ready" : "Idle",
          };
        }
      }
      return updated;
    });
  }

  function setClassFromResult(result: RunResult) {
    setClassStatuses(previous => ({
      ...previous,
      [result.class]: {
        state: result.status === "failed"
          ? "failed"
          : result.status === "queued"
            ? "queued"
            : "completed",
        detail: result.status === "failed"
          ? result.error ?? "Failed"
          : result.status === "queued"
            ? `Queued${result.cardCount != null ? ` — ${result.cardCount} signals` : ""}`
            : `Done${result.cardCount != null ? ` — ${result.cardCount} signals` : ""}`,
      },
    }));
  }

  function toggleClass(assetClass: AssetClassKey) {
    if (assetClass === "memecoins") {
      setMemecoinsSelected(previous => !previous);
      return;
    }

    const config = CLASS_CONFIG.find(item => item.key === assetClass);
    if (!config) {
      return;
    }

    const symbols = config.assets.map(asset => asset.symbol);
    const fullySelected = symbols.every(symbol => selectedAssetSet.has(symbol));
    const next = new Set(selectedAssets);

    for (const symbol of symbols) {
      if (fullySelected) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
    }

    setSelectedAssets([...next]);
  }

  function toggleAsset(symbol: string) {
    const next = new Set(selectedAssets);
    if (next.has(symbol)) {
      next.delete(symbol);
    } else {
      next.add(symbol);
    }
    setSelectedAssets([...next]);
  }

  function toggleExpanded(assetClass: AssetClassKey) {
    setExpanded(previous => ({
      ...previous,
      [assetClass]: !previous[assetClass],
    }));
  }

  function selectAll() {
    setSelectedAssets([...ALL_SELECTABLE_ASSETS]);
    setMemecoinsSelected(true);
  }

  function deselectAll() {
    setSelectedAssets([]);
    setMemecoinsSelected(false);
  }

  function clearScheduleInterval() {
    if (scheduleRef.current != null) {
      window.clearInterval(scheduleRef.current);
      scheduleRef.current = null;
    }
  }

  function updateRunHistory(entry: RunLogEntry) {
    setRunHistory(previous => [entry, ...previous].slice(0, 10));
  }

  async function executeRun(payload: RunRequestBody | null, action: Exclude<RunAction, null>) {
    if (running) {
      return;
    }

    if (!payload) {
      const nextMessage = "Select at least one asset class or asset before running.";
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
      return;
    }

    const nextClasses = deriveClasses(payload);
    if (nextClasses.length === 0) {
      const nextMessage = "No supported asset classes were selected.";
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
      return;
    }

    const startedAt = Date.now();
    setRunning(true);
    setActiveAction(action);
    setMessage(null);
    setCurrentRunClasses(nextClasses);
    resetStatuses(nextClasses);

    try {
      const response = await fetch("/api/admin/run-assets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null) as RunResponse | { error?: string } | null;

      if (!response.ok) {
        throw new Error(data && "error" in data && typeof data.error === "string"
          ? data.error
          : "Run request failed.");
      }

      const typedData = data as RunResponse;
      setLastAuthMode(typedData.authMode);
      setHeaderName(typedData.headerName);
      for (const result of typedData.results) {
        setClassFromResult(result);
      }

      const successCount = typedData.results.filter(result => result.status !== "failed").length;
      const signalCount = typedData.results.reduce((sum, result) => sum + (result.cardCount ?? 0), 0);
      const duration = Date.now() - startedAt;
      const summary = typedData.partial
        ? `Run complete with partial failures: ${signalCount} signals across ${successCount}/${typedData.results.length} classes.`
        : `Run complete: ${signalCount} signals generated across ${typedData.results.length} classes.`;

      setMessage(summary);
      showToast({
        tone: typedData.success ? "success" : typedData.partial ? "success" : "error",
        message: summary,
      });
      updateRunHistory({
        id: `run-${startedAt}`,
        label: selectionLabel(payload, nextClasses),
        startedAt,
        duration,
        successCount,
        totalCount: typedData.results.length,
        status: typedData.success ? "success" : typedData.partial ? "partial" : "failed",
        error: typedData.results.find(result => result.status === "failed")?.error,
      });
      router.refresh();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Run request failed.";
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
      setClassStatuses(previous => {
        const updated = { ...previous };
        for (const assetClass of nextClasses) {
          updated[assetClass] = {
            state: "failed",
            detail: nextMessage,
          };
        }
        return updated;
      });
      updateRunHistory({
        id: `run-${startedAt}`,
        label: selectionLabel(payload, nextClasses),
        startedAt,
        duration: Date.now() - startedAt,
        successCount: 0,
        totalCount: nextClasses.length,
        status: "failed",
        error: nextMessage,
      });
    } finally {
      setRunning(false);
      setActiveAction(null);
    }
  }

  function activateSchedule() {
    const payload = buildSelectionPayload();
    if (!payload) {
      const nextMessage = "Select assets before setting a schedule.";
      setMessage(nextMessage);
      showToast({ tone: "error", message: nextMessage });
      return;
    }

    clearScheduleInterval();
    const delay = SCHEDULE_OPTIONS[scheduleIntervalKey];
    setScheduleActive(true);
    setNextScheduledRunAt(Date.now() + delay);

    if (scheduleStartMode === "now") {
      void executeRun(payload, "schedule");
    }

    scheduleRef.current = window.setInterval(() => {
      setNextScheduledRunAt(Date.now() + delay);
      if (runningRef.current) {
        return;
      }
      void executeRun(selectionRef.current, "schedule");
    }, delay);

    setMessage(`Schedule set for every ${scheduleIntervalKey}. Runs continue while this tab stays open.`);
  }

  function clearSchedule() {
    clearScheduleInterval();
    setScheduleActive(false);
    setNextScheduledRunAt(null);
    setMessage("Schedule cleared.");
  }

  const completedCount = currentRunClasses.filter(assetClass => {
    const state = classStatuses[assetClass]?.state;
    return state === "completed" || state === "queued" || state === "failed";
  }).length;
  const progressPercent = currentRunClasses.length === 0
    ? 0
    : running
      ? Math.max(16, Math.round((completedCount / currentRunClasses.length) * 100))
      : 100;

  return (
    <section className="apex-surface px-6 py-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">
            Run Control
          </p>
          <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
            Multi-asset cycle control
          </h2>
          <p className="mt-3 max-w-[720px] text-[14px] text-[var(--apex-text-secondary)]">
            Manually trigger signal cycles across any asset selection.
          </p>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] ${running ? "border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] text-[#F59E0B]" : "border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] text-[var(--apex-text-secondary)]"}`}>
          <span className={running ? "inline-block animate-spin" : ""}>{running ? "⟳" : "●"}</span>
          <span>{running ? "Running" : "Idle"}</span>
        </div>
      </div>

      {adminMode ? (
        <div className="mt-5 rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Admin Auth</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-[11px] text-[var(--apex-text-tertiary)]">Endpoint</p>
              <p className="mt-1 font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">/api/admin/run-assets</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--apex-text-tertiary)]">Header</p>
              <p className="mt-1 font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">{headerName}</p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--apex-text-tertiary)]">Last auth mode</p>
              <p className="mt-1 font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">
                {lastAuthMode === "secret" ? "secret header" : lastAuthMode === "admin_session" ? "admin session" : "not used yet"}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        <div className="h-2 overflow-hidden rounded-full bg-[var(--apex-bg-raised)]">
          <div
            className={`h-full rounded-full bg-[linear-gradient(90deg,rgba(255,176,32,0.95),rgba(96,165,250,0.95))] transition-all duration-300 ${running && completedCount === 0 ? "animate-pulse" : ""}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {CLASS_CONFIG.map(item => {
            const status = classStatuses[item.key];
            return (
              <div key={item.key} className={`rounded-[var(--apex-radius-md)] border px-3 py-3 ${statusTone(status.state)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em]">{item.label}</span>
                  <span className={status.state === "running" ? "inline-block animate-spin" : ""}>{statusIcon(status.state)}</span>
                </div>
                <p className="mt-2 text-[12px]">{status.detail}</p>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <button
          type="button"
          disabled={running}
          onClick={() => void executeRun({ all: true }, "all")}
          className="apex-button apex-button-amber disabled:opacity-60"
        >
          {activeAction === "all" ? <span className="inline-block animate-spin">⟳</span> : "⚡"} Run All
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => void executeRun(buildSelectionPayload(), "selected")}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--apex-radius-md)] border border-[rgba(96,165,250,0.35)] bg-[rgba(96,165,250,0.10)] px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[#93C5FD] transition hover:border-[rgba(96,165,250,0.55)] hover:bg-[rgba(96,165,250,0.16)] disabled:opacity-60"
        >
          {activeAction === "selected" ? <span className="inline-block animate-spin">⟳</span> : null}
          <span>Run Selected</span>
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => setShowScheduler(previous => !previous)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)] transition hover:border-[var(--apex-border-default)] hover:text-[var(--apex-text-primary)] disabled:opacity-60"
        >
          <span>⏱</span>
          <span>Schedule</span>
        </button>
      </div>

      {message ? (
        <div className="mt-4 flex items-center gap-2 font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-accent)]">
          <span className="apex-pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--apex-text-accent)]" />
          <span>{message}</span>
        </div>
      ) : null}

      <section className="mt-8">
        <div className="flex flex-col gap-3 border-b border-[var(--apex-border-subtle)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Asset Selection</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Asset class toggles</h3>
            <p className="mt-2 max-w-[700px] text-[12px] text-[var(--apex-text-tertiary)]">
              Forex supports direct symbol overrides. Crypto, stocks, commodities, and indices currently run at class scope when individual symbols are selected.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={selectAll}
              className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-accent)]"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]"
            >
              Deselect All
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {CLASS_CONFIG.map(item => {
            const full = isClassFullySelected(item.key);
            const partial = isClassPartiallySelected(item.key);
            const indicator = full ? "✓" : partial ? "◐" : "○";

            return (
              <article
                key={item.key}
                className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleClass(item.key)}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] ${full ? "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]" : partial ? "border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] text-[#F59E0B]" : "border-[var(--apex-border-subtle)] text-[var(--apex-text-secondary)]"}`}
                    >
                      <span>{indicator}</span>
                      <span>{item.label}</span>
                    </button>
                    <div>
                      <p className="text-[12px] text-[var(--apex-text-secondary)]">{item.helper}</p>
                      <p className="text-[11px] text-[var(--apex-text-tertiary)]">
                        {item.autoOnly ? "Auto-scan only." : `${item.assets.filter(asset => selectedAssetSet.has(asset.symbol)).length}/${item.assets.length} selected`}
                      </p>
                    </div>
                  </div>
                  {!item.autoOnly ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(item.key)}
                      className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]"
                    >
                      {expanded[item.key] ? "Hide Assets" : "Show Assets"}
                    </button>
                  ) : null}
                </div>

                {item.autoOnly ? (
                  <div className="mt-4 rounded-[var(--apex-radius-md)] border border-dashed border-[var(--apex-border-subtle)] px-4 py-4 text-[12px] text-[var(--apex-text-tertiary)]">
                    Auto-scan only. Individual memecoin selection is not exposed in the current runtime.
                  </div>
                ) : expanded[item.key] ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {item.assets.map(asset => (
                      <label
                        key={asset.symbol}
                        className="flex items-center gap-3 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] px-3 py-2 text-[12px] text-[var(--apex-text-secondary)]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAssetSet.has(asset.symbol)}
                          onChange={() => toggleAsset(asset.symbol)}
                          className="h-4 w-4 rounded border-[var(--apex-border-default)] bg-transparent"
                        />
                        <span className="font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">{asset.label}</span>
                        <span className="ml-auto text-[10px] text-[var(--apex-text-tertiary)]">{asset.symbol}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
      {showScheduler ? (
        <section className="mt-8 rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
          <div className="flex flex-col gap-2 border-b border-[var(--apex-border-subtle)] pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Schedule A Run</p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Inline scheduler</h3>
            </div>
            <p className="text-[12px] text-[var(--apex-text-tertiary)]">Schedule runs while this tab is open.</p>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <label className="space-y-2 text-[12px] text-[var(--apex-text-secondary)]">
              <span className="font-[var(--apex-font-mono)] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Run every</span>
              <select
                value={scheduleIntervalKey}
                disabled={scheduleActive}
                onChange={event => setScheduleIntervalKey(event.target.value as keyof typeof SCHEDULE_OPTIONS)}
                className="h-10 w-full rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg)] px-3 text-[var(--apex-text-primary)] disabled:opacity-60"
              >
                {Object.keys(SCHEDULE_OPTIONS).map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-[12px] text-[var(--apex-text-secondary)]">
              <span className="font-[var(--apex-font-mono)] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Starting</span>
              <select
                value={scheduleStartMode}
                disabled={scheduleActive}
                onChange={event => setScheduleStartMode(event.target.value as "now" | "next")}
                className="h-10 w-full rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg)] px-3 text-[var(--apex-text-primary)] disabled:opacity-60"
              >
                <option value="now">Now</option>
                <option value="next">Next interval</option>
              </select>
            </label>

            <div className="space-y-2 text-[12px] text-[var(--apex-text-secondary)]">
              <span className="font-[var(--apex-font-mono)] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Classes</span>
              <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg)] px-3 py-3 text-[var(--apex-text-primary)]">
                Use current selection
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={running}
              onClick={activateSchedule}
              className="apex-button apex-button-amber disabled:opacity-60"
            >
              Set Schedule
            </button>
            <button
              type="button"
              onClick={clearSchedule}
              className="inline-flex h-10 items-center justify-center rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] px-4 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-secondary)]"
            >
              Clear Schedule
            </button>
            <div className={`rounded-full border px-3 py-2 font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] ${scheduleActive ? "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]" : "border-[var(--apex-border-subtle)] text-[var(--apex-text-tertiary)]"}`}>
              Next run in {formatCountdown(nextScheduledRunAt, nowTimestamp)}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-8 rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
        <div className="flex items-end justify-between border-b border-[var(--apex-border-subtle)] pb-4">
          <div>
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Recent Runs</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Live run log</h3>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {runHistory.length === 0 ? (
            <p className="text-[13px] text-[var(--apex-text-tertiary)]">No manual runs yet.</p>
          ) : runHistory.map(entry => (
            <article
              key={entry.id}
              className="grid gap-3 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] px-4 py-3 lg:grid-cols-[auto_1fr_auto_auto_auto]"
            >
              <div className={`font-[var(--apex-font-mono)] text-[14px] ${logStatusTone(entry.status)}`}>{logStatusIcon(entry.status)}</div>
              <div>
                <p className="font-[var(--apex-font-mono)] text-[12px] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]">{entry.label}</p>
                {entry.error ? (
                  <p className="mt-1 text-[12px] text-[var(--apex-status-blocked-text)]">{entry.error}</p>
                ) : null}
              </div>
              <div className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">{formatTimeAgo(entry.startedAt, nowTimestamp)}</div>
              <div className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{entry.successCount}/{entry.totalCount} success</div>
              <div className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{formatDuration(entry.duration)}</div>
            </article>
          ))}
        </div>
      </section>

      {toast ? (
        <div className={`fixed bottom-6 right-6 z-50 max-w-[360px] rounded-[var(--apex-radius-lg)] border px-4 py-3 shadow-xl ${toast.tone === "success" ? "border-[var(--apex-status-active-border)] bg-[var(--apex-bg-raised)] text-[var(--apex-status-active-text)]" : "border-[var(--apex-status-blocked-border)] bg-[var(--apex-bg-raised)] text-[var(--apex-status-blocked-text)]"}`}>
          <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em]">{toast.tone === "success" ? "Run Complete" : "Run Failed"}</p>
          <p className="mt-2 text-[13px]">{toast.message}</p>
        </div>
      ) : null}
    </section>
  );
}
