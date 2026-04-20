"use client";

import { useEffect, useMemo, useState } from "react";

type RejectionByGate = {
  gate1: number;
  gate2: number;
  gate3: number;
  gate4: number;
  gate5: number;
};

type DiagnosticCycle = {
  cycleId: string;
  totalEvaluations: number;
  signalsGenerated: number;
  rejectionByGate: RejectionByGate;
  createdAt: string;
};

type DiagnosticResponse = {
  cycles: DiagnosticCycle[];
};

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeGateCounts(value: unknown): RejectionByGate {
  if (!value || typeof value !== "object") {
    return { gate1: 0, gate2: 0, gate3: 0, gate4: 0, gate5: 0 };
  }

  const row = value as Record<string, unknown>;
  return {
    gate1: asNumber(row.gate1),
    gate2: asNumber(row.gate2),
    gate3: asNumber(row.gate3),
    gate4: asNumber(row.gate4),
    gate5: asNumber(row.gate5),
  };
}

function normalizeCycles(payload: unknown): DiagnosticCycle[] {
  if (!payload || typeof payload !== "object" || !("cycles" in payload)) {
    return [];
  }

  const raw = (payload as { cycles?: unknown }).cycles;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry): DiagnosticCycle | null => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const cycleId = typeof row.cycleId === "string" ? row.cycleId : "";
      if (!cycleId) return null;

      const createdAt = typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString();
      return {
        cycleId,
        totalEvaluations: asNumber(row.totalEvaluations),
        signalsGenerated: asNumber(row.signalsGenerated),
        rejectionByGate: normalizeGateCounts(row.rejectionByGate),
        createdAt,
      };
    })
    .filter((cycle): cycle is DiagnosticCycle => cycle !== null);
}

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return (value / total) * 100;
}

export function ScalpDiagnostics() {
  const [data, setData] = useState<DiagnosticResponse>({ cycles: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/scalp/diagnostics", { cache: "no-store" })
      .then(response => response.json())
      .then(payload => {
        setData({ cycles: normalizeCycles(payload) });
      })
      .finally(() => setLoading(false));
  }, []);

  const latest = data.cycles[0];

  const rows = useMemo(() => {
    if (!latest) return [];

    return [
      { label: "Total Evaluations", count: latest.totalEvaluations, color: "bg-slate-600" },
      { label: "Rejected by Gate 1 (Trend)", count: latest.rejectionByGate.gate1, color: "bg-red-500/60" },
      { label: "Rejected by Gate 2 (Level)", count: latest.rejectionByGate.gate2, color: "bg-orange-500/60" },
      { label: "Rejected by Gate 3 (Momentum)", count: latest.rejectionByGate.gate3, color: "bg-amber-500/60" },
      { label: "Rejected by Gate 4 (Candle)", count: latest.rejectionByGate.gate4, color: "bg-yellow-500/60" },
      { label: "Rejected by Gate 5 (Context)", count: latest.rejectionByGate.gate5, color: "bg-lime-500/60" },
      { label: "Signals Generated", count: latest.signalsGenerated, color: "bg-emerald-500" },
    ];
  }, [latest]);

  if (loading) {
    return <div className="p-6 text-sm font-mono text-slate-500">Loading diagnostics...</div>;
  }

  if (!latest) {
    return (
      <div className="p-6">
        <div className="text-sm font-mono text-slate-500">No diagnostic data yet</div>
        <div className="text-xs font-mono text-slate-600 mt-2">Run a scan to populate diagnostics</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-mono font-bold text-white">SCALP DIAGNOSTICS</h1>
        <p className="text-xs font-mono text-slate-500 mt-0.5">
          Gate-by-gate rejection analysis - Last {data.cycles.length} cycles
        </p>
      </div>

      <div>
        <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">
          Latest Cycle Funnel ({latest.cycleId})
        </div>

        <div className="space-y-2">
          {rows.map((row) => {
            const progress = pct(row.count, latest.totalEvaluations);
            return (
              <div key={row.label} className="flex items-center gap-3">
                <div className="w-56 text-xs font-mono text-slate-400">{row.label}</div>
                <div className="flex-1 h-6 bg-slate-800 rounded-lg overflow-hidden relative">
                  <div className={`${row.color} h-full rounded-lg transition-all`} style={{ width: `${progress}%` }} />
                  <div className="absolute inset-0 flex items-center px-3 text-xs font-mono font-bold text-white">
                    {row.count} ({progress.toFixed(0)}%)
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">
          Gate Health Check
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {[
            { key: "gate1", label: "Trend" },
            { key: "gate2", label: "Level" },
            { key: "gate3", label: "Momentum" },
            { key: "gate4", label: "Candle" },
            { key: "gate5", label: "Context" },
          ].map((gate, index) => {
            const rejected = latest.rejectionByGate[gate.key as keyof RejectionByGate];
            const rejectionRate = pct(rejected, latest.totalEvaluations);

            let status = "healthy";
            let statusColor = "text-emerald-400";
            if (rejectionRate === 0) {
              status = "suspicious (0 rejected)";
              statusColor = "text-amber-400";
            } else if (rejectionRate > 95) {
              status = "too strict";
              statusColor = "text-red-400";
            } else if (rejectionRate > 80) {
              status = "very strict";
              statusColor = "text-orange-400";
            }

            return (
              <div key={gate.key} className="border border-slate-800 rounded-xl p-4 bg-slate-900/50">
                <div className="text-[10px] font-mono text-slate-500 uppercase mb-1">Gate {index + 1}</div>
                <div className="text-sm font-mono font-bold mb-2 text-white">{gate.label}</div>
                <div className="text-2xl font-mono font-bold text-white mb-1">{rejectionRate.toFixed(0)}%</div>
                <div className="text-[10px] font-mono text-slate-500 mb-2">rejection rate</div>
                <div className={`text-[10px] font-mono ${statusColor}`}>{status}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">
          Cycle History
        </div>
        <div className="border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-slate-900 border-b border-slate-800">
              <tr>
                <th className="text-left p-3 text-[10px] text-slate-500">Cycle</th>
                <th className="text-left p-3 text-[10px] text-slate-500">Evaluated</th>
                <th className="text-left p-3 text-[10px] text-slate-500">G1</th>
                <th className="text-left p-3 text-[10px] text-slate-500">G2</th>
                <th className="text-left p-3 text-[10px] text-slate-500">G3</th>
                <th className="text-left p-3 text-[10px] text-slate-500">G4</th>
                <th className="text-left p-3 text-[10px] text-slate-500">G5</th>
                <th className="text-left p-3 text-[10px] text-slate-500">Signals</th>
                <th className="text-left p-3 text-[10px] text-slate-500">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.cycles.map((cycle) => (
                <tr key={cycle.cycleId} className="border-b border-slate-800/50">
                  <td className="p-3 text-slate-300 text-[10px]">{cycle.cycleId.slice(0, 16)}</td>
                  <td className="p-3 text-slate-300">{cycle.totalEvaluations}</td>
                  <td className="p-3 text-red-400">{cycle.rejectionByGate.gate1}</td>
                  <td className="p-3 text-orange-400">{cycle.rejectionByGate.gate2}</td>
                  <td className="p-3 text-amber-400">{cycle.rejectionByGate.gate3}</td>
                  <td className="p-3 text-yellow-400">{cycle.rejectionByGate.gate4}</td>
                  <td className="p-3 text-lime-400">{cycle.rejectionByGate.gate5}</td>
                  <td className={`p-3 ${cycle.signalsGenerated > 0 ? "text-emerald-400 font-bold" : "text-slate-500"}`}>
                    {cycle.signalsGenerated}
                  </td>
                  <td className="p-3 text-slate-500 text-[10px]">
                    {new Date(cycle.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-slate-800 rounded-xl p-4 bg-slate-900/50">
        <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-3">
          Interpretation Guide
        </div>
        <div className="space-y-2 text-xs font-mono text-slate-400">
          <div><span className="text-emerald-400">healthy:</span> Gate rejects roughly 20-70% of setups</div>
          <div><span className="text-amber-400">suspicious:</span> Gate rejects 0% consistently (likely wiring issue)</div>
          <div><span className="text-orange-400">very strict:</span> Gate rejects 80-95% (signals will be rare)</div>
          <div><span className="text-red-400">too strict:</span> Gate rejects over 95% (tuning likely needed)</div>
        </div>
      </div>
    </div>
  );
}
