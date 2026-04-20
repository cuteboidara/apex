"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type SignupResponse = {
  error?: string;
  message?: string;
};

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (password !== confirmPassword) {
      setError("Password and confirmation do not match.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        password,
      }),
    });

    const payload = await response.json().catch(() => ({})) as SignupResponse;
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to create account.");
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setMessage(payload.message ?? "Account created. You can now sign in.");
  }

  return (
    <div className="grid min-h-screen bg-transparent lg:grid-cols-[1.15fr_0.95fr]">
      <section className="relative hidden overflow-hidden border-r border-[var(--apex-border-subtle)] px-12 py-14 lg:block xl:px-16">
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 16% 18%, rgba(141,244,206,0.18), transparent 34%), radial-gradient(circle at 78% 22%, rgba(125,211,252,0.16), transparent 26%), linear-gradient(180deg, rgba(8,15,28,0.52), rgba(4,9,22,0.04))",
          }}
        />
        <div className="relative flex h-full flex-col justify-between">
          <div className="space-y-10">
            <div className="inline-flex items-center gap-4 rounded-[26px] border border-[var(--apex-border-default)] bg-[rgba(255,255,255,0.03)] px-5 py-4 backdrop-blur-xl">
              <div className="apex-sidebar-brand-mark">A</div>
              <div>
                <p className="font-[var(--apex-font-display)] text-[26px] font-semibold tracking-[-0.06em] text-[var(--apex-text-primary)]">
                  APEX
                </p>
                <p className="apex-sidebar-brand-caption">Operator Runtime</p>
              </div>
            </div>

            <div className="max-w-[560px]">
              <p className="apex-eyebrow">Operator Onboarding</p>
              <h1 className="mt-5 font-[var(--apex-font-display)] text-[clamp(56px,7vw,96px)] font-semibold leading-[0.92] tracking-[-0.08em] text-[var(--apex-text-primary)]">
                Create
                <br />
                your access.
              </h1>
              <p className="mt-6 max-w-[440px] text-[17px] leading-8 text-[var(--apex-text-secondary)]">
                New members are created with approval controls enabled. Admins receive signup notifications immediately.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-10 md:px-8">
        <div className="apex-surface w-full max-w-[440px] px-7 py-8 sm:px-8 sm:py-10">
          <div className="mb-8">
            <p className="apex-eyebrow">Private Access</p>
            <h1 className="mt-4 font-[var(--apex-font-display)] text-[34px] font-semibold tracking-[-0.06em] text-[var(--apex-text-primary)]">
              Create account
            </h1>
            <p className="mt-3 text-[15px] leading-7 text-[var(--apex-text-secondary)]">
              Register your operator account. Non-admin accounts require approval before full access.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="apex-form-label">Full Name</label>
              <input
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Operator Name"
                className="apex-form-input"
              />
            </div>

            <div>
              <label className="apex-form-label">Email Address</label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="operator@apex.local"
                className="apex-form-input"
              />
            </div>

            <div>
              <label className="apex-form-label">Password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                className="apex-form-input"
              />
            </div>

            <div>
              <label className="apex-form-label">Confirm Password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                placeholder="Repeat password"
                className="apex-form-input"
              />
            </div>

            {message ? (
              <div className="apex-stack-card border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] px-4 py-3 text-[13px] text-[var(--apex-status-active-text)]">
                {message}
              </div>
            ) : null}

            {error ? (
              <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-4 py-3 text-[13px] text-[var(--apex-status-blocked-text)]">
                {error}
              </div>
            ) : null}

            <button type="submit" disabled={loading} className="apex-button apex-button-amber w-full disabled:opacity-60">
              {loading ? "Creating Account" : "Create Account"}
            </button>
          </form>

          <div className="mt-7 text-[13px] text-[var(--apex-text-secondary)]">
            Already have access?{" "}
            <Link href="/auth/signin" className="text-[var(--apex-text-accent)] hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
