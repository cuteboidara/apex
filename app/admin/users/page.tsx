"use client";

import { useCallback, useEffect, useState } from "react";

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
  PENDING: "text-yellow-300 bg-yellow-300/10 border-yellow-300/20",
  APPROVED: "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]",
  SUSPENDED: "text-orange-300 bg-orange-300/10 border-orange-300/20",
  BANNED: "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]",
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = tab === "ALL" ? "/api/admin/users" : `/api/admin/users?status=${tab}`;
      const result = await fetchJsonResponse<AdminUser[]>(url);
      if (cancelled) {
        return;
      }
      if (result.ok && Array.isArray(result.data)) {
        setUsers(result.data);
        setError(null);
      } else {
        setUsers([]);
        setError(formatApiError(result, "Failed to load users."));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const pendingCount = users.filter(user => user.status === "PENDING").length;

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
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Operator Access</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          User approvals and lifecycle actions
        </h2>
        <p className="mt-3 text-[14px] leading-7 text-[var(--apex-text-secondary)]">
          Review pending access, suspend accounts, and restore operator access without leaving the unified control surface.
        </p>
      </section>

      <div className="apex-tab-row">
        {TABS.map(item => (
          <button key={item} onClick={() => setTab(item)} data-active={tab === item} className="apex-tab-button">
            {item}
            {item === "PENDING" && pendingCount > 0 && tab !== "PENDING" ? (
              <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-yellow-300 px-1.5 py-0.5 text-[9px] font-bold text-[#04111f]">
                {pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="apex-empty-state">Loading user registry…</div>
      ) : error ? (
        <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
          {error}
        </div>
      ) : (
        <div className="apex-table-shell overflow-hidden">
          <div className="overflow-x-auto px-6 py-5">
            <table className="apex-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Last Login</th>
                  <th>Logins</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="apex-empty-state">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map(user => (
                    <tr key={user.id}>
                      <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">{user.name ?? "—"}</td>
                      <td>{user.email}</td>
                      <td>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${STATUS_STYLE[user.status] ?? "text-[var(--apex-text-secondary)] border-[var(--apex-border-default)]"}`}>
                          {user.status}
                        </span>
                        {user.suspendedReason ? (
                          <p className="mt-2 text-[11px] text-orange-200/80">{user.suspendedReason}</p>
                        ) : null}
                      </td>
                      <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}</td>
                      <td>{user.loginCount}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {user.status === "PENDING" ? (
                            <>
                              <ActionBtn label="Approve" color="green" loading={actionLoading === user.id + "approve"} onClick={() => action(user.id, "approve")} />
                              <ActionBtn label="Reject" color="red" loading={actionLoading === user.id + "delete"} onClick={() => deleteUser(user.id)} />
                            </>
                          ) : null}
                          {user.status === "APPROVED" ? (
                            <>
                              <ActionBtn label="Suspend" color="orange" loading={actionLoading === user.id + "suspend"} onClick={() => setSuspendModal({ userId: user.id, name: user.name ?? user.email })} />
                              <ActionBtn label="Ban" color="red" loading={actionLoading === user.id + "ban"} onClick={() => action(user.id, "ban")} />
                            </>
                          ) : null}
                          {user.status === "SUSPENDED" ? (
                            <ActionBtn label="Restore" color="green" loading={actionLoading === user.id + "restore"} onClick={() => action(user.id, "restore")} />
                          ) : null}
                          {user.status === "BANNED" ? (
                            <ActionBtn label="Unban" color="green" loading={actionLoading === user.id + "unban"} onClick={() => action(user.id, "unban")} />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {suspendModal ? (
        <div className="apex-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="apex-modal-card w-full max-w-md">
            <h3 className="font-[var(--apex-font-display)] text-[26px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
              Suspend {suspendModal.name}
            </h3>
            <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">Provide a reason if you want the suspension context visible in admin review.</p>
            <textarea
              className="apex-form-textarea mt-5"
              rows={3}
              placeholder="Reason for suspension..."
              value={suspendReason}
              onChange={event => setSuspendReason(event.target.value)}
            />
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => {
                  void action(suspendModal.userId, "suspend", suspendReason || undefined);
                  setSuspendModal(null);
                  setSuspendReason("");
                }}
                className="apex-button apex-button-amber flex-1"
              >
                Confirm Suspend
              </button>
              <button
                onClick={() => {
                  setSuspendModal(null);
                  setSuspendReason("");
                }}
                className="apex-button apex-button-muted flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionBtn({
  label,
  color,
  loading,
  onClick,
}: {
  label: string;
  color: "green" | "red" | "orange";
  loading: boolean;
  onClick: () => void;
}) {
  const colors = {
    green: "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]",
    red: "border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]",
    orange: "border-yellow-300/20 bg-yellow-300/10 text-yellow-300",
  };

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`inline-flex rounded-full border px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] transition-all disabled:opacity-40 ${colors[color]}`}
    >
      {loading ? "..." : label}
    </button>
  );
}
