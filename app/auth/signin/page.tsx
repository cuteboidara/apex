"use client";

import { FormEvent, Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveSignInErrorMessage } from "@/src/lib/authErrors";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/account";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email: email.trim(),
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError(resolveSignInErrorMessage(result.error));
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
          autoComplete="current-password"
          required
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="••••••••"
          className="apex-form-input"
        />
      </div>

      {error ? (
        <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-4 py-3 text-[13px] text-[var(--apex-status-blocked-text)]">
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={loading} className="apex-button apex-button-amber w-full disabled:opacity-60">
        {loading ? "Signing In" : "Sign In"}
      </button>
    </form>
  );
}

export default function SignInPage() {
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
              <p className="apex-eyebrow">FX Signal Command Surface</p>
              <h1 className="mt-5 font-[var(--apex-font-display)] text-[clamp(60px,7vw,104px)] font-semibold leading-[0.92] tracking-[-0.08em] text-[var(--apex-text-primary)]">
                Precision
                <br />
                signal ops.
              </h1>
              <p className="mt-6 max-w-[440px] text-[17px] leading-8 text-[var(--apex-text-secondary)]">
                One private runtime for eight liquid FX pairs, governed cycle control, and high-signal delivery across trader and admin surfaces.
              </p>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {[
              { label: "Pairs", value: "8", detail: "Focused FX universe" },
              { label: "Strategies", value: "3", detail: "Trend, breakout, mean reversion" },
              { label: "Delivery", value: "Daily", detail: "Scheduled signals with retryable delivery" },
            ].map(item => (
              <div key={item.label} className="apex-admin-kpi">
                <p className="apex-admin-kpi-label">{item.label}</p>
                <p className="apex-admin-kpi-value">{item.value}</p>
                <p className="apex-admin-kpi-detail">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-10 md:px-8">
        <div className="apex-surface w-full max-w-[440px] px-7 py-8 sm:px-8 sm:py-10">
          <div className="mb-8">
            <p className="apex-eyebrow">Private Access</p>
            <h1 className="mt-4 font-[var(--apex-font-display)] text-[34px] font-semibold tracking-[-0.06em] text-[var(--apex-text-primary)]">
              Operator sign in
            </h1>
            <p className="mt-3 text-[15px] leading-7 text-[var(--apex-text-secondary)]">
              Authenticate to access the live trader runtime and unified admin control surface.
            </p>
          </div>

          <Suspense fallback={null}>
            <SignInForm />
          </Suspense>

          <div className="mt-8 flex items-center gap-3 text-[12px] text-[var(--apex-text-tertiary)]">
            <div className="apex-amber-rule" />
            Registration is closed. Operator access is controlled centrally.
          </div>
        </div>
      </section>
    </div>
  );
}
