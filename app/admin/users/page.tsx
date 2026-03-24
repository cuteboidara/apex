"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
  suspendedReason: string | null;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
}

const TABS = ["ALL", "PENDING", "APPROVED", "SUSPENDED", "BANNED"] as const;
type Tab = typeof TABS[number];

const STATUS_STYLE: Record<string, string> = {
  PENDING:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  APPROVED:  "text-green-400  bg-green-400/10  border-green-400/20",
  SUSPENDED: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  BANNED:    "text-red-400    bg-red-400/10    border-red-400/20",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tab, setTab] = useState<Tab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suspendModal, setSuspendModal] = useState<{ userId: string; name: string } | null>(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async (status: Tab) => {
    setLoading(true);
    setError(null);
    const url = status === "ALL" ? "/api/admin/users" : `/api/admin/users?status=${status}`;
    const result = await fetchJsonResponse<AdminUser[]>(url);
    if (result.ok && Array.isArray(result.data)) {
      setUsers(result.data);
    } else {
      setUsers([]);
      setError(formatApiError(result, "Failed to load users."));
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(tab); }, [tab, load]);

  const pendingCount = users.filter(u => u.status === "PENDING").length;

  async function action(userId: string, act: string, reason?: string) {
    setActionLoading(userId + act);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act, reason }),
    });
    setActionLoading(null);
    void load(tab);
  }

  async function deleteUser(userId: string) {
    if (!confirm("Delete this user permanently?")) return;
    setActionLoading(userId + "delete");
    await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setActionLoading(null);
    void load(tab);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">User Management</h1>
        <p className="text-xs text-zinc-500">Approve, suspend, or ban user accounts</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium tracking-wide transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-[#00ff88] text-[#00ff88]"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
            {t === "PENDING" && pendingCount > 0 && tab !== "PENDING" && (
              <span className="ml-1.5 bg-yellow-500 text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-zinc-500 text-sm">Loading...</div>
      ) : error ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
          {error}
        </div>
      ) : (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Joined</th>
                  <th className="text-left px-4 py-3">Last Login</th>
                  <th className="text-left px-4 py-3">Logins</th>
                  <th className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-zinc-600">No users found</td>
                  </tr>
                )}
                {users.map(u => (
                  <tr key={u.id} className="border-b border-zinc-900 hover:bg-zinc-900/40">
                    <td className="px-4 py-3 text-zinc-100 font-medium">{u.name ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${STATUS_STYLE[u.status] ?? "text-zinc-400"}`}>
                        {u.status}
                      </span>
                      {u.suspendedReason && (
                        <p className="text-[10px] text-orange-400/70 mt-0.5">{u.suspendedReason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-center">{u.loginCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {u.status === "PENDING" && (
                          <>
                            <ActionBtn
                              label="Approve"
                              color="green"
                              loading={actionLoading === u.id + "approve"}
                              onClick={() => action(u.id, "approve")}
                            />
                            <ActionBtn
                              label="Reject"
                              color="red"
                              loading={actionLoading === u.id + "delete"}
                              onClick={() => deleteUser(u.id)}
                            />
                          </>
                        )}
                        {u.status === "APPROVED" && (
                          <>
                            <ActionBtn
                              label="Suspend"
                              color="orange"
                              loading={actionLoading === u.id + "suspend"}
                              onClick={() => setSuspendModal({ userId: u.id, name: u.name ?? u.email })}
                            />
                            <ActionBtn
                              label="Ban"
                              color="red"
                              loading={actionLoading === u.id + "ban"}
                              onClick={() => action(u.id, "ban")}
                            />
                          </>
                        )}
                        {u.status === "SUSPENDED" && (
                          <ActionBtn
                            label="Restore"
                            color="green"
                            loading={actionLoading === u.id + "restore"}
                            onClick={() => action(u.id, "restore")}
                          />
                        )}
                        {u.status === "BANNED" && (
                          <ActionBtn
                            label="Unban"
                            color="green"
                            loading={actionLoading === u.id + "unban"}
                            onClick={() => action(u.id, "unban")}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Suspend modal */}
      {suspendModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-zinc-100 font-semibold mb-1">Suspend {suspendModal.name}</h3>
            <p className="text-zinc-500 text-xs mb-4">Provide a reason (optional, shown to admin)</p>
            <textarea
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
              rows={3}
              placeholder="Reason for suspension..."
              value={suspendReason}
              onChange={e => setSuspendReason(e.target.value)}
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  void action(suspendModal.userId, "suspend", suspendReason || undefined);
                  setSuspendModal(null);
                  setSuspendReason("");
                }}
                className="flex-1 py-2 bg-orange-500 hover:bg-orange-400 text-black text-sm font-semibold rounded-lg transition-colors"
              >
                Confirm Suspend
              </button>
              <button
                onClick={() => { setSuspendModal(null); setSuspendReason(""); }}
                className="flex-1 py-2 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  label, color, loading, onClick,
}: {
  label: string;
  color: "green" | "red" | "orange";
  loading: boolean;
  onClick: () => void;
}) {
  const colors = {
    green:  "bg-green-500/10 text-green-400 hover:bg-green-500/20 border-green-500/20",
    red:    "bg-red-500/10   text-red-400   hover:bg-red-500/20   border-red-500/20",
    orange: "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border-orange-500/20",
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`text-xs px-2.5 py-1 rounded border font-medium transition-colors disabled:opacity-40 ${colors[color]}`}
    >
      {loading ? "..." : label}
    </button>
  );
}
