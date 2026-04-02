"use client";

import { useState, useTransition } from "react";

export function PasswordSettingsCard({
  email,
}: {
  email: string;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submitPasswordChange() {
    setMessage(null);
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    const response = await fetch("/api/me/password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword,
        newPassword,
      }),
    });

    const payload = await response.json().catch(() => null) as { error?: string; success?: boolean } | null;
    if (!response.ok) {
      setError(payload?.error ?? "Unable to change password.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage("Password updated. Your current session stays active.");
  }

  return (
    <section className="apex-surface px-6 py-6">
      <div className="flex flex-col gap-2 border-b border-[var(--apex-border-subtle)] pb-4">
        <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Account</p>
        <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Change password</h2>
        <p className="text-[13px] leading-6 text-[var(--apex-text-secondary)]">
          Signed in as <span className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{email}</span>.
          Update your credentials here after first login.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="space-y-5">
          <div>
            <label className="apex-form-label">Current Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              className="apex-form-input"
              placeholder="Current password"
            />
          </div>

          <div>
            <label className="apex-form-label">New Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              className="apex-form-input"
              placeholder="Minimum 8 characters"
            />
          </div>

          <div>
            <label className="apex-form-label">Confirm New Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              className="apex-form-input"
              placeholder="Repeat new password"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => startTransition(() => void submitPasswordChange())}
              disabled={pending}
              className="apex-button apex-button-amber disabled:opacity-60"
            >
              {pending ? "Updating Password" : "Update Password"}
            </button>
          </div>

          {message ? (
            <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] px-4 py-3 text-[13px] text-[var(--apex-status-active-text)]">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-4 py-3 text-[13px] text-[var(--apex-status-blocked-text)]">
              {error}
            </div>
          ) : null}
        </div>

        <div className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Security Notes</p>
          <ul className="mt-4 space-y-3 text-[13px] leading-6 text-[var(--apex-text-secondary)]">
            <li>Use this immediately after a seeded or temporary login.</li>
            <li>New passwords must be at least 8 characters.</li>
            <li>Your current session remains active after the change.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
