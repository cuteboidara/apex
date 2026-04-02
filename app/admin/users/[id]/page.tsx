"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

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

const STATUS_STYLE: Record<string, string> = {
  PENDING: "text-yellow-300 bg-yellow-300/10 border-yellow-300/20",
  APPROVED: "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]",
  SUSPENDED: "text-orange-300 bg-orange-300/10 border-orange-300/20",
  BANNED: "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]",
};

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchJsonResponse<AdminUser>(`/api/admin/users/${id}`);
    if (result.ok && result.data) {
      setUser(result.data);
    } else {
      setUser(null);
      setError(formatApiError(result, "User not found."));
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchJsonResponse<AdminUser>(`/api/admin/users/${id}`);
      if (cancelled) {
        return;
      }
      if (result.ok && result.data) {
        setUser(result.data);
        setError(null);
      } else {
        setUser(null);
        setError(formatApiError(result, "User not found."));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function doAction(act: string, reason?: string) {
    setActionLoading(true);
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act, reason }),
    });
    setActionLoading(false);
    void load();
  }

  if (loading) return <div className="apex-empty-state">Loading user detail…</div>;
  if (!user) {
    return (
      <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
        {error ?? "User not found."}
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/users" className="apex-link-button px-3 py-2 text-[10px]">
          Back To Users
        </Link>
        <h1 className="font-[var(--apex-font-display)] text-[32px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          {user.name ?? user.email}
        </h1>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${STATUS_STYLE[user.status] ?? "text-[var(--apex-text-secondary)] border-[var(--apex-border-default)]"}`}>
          {user.status}
        </span>
      </div>

      <div className="apex-surface px-6 py-5">
        <p className="apex-eyebrow">Identity Detail</p>
        <div className="mt-5 grid gap-3">
          <Row label="ID" value={user.id} mono />
          <Row label="Name" value={user.name ?? "—"} />
          <Row label="Email" value={user.email} mono />
          <Row label="Role" value={user.role} />
          <Row label="Status" value={user.status} />
          <Row label="Joined" value={new Date(user.createdAt).toLocaleString()} />
          <Row label="Last Login" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"} />
          <Row label="Login Count" value={String(user.loginCount)} />
          <Row label="Approved At" value={user.approvedAt ? new Date(user.approvedAt).toLocaleString() : "—"} />
          <Row label="Approved By" value={user.approvedBy ?? "—"} />
          {user.suspendedReason ? <Row label="Suspend Reason" value={user.suspendedReason} /> : null}
        </div>
      </div>

      <div className="apex-surface px-6 py-5">
        <p className="apex-eyebrow">Quick Actions</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {user.status === "PENDING" ? (
            <ActionButton label="Approve" color="green" disabled={actionLoading} onClick={() => doAction("approve")} />
          ) : null}
          {user.status === "APPROVED" ? (
            <>
              <ActionButton label="Suspend" color="orange" disabled={actionLoading} onClick={() => doAction("suspend")} />
              <ActionButton label="Ban" color="red" disabled={actionLoading} onClick={() => doAction("ban")} />
            </>
          ) : null}
          {user.status === "SUSPENDED" ? (
            <ActionButton label="Restore" color="green" disabled={actionLoading} onClick={() => doAction("restore")} />
          ) : null}
          {user.status === "BANNED" ? (
            <ActionButton label="Unban" color="green" disabled={actionLoading} onClick={() => doAction("unban")} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="apex-stack-card flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <span className="w-32 flex-shrink-0 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">{label}</span>
      <span className={`text-[14px] text-[var(--apex-text-primary)] ${mono ? "font-[var(--apex-font-mono)] text-[12px]" : "font-[var(--apex-font-body)]"}`}>
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: "green" | "red" | "orange";
  disabled: boolean;
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
      disabled={disabled}
      className={`inline-flex rounded-full border px-4 py-2 text-[10px] font-medium uppercase tracking-[0.12em] transition-all disabled:opacity-40 ${colors[color]}`}
    >
      {disabled ? "..." : label}
    </button>
  );
}
