"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

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
  PENDING:   "text-yellow-400 bg-yellow-400/10",
  APPROVED:  "text-green-400  bg-green-400/10",
  SUSPENDED: "text-orange-400 bg-orange-400/10",
  BANNED:    "text-red-400    bg-red-400/10",
};

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const load = () => {
    setLoading(true);
    fetch(`/api/admin/users/${id}`)
      .then(r => r.json())
      .then(setUser)
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  async function doAction(act: string, reason?: string) {
    setActionLoading(true);
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: act, reason }),
    });
    setActionLoading(false);
    load();
  }

  if (loading) return <div className="text-zinc-500 text-sm">Loading...</div>;
  if (!user)   return <div className="text-red-400 text-sm">User not found.</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/users" className="text-zinc-500 hover:text-zinc-300 text-sm">← Users</Link>
        <h1 className="text-xl font-bold text-zinc-100">{user.name ?? user.email}</h1>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_STYLE[user.status] ?? "text-zinc-400"}`}>
          {user.status}
        </span>
      </div>

      {/* Details card */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 space-y-3">
        <Row label="ID"             value={user.id} mono />
        <Row label="Name"           value={user.name ?? "—"} />
        <Row label="Email"          value={user.email} mono />
        <Row label="Role"           value={user.role} />
        <Row label="Status"         value={user.status} />
        <Row label="Joined"         value={new Date(user.createdAt).toLocaleString()} />
        <Row label="Last Login"     value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"} />
        <Row label="Login Count"    value={String(user.loginCount)} />
        <Row label="Approved At"    value={user.approvedAt ? new Date(user.approvedAt).toLocaleString() : "—"} />
        <Row label="Approved By"    value={user.approvedBy ?? "—"} />
        {user.suspendedReason && (
          <Row label="Suspend Reason" value={user.suspendedReason} />
        )}
      </div>

      {/* Actions */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5">
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          {user.status === "PENDING" && (
            <ActionButton label="Approve" color="green" disabled={actionLoading} onClick={() => doAction("approve")} />
          )}
          {user.status === "APPROVED" && (
            <>
              <ActionButton label="Suspend" color="orange" disabled={actionLoading} onClick={() => doAction("suspend")} />
              <ActionButton label="Ban"     color="red"    disabled={actionLoading} onClick={() => doAction("ban")} />
            </>
          )}
          {user.status === "SUSPENDED" && (
            <ActionButton label="Restore" color="green" disabled={actionLoading} onClick={() => doAction("restore")} />
          )}
          {user.status === "BANNED" && (
            <ActionButton label="Unban" color="green" disabled={actionLoading} onClick={() => doAction("unban")} />
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-4">
      <span className="text-xs text-zinc-500 w-32 flex-shrink-0">{label}</span>
      <span className={`text-sm text-zinc-200 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ActionButton({
  label, color, disabled, onClick,
}: {
  label: string;
  color: "green" | "red" | "orange";
  disabled: boolean;
  onClick: () => void;
}) {
  const colors = {
    green:  "bg-green-500 hover:bg-green-400 text-black",
    red:    "bg-red-600   hover:bg-red-500   text-white",
    orange: "bg-orange-500 hover:bg-orange-400 text-black",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 ${colors[color]}`}
    >
      {disabled ? "..." : label}
    </button>
  );
}
