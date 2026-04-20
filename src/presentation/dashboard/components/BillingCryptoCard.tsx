"use client";

import { useEffect, useMemo, useState } from "react";

type Plan = {
  id: string;
  slug: string;
  name: string;
  tier: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  features: string[];
};

type SubscriptionResponse = {
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    plan: {
      name: string;
      slug: string;
      tier: string;
    } | null;
  } | null;
  payments: Array<{
    id: string;
    status: string;
    provider: string;
    amountUsd: number;
    assetSymbol: string | null;
    amountCrypto: number | null;
    checkoutUrl: string;
    createdAt: string;
    expiresAt: string | null;
  }>;
};

type PlansResponse = { plans: Plan[] };

type BillingCycle = "monthly" | "annual";

function formatUsd(cents: number | null) {
  if (!cents || cents <= 0) {
    return "N/A";
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function BillingCryptoCard() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionResponse["subscription"]>(null);
  const [payments, setPayments] = useState<SubscriptionResponse["payments"]>([]);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [loading, setLoading] = useState(true);
  const [processingPlanSlug, setProcessingPlanSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const activeSubscriptionLabel = useMemo(() => {
    if (!subscription) {
      return "No active subscription";
    }
    const planName = subscription.plan?.name ?? "Unknown plan";
    const status = subscription.status;
    const end = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "N/A";
    return `${planName} (${status}) · Renews ${end}`;
  }, [subscription]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    setError(null);

    const [plansRes, subscriptionRes] = await Promise.all([
      fetch("/api/billing/plans", { cache: "no-store" }),
      fetch("/api/billing/subscription", { cache: "no-store" }),
    ]);

    const plansPayload = await plansRes.json().catch(() => null) as PlansResponse | null;
    const subscriptionPayload = await subscriptionRes.json().catch(() => null) as SubscriptionResponse | null;

    if (!plansRes.ok || !subscriptionRes.ok) {
      setError("Unable to load billing data.");
      setLoading(false);
      return;
    }

    setPlans(plansPayload?.plans ?? []);
    setSubscription(subscriptionPayload?.subscription ?? null);
    setPayments(subscriptionPayload?.payments ?? []);
    setLoading(false);
  }

  async function startCheckout(planSlug: string) {
    setProcessingPlanSlug(planSlug);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/billing/crypto/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planSlug, billingCycle }),
    });

    const payload = await response.json().catch(() => null) as {
      error?: string;
      checkoutUrl?: string;
    } | null;

    if (!response.ok || !payload?.checkoutUrl) {
      setError(payload?.error ?? "Unable to start checkout.");
      setProcessingPlanSlug(null);
      return;
    }

    window.open(payload.checkoutUrl, "_blank", "noopener,noreferrer");
    setMessage("Checkout opened in a new tab. Complete payment, then refresh this page.");
    setProcessingPlanSlug(null);
    void refresh();
  }

  return (
    <section className="apex-surface px-6 py-6">
      <div className="flex flex-col gap-2 border-b border-[var(--apex-border-subtle)] pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Billing</p>
          <h2 className="text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Crypto subscription checkout</h2>
          <p className="text-[13px] leading-6 text-[var(--apex-text-secondary)]">{activeSubscriptionLabel}</p>
        </div>
        <div className="inline-flex gap-2 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] p-1">
          {(["monthly", "annual"] as BillingCycle[]).map(cycle => (
            <button
              key={cycle}
              type="button"
              onClick={() => setBillingCycle(cycle)}
              className={`rounded-[calc(var(--apex-radius-md)-4px)] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] ${
                billingCycle === cycle
                  ? "bg-[var(--apex-amber-soft)] text-[var(--apex-amber)]"
                  : "text-[var(--apex-text-tertiary)] hover:text-[var(--apex-text-primary)]"
              }`}
            >
              {cycle}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-[13px] text-[var(--apex-text-tertiary)]">Loading billing data...</div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {plans.map(plan => (
            <div key={plan.id} className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
              <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">{plan.tier}</p>
              <h3 className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">{plan.name}</h3>
              <p className="mt-1 text-[14px] text-[var(--apex-text-secondary)]">
                {billingCycle === "monthly" ? formatUsd(plan.monthlyPriceCents) : formatUsd(plan.annualPriceCents)} / {billingCycle}
              </p>

              <ul className="mt-4 space-y-2 text-[12px] leading-5 text-[var(--apex-text-secondary)]">
                {plan.features.map(feature => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => void startCheckout(plan.slug)}
                disabled={processingPlanSlug === plan.slug}
                className="apex-button apex-button-amber mt-5 w-full disabled:opacity-60"
              >
                {processingPlanSlug === plan.slug ? "Creating Checkout" : "Pay With Crypto"}
              </button>
            </div>
          ))}
        </div>
      )}

      {message ? (
        <div className="mt-5 rounded-[var(--apex-radius-md)] border border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] px-4 py-3 text-[13px] text-[var(--apex-status-active-text)]">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-[var(--apex-radius-md)] border border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-4 py-3 text-[13px] text-[var(--apex-status-blocked-text)]">
          {error}
        </div>
      ) : null}

      {payments.length > 0 ? (
        <div className="mt-6">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">Recent payments</p>
          <div className="mt-3 space-y-2">
            {payments.map(payment => (
              <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-3 text-[12px]">
                <div className="text-[var(--apex-text-secondary)]">
                  <span className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{payment.status}</span>
                  {" · "}
                  {formatUsd(payment.amountUsd)}
                  {payment.assetSymbol ? ` · ${payment.assetSymbol}` : ""}
                </div>
                <div className="text-[var(--apex-text-tertiary)]">
                  {new Date(payment.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

