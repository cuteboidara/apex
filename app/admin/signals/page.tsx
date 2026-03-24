"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

interface TradePlan {
  style: string;
  bias: string;
  confidence: number;
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
}

interface AdminSignal {
  id: string;
  asset: string;
  direction: string;
  rank: string;
  total: number;
  macro: number;
  structure: number;
  zones: number;
  technical: number;
  timing: number;
  brief: string;
  aiUnifiedAnalysis: string | null;
  aiGptConfidence: number | null;
  aiClaudeConfidence: number | null;
  aiGeminiConfidence: number | null;
  aiVerdict: string | null;
  createdAt: string;
  tradePlans: TradePlan[];
}

const RANK_COLORS: Record<string, string> = {
  S: "text-amber-300 bg-amber-300/10",
  A: "text-emerald-400 bg-emerald-400/10",
  B: "text-sky-400 bg-sky-400/10",
};

const ASSETS = ["EURUSD","GBPUSD","USDJPY","USDCAD","AUDUSD","NZDUSD","USDCHF","EURJPY","GBPJPY","XAUUSD","XAGUSD","BTCUSDT","ETHUSDT"];

export default function AdminSignalsPage() {
  const [signals, setSignals] = useState<AdminSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState("");
  const [rank, setRank] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (asset) params.set("asset", asset);
    if (rank)  params.set("rank", rank);
    params.set("limit", "50");
    const result = await fetchJsonResponse<AdminSignal[]>(`/api/admin/signals?${params}`);
    if (result.ok && Array.isArray(result.data)) {
      setSignals(result.data);
    } else {
      setSignals([]);
      setError(formatApiError(result, "Failed to load signals."));
    }
    setLoading(false);
  }, [asset, rank]);

  useEffect(() => { void load(); }, [load]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function exportCSV() {
    const rows = [
      ["Asset","Direction","Rank","Total","Macro","Structure","Zones","Technical","Timing","AI Verdict","Created"],
      ...signals.map(s => [
        s.asset, s.direction, s.rank, s.total, s.macro, s.structure, s.zones, s.technical, s.timing,
        s.aiVerdict ?? "", new Date(s.createdAt).toISOString(),
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apex-signals-${Date.now()}.csv`;
    a.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 mb-1">Signals</h1>
          <p className="text-xs text-zinc-500">Browse and filter generated signals</p>
        </div>
        <button
          onClick={exportCSV}
          className="text-xs px-3 py-2 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          ↓ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={asset}
          onChange={e => setAsset(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none"
        >
          <option value="">All Assets</option>
          {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={rank}
          onChange={e => setRank(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none"
        >
          <option value="">All Ranks</option>
          <option value="S">S</option>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading...</div>
      ) : error ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
          {error}
        </div>
      ) : (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-4 py-3">Asset</th>
                <th className="text-left px-4 py-3">Dir</th>
                <th className="text-left px-4 py-3">Rank</th>
                <th className="text-left px-4 py-3">Score</th>
                <th className="text-left px-4 py-3">AI Analysis</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="text-left px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {signals.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600">No signals found</td></tr>
              )}
              {signals.map(s => (
                <>
                  <tr key={s.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                    <td className="px-4 py-3 font-mono font-semibold text-zinc-100">{s.asset}</td>
                    <td className={`px-4 py-3 font-medium ${s.direction === "LONG" ? "text-green-400" : "text-red-400"}`}>
                      {s.direction}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded font-bold ${RANK_COLORS[s.rank] ?? "text-zinc-400"}`}>
                        {s.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{s.total}/100</td>
                    <td className="px-4 py-3">
                      {s.aiVerdict ? (
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          s.aiVerdict === "STRONG" ? "text-green-400 bg-green-400/10" :
                          s.aiVerdict === "MODERATE" ? "text-blue-400 bg-blue-400/10" :
                          s.aiVerdict === "WEAK" ? "text-yellow-400 bg-yellow-400/10" :
                          "text-red-400 bg-red-400/10"
                        }`}>{s.aiVerdict}</span>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleExpand(s.id)}
                        className="text-xs text-zinc-500 hover:text-zinc-300"
                      >
                        {expanded.has(s.id) ? "▲ hide" : "▼ expand"}
                      </button>
                    </td>
                  </tr>
                  {expanded.has(s.id) && (
                    <tr key={s.id + "-exp"} className="border-b border-zinc-900 bg-zinc-900/30">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                          {/* Score breakdown */}
                          <div>
                            <p className="text-zinc-500 font-semibold mb-2 uppercase tracking-wider">Score Breakdown</p>
                            {[
                              ["Macro", s.macro],
                              ["Structure", s.structure],
                              ["Zones", s.zones],
                              ["Technical", s.technical],
                              ["Timing", s.timing],
                            ].map(([k, v]) => (
                              <div key={k as string} className="flex justify-between py-0.5">
                                <span className="text-zinc-500">{k}</span>
                                <span className="text-zinc-300 font-mono">{v}/20</span>
                              </div>
                            ))}
                          </div>
                          {/* Trade plans */}
                          <div>
                            <p className="text-zinc-500 font-semibold mb-2 uppercase tracking-wider">Trade Plans</p>
                            {s.tradePlans.map(tp => (
                              <div key={tp.style} className="mb-2 border border-zinc-800 rounded p-2">
                                <p className="text-zinc-300 font-medium">{tp.style} — {tp.bias}</p>
                                <div className="text-zinc-500 mt-1 space-y-0.5">
                                  {tp.entryMin != null && <div>Entry {tp.entryMin}–{tp.entryMax}</div>}
                                  {tp.stopLoss != null && <div>SL {tp.stopLoss}</div>}
                                  {tp.takeProfit1 != null && <div>TP1 {tp.takeProfit1}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* AI analysis */}
                          <div>
                            <p className="text-zinc-500 font-semibold mb-2 uppercase tracking-wider">AI Analysis</p>
                            {s.aiUnifiedAnalysis ? (
                              <>
                                <p className="text-zinc-300 leading-relaxed mb-2">{s.aiUnifiedAnalysis}</p>
                                <div className="flex gap-3 text-[10px]">
                                  {s.aiGptConfidence != null && <span className="text-blue-400">GPT {s.aiGptConfidence}</span>}
                                  {s.aiClaudeConfidence != null && <span className="text-green-400">Risk {s.aiClaudeConfidence}</span>}
                                  {s.aiGeminiConfidence != null && <span className="text-purple-400">Gemini {s.aiGeminiConfidence}</span>}
                                </div>
                              </>
                            ) : (
                              <p className="text-zinc-600">No AI analysis yet</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
