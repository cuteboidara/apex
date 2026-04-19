"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

type PendingUser = {
  id: string;
  name: string | null;
  email: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
};

export default function AdminUserApprovalsPage() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const result = await fetchJsonResponse<PendingUser[]>("/api/admin/users?status=PENDING");

    if (result.ok && Array.isArray(result.data)) {
      setUsers(result.data);
      setError(null);
    } else {
      setUsers([]);
      setError(formatApiError(result, "Failed to load pending approvals."));
    }

    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function approve(userId: string) {
    setActionLoading(`${userId}:approve`);
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    setActionLoading(null);
    await load();
  }

  async function reject(userId: string) {
    if (!confirm("Reject and delete this pending user?")) return;
    setActionLoading(`${userId}:reject`);
    await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    setActionLoading(null);
    await load();
  }

  return (
    <div className="space-y-6 p-6">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Approvals</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Pending user approvals
        </h2>
        <p className="mt-3 text-[14px] leading-7 text-[var(--apex-text-secondary)]">
          Review pending accounts and approve or reject access requests.
        </p>
      </section>

      {loading ? (
        <div className="apex-empty-state">Loading pending users...</div>
      ) : error ? (
        <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
          {error}
        </div>
      ) : (
        <div className="apex-table-shell overflow-hidden">
          <div className="overflow-x-auto px-6 py-5">
            <table className="apex-table min-w-[900px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Joined</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="apex-empty-state">No pending approvals.</td>
                  </tr>
                ) : (
                  users.map(user => (
                    <tr key={user.id}>
                      <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">{user.name ?? "-"}</td>
                      <td>{user.email}</td>
                      <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => void approve(user.id)}
                            disabled={actionLoading === `${user.id}:approve`}
                            className="inline-flex rounded-full border border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--apex-status-active-text)] disabled:opacity-40"
                          >
                            {actionLoading === `${user.id}:approve` ? "..." : "Approve"}
                          </button>
                          <button
                            onClick={() => void reject(user.id)}
                            disabled={actionLoading === `${user.id}:reject`}
                            className="inline-flex rounded-full border border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--apex-status-blocked-text)] disabled:opacity-40"
                          >
                            {actionLoading === `${user.id}:reject` ? "..." : "Reject"}
                          </button>
                          <Link href={`/admin/users/${user.id}`} className="inline-flex rounded-full border border-[var(--apex-border-default)] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--apex-text-secondary)] hover:text-[var(--apex-text-primary)]">
                            Open
                          </Link>
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
    </div>
  );
}
