"use client";

import { useEffect, useState } from "react";

interface SystemData {
  latestRun: {
    id: string;
    status: string;
    queuedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    totalDurationMs: number | null;
    failureCode: string | null;
    failureReason: string | null;
  } | null;
  queue: { pending: number; failed: number };
  envStatus: Record<string, boolean>;
  dbStatus: string;
  providerHealth: { provider: string; status: string; latencyMs: number | null; errorRate: number | null; recordedAt: string }[];
}

export default function AdminSystemPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleResult, setCycleResult] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch("/api/admin/system")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function triggerCycle() {
    setCycleLoading(true);
    setCycleResult(null);
    try {
      const res = await fetch("/api/admin/trigger-cycle", { method: "POST" });
      const json = await res.json() as { success: boolean; signalCount?: number; error?: string };
      setCycleResult(json.success ? `✓ Cycle complete — ${json.signalCount} signals` : `✗ ${json.error}`);
      load();
    } catch (e) {
      setCycleResult(`✗ ${String(e)}`);
    }
    setCycleLoading(false);
  }

  if (loading) return <div className="text-zinc-500 text-sm">Loading...</div>;
  if (!data)   return <div className="text-red-400 text-sm">Failed to load system status.</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">System Control</h1>
        <p className="text-xs text-zinc-500">Engine status, controls, and environment</p>
      </div>

      {/* Controls */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Controls</h2>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={triggerCycle}
            disabled={cycleLoading}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#00ff88", color: "#000" }}
          >
            {cycleLoading ? "Running..." : "▶ Trigger Signal Cycle"}
          </button>
        </div>
        {cycleResult && (
          <p className={`mt-3 text-sm font-mono ${cycleResult.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>
            {cycleResult}
          </p>
        )}
      </section>

      {/* Latest run */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Latest Run</h2>
        {data.latestRun ? (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 space-y-2">
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                data.latestRun.status === "COMPLETED" ? "text-green-400 bg-green-400/10" :
                data.latestRun.status === "RUNNING"   ? "text-blue-400 bg-blue-400/10" :
                data.latestRun.status === "FAILED"    ? "text-red-400 bg-red-400/10" :
                "text-zinc-400 bg-zinc-800"
              }`}>{data.latestRun.status}</span>
              <span className="text-zinc-500 text-xs font-mono">{data.latestRun.id}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs mt-2">
              <Row label="Queued"    value={new Date(data.latestRun.queuedAt).toLocaleString()} />
              <Row label="Started"   value={data.latestRun.startedAt ? new Date(data.latestRun.startedAt).toLocaleString() : "—"} />
              <Row label="Completed" value={data.latestRun.completedAt ? new Date(data.latestRun.completedAt).toLocaleString() : "—"} />
              <Row label="Duration"  value={data.latestRun.totalDurationMs ? `${(data.latestRun.totalDurationMs / 1000).toFixed(1)}s` : "—"} />
            </div>
            {data.latestRun.failureReason && (
              <p className="text-red-400 text-xs mt-2">{data.latestRun.failureCode}: {data.latestRun.failureReason}</p>
            )}
          </div>
        ) : (
          <p className="text-zinc-600 text-sm">No runs yet.</p>
        )}
      </section>

      {/* Queue & DB */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Infrastructure</h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatusCard label="Database"      status={data.dbStatus === "OK" ? "OK" : "ERROR"} />
          <StatusCard label="Alert Queue"   status={data.queue.pending > 0 ? "PENDING" : "OK"} sub={`${data.queue.pending} pending / ${data.queue.failed} failed`} />
        </div>
      </section>

      {/* Provider health */}
      {data.providerHealth.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Provider Health</h2>
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500">
                  <th className="text-left px-4 py-2">Provider</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2">Latency</th>
                  <th className="text-left px-4 py-2">Error Rate</th>
                  <th className="text-left px-4 py-2">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {data.providerHealth.map((p, i) => (
                  <tr key={i} className="border-b border-zinc-900">
                    <td className="px-4 py-2 font-mono text-zinc-300">{p.provider}</td>
                    <td className="px-4 py-2">
                      <span className={p.status === "OK" ? "text-green-400" : "text-red-400"}>{p.status}</span>
                    </td>
                    <td className="px-4 py-2 text-zinc-400">{p.latencyMs != null ? `${p.latencyMs}ms` : "—"}</td>
                    <td className="px-4 py-2 text-zinc-400">{p.errorRate != null ? `${(p.errorRate * 100).toFixed(1)}%` : "—"}</td>
                    <td className="px-4 py-2 text-zinc-500">{new Date(p.recordedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Environment */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Environment Variables</h2>
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 grid grid-cols-2 lg:grid-cols-3 gap-2">
          {Object.entries(data.envStatus).map(([key, set]) => (
            <div key={key} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${set ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-xs font-mono text-zinc-400">{key}</span>
              <span className={`text-[10px] ml-auto ${set ? "text-green-500" : "text-red-500"}`}>
                {set ? "SET" : "MISSING"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-zinc-500 w-24">{label}</span>
      <span className="text-zinc-300">{value}</span>
    </div>
  );
}

function StatusCard({ label, status, sub }: { label: string; status: string; sub?: string }) {
  const ok = status === "OK";
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-sm font-semibold ${ok ? "text-green-400" : "text-red-400"}`}>{status}</p>
      {sub && <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>}
    </div>
  );
}
