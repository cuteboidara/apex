"use client";

import { useEffect, useState, useTransition } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

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

type AccountsResponse = {
  accounts?: PaperAccount[];
};

type PositionsResponse = {
  positions?: PaperPosition[];
};

export default function AdminExecutionPage() {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [tradePlanId, setTradePlanId] = useState("");
  const [closePrice, setClosePrice] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    setIsLoading(true);

    const [accountResult, positionResult] = await Promise.all([
      fetchJsonResponse<AccountsResponse>("/api/execution/accounts"),
      fetchJsonResponse<PositionsResponse>("/api/execution/positions"),
    ]);

    setAccounts(accountResult.data?.accounts ?? []);
    setPositions(positionResult.data?.positions ?? []);

    const failures = [
      !accountResult.ok ? `Accounts: ${formatApiError(accountResult, "Unable to load paper trading accounts.")}` : null,
      !positionResult.ok ? `Positions: ${formatApiError(positionResult, "Unable to load paper trading positions.")}` : null,
    ].filter(Boolean);

    setError(failures.length > 0 ? failures.join(" ") : null);
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [accountResult, positionResult] = await Promise.all([
        fetchJsonResponse<AccountsResponse>("/api/execution/accounts"),
        fetchJsonResponse<PositionsResponse>("/api/execution/positions"),
      ]);

      if (cancelled) {
        return;
      }

      setAccounts(accountResult.data?.accounts ?? []);
      setPositions(positionResult.data?.positions ?? []);
      const failures = [
        !accountResult.ok ? `Accounts: ${formatApiError(accountResult, "Unable to load paper trading accounts.")}` : null,
        !positionResult.ok ? `Positions: ${formatApiError(positionResult, "Unable to load paper trading positions.")}` : null,
      ].filter(Boolean);
      setError(failures.length > 0 ? failures.join(" ") : null);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createAccount = () => {
    setError(null);
    startTransition(async () => {
      const result = await fetchJsonResponse<{ account?: PaperAccount }>("/api/execution/accounts", { method: "POST" });
      if (!result.ok) {
        setError(formatApiError(result, "Unable to create or load a paper trading account."));
        return;
      }

      await refresh();
    });
  };

  const executeTradePlan = () => {
    setError(null);
    startTransition(async () => {
      const result = await fetchJsonResponse<{ position?: PaperPosition }>("/api/execution/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute_trade_plan",
          tradePlanId,
        }),
      });

      if (!result.ok) {
        setError(formatApiError(result, "Execution failed."));
        return;
      }

      setTradePlanId("");
      await refresh();
    });
  };

  const closePosition = () => {
    setError(null);
    startTransition(async () => {
      const result = await fetchJsonResponse<{ position?: PaperPosition }>("/api/execution/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close_position",
          positionId: selectedPositionId,
          exitPrice: Number(closePrice),
        }),
      });

      if (!result.ok) {
        setError(formatApiError(result, "Close failed."));
        return;
      }

      setClosePrice("");
      setSelectedPositionId("");
      await refresh();
    });
  };

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Execution Control</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Paper trading accounts and fills
        </h2>
        <p className="mt-3 max-w-[760px] text-[14px] leading-7 text-[var(--apex-text-secondary)]">
          Operator controls for creating default paper accounts, executing stored trade plans, and managing position exits.
        </p>
      </section>

      <section className="apex-surface px-6 py-6">
        <div className="flex flex-wrap gap-3">
          <button onClick={createAccount} disabled={isPending} className="apex-button apex-button-amber disabled:opacity-60">
            Create / Load Default Paper Account
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="apex-form-label">Trade Plan ID</span>
            <input className="apex-form-input" value={tradePlanId} onChange={event => setTradePlanId(event.target.value)} />
          </label>
          <div className="flex items-end">
            <button onClick={executeTradePlan} disabled={isPending || !tradePlanId} className="apex-button apex-button-amber disabled:opacity-60">
              Execute Paper Trade
            </button>
          </div>
          <label className="text-sm">
            <span className="apex-form-label">Position ID</span>
            <input className="apex-form-input" value={selectedPositionId} onChange={event => setSelectedPositionId(event.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-sm">
              <span className="apex-form-label">Exit Price</span>
              <input className="apex-form-input" value={closePrice} onChange={event => setClosePrice(event.target.value)} />
            </label>
            <div className="flex items-end">
              <button onClick={closePosition} disabled={isPending || !selectedPositionId || !closePrice} className="apex-button apex-button-muted disabled:opacity-60">
                Close Position
              </button>
            </div>
          </div>
        </div>

        {error ? <p className="mt-5 text-sm text-[var(--apex-status-blocked-text)]">{error}</p> : null}
        {!error && isLoading ? <p className="mt-5 text-sm text-[var(--apex-text-tertiary)]">Loading paper trading data…</p> : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="apex-table-shell px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Accounts</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Paper account ledger</h3>
          </div>
          <table className="apex-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Cash</th>
                <th>Equity</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(account => (
                <tr key={account.id}>
                  <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">{account.name}</td>
                  <td>{account.cashBalance.toFixed(2)} {account.currency}</td>
                  <td>{account.equity.toFixed(2)} {account.currency}</td>
                </tr>
              ))}
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="apex-empty-state">
                    {isLoading ? "Loading accounts…" : "No paper trading accounts available."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="apex-table-shell px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Positions</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Open and closed paper positions</h3>
          </div>
          <table className="apex-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Status</th>
                <th>PnL</th>
              </tr>
            </thead>
            <tbody>
              {positions.map(position => (
                <tr key={position.id}>
                  <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">
                    <div>{position.symbol}</div>
                    <div className="mt-1 text-[11px] text-[var(--apex-text-tertiary)]">{position.id}</div>
                  </td>
                  <td>{position.status}</td>
                  <td>{(position.unrealizedPnl ?? position.realizedPnl).toFixed(2)}</td>
                </tr>
              ))}
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={3} className="apex-empty-state">
                    {isLoading ? "Loading positions…" : "No paper positions available."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
