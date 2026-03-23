"use client";

import { useEffect, useState, useTransition } from "react";

type PaperAccount = {
  id: string;
  name: string;
  currency: string;
  cashBalance: number;
  equity: number;
  status: string;
};

type PaperPosition = {
  id: string;
  symbol: string;
  direction: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number;
  status: string;
};

export default function AdminExecutionPage() {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [tradePlanId, setTradePlanId] = useState("");
  const [closePrice, setClosePrice] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    Promise.all([
      fetch("/api/execution/accounts").then(res => res.json()),
      fetch("/api/execution/positions").then(res => res.json()),
    ])
      .then(([accountPayload, positionPayload]) => {
        setAccounts(accountPayload.accounts ?? []);
        setPositions(positionPayload.positions ?? []);
      })
      .catch(err => setError(String(err)));
  };

  useEffect(() => {
    refresh();
  }, []);

  const createAccount = () => {
    startTransition(async () => {
      await fetch("/api/execution/accounts", { method: "POST" });
      refresh();
    });
  };

  const executeTradePlan = () => {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/execution/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute_trade_plan",
          tradePlanId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Execution failed.");
        return;
      }
      setTradePlanId("");
      refresh();
    });
  };

  const closePosition = () => {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/execution/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close_position",
          positionId: selectedPositionId,
          exitPrice: Number(closePrice),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Close failed.");
        return;
      }
      setClosePrice("");
      refresh();
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">Execution</h1>
        <p className="text-xs text-zinc-500">Paper-trading accounts, positions, and fills.</p>
      </div>

      <section className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap gap-3">
          <button onClick={createAccount} disabled={isPending} className="px-4 py-2 rounded bg-emerald-400 text-black font-medium disabled:opacity-60">
            Create / Load Default Paper Account
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Trade Plan ID</span>
            <input className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={tradePlanId} onChange={event => setTradePlanId(event.target.value)} />
          </label>
          <div className="flex items-end">
            <button onClick={executeTradePlan} disabled={isPending || !tradePlanId} className="px-4 py-2 rounded bg-emerald-400 text-black font-medium disabled:opacity-60">
              Execute Paper Trade
            </button>
          </div>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Position ID</span>
            <input className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={selectedPositionId} onChange={event => setSelectedPositionId(event.target.value)} />
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-zinc-500">Exit Price</span>
              <input className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={closePrice} onChange={event => setClosePrice(event.target.value)} />
            </label>
            <div className="flex items-end">
              <button onClick={closePosition} disabled={isPending || !selectedPositionId || !closePrice} className="px-4 py-2 rounded border border-zinc-700 text-zinc-200 disabled:opacity-60">
                Close
              </button>
            </div>
          </div>
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 text-sm font-medium text-zinc-200">Accounts</div>
          <table className="w-full text-sm">
            <thead className="text-zinc-500 text-xs border-b border-zinc-800">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Cash</th>
                <th className="text-left px-4 py-3">Equity</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(account => (
                <tr key={account.id} className="border-b border-zinc-900">
                  <td className="px-4 py-3 text-zinc-100">{account.name}</td>
                  <td className="px-4 py-3 text-zinc-300">{account.cashBalance.toFixed(2)} {account.currency}</td>
                  <td className="px-4 py-3 text-zinc-300">{account.equity.toFixed(2)} {account.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 text-sm font-medium text-zinc-200">Positions</div>
          <table className="w-full text-sm">
            <thead className="text-zinc-500 text-xs border-b border-zinc-800">
              <tr>
                <th className="text-left px-4 py-3">Symbol</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">PnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(position => (
                <tr key={position.id} className="border-b border-zinc-900">
                  <td className="px-4 py-3 text-zinc-100">
                    <div>{position.symbol}</div>
                    <div className="text-xs text-zinc-500">{position.id}</div>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{position.status}</td>
                  <td className="px-4 py-3 text-zinc-300">
                    {(position.unrealizedPnl ?? position.realizedPnl).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
